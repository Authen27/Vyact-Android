import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// W4g (v10.76.0; owner decision D19; audit BE-WA-08) — loans run themselves: an EMI paid on WhatsApp
// goes through the loan (the server's split), an auto-recorded EMI posts on its date, EMI schedules
// move onto their loan, and the old client-computed command is gone.

const db = new PGlite();
const OWNER = '10000000-0000-4000-8000-0000000000a1';
const VIEWER = '10000000-0000-4000-8000-0000000000a2';
const HH = '20000000-0000-4000-8000-0000000000a1';
const BANK = '40000000-0000-4000-8000-0000000000a1';
const HDFC = '40000000-0000-4000-8000-0000000000a2';
const CAR = '30000000-0000-4000-8000-0000000000a1';      // paid on WhatsApp
const HOME = '30000000-0000-4000-8000-0000000000a2';     // auto-recorded
const GONE = '30000000-0000-4000-8000-0000000000a3';     // auto-record with no account to pay from
const SCHED_EMI = '50000000-0000-4000-8000-0000000000a1';
const SCHED_ORPHAN = '50000000-0000-4000-8000-0000000000a2';
let today = '';
let ago: (n: number) => string = () => '';

const query = async <T>(q: string, p: unknown[] = []) => (await db.query<T>(q, p)).rows;
const payWa = async (args: { debt?: string; amount: number; msg: string; profile?: string; alias?: string | null }) =>
  (await query<{ r: Record<string, unknown> }>(
    `select whatsapp_pay_loan($1, $2, $3, $4, $5::date, $6, $7) as r`,
    [args.profile ?? OWNER, HH, args.debt ?? CAR, args.amount, today, args.msg, args.alias ?? null]))[0].r;
const legs = async (debt: string) => query<{ type: string; amount: number; account_id: string; date: string }>(
  `select type, amount::float8 as amount, account_id, date::text from transactions where debt_id = $1 and deleted_at is null order by date, type`, [debt]);
