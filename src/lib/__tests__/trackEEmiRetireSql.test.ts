import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isLoanEmiSchedule } from '../recurring';
import type { RecurringSchedule } from '../../types';

// TE6B-001..003 — Track E, E6b (v10.101.0; owner decisions E-3 and E-11): the leftover EMI schedules are
// soft-deleted in the database. The set is exactly the app's `isLoanEmiSchedule` (which E6a already hides
// everywhere); their transactions keep their history; a second run changes nothing.

const db = new PGlite();
const HH = '20000000-0000-4000-8000-0000000000e6';
const OTHER = '20000000-0000-4000-8000-0000000000e7';
const LOAN = '40000000-0000-4000-8000-0000000000e6';
const id = (n: number) => `30000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const MIGRATION = readFileSync(new URL('../../../../supabase/migrations/20261023120000_retire_emi_schedules.sql', import.meta.url), 'utf8');

/** The rows as production can hold them: what W4g could not move onto a loan, beside ordinary bills. */
const TEMPLATES: Record<number, Record<string, unknown>> = {
  1: { type: 'expense', amount: 15000, category: 'loan_emi', description: 'Car EMI' },                         // no loan link
  2: { type: 'expense', amount: 9000, category: 'loan_emi', description: 'Old bike EMI', debtId: LOAN },         // a deleted loan
  3: { type: 'transfer', amount: 5000, category: '', description: 'Pay Ravi back', linkedDebtId: LOAN },         // a loan link, other category
  4: { type: 'expense', amount: 20000, category: 'rent_mortgage', description: 'Rent', debtId: '' },            // an empty link: a bill
  5: { type: 'income', amount: 90000, category: 'salary', description: 'Salary' },
  6: { type: 'expense', amount: 15000, category: 'loan_emi', description: 'Already retired by W4g' },
  7: { type: 'expense', amount: 12000, category: 'loan_emi', description: 'Another household' },
};
const EARLIER = '2026-10-01T12:00:00Z';
const EARLIER_TEXT = '2026-10-01 12:00:00+00';

async function rows() {
  return (await db.query<{ id: string; active: boolean; deleted_at: string | null; updated_at: string }>(
    'select id, active, deleted_at::text, updated_at::text from recurring_schedules order by id')).rows;
}

beforeAll(async () => {
  await db.exec(`
    set timezone = 'UTC';
    create table recurring_schedules (
      id uuid primary key, household_id uuid not null, txn_template jsonb not null default '{}',
      frequency text not null default 'monthly', start_date date not null default '2026-01-05',
      next_due_date date not null default '2026-11-05', auto_confirm boolean not null default true,
      active boolean not null default true, updated_at timestamptz not null default '${EARLIER}', deleted_at timestamptz);
    create table transactions (id uuid primary key, household_id uuid, recurring_schedule_id uuid, amount numeric, date date);
  `);
  for (const [n, t] of Object.entries(TEMPLATES)) {
    await db.query('insert into recurring_schedules (id, household_id, txn_template, deleted_at) values ($1, $2, $3, $4)',
      [id(Number(n)), Number(n) === 7 ? OTHER : HH, JSON.stringify(t), Number(n) === 6 ? EARLIER : null]);
  }
  await db.query(`insert into transactions values (gen_random_uuid(), $1, $2, 15000, '2026-09-05')`, [HH, id(1)]);
  await db.exec(MIGRATION);
}, 60000);
afterAll(async () => { await db.close(); });

describe('E6b — the leftover EMI schedules are retired (soft delete)', () => {
  it('TE6B-001 · exactly the app\'s isLoanEmiSchedule set is retired, in every household; bills are untouched', async () => {
    const after = await rows();
    const retired = after.filter(r => r.deleted_at && r.deleted_at !== EARLIER_TEXT).map(r => r.id);
    expect(retired).toEqual([id(1), id(2), id(3), id(7)]);
    expect(after.filter(r => retired.includes(r.id)).every(r => !r.active && r.updated_at > EARLIER_TEXT)).toBe(true);
    // Bills (an empty loan link included) stay live, untouched.
    expect(after.filter(r => [id(4), id(5)].includes(r.id))).toEqual([
      expect.objectContaining({ active: true, deleted_at: null, updated_at: EARLIER_TEXT }),
      expect.objectContaining({ active: true, deleted_at: null, updated_at: EARLIER_TEXT }),
    ]);
    // The SQL and the app agree on which schedules are EMI schedules.
    const app = Object.entries(TEMPLATES)
      .filter(([n, t]) => Number(n) !== 6 && isLoanEmiSchedule({ transactionTemplate: t } as unknown as RecurringSchedule))
      .map(([n]) => id(Number(n)));
    expect(retired).toEqual(app);
  });

  it('TE6B-002 · a schedule W4g already retired keeps its own deletion; the transactions a schedule made keep their history', async () => {
    const six = (await rows()).find(r => r.id === id(6))!;
    expect(six).toMatchObject({ deleted_at: EARLIER_TEXT, updated_at: EARLIER_TEXT });
    const made = (await db.query<{ n: number }>('select count(*)::int as n from transactions where recurring_schedule_id = $1', [id(1)])).rows[0].n;
    expect(made).toBe(1);
  });

  it('TE6B-003 · idempotent: a second run changes nothing', async () => {
    const before = await rows();
    await db.exec(MIGRATION);
    expect(await rows()).toEqual(before);
  });
});
