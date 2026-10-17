import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// erase_household_data, as it stands (20261018120000):
//  · W0 (audit 2026-10-04, DB-INT-05) — it used to end with an activity_log row whose action the
//    table's CHECK rejects, so every erase rolled back.
//  · R1 (13 Oct 2026) — W4e's debts_refuse_unpaid_delete made it roll back again for any household
//    with an unpaid loan. The guard here is the REAL one, read from the W4e migration.
//  · XC-PRV-08 / DB-SEC-08 — it now erases every household table that holds money or words, and the
//    household's shared splits (owner's decision: deleted for everyone). The coverage test fails when
//    a new household table is in neither the erased nor the kept list.

const MIGRATIONS = new URL('../../../../supabase/migrations/', import.meta.url);
const ERASE_SQL = readFileSync(new URL('20261018120000_erase_household_complete.sql', MIGRATIONS), 'utf8');
const W4E_SQL = readFileSync(new URL('20261016120000_w4e_loan_model.sql', MIGRATIONS), 'utf8');
const SCHEMA_SQL = readFileSync(new URL('../../../../db/schema.sql', import.meta.url), 'utf8');

/** One `create or replace function public.<name>` statement, verbatim from a migration. */
function fn(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  const bodyStart = sql.indexOf('$$', start);
  const bodyEnd = sql.indexOf('$$;', bodyStart + 2);
  return sql.slice(start, bodyEnd + 3);
}

const db = new PGlite();
const owner = '10000000-0000-4000-8000-000000000001';
const member = '10000000-0000-4000-8000-000000000002';
const household = '20000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000002';
const LOAN = '30000000-0000-4000-8000-000000000001';
const LOAN_ACC = '40000000-0000-4000-8000-000000000001';
const BANK = '40000000-0000-4000-8000-000000000002';

