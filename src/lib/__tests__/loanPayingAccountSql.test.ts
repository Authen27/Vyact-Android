import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// LPA-SQL-001..006 — v10.119.0 (owner decisions, 19 Oct 2026). A loan that records its EMIs automatically always
// has an account to pay from. `loan_payment_core` refuses a missing, deleted, archived, non-bank or foreign
// paying account, so such a loan used to stop recording silently. Now:
//   * the migration switches "Record automatically" off for every loan whose paying account is unusable;
//   * a loan can only be set to record from a live bank or cash account of its own household;
//   * the account can't be deleted (delete_account) or archived (from the app) while such a loan pays from it;
//   * moving the account's history carries the loans with it.
// Runs the real T2c migration (the delete functions and lifecycle guard it extends) and this one over a fixture
// shaped like today's tables.

const db = new PGlite();
const mig = (f: string) => readFileSync(new URL(`../../../../supabase/migrations/${f}`, import.meta.url), 'utf8');

const ASHA = '10000000-0000-4000-8000-00000000000a';    // owner of H
const BEN = '10000000-0000-4000-8000-00000000000c';     // owner of B
const H = '20000000-0000-4000-8000-000000000001';
const B = '20000000-0000-4000-8000-000000000002';
const HDFC = '40000000-0000-4000-8000-000000000001';
const ICICI = '40000000-0000-4000-8000-000000000002';
const GONE = '40000000-0000-4000-8000-000000000003';    // deleted
const SHELVED = '40000000-0000-4000-8000-000000000004'; // archived
const CARD = '40000000-0000-4000-8000-000000000005';
const B_BANK = '40000000-0000-4000-8000-000000000009';
const loanId = (n: number) => `60000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;

    create table households (id uuid primary key, name text not null, base_currency text not null default 'INR');
    create table memberships (id uuid primary key default gen_random_uuid(), household_id uuid not null references households(id),
      user_id uuid, role text not null);
    create function public.is_member(h uuid) returns boolean language sql stable security definer as
      $$ select exists (select 1 from memberships where household_id = h and user_id = auth.uid()) $$;
    create function public.role_in(h uuid) returns text language sql stable security definer as
      $$ select role from memberships where household_id = h and user_id = auth.uid() limit 1 $$;
    create table assets (id uuid primary key, household_id uuid not null references households(id), name text, deleted_at timestamptz);
    create table debts (id uuid primary key, household_id uuid not null references households(id), name text not null,
      direction text default 'owed_by_me', auto_record boolean not null default false, funding_account_id uuid,
      paid_off_at timestamptz, updated_at timestamptz not null default now(), deleted_at timestamptz);
    create table accounts (
      id uuid primary key default gen_random_uuid(), household_id uuid not null references households(id) on delete cascade,
      asset_id uuid references assets(id) on delete set null, debt_id uuid references debts(id) on delete set null,
      kind text not null, name text not null, currency text not null default 'INR',
      is_default boolean not null default false, is_archived boolean not null default false,
      opening_balance numeric not null default 0, reconciliation_offset numeric not null default 0,
      reconciliation_log jsonb not null default '[]'::jsonb, source text,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);
    alter table debts add constraint debts_funding_fk foreign key (funding_account_id) references accounts(id) on delete set null;
    create unique index uq_account_cash_per_household on accounts (household_id) where kind = 'cash' and deleted_at is null;
    create unique index uq_account_default_per_household on accounts (household_id) where is_default and not is_archived and deleted_at is null;
    create table recurring_schedules (id uuid primary key default gen_random_uuid(), household_id uuid not null references households(id),
      owner_member_id uuid references memberships(id) on delete set null, txn_template jsonb not null default '{}'::jsonb, deleted_at timestamptz);
    create table transactions (
      id uuid primary key default gen_random_uuid(), household_id uuid not null references households(id),
      account_id uuid references accounts(id) on delete set null, to_account_id uuid references accounts(id) on delete set null,
      member_id uuid references memberships(id) on delete set null, initiated_by uuid references memberships(id) on delete set null,
      debt_id uuid references debts(id) on delete set null, asset_id uuid references assets(id) on delete restrict,
      recurring_schedule_id uuid references recurring_schedules(id) on delete set null,
      type text not null default 'expense', amount numeric not null default 0, date date not null default current_date,
      category text, description text, deleted_at timestamptz);
    create table shared_splits (id uuid primary key default gen_random_uuid(), owner_user_id uuid, owner_household_id uuid, txn_id uuid, closed_at timestamptz);
    create table loan_payment_events (id uuid primary key default gen_random_uuid(), loan_account_id uuid);

    alter table accounts enable row level security;
    create policy "accounts_read" on accounts for select to authenticated using (is_member(household_id));
    create policy "accounts_update" on accounts for update to authenticated
      using (role_in(household_id) in ('owner','admin','member')) with check (role_in(household_id) in ('owner','admin','member'));
    alter table debts enable row level security;
    create policy "debts_all" on debts for all to authenticated using (is_member(household_id)) with check (is_member(household_id));
    grant select, insert, update, delete on accounts, debts, transactions, recurring_schedules, assets to authenticated;
    grant select on memberships, households to authenticated;

    insert into households values ('${H}', 'Sharma family', 'INR'), ('${B}', 'Other family', 'INR');
    insert into memberships (household_id, user_id, role) values ('${H}', '${ASHA}', 'owner'), ('${B}', '${BEN}', 'owner');
    insert into accounts (id, household_id, kind, name, is_archived, deleted_at) values
      ('${HDFC}', '${H}', 'bank', 'HDFC', false, null), ('${ICICI}', '${H}', 'bank', 'ICICI', false, null),
      ('${GONE}', '${H}', 'bank', 'Old bank', false, now() - interval '1 day'),
      ('${SHELVED}', '${H}', 'bank', 'Shelved', true, null), ('${CARD}', '${H}', 'credit_card', 'Card', false, null),
      ('${B_BANK}', '${B}', 'bank', 'Their bank', false, null);
    -- The loans as production may hold them, before this release.
    insert into debts (id, household_id, name, auto_record, funding_account_id, direction, paid_off_at) values
      ('${loanId(1)}', '${H}', 'Car loan', true, '${HDFC}', 'owed_by_me', null),          -- fine: stays on
      ('${loanId(2)}', '${H}', 'Gone-account loan', true, '${GONE}', 'owed_by_me', null),
      ('${loanId(3)}', '${H}', 'Shelved-account loan', true, '${SHELVED}', 'owed_by_me', null),
      ('${loanId(4)}', '${H}', 'No-account loan', true, null, 'owed_by_me', null),
      ('${loanId(5)}', '${H}', 'Card-paid loan', true, '${CARD}', 'owed_by_me', null),
      ('${loanId(6)}', '${H}', 'Foreign-account loan', true, '${B_BANK}', 'owed_by_me', null),
      ('${loanId(7)}', '${H}', 'Paid-off loan', true, '${GONE}', 'owed_by_me', now()),    -- not live: left alone
      ('${loanId(8)}', '${H}', 'Hand-paid loan', false, '${HDFC}', 'owed_by_me', null);
  `);
  await db.exec(mig('20261102120000_t2c_ledger_integrity.sql'));
  await db.exec(mig('20261104120000_loan_paying_account.sql'));
}, 60000);
afterAll(async () => { await db.close(); });

