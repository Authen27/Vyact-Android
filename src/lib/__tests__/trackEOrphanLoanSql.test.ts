import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// TE7-SQL-001..003 — Track E, E7 (v10.102.0; owner decisions E-8 and 14 Oct 2026 "reconcile to zero +
// archive"; audit FE-MNY-04 part 1): a loan account whose loan was deleted before v10.74 is cleared exactly
// as "Mark paid off" clears a loan — offset + dated log, never a transaction — then archived.

const db = new PGlite();
const HH = '20000000-0000-4000-8000-0000000000f7';
const ids = {
  goneDebt: '40000000-0000-4000-8000-000000000001', liveDebt: '40000000-0000-4000-8000-000000000002',
  orphan: '50000000-0000-4000-8000-000000000001', orphanZero: '50000000-0000-4000-8000-000000000002',
  liveLoan: '50000000-0000-4000-8000-000000000003', unlinked: '50000000-0000-4000-8000-000000000004',
  bank: '50000000-0000-4000-8000-000000000005', cleared: '50000000-0000-4000-8000-000000000006',
};
const EARLIER = '2026-10-01 12:00:00+00';
const read = (name: string) => readFileSync(new URL(`../../../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const MIGRATION = read('20261024120000_clear_orphan_loan_accounts.sql');
/** The production ledger function, taken from the W4e migration itself. */
const LEDGER_FN = read('20261016120000_w4e_loan_model.sql').match(/create or replace function public\.loan_ledger_balance[\s\S]*?\$\$;/)![0];

interface Row { id: string; is_archived: boolean; reconciliation_offset: string; reconciliation_log: { delta: number; kind: string; stated_value: number; note: string }[]; last_reconciled_at: string | null; updated_at: string; ledger: string }
const accounts = async () => (await db.query<Row>(`select id, is_archived, reconciliation_offset::text, reconciliation_log, last_reconciled_at::text,
  updated_at::text, public.loan_ledger_balance(id)::text as ledger from accounts order by id`)).rows;
const byId = async (id: string) => (await accounts()).find(r => r.id === id)!;

beforeAll(async () => {
  await db.exec(`
    set timezone = 'UTC';
    create table debts (id uuid primary key, household_id uuid, name text, deleted_at timestamptz);
    create table accounts (
      id uuid primary key, household_id uuid not null, kind text not null, name text, currency text default 'INR',
      opening_balance numeric not null default 0, reconciliation_offset numeric not null default 0,
      reconciliation_log jsonb not null default '[]', last_reconciled_at timestamptz,
      is_archived boolean not null default false, debt_id uuid references debts(id) on delete set null,
      updated_at timestamptz not null default '${EARLIER}', deleted_at timestamptz);
    create table transactions (id uuid primary key default gen_random_uuid(), account_id uuid, to_account_id uuid,
      type text, amount numeric, deleted_at timestamptz);
    insert into debts values ('${ids.goneDebt}', '${HH}', 'Car loan', '${EARLIER}'), ('${ids.liveDebt}', '${HH}', 'Home loan', null);
    insert into accounts (id, household_id, kind, name, opening_balance, debt_id, is_archived) values
      ('${ids.orphan}',     '${HH}', 'loan', 'Car loan',   -100000, '${ids.goneDebt}', false),
      ('${ids.orphanZero}', '${HH}', 'loan', 'Bike loan',  -5000,   '${ids.goneDebt}', false),
      ('${ids.liveLoan}',   '${HH}', 'loan', 'Home loan',  -900000, '${ids.liveDebt}', false),
      ('${ids.unlinked}',   '${HH}', 'loan', 'Old loan',   -40000,  null,              false),
      ('${ids.bank}',       '${HH}', 'bank', 'HDFC',        500000, null,              false),
      ('${ids.cleared}',    '${HH}', 'loan', 'Done loan',   0,      '${ids.goneDebt}', true);
    -- Payments into the orphan (it owes 80,000), and the one that cleared the bike loan.
    insert into transactions (account_id, to_account_id, type, amount) values
      ('${ids.bank}', '${ids.orphan}', 'transfer', 20000), ('${ids.bank}', '${ids.orphanZero}', 'transfer', 5000);
  `);
  await db.exec(LEDGER_FN);
  await db.exec(MIGRATION);
}, 60000);
afterAll(async () => { await db.close(); });

describe('E7 — loan accounts whose loan was deleted are cleared and archived', () => {
  it('TE7-SQL-001 · an orphan goes to zero through its offset with a dated log, never a transaction, and is archived', async () => {
    const orphan = await byId(ids.orphan);
    expect(orphan).toMatchObject({ is_archived: true, reconciliation_offset: '80000', ledger: '0' });
    expect(orphan.reconciliation_log).toEqual([expect.objectContaining({ delta: 80000, kind: 'loan', stated_value: 0,
      note: 'Loan deleted before v10.74: balance cleared' })]);
    expect(orphan.last_reconciled_at).not.toBeNull();
    expect(orphan.updated_at > EARLIER).toBe(true);
    // One already at zero is archived, with no log entry.
    expect(await byId(ids.orphanZero)).toMatchObject({ is_archived: true, reconciliation_offset: '0', reconciliation_log: [], last_reconciled_at: null, ledger: '0' });
    // No transaction was written.
    expect((await db.query<{ n: number }>('select count(*)::int as n from transactions')).rows[0].n).toBe(2);
  });

  it('TE7-SQL-002 · a live loan, a loan account with no link, a bank account and an already-cleared one are untouched', async () => {
    for (const id of [ids.liveLoan, ids.unlinked, ids.bank, ids.cleared]) {
      expect(await byId(id)).toMatchObject({ reconciliation_offset: '0', reconciliation_log: [], updated_at: EARLIER });
    }
    expect(await byId(ids.liveLoan)).toMatchObject({ is_archived: false, ledger: '-900000' });
    expect(await byId(ids.unlinked)).toMatchObject({ is_archived: false, ledger: '-40000' });
  });

  it('TE7-SQL-003 · idempotent: a second run changes nothing', async () => {
    const before = await accounts();
    await db.exec(MIGRATION);
    expect(await accounts()).toEqual(before);
  });
});