/** Tables with only (id, household_id) in this fixture: the function deletes them by household. */
const simpleTables = ['budgets', 'budget_allocations', 'goals', 'assets', 'recurring_schedules', 'saved_views',
  'net_worth_snapshots', 'notifications', 'whatsapp_inbound_messages', 'whatsapp_pending_turns',
  'whatsapp_rule_state', 'agent_conversations', 'agent_pending_intents', 'ask_vyact_relay'];

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function public.recently_reauthenticated(p_max_age_seconds int default 600) returns boolean language sql as
      $$ select coalesce(current_setting('test.reauth', true), 'on') = 'on' $$;
    create table households (id uuid primary key, onboarding jsonb not null default '{}'::jsonb);
    create table memberships (household_id uuid, user_id uuid, role text);
    ${simpleTables.map(t => `create table ${t} (id uuid primary key default gen_random_uuid(), household_id uuid);`).join('\n')}
    create table accounts (id uuid primary key default gen_random_uuid(), household_id uuid, kind text,
      opening_balance numeric not null default 0, reconciliation_offset numeric, debt_id uuid,
      created_at timestamptz not null default now(), deleted_at timestamptz);
    create table debts (id uuid primary key default gen_random_uuid(), household_id uuid, type text not null,
      current_balance numeric not null check (current_balance >= 0), direction text default 'owed_by_me',
      deleted_at timestamptz);
    create table transactions (id uuid primary key default gen_random_uuid(), household_id uuid, type text,
      amount numeric, account_id uuid, to_account_id uuid, deleted_at timestamptz);
    create table loan_payment_events (operation_id uuid primary key default gen_random_uuid(), household_id uuid not null,
      debt_id uuid references debts(id) on delete cascade);
    create table shared_splits (id uuid primary key default gen_random_uuid(), owner_household_id uuid not null,
      txn_id uuid references transactions(id) on delete set null);
    create table shared_split_shares (id uuid primary key default gen_random_uuid(),
      split_id uuid not null references shared_splits(id) on delete cascade, email text);
    create table activity_log (
      id uuid primary key default gen_random_uuid(), household_id uuid not null, actor_id uuid,
      action text not null check (action in ('created','updated','deleted','invited','accepted','removed','role_changed','transferred')),
      entity_type text not null, entity_id uuid, changes jsonb, created_at timestamptz not null default now());
    insert into households values ('${household}', '{"step":3}'), ('${other}', '{}');
    insert into memberships values ('${household}','${owner}','owner'), ('${household}','${member}','member');
  `);
  // The real W4e guard: a debt with money owed cannot be deleted while its household exists.
  await db.exec([fn(W4E_SQL, 'loan_ledger_balance'), fn(W4E_SQL, 'loan_outstanding'),
    fn(W4E_SQL, 'debts_refuse_unpaid_delete'),
    `create trigger trg_debts_refuse_unpaid_delete before update of deleted_at or delete on public.debts
       for each row execute function public.debts_refuse_unpaid_delete();`].join('\n'));
  await db.exec(ERASE_SQL);
}, 30000);
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  await db.exec(`
    delete from shared_split_shares; delete from shared_splits; delete from loan_payment_events;
    delete from transactions; delete from accounts;
    alter table debts disable trigger trg_debts_refuse_unpaid_delete; delete from debts;
    alter table debts enable trigger trg_debts_refuse_unpaid_delete;
    delete from activity_log;
    select set_config('test.reauth', 'on', false);`);
  for (const t of simpleTables) {
    await db.exec(`delete from ${t}; insert into ${t}(household_id) values ('${household}'), ('${other}');`);
  }
  await db.exec(`
    -- A loan with ₹50,000 owed: its account opens at −50,000 and one ₹5,000 principal leg has been paid.
    insert into debts (id, household_id, type, current_balance) values ('${LOAN}', '${household}', 'personal_loan', 45000);
    insert into debts (household_id, type, current_balance) values ('${other}', 'home_loan', 90000);
    insert into accounts (id, household_id, kind, opening_balance, debt_id) values
      ('${LOAN_ACC}', '${household}', 'loan', -50000, '${LOAN}'), ('${BANK}', '${household}', 'bank', 100000, null);
    insert into accounts (household_id, kind) values ('${other}', 'bank');
    insert into transactions (household_id, type, amount, account_id, to_account_id) values
      ('${household}', 'transfer', 5000, '${BANK}', '${LOAN_ACC}'), ('${other}', 'expense', 100, null, null);
    insert into loan_payment_events (household_id, debt_id) values ('${household}', '${LOAN}');
    insert into shared_splits (id, owner_household_id) values
      ('50000000-0000-4000-8000-000000000001', '${household}'), ('50000000-0000-4000-8000-000000000002', '${other}');
    insert into shared_split_shares (split_id, email) values
      ('50000000-0000-4000-8000-000000000001', 'a@example.com'), ('50000000-0000-4000-8000-000000000002', 'b@example.com');
    insert into activity_log(household_id, action, entity_type) values ('${household}','created','transaction'), ('${other}','created','transaction');
    update households set onboarding = '{"step":3}' where id = '${household}';`);
});

const asUser = (uid: string) => db.exec(`select set_config('request.jwt.claim.sub','${uid}',false)`);
const count = async (table: string, hid: string, col = 'household_id') =>
  (await db.query<{ n: number }>(`select count(*)::int as n from ${table} where ${col} = $1`, [hid])).rows[0].n;
const ERASED_HERE = [...simpleTables, 'transactions', 'accounts', 'debts', 'loan_payment_events'];

describe('erase_household_data', () => {
  it('CON-UNIT-W0-001 - the old audit action is exactly what the activity_log CHECK rejects', async () => {
    await expect(db.exec(`insert into activity_log(household_id, action, entity_type)
      values ('${household}','erase_household_data','household')`)).rejects.toThrow(/check/i);
  });

  it('CON-UNIT-W0-002 / R1-001 - an owner erase commits, even with an unpaid loan: every table emptied, one audit row', async () => {
    await asUser(owner);
    await db.query('select erase_household_data($1)', [household]);
    for (const t of ERASED_HERE) expect(await count(t, household), t).toBe(0);
    expect(await count('shared_splits', household, 'owner_household_id')).toBe(0);
    const log = await db.query<{ action: string; changes: { kind: string } }>(
      'select action, changes from activity_log where household_id = $1', [household]);
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].action).toBe('deleted');
    expect(log.rows[0].changes.kind).toBe('erase_household_data');
    const onboarding = await db.query<{ onboarding: object }>('select onboarding from households where id = $1', [household]);
    expect(onboarding.rows[0].onboarding).toEqual({});
  });

  it('R1-002 - outside the erase, the loan guard still refuses to delete a debt with money owed', async () => {
    await expect(db.exec(`delete from debts where id = '${LOAN}'`)).rejects.toThrow(/debt_not_paid_off/);
  });

  it('CON-UNIT-W0-003 - another household is untouched, its splits and loan included', async () => {
    await asUser(owner);
    await db.query('select erase_household_data($1)', [household]);
    for (const t of [...simpleTables, 'transactions', 'accounts', 'debts']) expect(await count(t, other), t).toBe(1);
    expect(await count('shared_splits', other, 'owner_household_id')).toBe(1);
    expect((await db.query<{ n: number }>('select count(*)::int as n from shared_split_shares')).rows[0].n).toBe(1);
    expect(await count('activity_log', other)).toBe(1);
  });

  it('XC-PRV-08-001 - the household\'s shared splits are deleted with their shares (owner decision)', async () => {
    await asUser(owner);
    await db.query('select erase_household_data($1)', [household]);
    const shares = await db.query<{ email: string }>('select email from shared_split_shares');
    expect(shares.rows.map(r => r.email)).toEqual(['b@example.com']);
  });

  it('CON-UNIT-W0-004 - a plain member is refused and nothing is erased', async () => {
    await asUser(member);
    await expect(db.query('select erase_household_data($1)', [household])).rejects.toThrow(/not authorized/);
    for (const t of simpleTables) expect(await count(t, household)).toBe(1);
    expect(await count('debts', household)).toBe(1);
  });

  it('R1-003 - without a recent sign-in the erase is refused and nothing changes', async () => {
    await asUser(owner);
    await db.exec(`select set_config('test.reauth', 'off', false)`);
    await expect(db.query('select erase_household_data($1)', [household])).rejects.toThrow(/reauth_required/);
    expect(await count('transactions', household)).toBe(1);
  });

  it('XC-PRV-08-002 - every household table is either erased or explicitly kept', () => {
    // Tables keyed by a household that are NOT the household's money or words (owner, 13 Oct 2026).
    const KEEP = ['memberships', 'invitations', 'subscriptions', 'whatsapp_identities', 'whatsapp_verification_otps',
      'push_subscriptions', 'ai_usage', 'ai_feedback', 'exchange_rates'];
    const tables = new Set<string>();
    const re = /create table (?:if not exists )?(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\n\);/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(SCHEMA_SQL)) !== null) {
      if (/^\s*(owner_)?household_id\s/m.test(m[2])) tables.add(m[1]);
    }
    // …and a household column added to an existing table later.
    for (const a of SCHEMA_SQL.matchAll(/alter table (?:if exists )?(?:only )?(?:public\.)?([a-z_]+)\s+add column (?:if not exists )?(?:owner_)?household_id\b/gi)) {
      tables.add(a[1]);
    }
    const erased = new Set([...ERASE_SQL.matchAll(/delete from ([a-z_]+)\s+where (?:owner_)?household_id = h_id/g)].map(x => x[1]));
    const unclassified = [...tables].filter(t => !erased.has(t) && !KEEP.includes(t)).sort();
    expect(unclassified, 'classify each new household table: erase it or add it to KEEP').toEqual([]);
    expect([...erased].filter(t => KEEP.includes(t))).toEqual([]);
    expect(tables.size).toBeGreaterThan(20);
  });
});
