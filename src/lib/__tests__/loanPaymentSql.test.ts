import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyPayment } from '../amortization';
import type { Debt, PartPaymentChoice } from '../../types';

const db = new PGlite();
const actor = '10000000-0000-4000-8000-000000000001';
const household = '20000000-0000-4000-8000-000000000001';
const debt = '30000000-0000-4000-8000-000000000001';
const funding = '40000000-0000-4000-8000-000000000001';
const operation = '50000000-0000-4000-8000-000000000001';

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table households (id uuid primary key);
    create table memberships (id uuid primary key default gen_random_uuid(), household_id uuid, user_id uuid, role text);
    create function is_member(hid uuid) returns boolean language sql as
      $$ select exists(select 1 from memberships where household_id=hid and user_id=auth.uid()) $$;
    create function role_in(hid uuid) returns text language sql as
      $$ select role from memberships where household_id=hid and user_id=auth.uid() limit 1 $$;
    create table debts (id uuid primary key, household_id uuid, name text, currency text,
      current_balance numeric check(current_balance>=0), minimum_payment numeric, interest_rate numeric,
      direction text default 'owed_by_me', extras jsonb default '{}', updated_at timestamptz default now(), deleted_at timestamptz);
    create table accounts (id uuid primary key default gen_random_uuid(), household_id uuid,
      kind text, name text, currency text, opening_balance numeric not null default 0,
      is_archived boolean not null default false, updated_at timestamptz default now(), deleted_at timestamptz);
    create table transactions (id uuid primary key default gen_random_uuid(), household_id uuid,
      created_by uuid, member_id uuid, amount numeric check(amount>0), currency text, type text,
      category text, account_id uuid, to_account_id uuid, debt_id uuid, date date, description text,
      extras jsonb, updated_at timestamptz default now(),
      check((type='expense' and account_id is not null and to_account_id is null and category is not null)
        or (type='transfer' and account_id is not null and to_account_id is not null and category is null)));
    insert into households values ('${household}');
    insert into memberships(household_id,user_id,role) values ('${household}','${actor}','owner');
    insert into debts(id,household_id,name,currency,current_balance,minimum_payment,interest_rate,extras)
      values ('${debt}','${household}','Loan','USD',8000,500,0,'{"remainingMonths":16}');
    insert into accounts(id,household_id,kind,name,currency) values ('${funding}','${household}','bank','Funding','USD');
    select set_config('request.jwt.claim.sub','${actor}',false);
  `);
  for (const file of ['20260908120300_audit_f2_record_loan_payment.sql', '20260909140000_correct_loan_payment_contract.sql']) {
    await db.exec(readFileSync(new URL(`../../../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
}, 30000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("delete from loan_payment_events; delete from transactions; delete from accounts where kind='loan'");
  await db.query(`update debts set current_balance=8000, minimum_payment=500,
    extras='{"remainingMonths":16}' where id=$1`, [debt]);
  await db.exec(`select set_config('request.jwt.claim.sub','${actor}',false)`);
});

const pay = (id: string, newBalance: number, principal = 500) => db.query<{ result: {
  status: string; debt: { current_balance: number }; loan_account: { opening_balance: number };
  transactions: Array<{ id: string }>;
} }>(`select record_loan_payment($1,$2,$3,500,'USD','2026-09-09',0,$4,null,'Payment',$5,15,500,'{}') as result`,
  [id, debt, funding, principal, newBalance]);

describe.sequential('loan command executed by Postgres', () => {
  it('CON-UNIT-918 - server payment arithmetic agrees with client calculations across strategies and currencies', async () => {
    for (const currency of ['USD', 'JPY']) {
      for (const strategy of [undefined, 'reduce_tenure', 'reduce_emi', 'apply_advance'] as Array<PartPaymentChoice | undefined>) {
        const debtId = crypto.randomUUID();
        const accountId = crypto.randomUUID();
        const model: Debt = { id: debtId, type: 'loan', name: 'Parity', currency,
          principal: 8000, currentBalance: 8000, interestRate: 12, minimumPayment: 500, remainingMonths: 20 };
        await db.query(`insert into debts(id,household_id,name,currency,current_balance,minimum_payment,interest_rate,extras)
          values($1,$2,'Parity',$3,8000,500,12,'{"remainingMonths":20}')`, [debtId, household, currency]);
        await db.query(`insert into accounts(id,household_id,kind,name,currency) values($1,$2,'bank','Funding',$3)`,
          [accountId, household, currency]);
        const amount = strategy ? 1500 : 500;
        const expected = applyPayment(model, amount, strategy, '2026-09-09');
        const { rows } = await db.query<{ result: { debt: { current_balance: number; minimum_payment: number;
          extras: { remainingMonths: number; paymentLog: Array<{ interest: number; principal: number }> } } } }>(
          `select record_loan_payment($1,$2,$3,$4,$5,'2026-09-09',$6,$7,null,'Parity',$8,null,null,$9) as result`,
          [crypto.randomUUID(), debtId, accountId, amount, currency, expected.log.interest, expected.log.principal,
            expected.debt.currentBalance, JSON.stringify({ partChoice: strategy })]);
        const actual = rows[0].result.debt;
        expect(actual.current_balance).toBe(expected.debt.currentBalance);
        expect(actual.minimum_payment).toBeCloseTo(expected.debt.minimumPayment, 6);
        expect(actual.extras.remainingMonths).toBe(expected.debt.remainingMonths);
        expect(actual.extras.paymentLog[0]).toMatchObject({ interest: expected.log.interest, principal: expected.log.principal });
      }
    }
  });
  it('CON-UNIT-902 - initializes the liability and persists balanced rows', async () => {
    const { rows } = await pay(operation, 7500);
    expect(rows[0].result.debt.current_balance).toBe(7500);
    expect(rows[0].result.loan_account.opening_balance).toBe(-8000);
    expect(rows[0].result.transactions).toHaveLength(1);
  });
  it('CON-UNIT-903 - retries return the original transaction without reducing the debt twice', async () => {
    await pay(operation, 7500);
    const { rows } = await pay(operation, 7500);
    expect(rows[0].result.status).toBe('duplicate');
    expect(rows[0].result.debt.current_balance).toBe(7500);
    expect((await db.query('select * from transactions where debt_id = $1', [debt])).rows).toHaveLength(1);
  });
  it('CON-UNIT-904 - rejects stale or invented balance reductions and rolls back', async () => {
    await pay(operation, 7500);
    await expect(pay(crypto.randomUUID(), 7500)).rejects.toThrow('payment_state_changed');
    await expect(pay(crypto.randomUUID(), 0)).rejects.toThrow('payment_state_changed');
    expect((await db.query('select * from transactions where debt_id = $1', [debt])).rows).toHaveLength(1);
  });
  it('CON-UNIT-905 - duplicate operation lookup does not bypass authorization', async () => {
    await pay(operation, 7500);
    await db.exec(`select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false)`);
    await expect(pay(operation, 7500)).rejects.toThrow('not_authorized');
    await db.exec(`select set_config('request.jwt.claim.sub','${actor}',false)`);
  });
});