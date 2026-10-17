// FE-MNY-16 (v10.91.0; owner decision 13 Oct 2026) — the budget form's "already committed via recurring"
// forecast counts each bill's REAL dates in the budget period, read from the schedule's own rule, the
// way the engine and the bill calendar read it. It used to multiply the period's length by a per-period
// rate from the frequency label: a quarterly bill was forecast at about its full amount in every month,
// and a Mon + Thu bill once a week.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { recurringForecastByCategory, resolveBudgetPeriod, type ForecastSchedule } from '../calculations';

const bill = (amount: number, category: string, startDate: string, extra: Partial<ForecastSchedule> = {}): ForecastSchedule => ({
  transactionTemplate: { type: 'expense', amount, currency: 'INR', category },
  frequency: 'monthly', startDate, ...extra,
});
const month = (y: number, m: number): [string, string] => {
  const p = resolveBudgetPeriod('month', y, m);
  return [p.periodStart, p.periodEnd];
};
const year = (y: number): [string, string] => {
  const p = resolveBudgetPeriod('annual', y, 1);
  return [p.periodStart, p.periodEnd];
};
const forecast = (s: ForecastSchedule[], [from, to]: [string, string]) => recurringForecastByCategory(s, from, to, 'INR', {});
const src = (p: string) => readFileSync(resolve(__dirname, '..', '..', p), 'utf8');

describe('budget forecast counts real dates (FE-MNY-16)', () => {
  it('MNY16-F-001 · a quarterly bill counts only in the months it falls in', () => {
    // The form saves "Every 3 months" as FREQ=MONTHLY;INTERVAL=3 (buildRRule).
    const premium = [bill(6000, 'insurance', '2026-01-15', { rrule: 'FREQ=MONTHLY;INTERVAL=3' })];
    expect(forecast(premium, month(2026, 1))).toEqual({ insurance: 6000 });
    expect(forecast(premium, month(2026, 2))).toEqual({});      // was ≈ ₹5,520
    expect(forecast(premium, month(2026, 3))).toEqual({});
    expect(forecast(premium, month(2026, 4))).toEqual({ insurance: 6000 });
    expect(forecast(premium, year(2026))).toEqual({ insurance: 24000 });   // Jan, Apr, Jul, Oct
  });

  it('MNY16-F-002 · a Mon + Thu bill counts each of those days', () => {
    // October 2026: Thursdays 1, 8, 15, 22, 29 and Mondays 5, 12, 19, 26.
    const groceries = [bill(200, 'groceries', '2026-10-01', { frequency: 'weekly', rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH' })];
    expect(forecast(groceries, month(2026, 10))).toEqual({ groceries: 1800 });   // was ≈ ₹886
  });

  it('MNY16-F-003 · nothing before the start date, and nothing after COUNT or UNTIL runs out', () => {
    const fromOct = [bill(500, 'subscriptions', '2026-10-20')];
    expect(forecast(fromOct, month(2026, 9))).toEqual({});
    expect(forecast(fromOct, month(2026, 10))).toEqual({ subscriptions: 500 });

    const twice = [bill(1000, 'education', '2026-09-10', { rrule: 'FREQ=MONTHLY;INTERVAL=1;COUNT=2' })];
    expect(forecast(twice, month(2026, 9))).toEqual({ education: 1000 });
    expect(forecast(twice, month(2026, 10))).toEqual({ education: 1000 });
    expect(forecast(twice, month(2026, 11))).toEqual({});

    const untilMarch = [bill(300, 'utilities', '2026-01-05', { rrule: 'FREQ=MONTHLY;INTERVAL=1;UNTIL=20260305' })];
    expect(forecast(untilMarch, month(2026, 3))).toEqual({ utilities: 300 });
    expect(forecast(untilMarch, month(2026, 4))).toEqual({});
    expect(forecast(untilMarch, year(2026))).toEqual({ utilities: 900 });
  });

  it('MNY16-F-004 · the schedule\'s month-end rule decides which month a 31st lands in', () => {
    const rent = (policy: ForecastSchedule['shortMonthPolicy']) =>
      [bill(100, 'rent_mortgage', '2026-01-31', { rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31', shortMonthPolicy: policy })];
    expect(forecast(rent(undefined), month(2026, 2))).toEqual({ rent_mortgage: 100 });        // last_day: 28 Feb
    expect(forecast(rent('last_day'), month(2026, 2))).toEqual({ rent_mortgage: 100 });
    expect(forecast(rent('next_month_first'), month(2026, 2))).toEqual({});                    // moved to 1 Mar
    expect(forecast(rent('next_month_first'), month(2026, 3))).toEqual({ rent_mortgage: 200 }); // 1 Mar + 31 Mar
  });

  it('MNY16-F-005 · a row with no stored rule uses the rule derived from its columns', () => {
    const weekly = [bill(250, 'food_dining', '2026-10-05', { frequency: 'weekly', weekday: 1 })];          // Mondays
    expect(forecast(weekly, month(2026, 10))).toEqual({ food_dining: 1000 });                              // 5, 12, 19, 26
    const yearly = [bill(1200, 'personal_care', '2025-03-10', { frequency: 'yearly' })];
    expect(forecast(yearly, month(2026, 3))).toEqual({ personal_care: 1200 });
    expect(forecast(yearly, month(2026, 4))).toEqual({});
    const daily = [bill(10, 'food_dining', '2026-10-01', { frequency: 'daily' })];
    expect(forecast(daily, month(2026, 10))).toEqual({ food_dining: 310 });
    const monthly = [bill(400, 'utilities', '2026-01-01', { dayOfMonth: 5 })];
    expect(forecast(monthly, year(2026))).toEqual({ utilities: 4800 });
  });

  it('MNY16-F-006 · bills in one category add up; skipped rows and an empty period add nothing', () => {
    const s: ForecastSchedule[] = [
      bill(700, 'utilities', '2026-01-03'),
      bill(300, 'utilities', '2026-01-20'),
      bill(999, 'subscriptions', '2026-01-01', { active: false }),
      bill(16000, 'loan_emi', '2026-01-05'),
      { ...bill(5000, 'other_expense', '2026-01-05'), transactionTemplate: { type: 'expense', amount: 5000, currency: 'INR', category: 'other_expense', debtId: 'd1' } },
      { ...bill(5000, 'salary', '2026-01-01'), transactionTemplate: { type: 'income', amount: 5000, currency: 'INR', category: 'salary' } },
    ];
    expect(forecast(s, month(2026, 6))).toEqual({ utilities: 1000 });
    expect(forecast(s, ['2026-06-30', '2026-06-01'])).toEqual({});
  });

  it('MNY16-F-007 · the forecast reads dates exactly as the bill calendar does, and the server copy is gone', () => {
    const call = /expandRRule\(ruleOf\((\w+)\), \1\.startDate, \w+, \w+, \{ shortMonthPolicy: policyOf\(\1\) \}\)/;
    expect(src('lib/billCalendar.ts')).toMatch(call);
    const calc = src('lib/calculations.ts');
    expect(calc.slice(calc.indexOf('export function recurringForecastByCategory'))).toMatch(call);
    // Track E (v10.96.0): the whole hand-copied money port is gone, not just this function.
    expect(existsSync(resolve(__dirname, '../../../../supabase/functions/_shared/money/calculations.ts'))).toBe(false);
    expect(src('components/budgets/BudgetFormModal.tsx'))
      .toMatch(/recurringForecastByCategory\(recurring, period\.periodStart, period\.periodEnd, form\.currency, rates\)/);
  });
});
