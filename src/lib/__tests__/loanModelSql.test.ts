import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// W4e (v10.74.0; owner decisions D19, D17, D30) — the loan model in Postgres: the outstanding is the
// loan account's ledger; pay_loan computes the split per instalment on a reducing balance; only the
// latest payment can be undone, atomically; a loan with money owed cannot be deleted; cards are accounts.

const db = new PGlite();
const OWNER = '10000000-0000-4000-8000-0000000000f1';
const VIEWER = '10000000-0000-4000-8000-0000000000f2';
const HH = '20000000-0000-4000-8000-0000000000f1';
const BANK = '40000000-0000-4000-8000-0000000000f1';
const CARD_LINKED_ACC = '40000000-0000-4000-8000-0000000000f2';
const LOAN = '30000000-0000-4000-8000-0000000000f1';       // the loan the payment tests use
const LEGACY = '30000000-0000-4000-8000-0000000000f2';     // no account, a payment log, estimated terms
const CARD_NEW = '30000000-0000-4000-8000-0000000000f3';   // card debt with no account
const CARD_LINKED = '30000000-0000-4000-8000-0000000000f4'; // card debt with its account
const PAID = '30000000-0000-4000-8000-0000000000f5';       // nothing owed
const LOG_ID = '60000000-0000-4000-8000-0000000000f1';

const as = (user: string) => db.exec(`select set_config('request.jwt.claim.sub', '${user}', false)`);
const op = () => crypto.randomUUID();
type Result = Record<string, unknown> & { debt: Record<string, unknown>; transactions: Array<Record<string, unknown>> };
async function pay(kind: string, amount: number | string, extra: { date?: string; choice?: string; bi?: number; bp?: number; id?: string; debt?: string } = {}) {
  const r = await db.query<{ r: Result }>(
    `select pay_loan($1::uuid, $2::uuid, $3, $4::numeric, $5::date, $6::uuid, null, null, $7, $8::numeric, $9::numeric) as r`,
    [extra.id ?? op(), extra.debt ?? LOAN, kind, String(amount), extra.date ?? '2026-11-05', BANK, extra.choice ?? null,
     extra.bi ?? null, extra.bp ?? null]);
  return r.rows[0].r;
}
const fail = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { const err = e as { message: string; detail?: string }; return { message: err.message, detail: err.detail }; }
  throw new Error('expected a refusal');
};
const owed = async (debt = LOAN) => Number((await db.query<{ o: string }>(
  `select loan_outstanding(d)::text as o from debts d where id = $1`, [debt])).rows[0].o);
const debtRow = async (id = LOAN) => (await db.query<Record<string, unknown>>(
  `select current_balance::float8 as balance, minimum_payment::float8 as emi, instalments_paid, due_date::text as due,
          paid_off_at is not null as paid_off, deleted_at is not null as deleted from debts where id = $1`, [id])).rows[0];