async function asUser<T>(uid: string, sql: string, params: unknown[] = []) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false);
    select set_config('request.jwt.claims', '{"role":"authenticated","sub":"${uid}"}', false); set role authenticated;`);
  try { return await db.query<T>(sql, params); }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`); }
}
const one = async <T>(sql: string) => (await db.query<T>(sql)).rows[0];
const auto = async (n: number) => (await one<{ a: boolean }>(`select auto_record as a from debts where id = '${loanId(n)}'`)).a;

describe('loans that record automatically (v10.119.0)', () => {
  it('LPA-SQL-001 · the migration switched recording off for every live loan with no usable paying account, and nothing else', async () => {
    expect(await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(auto))).toEqual([true, false, false, false, false, false, true, false]);
    // Nothing else changed on them: still owed, still pointing where they did.
    expect(await one(`select count(*)::int as n from debts where deleted_at is null and paid_off_at is null`)).toEqual({ n: 7 });
    expect(await one(`select funding_account_id from debts where id = '${loanId(2)}'`)).toEqual({ funding_account_id: GONE });
  });

  it('LPA-SQL-002 · a loan records automatically only from a live bank or cash account of its own household', async () => {
    const turnOn = (n: number, account: string | null) => asUser(ASHA,
      `update debts set auto_record = true, funding_account_id = $1 where id = $2`, [account, loanId(n)]);
    for (const [why, account] of [['none', null], ['deleted', GONE], ['archived', SHELVED], ['card', CARD]] as const) {
      await expect(turnOn(4, account), why).rejects.toThrow(/loan_needs_paying_account/);
    }
    await expect(turnOn(4, B_BANK)).rejects.toThrow(/funding_account_id belongs to a different household/);
    await turnOn(4, ICICI);
    expect(await auto(4)).toBe(true);
    // Moving a recording loan onto an archived account is refused too; a hand-paid loan may point anywhere of its own.
    await expect(asUser(ASHA, `update debts set funding_account_id = $1 where id = $2`, [SHELVED, loanId(4)])).rejects.toThrow(/loan_needs_paying_account/);
    await asUser(ASHA, `update debts set funding_account_id = $1 where id = $2`, [SHELVED, loanId(8)]);
    await asUser(ASHA, `update debts set funding_account_id = $1 where id = $2`, [HDFC, loanId(8)]);
  });

  it('LPA-SQL-003 · account_dependencies lists the loans recording from an account; delete_account refuses while there are any', async () => {
    const deps = await asUser<{ d: { loans: { id: string; name: string }[] } }>(ASHA, `select account_dependencies($1) as d`, [HDFC]);
    expect(deps.rows[0].d.loans).toEqual([{ id: loanId(1), name: 'Car loan' }]);   // not the hand-paid one
    await expect(asUser(ASHA, `select delete_account($1)`, [HDFC])).rejects.toThrow(/account_in_use/);
    expect(await one(`select deleted_at from accounts where id = '${HDFC}'`)).toEqual({ deleted_at: null });
  });

  it('LPA-SQL-004 · from the app, archiving an account a loan records from is refused, naming the loan', async () => {
    await expect(asUser(ASHA, `update accounts set is_archived = true where id = $1`, [HDFC]))
      .rejects.toThrow(/account_pays_a_loan: Car loan records its EMIs from this account/);
    expect(await one(`select is_archived from accounts where id = '${HDFC}'`)).toEqual({ is_archived: false });
    // An account no recording loan uses still archives.
    await asUser(ASHA, `update accounts set is_archived = true where id = $1`, [CARD]);
    expect(await one(`select is_archived from accounts where id = '${CARD}'`)).toEqual({ is_archived: true });
  });

  it('LPA-SQL-005 · moving the history carries every loan paid from the account, then deletes it', async () => {
    const r = await asUser<{ r: { status: string; loans: number } }>(ASHA, `select move_account_and_delete($1, $2) as r`, [HDFC, ICICI]);
    expect(r.rows[0].r).toEqual(expect.objectContaining({ status: 'moved', loans: 2 }));   // the car loan and the hand-paid one
    expect((await db.query(`select id from debts where funding_account_id = '${HDFC}'`)).rows).toEqual([]);
    expect(await one(`select funding_account_id, auto_record from debts where id = '${loanId(1)}'`)).toEqual({ funding_account_id: ICICI, auto_record: true });
    expect((await one<{ gone: boolean }>(`select deleted_at is not null as gone from accounts where id = '${HDFC}'`)).gone).toBe(true);
  });

  it('LPA-SQL-006 · deleting an account only a hand-paid loan names clears that default; nothing records from a deleted account', async () => {
    const spare = (await one<{ id: string }>(`insert into accounts (household_id, kind, name) values ('${H}', 'bank', 'Spare') returning id`)).id;
    await asUser(ASHA, `update debts set funding_account_id = $1 where id = $2`, [spare, loanId(8)]);
    await asUser(ASHA, `select delete_account($1)`, [spare]);
    expect(await one(`select funding_account_id from debts where id = '${loanId(8)}'`)).toEqual({ funding_account_id: null });
    // Every live loan that records automatically now points at a live, unarchived bank or cash account.
    expect(await one(`select count(*)::int as n from debts d left join accounts a on a.id = d.funding_account_id
      where d.deleted_at is null and d.paid_off_at is null and d.auto_record
        and (a.id is null or a.deleted_at is not null or a.is_archived or a.kind not in ('bank','cash'))`)).toEqual({ n: 0 });
  });
});
