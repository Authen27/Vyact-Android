import { describe, expect, it } from 'vitest';
import type { Budget, BudgetAllocation, Transaction } from '../../types';
import { compareTxnRecency, transactionSortValue } from '../format';
import { budgetLinesForMonth } from '../calculations';

// CON-UNIT-131..135 — two display bugs with ONE root cause: code that depended
// on incidental array order or on a field that means "when this row was
// written" rather than "when the money moved".
//
// Both were masked for as long as the local cache happened to supply a
// favourable order and no `created_at`. Clearing that cache in v10.20.7 made
// every row cloud-sourced — where `created_at` is always set and the order is
// the server's — and both surfaced at once. Order is not a contract.

const txn = (over: Partial<Transaction>): Transaction => ({
  id: 'x', type: 'expense', amount: 1, currency: 'INR',
  date: '2026-09-01', description: 'x', category: 'other',
  ...over,
}) as Transaction;

describe('compareTxnRecency · newest-first means when the money moved', () => {
  it('CON-UNIT-131 · a back-dated row written today does not outrank a later-dated one', () => {
    // THE REPORTED BUG. Three Salary rows written in one catch-up batch sorted
    // above a transaction dated a month later, so July's salary appeared above
    // September's rent on the dashboard.
    const julySalary = txn({
      id: 'a', date: '2026-07-02', description: 'Salary',
      created_at: '2026-09-08T15:00:00Z',      // written in a recent batch
    });
    const septRent = txn({
      id: 'b', date: '2026-09-07', description: 'Rent',
      created_at: '2026-09-07T04:00:00Z',
    });

    const sorted = [julySalary, septRent].sort(compareTxnRecency);
    expect(sorted.map(t => t.description)).toEqual(['Rent', 'Salary']);

    // And the primitive itself must not consult created_at at all.
    expect(transactionSortValue(julySalary)).toBe(Date.parse('2026-07-02T00:00:00'));
  });

  it('CON-UNIT-132 · created_at breaks ties WITHIN a day, newest entry first', () => {
    const morning = txn({ id: 'a', date: '2026-09-07', created_at: '2026-09-07T06:00:00Z' });
    const evening = txn({ id: 'b', date: '2026-09-07', created_at: '2026-09-07T20:00:00Z' });
    expect([morning, evening].sort(compareTxnRecency).map(t => t.id)).toEqual(['b', 'a']);
  });

  it('CON-UNIT-133 · an explicit time still wins, and ordering is total', () => {
    const early = txn({ id: 'a', date: '2026-09-07', time: '09:00' });
    const late  = txn({ id: 'b', date: '2026-09-07', time: '18:30' });
    expect([early, late].sort(compareTxnRecency).map(t => t.id)).toEqual(['b', 'a']);

    // No date, no time, no created_at — must still be deterministic, never 0
    // (which would leave order to Array.prototype.sort's implementation).
    const p = txn({ id: 'p', date: '2026-09-07' });
    const q = txn({ id: 'q', date: '2026-09-07' });
    expect([p, q].sort(compareTxnRecency).map(t => t.id)).toEqual(['q', 'p']);
  });
});

describe('budgetLinesForMonth · the dashboard shows THIS month', () => {
  const budget = (id: string, year: number, month: number): Budget => ({
    id, scope: 'month', periodYear: year, periodMonth: month,
    limit: 1000, currency: 'INR',
  }) as Budget;
  const alloc = (id: string, budgetId: string, category: string): BudgetAllocation => ({
    id, budgetId, category, amount: 500,
  }) as BudgetAllocation;

  it('CON-UNIT-134 · only the current month survives, whatever the array order', () => {
    // THE REPORTED BUG. The dashboard called budgetLines() over EVERY budget the
    // household ever had and then took slice(0, 5), so the month on screen was
    // decided by array position. August is deliberately first here.
    const budgets = [budget('aug', 2026, 8), budget('sep', 2026, 9), budget('jul', 2026, 7)];
    const allocs = [
      alloc('a1', 'aug', 'food'), alloc('a2', 'aug', 'rent_mortgage'),
      alloc('s1', 'sep', 'travel'),
      alloc('j1', 'jul', 'utilities'),
    ];

    const lines = budgetLinesForMonth(budgets, allocs, '2026-09');
    expect(lines).toHaveLength(1);
    expect(lines[0].category).toBe('travel');

    // Reversing the input must not change the answer.
    expect(budgetLinesForMonth([...budgets].reverse(), allocs, '2026-09'))
      .toStrictEqual(lines);
  });

  it('CON-UNIT-135 · an annual budget covers every month of its year', () => {
    const annual = { id: 'y', scope: 'annual', periodYear: 2026, limit: 12000,
      currency: 'INR' } as Budget;
    const lines = budgetLinesForMonth([annual], [alloc('y1', 'y', 'food')], '2026-09');
    expect(lines).toHaveLength(1);
    // ...but not a different year.
    expect(budgetLinesForMonth([annual], [alloc('y1', 'y', 'food')], '2025-09')).toHaveLength(0);
  });
});
