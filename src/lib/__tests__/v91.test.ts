// Vyact v9.1 — unit pins for the feedback-batch helpers.
//   §4 budget identity + allocation flattening + recurring forecast
//   §5 RRULE composition (incl. month-end/quarterly/COUNT/UNTIL encoding)
import { describe, it, expect } from 'vitest';
import { resolveBudgetPeriod, budgetLines, recurringForecastByCategory, type ForecastSchedule } from '../calculations';
import { buildRRule } from '../recurring';
import type { Budget, BudgetAllocation } from '../../types';

const R = { USD: 1 };

describe('v9.1 §4 — budget identity', () => {
  it('resolveBudgetPeriod gives exact month / annual ranges (incl. leap Feb)', () => {
    expect(resolveBudgetPeriod('month', 2026, 6)).toEqual({ periodStart: '2026-06-01', periodEnd: '2026-06-30' });
    // Feb in a leap year ends on the 29th
    expect(resolveBudgetPeriod('month', 2028, 2)).toEqual({ periodStart: '2028-02-01', periodEnd: '2028-02-29' });
    expect(resolveBudgetPeriod('annual', 2025, 1)).toEqual({ periodStart: '2025-01-01', periodEnd: '2025-12-31' });
  });

  it('budgetLines flattens a container + allocations into concrete category lines', () => {
    const b: Budget = { id: 'b1', limit: 1000, currency: 'USD', scope: 'month', periodYear: 2026, periodMonth: 6, periodStart: '2026-06-01', periodEnd: '2026-06-30' };
    const allocs: BudgetAllocation[] = [
      { id: 'a1', budgetId: 'b1', category: 'rent_mortgage', amount: 800 },
      { id: 'a2', budgetId: 'b1', category: 'food_dining', amount: 200 },
    ];
    const lines = budgetLines([b], allocs);
    expect(lines).toHaveLength(2);
    expect(lines.map(l => l.category).sort()).toEqual(['food_dining', 'rent_mortgage']);
    expect(lines.find(l => l.category === 'rent_mortgage')!.limit).toBe(800);
    // each line inherits the parent's period window
    expect(lines[0].periodStart).toBe('2026-06-01');
  });

  it('budgetForecast sums recurring EXPENSE schedules by category; excludes income', () => {
    const sched: ForecastSchedule[] = [
      { transactionTemplate: { type: 'expense', amount: 1000, currency: 'USD', category: 'rent_mortgage' }, frequency: 'monthly', startDate: '2026-01-01' },
      { transactionTemplate: { type: 'income',  amount: 5000, currency: 'USD', category: 'salary' }, frequency: 'monthly', startDate: '2026-01-01' },
    ];
    const f = recurringForecastByCategory(sched, '2026-06-01', '2026-06-30', 'USD', R);
    // v10.91.0 (FE-MNY-16): one real date in June → exactly one rent (it was ~986, a 30/30.4375 estimate).
    expect(f.rent_mortgage).toBe(1000);
    expect(f.salary).toBeUndefined();               // income excluded from spend forecast
  });
});

describe('v9.1 §5 — RRULE composition', () => {
  it('encodes frequency + ends correctly (quarterly = monthly interval 3)', () => {
    expect(buildRRule('monthly', { kind: 'never' })).toBe('FREQ=MONTHLY;INTERVAL=1');
    expect(buildRRule('quarterly', { kind: 'never' })).toBe('FREQ=MONTHLY;INTERVAL=3');
    expect(buildRRule('weekly', { kind: 'count', count: 10 })).toBe('FREQ=WEEKLY;INTERVAL=1;COUNT=10');
    expect(buildRRule('yearly', { kind: 'until', date: '2027-01-15' })).toBe('FREQ=YEARLY;INTERVAL=1;UNTIL=20270115');
  });
  it('COUNT and UNTIL are mutually exclusive (never both)', () => {
    const r = buildRRule('monthly', { kind: 'count', count: 6 });
    expect(r.includes('COUNT')).toBe(true);
    expect(r.includes('UNTIL')).toBe(false);
  });
});