const loan = async (id: string) => (await query<{ balance: number; paid: number; due: string | null; auto: boolean; funding: string | null }>(
  `select current_balance::float8 as balance, instalments_paid as paid, due_date::text as due, auto_record as auto, funding_account_id as funding
     from debts where id = $1`, [id]))[0];

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    insert into auth.users values ('${OWNER}'), ('${VIEWER}');
    create table households (id uuid primary key, base_currency text not null default 'INR', timezone text);
    create table memberships (id uuid primary key default gen_random_uuid(), household_id uuid, user_id uuid, role text,
      joined_at timestamptz not null default now());
    create function is_member(hid uuid) returns boolean language sql as
      $$ select exists(select 1 from memberships where household_id = hid and user_id = auth.uid()) $$;
    create table accounts (id uuid primary key default gen_random_uuid(), household_id uuid, kind text, name text, currency text,
      opening_balance numeric not null default 0, reconciliation_offset numeric, reconciliation_log jsonb, last_reconciled_at timestamptz,
      is_archived boolean not null default false, is_default boolean not null default false, debt_id uuid,
      payment_modes text[] not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz, deleted_at timestamptz);
    create table debts (id uuid primary key default gen_random_uuid(), household_id uuid, type text not null, name text not null,
      principal numeric, current_balance numeric not null check (current_balance >= 0), interest_rate numeric not null,
      minimum_payment numeric not null, due_date date, currency text default 'INR', direction text default 'owed_by_me', extras jsonb,
      created_at timestamptz not null default now(), updated_at timestamptz, deleted_at timestamptz);
    create table transactions (id uuid primary key default gen_random_uuid(), household_id uuid, created_by uuid, member_id uuid,
      amount numeric check (amount > 0), currency text, type text, category text, account_id uuid, to_account_id uuid, debt_id uuid,
      date date, description text, extras jsonb, updated_at timestamptz, deleted_at timestamptz);
    create table loan_payment_events (operation_id uuid primary key, household_id uuid not null, debt_id uuid not null,
      expense_txn_id uuid, transfer_txn_id uuid, loan_account_id uuid, amount numeric not null, interest numeric not null,
      principal numeric not null, created_at timestamptz not null default now(), request jsonb);
    create table whatsapp_inbound_messages (wa_message_id text primary key, profile_id uuid, household_id uuid, direction text,
      processed_at timestamptz, payload jsonb);
    create table recurring_schedules (id uuid primary key, household_id uuid, txn_template jsonb, active boolean default true,
      auto_confirm boolean default false, updated_at timestamptz, deleted_at timestamptz);
    -- The command this release drops, as production has it.
    create function record_loan_payment(uuid, uuid, uuid, numeric, text, date, numeric, numeric, uuid, text, numeric, integer, numeric, jsonb)
      returns jsonb language sql as $$ select '{}'::jsonb $$;

    insert into households values ('${HH}', 'INR', 'Asia/Kolkata');
    insert into memberships (household_id, user_id, role) values ('${HH}', '${OWNER}', 'owner'), ('${HH}', '${VIEWER}', 'viewer');
    insert into accounts (id, household_id, kind, name, currency, is_default) values
      ('${BANK}', '${HH}', 'bank', 'Savings', 'INR', true), ('${HDFC}', '${HH}', 'bank', 'HDFC Salary', 'INR', false);
  `);
  await db.exec(readFileSync(new URL('../../../../supabase/migrations/20261016120000_w4e_loan_model.sql', import.meta.url), 'utf8'));
  const d = (await query<{ t: string }>(`select (now() at time zone 'Asia/Kolkata')::date::text as t`))[0];
  today = d.t;
  // n months back on a day every month has (≤ 28), so the dates never roll over and are never after today.
  ago = (n: number) => {
    const [y, m, dd] = today.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1 - n, Math.min(dd, 28))).toISOString().slice(0, 10);
  };
  await db.exec(`
    insert into debts (id, household_id, type, name, principal, current_balance, interest_rate, minimum_payment, due_date) values
      ('${CAR}',  '${HH}', 'auto_loan', 'Car loan', 100000, 100000, 12, 8884.88, '${today}'),
      ('${HOME}', '${HH}', 'home_loan', 'Home loan', 100000, 100000, 12, 8884.88, '${ago(2)}'),
      ('${GONE}', '${HH}', 'personal_loan', 'Old loan', 5000, 5000, 0, 1000, '${ago(1)}');
    insert into recurring_schedules (id, household_id, txn_template, active, auto_confirm) values
      ('${SCHED_EMI}', '${HH}', '{"type":"expense","category":"loan_emi","amount":8884.88,"linkedDebtId":"${HOME}","accountId":"${HDFC}"}', true, true),
      ('${SCHED_ORPHAN}', '${HH}', '{"type":"expense","category":"loan_emi","amount":500,"linkedDebtId":"not-a-loan"}', true, true);
    update debts set auto_record = true where id = '${GONE}';
  `);
  await db.exec(readFileSync(new URL('../../../../supabase/migrations/20261017120000_w4g_loan_automation.sql', import.meta.url), 'utf8'));
}, 60000);
afterAll(async () => { await db.close(); });

describe.sequential('loan automation (W4g)', () => {
  it('W4-D19-015 · "paid car EMI" on WhatsApp pays the loan’s instalment — the server’s split — once', async () => {
    const r = await payWa({ amount: 8884.88, msg: 'wamid.1', alias: 'hdfc' });
    expect(r).toMatchObject({ status: 'success', interest: 1000, principal: 7884.88, instalment_no: 1, loan: 'Car loan' });
    expect(await legs(CAR)).toEqual([
      { type: 'expense', amount: 1000, account_id: HDFC, date: today },
      { type: 'transfer', amount: 7884.88, account_id: HDFC, date: today },
    ]);
    // A replay of the same message pays nothing.
    expect(await payWa({ amount: 8884.88, msg: 'wamid.1' })).toEqual({ status: 'duplicate' });
    expect(await legs(CAR)).toHaveLength(2);
    // More than the instalment due is refused with what is due (the extra is a prepayment, in the app).
    expect(await payWa({ amount: 9000, msg: 'wamid.2' })).toMatchObject({ status: 'refused', reason: 'more_than_due', figure: '8884.88', loan: 'Car loan' });
    // A viewer cannot pay; the message is still claimed.
    expect(await payWa({ amount: 100, msg: 'wamid.3', profile: VIEWER })).toMatchObject({ status: 'error', reason: 'read_only_member' });
  });

  it('W4-D19-016 · moving EMI schedules onto their loan: the loan auto-records from the schedule’s account; the schedule closes', async () => {
    expect(await loan(HOME)).toMatchObject({ auto: true, funding: HDFC });
    const sched = await query<{ id: string; deleted: boolean }>(`select id, deleted_at is not null as deleted from recurring_schedules order by id`);
    expect(sched).toEqual([{ id: SCHED_EMI, deleted: true }, { id: SCHED_ORPHAN, deleted: false }]);
    // The client-computed command is gone.
    expect((await query<{ n: number }>(`select count(*)::int as n from pg_proc where proname = 'record_loan_payment'`))[0].n).toBe(0);
  });

  it('W4-D19-017 · auto-record posts each due EMI on its date, catches up, never twice, and skips a loan it cannot pay from', async () => {
    const run = async () => (await query<{ r: { posted: number; errors: number } }>(`select auto_record_due_emis() as r`))[0].r;
    expect(await run()).toEqual({ posted: 3, errors: 1 });          // Home: 2 months ago, last month, this month; Old loan: no account
    const home = await legs(HOME);
    expect(home.map(l => [l.type, l.amount, l.date])).toEqual([
      ['expense', 1000, ago(2)], ['transfer', 7884.88, ago(2)],
      ['expense', 921.15, ago(1)], ['transfer', 7963.73, ago(1)],
      ['expense', 841.51, ago(0)], ['transfer', 8043.37, ago(0)],
    ]);
    expect(await loan(HOME)).toMatchObject({ balance: 76108.02, paid: 3, due: ago(-1) });
    expect(home.every(l => l.account_id === HDFC)).toBe(true);
    // A second run finds nothing due.
    expect(await run()).toEqual({ posted: 0, errors: 1 });
    expect(await legs(HOME)).toHaveLength(6);
    expect(await legs(GONE)).toHaveLength(0);
  });
});
