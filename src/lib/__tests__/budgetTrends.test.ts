import { describe, expect, it } from 'vitest';
import type { Budget, BudgetAllocation, Transaction } from '../../types';
import { budgetTrends } from '../budgetTrends';

const NOW = '2026-09-11';
const txn = (patch: Partial<Transaction>): Transaction => ({ id: 't', type: 'expense', category: 'groceries', amount: 50, currency: 'USD', date: '2026-07-10', description: '', ...patch });
const budget = (patch: Partial<Budget>): Budget => ({ id: 'b', scope: 'month', periodYear: 2026, periodMonth: 7, limit: 0, currency: 'USD', ...patch } as Budget);
const line = (budgetId: string, category: string, amount: number): BudgetAllocation => ({ id: `${budgetId}-${category}`, budgetId, category, amount } as BudgetAllocation);
const run = (budgets: Budget[], allocations: BudgetAllocation[], transactions: Transaction[], range = { from: '2025-10-01', to: NOW }) =>
  budgetTrends({ budgets, allocations, transactions, baseCurrency: 'USD', rates: { USD: 1, EUR: 0.8 }, range, now: NOW });

describe('Budget vs actual by matching scope (v10.31.0)', () => {
  it('compares a monthly budget over its own month, only in its allocated categories, through central FX', () => {
    const trends = run([budget({ id: 'jul', currency: 'EUR' })], [line('jul', 'groceries', 80), line('jul', 'travel', 40)], [
      txn({ amount: 90 }), txn({ category: 'travel', amount: 30 }), txn({ category: 'shopping', amount: 500 }),
      txn({ date: '2026-08-01', amount: 500 }), txn({ excluded: true, amount: 500 }),
    ]);
    expect(trends.monthly).toEqual([expect.objectContaining({ label: 'Jul 2026', start: '2026-07-01', end: '2026-07-31',
      budgeted: 150, actual: 120, difference: 30, status: 'under' })]);
  });

  it('marks over, and never calls the current period over or under', () => {
    const trends = run([budget({ id: 'aug', periodMonth: 8 }), budget({ id: 'sep', periodMonth: 9 })],
      [line('aug', 'groceries', 40), line('sep', 'groceries', 10)],
      [txn({ date: '2026-08-05', amount: 60 }), txn({ date: '2026-09-02', amount: 90 }), txn({ date: '2026-09-20', amount: 999 })]);
    expect(trends.monthly.map(row => [row.label, row.status, row.actual])).toEqual([['Aug 2026', 'over', 60], ['Sep 2026', 'in-progress', 90]]);
    expect(trends).toMatchObject({ completedOver: 1, completedUnder: 0 });
  });

  it('keeps annual budgets in their own series over the full year', () => {
    const trends = run([budget({ id: 'y25', scope: 'annual', periodYear: 2025, periodMonth: undefined }), budget({ id: 'jul' })],
      [line('y25', 'groceries', 1000), line('jul', 'groceries', 100)],
      [txn({ date: '2025-02-01', amount: 300 }), txn({ date: '2025-11-01', amount: 200 })]);
    expect(trends.annual).toEqual([expect.objectContaining({ label: '2025', start: '2025-01-01', end: '2025-12-31', actual: 500, status: 'under' })]);
    expect(trends.monthly.map(row => row.label)).toEqual(['Jul 2026']);
  });

  it('includes only budgets overlapping the range, and skips budgets with no allocations', () => {
    const trends = run([budget({ id: 'jul' }), budget({ id: 'mar', periodMonth: 3 }), budget({ id: 'empty', periodMonth: 8 })],
      [line('jul', 'groceries', 100), line('mar', 'groceries', 100)], [], { from: '2026-06-15', to: NOW });
    expect(trends.monthly.map(row => row.budgetId)).toEqual(['jul']);
    expect(trends.unallocated).toBe(1);
  });
});