const legs = async () => (await db.query<{ type: string; amount: number; category: string | null }>(
  `select type, amount::float8 as amount, category from transactions where debt_id = '${LOAN}' and deleted_at is null order by type`)).rows;

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    insert into auth.users values ('${OWNER}'), ('${VIEWER}');
    create table households (id uuid primary key, base_currency text not null default 'INR');
    create table memberships (id uuid primary key default gen_random_uuid(), household_id uuid, user_id uuid, role text);
    create function is_member(hid uuid) returns boolean language sql as
      $$ select exists(select 1 from memberships where household_id = hid and user_id = auth.uid()) $$;
    create table accounts (id uuid primary key default gen_random_uuid(), household_id uuid, kind text, name text, currency text,
      opening_balance numeric not null default 0, reconciliation_offset numeric, reconciliation_log jsonb, last_reconciled_at timestamptz,
      is_archived boolean not null default false, debt_id uuid, payment_modes text[] not null default '{}',
      created_at timestamptz not null default now(), updated_at timestamptz default now(), deleted_at timestamptz);
    create table debts (id uuid primary key default gen_random_uuid(), household_id uuid references households(id) on delete cascade, type text not null, name text not null,
      principal numeric, current_balance numeric not null check (current_balance >= 0), interest_rate numeric not null,
      minimum_payment numeric not null check (minimum_payment >= 0), due_date date, currency text not null default 'INR',
      direction text default 'owed_by_me', extras jsonb, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(), deleted_at timestamptz);
    create table transactions (id uuid primary key default gen_random_uuid(), household_id uuid, created_by uuid, member_id uuid,
      amount numeric check (amount > 0), currency text, type text, category text, account_id uuid, to_account_id uuid, debt_id uuid,
      date date, description text, extras jsonb, updated_at timestamptz default now(), deleted_at timestamptz,
      check ((type = 'expense' and account_id is not null and to_account_id is null and category is not null)
          or (type = 'transfer' and account_id is not null and to_account_id is not null and category is null)));
    create table loan_payment_events (operation_id uuid primary key, household_id uuid not null, debt_id uuid not null,
      expense_txn_id uuid, transfer_txn_id uuid, loan_account_id uuid, amount numeric not null, interest numeric not null,
      principal numeric not null, created_at timestamptz not null default now(), request jsonb);

    insert into households values ('${HH}', 'INR');
    insert into memberships (household_id, user_id, role) values ('${HH}', '${OWNER}', 'owner'), ('${HH}', '${VIEWER}', 'viewer');
    insert into accounts (id, household_id, kind, name, currency) values ('${BANK}', '${HH}', 'bank', 'Bank', 'INR');
    -- Rows as production holds them before the migration.
    insert into debts (id, household_id, type, name, principal, current_balance, interest_rate, minimum_payment, due_date, extras) values
      ('${LOAN}',        '${HH}', 'personal_loan', 'Car', 100000, 100000, 12, 8884.88, '2026-11-05', '{"tenureMonths":12}'),
      ('${LEGACY}',      '${HH}', 'home_loan',     'Home', 500000, 400000, 9, 6000, '2026-11-10',
         '{"tenureMonths":120,"remainingMonths":100,"paymentLog":[{"id":"${LOG_ID}","date":"2026-09-10","amount":6000,"interest":3000,"principal":3000}]}'),
      ('${CARD_NEW}',    '${HH}', 'credit_card',   'Visa', null, 24000, 36, 1200, null, null),
      ('${CARD_LINKED}', '${HH}', 'credit_card',   'Amex', null, 5000, 36, 250, null, null),
      ('${PAID}',        '${HH}', 'personal_loan', 'Old', 1000, 0, 10, 0, null, null);
    insert into accounts (id, household_id, kind, name, currency, opening_balance, debt_id)
      values ('${CARD_LINKED_ACC}', '${HH}', 'credit_card', 'Amex', 'INR', -7000, '${CARD_LINKED}');
  `);
  await db.exec(readFileSync(new URL('../../../../supabase/migrations/20261016120000_w4e_loan_model.sql', import.meta.url), 'utf8'));
  await as(OWNER);
}, 60000);
afterAll(async () => { await db.close(); });

describe.sequential('the loan model (W4e)', () => {
  it('W4-D19-001 · migration: cards become accounts, every loan gets its account, terms are estimated, the payment log becomes events', async () => {
    const card = (await db.query<{ kind: string; opening: number; deleted: boolean }>(
      `select a.kind, a.opening_balance::float8 as opening, d.deleted_at is not null as deleted
         from accounts a join debts d on d.id = a.debt_id where a.debt_id = '${CARD_NEW}'`)).rows;
    expect(card).toEqual([{ kind: 'credit_card', opening: -24000, deleted: true }]);
    // The linked card keeps its own ledger (what net worth already counted); no second account.
    const linked = (await db.query<{ n: number }>(`select count(*)::int as n from accounts where debt_id = '${CARD_LINKED}'`)).rows[0].n;
    expect(linked).toBe(1);
    expect((await debtRow(CARD_LINKED)).deleted).toBe(true);
    // An older app saving a card debt: moved the same way.
    await db.exec(`insert into debts (id, household_id, type, name, current_balance, interest_rate, minimum_payment)
      values ('30000000-0000-4000-8000-0000000000f9', '${HH}', 'credit_card', 'New card', 900, 30, 50)`);
    expect((await debtRow('30000000-0000-4000-8000-0000000000f9')).deleted).toBe(true);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from accounts where debt_id = '30000000-0000-4000-8000-0000000000f9' and kind = 'credit_card'`)).rows[0].n).toBe(1);

    // Every live loan has its account at the outstanding it showed: net worth does not move.
    expect(await owed(LOAN)).toBe(100000);
    expect(await owed(LEGACY)).toBe(400000);
    const legacy = (await db.query<{ tenure: number; paid: number; first: string; confirmed: boolean }>(
      `select tenure_months as tenure, instalments_paid as paid, first_emi_date::text as first, terms_confirmed as confirmed
         from debts where id = '${LEGACY}'`)).rows[0];
    expect(legacy).toEqual({ tenure: 120, paid: 20, first: '2025-03-10', confirmed: false });
    expect((await debtRow(PAID)).paid_off).toBe(true);
    const events = (await db.query<{ kind: string; amount: number }>(
      `select kind, amount::float8 as amount from loan_payment_events where operation_id = '${LOG_ID}'`)).rows;
    expect(events).toEqual([{ kind: 'legacy', amount: 6000 }]);
  });

  it('W4-D19-002 · an EMI is interest first, then principal, on the reducing balance; the instalment moves on', async () => {
    const emi = (await db.query<{ e: string }>(`select loan_emi(100000, 12, 12, 100)::text as e`)).rows[0].e;
    expect(Number(emi)).toBe(8884.88);
    const first = await pay('emi', 8884.88);
    expect(first).toMatchObject({ status: 'success', interest: 1000, principal: 7884.88, instalment_no: 1, closes_instalment: true,
      outstanding_after: 92115.12, next_due_date: '2026-12-05' });
    expect(await legs()).toEqual([
      { type: 'expense', amount: 1000, category: 'loan_emi' },
      { type: 'transfer', amount: 7884.88, category: null },
    ]);
    // Month 2: 92,115.12 × 1% = 921.1512 → 921.15 (banker's, to the paisa).
    const second = await pay('emi', 8884.88, { date: '2026-12-05' });
    expect(second).toMatchObject({ interest: 921.15, principal: 7963.73, instalment_no: 2, outstanding_after: 84151.39, next_due_date: '2027-01-05' });
    expect(await debtRow()).toMatchObject({ balance: 84151.39, instalments_paid: 2, due: '2027-01-05' });
  });

  it('W4-D19-003 · a short EMI is accepted and the instalment stays open; more than due is refused with the amount due', async () => {
    expect(await fail(pay('emi', 9000))).toEqual({ message: 'more_than_due', detail: '8884.88' });
    // What the Pay form is told is exactly what pay_loan accepts.
    const due = async () => (await db.query<{ r: Record<string, unknown> }>(`select loan_due($1) as r`, [LOAN])).rows[0].r;
    expect(await due()).toMatchObject({ instalment_no: 3, due_date: '2027-01-05', interest: 841.51, due: 8884.88, remaining: 8884.88,
      started: false, payoff: 84151.39, outstanding: 84151.39 });
    const part = await pay('emi', 500);
    expect(await due()).toMatchObject({ instalment_no: 3, interest: 841.51, paid: 500, remaining: 8384.88, started: true, payoff: 84492.90 });
    expect((await due()).latest_payment).toMatchObject({ operation_id: part.operation_id, kind: 'emi', amount: 500 });
    // Interest first: 84,151.39 × 1% = 841.51 is still owed after 500.
    expect(part).toMatchObject({ interest: 500, principal: 0, closes_instalment: false, instalment_no: 3, next_due_date: '2027-01-05' });
    expect(await fail(pay('prepayment', 1000))).toEqual({ message: 'instalment_open', detail: '8384.88' });
    expect(await fail(pay('emi', 8384.89))).toEqual({ message: 'more_than_due', detail: '8384.88' });
    const rest = await pay('emi', 8384.88);
    expect(rest).toMatchObject({ interest: 341.51, principal: 8043.37, closes_instalment: true, next_due_date: '2027-02-05' });
    expect(await owed()).toBe(76108.02);
  });

  it('W4-D19-004 · a prepayment is all principal: reduce tenure keeps the EMI, reduce EMI spreads the rest over what was left', async () => {
    const tenure = await pay('prepayment', 10000, { choice: 'reduce_tenure' });
    expect(tenure).toMatchObject({ kind: 'prepayment', interest: 0, principal: 10000, outstanding_after: 66108.02, emi_after: 8884.88,
      next_due_date: '2027-02-05' });
    // Left at 8,884.88 on 66,108.02 at 1%/month: 8 instalments → the EMI over 8 after a further 6,108.02.
    const left = (await db.query<{ n: number }>(`select loan_instalments_left(66108.02, 12, 8884.88) as n`)).rows[0].n;
    expect(left).toBe(8);
    const r = 0.01, o = 60000, n = left;
    const expected = Math.ceil((o * r) / (1 - (1 + r) ** -n) * 100 - 1e-9) / 100;
    const emi = await pay('prepayment', 6108.02, { choice: 'reduce_emi' });
    expect(emi).toMatchObject({ outstanding_after: 60000, emi_after: expected });
    expect(await fail(pay('prepayment', 60000.01))).toEqual({ message: 'more_than_outstanding', detail: '60000.00' });
  });

  it('W4-D19-005 · only the latest payment can be undone, and undoing it restores every figure', async () => {
    const before = await debtRow();
    const p = await pay('emi', 7000, { date: '2027-02-05' });
    const later = await pay('emi', 100, { date: '2027-02-06' });
    expect(await fail(db.query(`select reverse_loan_payment($1)`, [p.operation_id]))).toMatchObject({ message: 'not_latest_payment' });
    await db.query(`select reverse_loan_payment($1)`, [later.operation_id]);
    const undo = await db.query<{ r: { status: string; outstanding: number } }>(`select reverse_loan_payment($1) as r`, [p.operation_id]);
    expect(undo.rows[0].r.status).toBe('reversed');
    expect(await debtRow()).toEqual(before);
    expect(await owed()).toBe(60000);
    const again = await db.query<{ r: { status: string } }>(`select reverse_loan_payment($1) as r`, [p.operation_id]);
    expect(again.rows[0].r.status).toBe('already_reversed');
    // A reduce-EMI prepayment undone puts the EMI back.
    const pre = await pay('prepayment', 1000, { choice: 'reduce_emi' });
    expect(Number(pre.emi_after)).not.toBe(before.emi);
    await db.query(`select reverse_loan_payment($1)`, [pre.operation_id]);
    expect((await debtRow()).emi).toBe(before.emi);
  });

  it('W4-D19-006 · INV-7: when a leg fails, the whole payment rolls back — no interest entry, no event, nothing moved', async () => {
    const before = await debtRow();
    const events = (await db.query<{ n: number }>(`select count(*)::int as n from loan_payment_events`)).rows[0].n;
    const entries = (await legs()).length;
    await db.exec(`create function fail_transfer() returns trigger language plpgsql as $$
      begin if new.type = 'transfer' then raise exception 'forced_leg_failure'; end if; return new; end $$;
      create trigger force_fail before insert on transactions for each row execute function fail_transfer();`);
    expect((await fail(pay('emi', 1000))).message).toBe('forced_leg_failure');
    await db.exec(`drop trigger force_fail on transactions`);
    expect(await debtRow()).toEqual(before);
    expect((await legs()).length).toBe(entries);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from loan_payment_events`)).rows[0].n).toBe(events);
  });

  it('W4-D19-007 · payoff is exactly the outstanding plus open interest; a bank’s own split closes the instalment', async () => {
    const bank = await pay('bank_override', 8000, { bi: 600, bp: 7400, date: '2027-02-05' });
    expect(bank).toMatchObject({ kind: 'bank_override', interest: 600, principal: 7400, closes_instalment: true, next_due_date: '2027-03-05' });
    expect(await fail(pay('bank_override', 8000, { bi: 600, bp: 7300 }))).toMatchObject({ message: 'bank_figures_invalid' });
    await pay('emi', 300, { date: '2027-03-05' });              // starts instalment 6: 526 interest, 300 paid
    expect(await fail(pay('payoff', 52600))).toEqual({ message: 'payoff_amount', detail: '52826.00' });
    const done = await pay('payoff', 52826, { date: '2027-03-06' });
    expect(done).toMatchObject({ interest: 226, principal: 52600, paid_off: true, outstanding_after: 0, next_due_date: null });
    expect(await debtRow()).toMatchObject({ balance: 0, paid_off: true, due: null });
    expect((await fail(pay('emi', 100))).message).toBe('loan_paid_off');
    // Undoing the payoff re-opens the loan.
    await db.query(`select reverse_loan_payment($1)`, [done.operation_id]);
    expect(await debtRow()).toMatchObject({ balance: 52600, paid_off: false, due: '2027-03-05' });
  });

  it('W4-D19-008 · a loan with money owed cannot be deleted; marking it paid off reconciles to zero, never posts; then it can go', async () => {
    expect(await fail(db.query(`select delete_debt($1)`, [LOAN]))).toEqual({ message: 'debt_not_paid_off', detail: '52600.00' });
    expect((await fail(db.exec(`update debts set deleted_at = now() where id = '${LOAN}'`))).message).toBe('debt_not_paid_off');
    const entries = (await legs()).length;
    const r = await db.query<{ r: { status: string; written_off: number } }>(`select mark_loan_paid_off($1, 'Closed at the branch') as r`, [LOAN]);
    expect(r.rows[0].r).toMatchObject({ status: 'paid_off', written_off: 52600 });
    expect(await owed()).toBe(0);
    expect((await legs()).length).toBe(entries);                 // no transaction
    const acc = (await db.query<{ archived: boolean; log: Array<{ kind: string; delta: number; stated_value: number }> }>(
      `select is_archived as archived, reconciliation_log as log from accounts where debt_id = '${LOAN}' and kind = 'loan'`)).rows[0];
    expect(acc.archived).toBe(true);
    expect(acc.log.at(-1)).toMatchObject({ kind: 'loan', delta: 52600, stated_value: 0 });
    const del = await db.query<{ r: { status: string } }>(`select delete_debt($1) as r`, [LOAN]);
    expect(del.rows[0].r.status).toBe('deleted');
    // A receivable is not the household's debt: it deletes freely.
    await db.exec(`insert into debts (id, household_id, type, name, current_balance, interest_rate, minimum_payment, direction)
      values ('30000000-0000-4000-8000-0000000000fa', '${HH}', 'family', 'Lent', 500, 0, 0, 'owed_to_me')`);
    expect((await db.query<{ r: { status: string } }>(`select delete_debt('30000000-0000-4000-8000-0000000000fa') as r`)).rows[0].r.status).toBe('deleted');
    // The account purge deletes the household and its debts go with it by cascade: a loan still owed
    // must not block that (the guard is for a debt deleted on its own).
    await db.exec(`insert into households values ('20000000-0000-4000-8000-0000000000f9', 'INR');
      insert into debts (id, household_id, type, name, current_balance, interest_rate, minimum_payment)
      values ('30000000-0000-4000-8000-0000000000fb', '20000000-0000-4000-8000-0000000000f9', 'personal_loan', 'Owed', 9000, 10, 500)`);
    await db.exec(`delete from households where id = '20000000-0000-4000-8000-0000000000f9'`);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from debts where id = '30000000-0000-4000-8000-0000000000fb'`)).rows[0].n).toBe(0);
  });

  it('W4-D19-009 · only a writing member may pay; a retry is a duplicate; a reused id with a different request is refused', async () => {
    const id = op();
    const firstLegacy = await pay('emi', 6000, { debt: LEGACY, id, date: '2026-11-10' });
    expect(firstLegacy.status).toBe('success');
    expect((await pay('emi', 6000, { debt: LEGACY, id, date: '2026-11-10' })).status).toBe('duplicate');
    expect((await fail(pay('emi', 5000, { debt: LEGACY, id, date: '2026-11-10' }))).message).toBe('operation_id_reused');
    await as(VIEWER);
    expect((await fail(pay('emi', 100, { debt: LEGACY }))).message).toBe('not_authorized');
    expect((await fail(db.query(`select reverse_loan_payment($1)`, [id]))).message).toBe('not_authorized');
    await as(OWNER);
    // A legacy (history-only) entry is never undone.
    expect((await fail(db.query(`select reverse_loan_payment($1)`, [LOG_ID]))).message).toBe('cannot_undo_legacy');
  });
});
