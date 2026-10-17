import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// W3b (v10.66.0; owner decision D14) — one currency per household. New and edited rows are stamped
// with the household's currency; an old label on a stored row is left alone (and ignored by every
// figure); a loan payment is checked against the HOUSEHOLD's currency, so it keeps working after the
// currency is changed (accounts are relabelled, the debt keeps its old label).

const db = new PGlite();
const actor = '10000000-0000-4000-8000-000000000001';
const household = '20000000-0000-4000-8000-000000000001';
const debt = '30000000-0000-4000-8000-000000000001';
const funding = '40000000-0000-4000-8000-000000000001';

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table households (id uuid primary key, base_currency text not null default 'USD');
    create table memberships (id uuid primary key default gen_random_uuid(), household_id uuid, user_id uuid, role text);
    create function is_member(hid uuid) returns boolean language sql as
      $$ select exists(select 1 from memberships where household_id=hid and user_id=auth.uid()) $$;
    create function role_in(hid uuid) returns text language sql as
      $$ select role from memberships where household_id=hid and user_id=auth.uid() limit 1 $$;
    create table debts (id uuid primary key, household_id uuid, name text, currency text,
      current_balance numeric check(current_balance>=0), minimum_payment numeric, interest_rate numeric,
      direction text default 'owed_by_me', extras jsonb default '{}', updated_at timestamptz default now(), deleted_at timestamptz);
    create table accounts (id uuid primary key default gen_random_uuid(), household_id uuid,
      kind text, name text, currency text, opening_balance numeric not null default 0, debt_id uuid,
      is_archived boolean not null default false, updated_at timestamptz default now(), deleted_at timestamptz);
    create table transactions (id uuid primary key default gen_random_uuid(), household_id uuid,
      created_by uuid, member_id uuid, amount numeric check(amount>0), currency text, type text,
      category text, account_id uuid, to_account_id uuid, debt_id uuid, date date, description text,
      extras jsonb, updated_at timestamptz default now());
    create table budgets (id uuid primary key default gen_random_uuid(), household_id uuid, currency text, monthly_limit numeric);
    create table goals (id uuid primary key default gen_random_uuid(), household_id uuid, currency text, target numeric);
    create table assets (id uuid primary key default gen_random_uuid(), household_id uuid, currency text, value numeric);
    insert into households values ('${household}', 'INR');
    insert into memberships(household_id,user_id,role) values ('${household}','${actor}','owner');
    -- A debt saved while the household was in USD; the household has since moved to INR.
    insert into debts(id,household_id,name,currency,current_balance,minimum_payment,interest_rate,extras)
      values ('${debt}','${household}','Loan','USD',8000,500,0,'{"remainingMonths":16}');
    insert into accounts(id,household_id,kind,name,currency) values ('${funding}','${household}','bank','Funding','INR');
    insert into transactions(household_id, amount, currency, type, category, account_id, date)
      values ('${household}', 42, 'USD', 'expense', 'food_dining', '${funding}', '2026-09-01');
  `);
  for (const file of ['20260908120300_audit_f2_record_loan_payment.sql', '20260909140000_correct_loan_payment_contract.sql',
    '20261013120000_w3b_one_currency.sql']) {
    await db.exec(readFileSync(new URL(`../../../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
}, 60000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`delete from loan_payment_events; delete from transactions where amount <> 42; delete from accounts where kind='loan';
    select set_config('request.jwt.claim.sub','${actor}',false);`);
  await db.query(`update debts set current_balance=8000, minimum_payment=500, extras='{"remainingMonths":16}' where id=$1`, [debt]);
  // Writing a debt stamps it; put the old label back so each test starts from a stale label.
  await db.exec(`alter table debts disable trigger trg_debts_household_currency;
    update debts set currency = 'USD' where id = '${debt}';
    alter table debts enable trigger trg_debts_household_currency;`);
});

const pay = (currency: string) => db.query<{ result: { status: string } }>(
  `select record_loan_payment(gen_random_uuid(),$1,$2,500,$3,'2026-09-09',0,500,null,'EMI',7500,15,500,'{}') as result`,
  [debt, funding, currency]);

describe('one currency per household (W3b)', () => {
  it('CON-UNIT-W3-D14-003 · new and edited rows take the household’s currency; a stored old label is left alone', async () => {
    const row = await db.query<{ currency: string }>(`select currency from transactions where amount = 42`);
    expect(row.rows[0].currency).toBe('USD');   // untouched until it is written again
    for (const [table, cols, vals] of [
      ['transactions', 'household_id, amount, currency, type, category, account_id, date', `'${household}', 9, 'EUR', 'expense', 'food_dining', '${funding}', '2026-09-02'`],
      ['budgets', 'household_id, currency, monthly_limit', `'${household}', 'GBP', 100`],
      ['goals', 'household_id, currency, target', `'${household}', 'JPY', 100`],
      ['assets', 'household_id, currency, value', `'${household}', 'USD', 100`],
    ]) {
      const ins = await db.query<{ currency: string }>(`insert into ${table} (${cols}) values (${vals}) returning currency`);
      expect(ins.rows[0].currency, table).toBe('INR');
    }
    const edited = await db.query<{ currency: string }>(`update transactions set description = 'edited' where amount = 42 returning currency`);
    expect(edited.rows[0].currency).toBe('INR');
    await db.exec(`update transactions set currency = 'USD' where amount = 42`);   // trigger stamps it back
    expect((await db.query<{ currency: string }>(`select currency from transactions where amount = 42`)).rows[0].currency).toBe('INR');
  });

  it('CON-UNIT-W3-D14-004 · a loan payment after a currency change works in the household’s currency, not the debt’s old label', async () => {
    const ok = await pay('INR');
    expect(ok.rows[0].result.status).toBe('success');
    const legs = await db.query<{ currency: string }>(`select distinct currency from transactions where debt_id = '${debt}'`);
    expect(legs.rows.map(r => r.currency)).toEqual(['INR']);
    const loanAccount = await db.query<{ currency: string }>(`select currency from accounts where kind = 'loan'`);
    expect(loanAccount.rows[0].currency).toBe('INR');
    await db.exec(`delete from loan_payment_events; delete from transactions where debt_id = '${debt}';`);
    await expect(pay('USD')).rejects.toThrow(/invalid_payment/);
  });
});
