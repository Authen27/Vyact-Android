import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loanInterest, loanEmi, instalmentsLeft, nextInstalmentDate, rateOn, minorScale } from '../loanSchedule';

// W4f (v10.75.0; owner decision D19) — the app's loan arithmetic is the database's, figure for figure.
// The server computes every payment (pay_loan); the app shows the schedule, the due instalment and
// "Clears <month>" from lib/loanSchedule.ts. If the two ever disagreed, the form would prefill an EMI
// the server refuses. These run the migration's own SQL functions in Postgres and compare.

const db = new PGlite();

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create table households (id uuid primary key, base_currency text);
    create table memberships (id uuid primary key, household_id uuid, user_id uuid, role text);
    create function is_member(hid uuid) returns boolean language sql as $$ select false $$;
    create table accounts (id uuid primary key default gen_random_uuid(), household_id uuid, kind text, name text, currency text,
      opening_balance numeric not null default 0, reconciliation_offset numeric, reconciliation_log jsonb, last_reconciled_at timestamptz,
      is_archived boolean not null default false, debt_id uuid, payment_modes text[] not null default '{}',
      created_at timestamptz not null default now(), updated_at timestamptz, deleted_at timestamptz);
    create table debts (id uuid primary key default gen_random_uuid(), household_id uuid, type text not null, name text not null,
      principal numeric, current_balance numeric not null, interest_rate numeric not null, minimum_payment numeric not null,
      due_date date, currency text, direction text, extras jsonb, created_at timestamptz not null default now(),
      updated_at timestamptz, deleted_at timestamptz);
    create table transactions (id uuid primary key default gen_random_uuid(), household_id uuid, created_by uuid, member_id uuid,
      amount numeric, currency text, type text, category text, account_id uuid, to_account_id uuid, debt_id uuid, date date,
      description text, extras jsonb, updated_at timestamptz, deleted_at timestamptz);
    create table loan_payment_events (operation_id uuid primary key, household_id uuid not null, debt_id uuid not null,
      expense_txn_id uuid, transfer_txn_id uuid, loan_account_id uuid, amount numeric not null, interest numeric not null,
      principal numeric not null, created_at timestamptz not null default now(), request jsonb);
  `);
  await db.exec(readFileSync(new URL('../../../../supabase/migrations/20261016120000_w4e_loan_model.sql', import.meta.url), 'utf8'));
}, 60000);
afterAll(async () => { await db.close(); });

const sql = async <T>(q: string, params: unknown[] = []) => (await db.query<{ v: T }>(q, params)).rows[0].v;
const num = (v: unknown) => (v == null ? null : Number(v));

describe('loan arithmetic: app = database (W4f)', () => {
  it('W4-D19-010 · interest, EMI and instalments left agree across balances, rates, tenures and currencies', async () => {
    const balances = [1, 999.99, 8000, 100000, 92115.12, 2500000, 12345678.9];
    const rates = [0, 7.25, 8.65, 9, 10.5, 12, 18.99, 36];
    const tenures = [1, 7, 12, 60, 240];
    let checked = 0;
    for (const currency of ['INR', 'JPY']) {
      const scale = minorScale(currency);
      for (const raw of balances) {
        const o = Math.round(raw * scale) / scale;
        for (const rate of rates) {
          expect(loanInterest(o, rate, currency), `interest ${o} @${rate} ${currency}`)
            .toBe(num(await sql(`select loan_interest($1, $2, $3)::text as v`, [o, rate, scale])));
          for (const n of tenures) {
            const emi = loanEmi(o, rate, n, currency);
            expect(emi, `emi ${o} @${rate} ×${n} ${currency}`)
              .toBe(num(await sql(`select loan_emi($1, $2, $3, $4)::text as v`, [o, rate, n, scale])));
            if (emi != null) {
              expect(instalmentsLeft(o, rate, emi), `left ${o} @${rate} at ${emi}`)
                .toBe(num(await sql(`select loan_instalments_left($1, $2, $3) as v`, [o, rate, emi])));
            }
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(2 * balances.length * rates.length * tenures.length);
  });

  it('W4-D19-011 · instalment dates keep the loan’s day (a 31st → the month’s last day), and rate changes apply from their date', async () => {
    for (const [from, day] of [['2026-01-31', 31], ['2026-02-28', 31], ['2026-12-15', 15], ['2027-01-30', 30], ['2024-01-29', 29], ['2026-03-31', 5]] as const) {
      expect(nextInstalmentDate(from, day), `${from} on ${day}`).toBe(await sql(`select loan_next_instalment($1::date, $2)::text as v`, [from, day]));
    }
    const history = [{ from: '2026-01-01', rate: 9 }, { from: '2026-07-01', rate: 9.5 }, { from: '2027-01-01', rate: 8.75 }];
    for (const on of [null, '2025-12-31', '2026-01-01', '2026-06-30', '2026-07-01', '2027-03-05']) {
      expect(rateOn(history, 8.75, on), `rate on ${on}`)
        .toBe(num(await sql(`select loan_rate_on($1::jsonb, 8.75, $2::date)::text as v`, [JSON.stringify(history), on])));
    }
    expect(rateOn([], 11, '2026-05-01')).toBe(11);
  });
});
