import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// T2C-001..008 — v10.117.0 (Track T2, part c; audit DB-SEC-09, DB-INT-09; owner decisions 18 Oct 2026:
// T2 reopens Batch E, DB-INT-09 "all three guards"). Every link an entry, an account or a schedule makes
// stays inside its household; Cash in Hand is never archived or deleted; an account is deleted only by the
// delete functions, and for good; and an entry never makes a NEW link to a deleted account or investment,
// while editing an old one still works.
// Runs the real migrations over a fixture shaped like today's tables and policies: the S3 tenant checks,
// the current account_dependencies (R2), then T2c. PGlite has one connection, so a delete racing a write
// can't be run here: the share lock that serialises them is checked on the function's text instead.

const db = new PGlite();
const mig = (f: string) => readFileSync(new URL(`../../../../supabase/migrations/${f}`, import.meta.url), 'utf8');
const T2C = '20261102120000_t2c_ledger_integrity.sql';

const ASHA = '10000000-0000-4000-8000-00000000000a';    // owner of H
const RAVI = '10000000-0000-4000-8000-00000000000b';    // member of H
const BEN = '10000000-0000-4000-8000-00000000000c';     // owner of B, another household
const H = '20000000-0000-4000-8000-000000000001';
const B = '20000000-0000-4000-8000-000000000002';
const M_ASHA = '30000000-0000-4000-8000-000000000001';
const M_RAVI = '30000000-0000-4000-8000-000000000002';
const M_BEN = '30000000-0000-4000-8000-000000000003';
const CASH = '40000000-0000-4000-8000-000000000001';
const HDFC = '40000000-0000-4000-8000-000000000002';
const ICICI = '40000000-0000-4000-8000-000000000003';
const OLD = '40000000-0000-4000-8000-000000000004';     // H's account, deleted before T2c, with history
const B_CASH = '40000000-0000-4000-8000-000000000009';   // B's Cash, archived before T2c
const B_BANK = '40000000-0000-4000-8000-00000000000b';
const FUND = '50000000-0000-4000-8000-000000000001';    // H's mutual fund
const GONE_FUND = '50000000-0000-4000-8000-000000000002'; // H's, deleted
const B_FUND = '50000000-0000-4000-8000-000000000009';
const B_DEBT = '60000000-0000-4000-8000-000000000009';
const B_SCHED = '70000000-0000-4000-8000-000000000009';
const OLD_ENTRY = '80000000-0000-4000-8000-000000000001'; // a live entry on OLD
const OLD_GONE_ENTRY = '80000000-0000-4000-8000-000000000002'; // a deleted entry on OLD
const OLD_BUY = '80000000-0000-4000-8000-000000000003';  // a buy into GONE_FUND, written before it went

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
    create table debts (id uuid primary key, household_id uuid not null references households(id), deleted_at timestamptz);
    create table accounts (
      id uuid primary key default gen_random_uuid(), household_id uuid not null references households(id) on delete cascade,
      asset_id uuid references assets(id) on delete set null, debt_id uuid references debts(id) on delete set null,
      kind text not null, name text not null, currency text not null default 'INR',
      is_default boolean not null default false, is_archived boolean not null default false,
      opening_balance numeric not null default 0, reconciliation_offset numeric not null default 0,
      reconciliation_log jsonb not null default '[]'::jsonb, source text,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);
    create unique index uq_account_cash_per_household on accounts (household_id) where kind = 'cash' and deleted_at is null;
    create unique index uq_account_default_per_household on accounts (household_id) where is_default and not is_archived and deleted_at is null;
    create table recurring_schedules (id uuid primary key default gen_random_uuid(), household_id uuid not null references households(id),
      owner_member_id uuid references memberships(id) on delete set null, txn_template jsonb not null default '{}'::jsonb,
      deleted_at timestamptz);
    create table transactions (
      id uuid primary key default gen_random_uuid(), household_id uuid not null references households(id),
      account_id uuid references accounts(id) on delete set null, to_account_id uuid references accounts(id) on delete set null,
      member_id uuid references memberships(id) on delete set null, initiated_by uuid references memberships(id) on delete set null,
      debt_id uuid references debts(id) on delete set null, asset_id uuid references assets(id) on delete restrict,
      recurring_schedule_id uuid references recurring_schedules(id) on delete set null,
      type text not null default 'expense', amount numeric not null default 0, date date not null default current_date,
      category text, description text, deleted_at timestamptz);
    create table shared_splits (id uuid primary key default gen_random_uuid(), owner_user_id uuid, owner_household_id uuid,
      txn_id uuid, closed_at timestamptz);
    create table loan_payment_events (id uuid primary key default gen_random_uuid(), loan_account_id uuid);
    create table budgets (id uuid primary key, household_id uuid);
    create table budget_allocations (id uuid primary key default gen_random_uuid(), budget_id uuid, household_id uuid);

    -- Row security as it stands on main.
    alter table accounts enable row level security;
    create policy "accounts_read" on accounts for select to authenticated using (is_member(household_id));
    create policy "accounts_insert" on accounts for insert to authenticated with check (role_in(household_id) in ('owner','admin','member'));
    create policy "accounts_update" on accounts for update to authenticated
      using (role_in(household_id) in ('owner','admin','member')) with check (role_in(household_id) in ('owner','admin','member'));
    create policy "accounts_delete" on accounts for delete to authenticated using (role_in(household_id) in ('owner','admin'));
    alter table transactions enable row level security;
    create policy "transactions_read" on transactions for select to authenticated using (is_member(household_id));
    create policy "transactions_insert" on transactions for insert with check (role_in(household_id) in ('owner', 'admin', 'member'));
    create policy "transactions_update" on transactions for update using (role_in(household_id) in ('owner', 'admin', 'member'));
    alter table recurring_schedules enable row level security;
    create policy "recurring_all" on recurring_schedules for all using (is_member(household_id)) with check (is_member(household_id));
    alter table assets enable row level security;
    create policy "assets_all" on assets for all using (is_member(household_id)) with check (is_member(household_id));
    grant select, insert, update, delete on accounts, transactions, recurring_schedules, assets, debts to authenticated;
    grant select on memberships, households to authenticated;

    insert into households values ('${H}', 'Sharma family', 'INR'), ('${B}', 'Other family', 'INR');
    insert into memberships values ('${M_ASHA}', '${H}', '${ASHA}', 'owner'), ('${M_RAVI}', '${H}', '${RAVI}', 'member'),
      ('${M_BEN}', '${B}', '${BEN}', 'owner');
    insert into assets values ('${FUND}', '${H}', 'Index fund', null), ('${GONE_FUND}', '${H}', 'Old fund', null),
      ('${B_FUND}', '${B}', 'Their fund', null);
    insert into debts values ('${B_DEBT}', '${B}', null);
    insert into accounts (id, household_id, kind, name, is_default, is_archived, deleted_at) values
      ('${CASH}', '${H}', 'cash', 'Cash in Hand', false, false, null),
      ('${HDFC}', '${H}', 'bank', 'HDFC', true, false, null),
      ('${ICICI}', '${H}', 'bank', 'ICICI', false, false, null),
      ('${OLD}', '${H}', 'bank', 'Old bank', false, false, null),
      -- B's Cash was archived through a direct write (the bypass T2c closes); it was B's default.
      ('${B_CASH}', '${B}', 'cash', 'Cash in Hand', true, true, null),
      ('${B_BANK}', '${B}', 'bank', 'B bank', false, false, null);
    insert into recurring_schedules (id, household_id, txn_template) values ('${B_SCHED}', '${B}', '{}');
    insert into transactions (id, household_id, account_id, amount) values
      ('${OLD_ENTRY}', '${H}', '${OLD}', 500), ('${OLD_GONE_ENTRY}', '${H}', '${OLD}', 70);
    insert into transactions (id, household_id, type, account_id, asset_id, amount) values
      ('${OLD_BUY}', '${H}', 'investment', '${HDFC}', '${GONE_FUND}', 1000);
  `);
  await db.exec(mig('20260909120000_audit_s3_tenant_consistency.sql'));
  const r2 = mig('20260910150000_r2_accounts_card_metadata_delete_guard.sql');
  await db.exec(r2.slice(r2.indexOf('-- ── 4a.'), r2.indexOf('-- ── 4b.')));
  // Before T2c: the old account and the old fund go (their live entries stay, as production may have).
  await db.exec(`update accounts set deleted_at = now() - interval '1 day' where id = '${OLD}';
    update transactions set deleted_at = now() - interval '2 days' where id = '${OLD_GONE_ENTRY}';
    update assets set deleted_at = now() - interval '1 day' where id = '${GONE_FUND}';`);
  await db.exec(mig(T2C));
}, 60000);
afterAll(async () => { await db.close(); });

/** As PostgREST runs a signed-in person's request: their id, the 'authenticated' claim and role. */
async function asUser<T>(uid: string, sql: string, params: unknown[] = []) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false);
    select set_config('request.jwt.claims', '{"role":"authenticated","sub":"${uid}"}', false); set role authenticated;`);
  try { return await db.query<T>(sql, params); }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`); }
}
/** Several statements as ONE request (one transaction), as a signed-in person. */
async function asUserScript(uid: string, script: string) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false);
    select set_config('request.jwt.claims', '{"role":"authenticated","sub":"${uid}"}', false); set role authenticated;`);
  try { await db.exec(`begin; ${script} commit;`); }
  catch (e) { await db.exec('rollback').catch(() => undefined); throw e; }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`); }
}
const one = async <T>(sql: string) => (await db.query<T>(sql)).rows[0];
const count = async (sql: string) => (await one<{ n: number }>(`select count(*)::int as n from (${sql}) q`)).n;
const newEntry = (uid: string, cols: Record<string, unknown>) => {
  const keys = Object.keys(cols);
  return asUser(uid, `insert into transactions (household_id, ${keys.join(', ')}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})`,
    [H, ...keys.map(k => cols[k])]);
};

describe('links stay inside the household (DB-SEC-09)', () => {
  it('T2C-001 · an entry can\'t point at another household\'s investment, schedule or member; its own still work', async () => {
    await expect(newEntry(RAVI, { type: 'investment', account_id: HDFC, asset_id: B_FUND, amount: 100 }))
      .rejects.toThrow(/asset_id belongs to a different household/);
    await expect(newEntry(RAVI, { account_id: HDFC, recurring_schedule_id: B_SCHED, amount: 1 }))
      .rejects.toThrow(/recurring_schedule_id belongs to a different household/);
    await expect(newEntry(RAVI, { account_id: HDFC, initiated_by: M_BEN, amount: 1 }))
      .rejects.toThrow(/initiated_by belongs to a different household/);
    await expect(newEntry(RAVI, { account_id: B_BANK, amount: 1 })).rejects.toThrow(/account_id belongs to a different household/);
    await newEntry(RAVI, { type: 'investment', account_id: HDFC, asset_id: FUND, initiated_by: M_RAVI, member_id: M_RAVI, amount: 100 });
    // Which is what kept B from being erased: nothing of H's now holds B's fund.
    expect(await count(`select 1 from transactions where asset_id = '${B_FUND}'`)).toBe(0);
  });

  it('T2C-002 · an account\'s investment and loan, and a schedule\'s owner and template accounts, are the household\'s own', async () => {
    await expect(asUser(RAVI, `update accounts set asset_id = $1 where id = $2`, [B_FUND, ICICI])).rejects.toThrow(/accounts.asset_id belongs/);
    await expect(asUser(RAVI, `update accounts set debt_id = $1 where id = $2`, [B_DEBT, ICICI])).rejects.toThrow(/accounts.debt_id belongs/);
    await expect(asUser(RAVI, `insert into accounts (household_id, kind, name, asset_id) values ($1, 'bank', 'x', $2)`, [H, B_FUND]))
      .rejects.toThrow(/accounts.asset_id belongs/);
    await asUser(RAVI, `update accounts set asset_id = $1 where id = $2`, [FUND, ICICI]);
    const sched = (owner: string | null, template: Record<string, string>) => asUser(RAVI,
      `insert into recurring_schedules (household_id, owner_member_id, txn_template) values ($1, $2, $3)`, [H, owner, JSON.stringify(template)]);
    await expect(sched(M_BEN, {})).rejects.toThrow(/owner_member_id belongs/);
    await expect(sched(M_RAVI, { accountId: B_BANK })).rejects.toThrow(/txn_template.accountId belongs/);
    await expect(sched(M_RAVI, { toAccountId: B_BANK })).rejects.toThrow(/txn_template.toAccountId belongs/);
    await expect(sched(M_RAVI, { assetId: B_FUND })).rejects.toThrow(/txn_template.assetId belongs/);
    // The household's own, a legacy non-UUID id, and an id that names nothing are all left alone.
    await sched(M_RAVI, { accountId: HDFC, toAccountId: 'cash', assetId: '90000000-0000-4000-8000-000000000000' });
    await expect(asUser(RAVI, `update recurring_schedules set txn_template = txn_template || $1::jsonb where owner_member_id = $2`,
      [JSON.stringify({ accountId: B_BANK }), M_RAVI])).rejects.toThrow(/txn_template.accountId belongs/);
  });
});

describe('Cash in Hand and deleting an account (DB-INT-09)', () => {
  it('T2C-003 · Cash in Hand can be renamed, never archived, deleted or converted — from the app, even by the owner', async () => {
    await asUser(ASHA, `update accounts set name = 'Wallet cash' where id = $1`, [CASH]);
    for (const [why, sql] of [
      ['archive', `update accounts set is_archived = true where id = '${CASH}'`],
      ['delete', `update accounts set deleted_at = now() where id = '${CASH}'`],
      ['convert', `update accounts set kind = 'bank' where id = '${CASH}'`],
      ['become cash', `update accounts set kind = 'cash' where id = '${ICICI}'`],
    ] as const) {
      await expect(asUser(ASHA, sql), why).rejects.toThrow(/cash_account_protected/);
    }
    await expect(asUser(ASHA, `select delete_account($1)`, [CASH])).rejects.toThrow(/cash_account_protected/);
    expect(await one(`select name, kind, is_archived, deleted_at from accounts where id = '${CASH}'`))
      .toEqual({ name: 'Wallet cash', kind: 'cash', is_archived: false, deleted_at: null });
  });

  it('T2C-004 · an account is deleted only by delete_account / move_account_and_delete, and stays deleted; other accounts still archive', async () => {
    await expect(asUser(ASHA, `update accounts set deleted_at = now() where id = $1`, [ICICI])).rejects.toThrow(/account_delete_guarded/);
    // A hard delete matches nothing now (the app never used it; it emptied every entry's account).
    const del = await asUser(ASHA, `delete from accounts where id = $1`, [ICICI]);
    expect(del.affectedRows ?? 0).toBe(0);
    expect(await count(`select 1 from accounts where id = '${ICICI}'`)).toBe(1);
    // Archiving any other account still works, for a member too.
    await asUser(RAVI, `update accounts set is_archived = true where id = $1`, [ICICI]);
    await asUser(RAVI, `update accounts set is_archived = false where id = $1`, [ICICI]);
    // The delete function still deletes (an unused account), and the flag doesn't outlive it.
    const spare = (await one<{ id: string }>(`insert into accounts (household_id, kind, name) values ('${H}', 'bank', 'Spare') returning id`)).id;
    await asUser(ASHA, `select delete_account($1)`, [spare]);
    expect((await one<{ gone: boolean }>(`select deleted_at is not null as gone from accounts where id = '${spare}'`)).gone).toBe(true);
    // One request that calls the delete function and then tombstones another account directly: the
    // second write is still refused, and the whole request rolls back.
    const spare2 = (await one<{ id: string }>(`insert into accounts (household_id, kind, name) values ('${H}', 'bank', 'Spare 2') returning id`)).id;
    await expect(asUserScript(ASHA, `select delete_account('${spare2}'); update accounts set deleted_at = now() where id = '${ICICI}';`))
      .rejects.toThrow(/account_delete_guarded/);
    expect(await one(`select deleted_at from accounts where id = '${ICICI}'`)).toEqual({ deleted_at: null });
    expect(await one(`select deleted_at from accounts where id = '${spare2}'`)).toEqual({ deleted_at: null });
    // A deleted account stays deleted.
    await expect(asUser(ASHA, `update accounts set deleted_at = null where id = $1`, [spare])).rejects.toThrow(/account_delete_final/);
    // A delete still refuses an account with live history (unchanged).
    await expect(asUser(ASHA, `select delete_account($1)`, [HDFC])).rejects.toThrow(/account_in_use/);
  });

  it('T2C-005 · move_account_and_delete still moves every entry (deleted ones too) onto the other account and deletes the source', async () => {
    const card = (await one<{ id: string }>(`insert into accounts (household_id, kind, name) values ('${H}', 'bank', 'To move') returning id`)).id;
    await newEntry(RAVI, { account_id: card, amount: 42 });
    await db.exec(`insert into transactions (household_id, account_id, amount, deleted_at) values ('${H}', '${card}', 9, now())`);
    const out = await asUser<{ r: { status: string; transactions: number } }>(ASHA, `select move_account_and_delete($1, $2) as r`, [card, ICICI]);
    expect(out.rows[0].r).toEqual(expect.objectContaining({ status: 'moved', transactions: 2 }));
    expect(await count(`select 1 from transactions where account_id = '${card}'`)).toBe(0);
    expect((await one<{ gone: boolean }>(`select deleted_at is not null as gone from accounts where id = '${card}'`)).gone).toBe(true);
  });
});

describe('no new link to a deleted account or investment (DB-INT-09)', () => {
  it('T2C-006 · a new entry, a changed account or a revived entry can\'t land on a deleted account; editing an old entry still works', async () => {
    // A queued save from a phone that hadn't heard of the delete: refused (the app sets it aside).
    await expect(newEntry(RAVI, { account_id: OLD, amount: 5000 })).rejects.toThrow(/account_deleted/);
    await expect(newEntry(RAVI, { type: 'transfer', account_id: HDFC, to_account_id: OLD, amount: 10 })).rejects.toThrow(/account_deleted/);
    // The same save as the app sends it (an upsert of a new id): refused too.
    await expect(asUser(RAVI, `insert into transactions (id, household_id, account_id, amount) values (gen_random_uuid(), $1, $2, 1)
      on conflict (id) do update set amount = excluded.amount`, [H, OLD])).rejects.toThrow(/account_deleted/);
    // Moving an entry onto it: refused.
    const mine = (await one<{ id: string }>(`insert into transactions (household_id, account_id, amount) values ('${H}', '${HDFC}', 30) returning id`)).id;
    await expect(asUser(RAVI, `update transactions set account_id = $1 where id = $2`, [OLD, mine])).rejects.toThrow(/account_deleted/);
    await expect(asUser(RAVI, `update transactions set to_account_id = $1, type = 'transfer' where id = $2`, [OLD, mine]))
      .rejects.toThrow(/account_deleted/);
    expect(await one(`select account_id, to_account_id from transactions where id = '${mine}'`)).toEqual({ account_id: HDFC, to_account_id: null });
    // Bringing back a deleted entry that was on it: refused.
    await expect(asUser(RAVI, `update transactions set deleted_at = null where id = $1`, [OLD_GONE_ENTRY])).rejects.toThrow(/account_deleted/);
    // An old entry on it can still be edited (as an update, and as the app's upsert), and deleted.
    await asUser(RAVI, `update transactions set amount = 550, description = 'fixed' where id = $1`, [OLD_ENTRY]);
    await asUser(RAVI, `insert into transactions (id, household_id, account_id, amount) values ($1, $2, $3, 560)
      on conflict (id) do update set amount = excluded.amount`, [OLD_ENTRY, H, OLD]);
    expect(await one(`select amount::int as amount from transactions where id = '${OLD_ENTRY}'`)).toEqual({ amount: 560 });
    await asUser(RAVI, `update transactions set deleted_at = now() where id = $1`, [OLD_ENTRY]);
    // A phone syncing an entry it already deleted makes no live link, so it still lands.
    await newEntry(RAVI, { account_id: OLD, amount: 3, deleted_at: new Date().toISOString() });
    // The server's own writers are held to it too (a WhatsApp or scheduled write runs without the app's claim).
    await expect(db.exec(`insert into transactions (household_id, account_id, amount) values ('${H}', '${OLD}', 1)`)).rejects.toThrow(/account_deleted/);
  });

  it('T2C-007 · the same for a deleted investment: no new buy into it; an old buy still edits', async () => {
    await expect(newEntry(RAVI, { type: 'investment', account_id: HDFC, asset_id: GONE_FUND, amount: 100 })).rejects.toThrow(/asset_deleted/);
    await expect(asUser(RAVI, `update transactions set asset_id = $1 where asset_id = $2 and deleted_at is null`, [GONE_FUND, FUND]))
      .rejects.toThrow(/asset_deleted/);
    await asUser(RAVI, `update transactions set amount = 1200 where id = $1`, [OLD_BUY]);
    expect(await one(`select amount::int as amount from transactions where id = '${OLD_BUY}'`)).toEqual({ amount: 1200 });
  });

  it('T2C-008 · the account or investment is locked while a new link is written, so a delete at the same moment waits for it', async () => {
    const src = (await one<{ src: string }>(`select prosrc as src from pg_proc where proname = 'assert_txn_tenant_consistency'`)).src;
    expect(src).toMatch(/from public\.accounts a\s+where \(acc_new and a\.id = new\.account_id\) or \(to_new and a\.id = new\.to_account_id\)\s+order by a\.id\s+for share/);
    expect(src).toMatch(/from public\.assets a where a\.id = new\.asset_id for share/);
    expect((await one<{ d: boolean }>(`select prosecdef as d from pg_proc where proname = 'assert_txn_tenant_consistency'`)).d).toBe(true);
    // delete_account takes the account FOR UPDATE before counting, which is what the share lock waits on.
    const del = (await one<{ src: string }>(`select prosrc as src from pg_proc where proname = 'delete_account'`)).src;
    expect(del).toMatch(/where id = p_account_id and deleted_at is null\s+for update/);
  });
});

describe('Cash in Hand is never handed back archived (DB-INT-09)', () => {
  it('T2C-009 · the migration restored B\'s archived Cash (still its default: no other); ensure_cash_account restores one too', async () => {
    expect(await one(`select is_archived, is_default from accounts where id = '${B_CASH}'`)).toEqual({ is_archived: false, is_default: true });
    // Archived again outside the app (no 'authenticated' claim), with another default in place.
    await db.exec(`update accounts set is_archived = true, is_default = true where id = '${B_CASH}';
      update accounts set is_default = true where id = '${B_BANK}';`);
    const r = await asUser<{ r: { id: string; is_archived: boolean } }>(BEN, `select ensure_cash_account($1) as r`, [B]);
    expect(r.rows[0].r).toEqual(expect.objectContaining({ id: B_CASH, is_archived: false }));
    expect(await one(`select is_default from accounts where id = '${B_CASH}'`)).toEqual({ is_default: false });
    expect(await count(`select 1 from accounts where household_id = '${B}' and kind = 'cash'`)).toBe(1);
  });
});
