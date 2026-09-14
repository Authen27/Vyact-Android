import { describe, expect, it } from 'vitest';
import type { Budget } from '../../types';
import { budgetPeriodWindow, sortBudgetsForDisplay, sortByUtilisation, utilisation } from '../budgetOrdering';

// v10.27.2 — display order for budgets and the categories inside them. Both used
// to follow whatever order the store returned.

const line = (label: string, spent: number, limit: number) => ({ label, spent, limit });
const labels = (rows: { label: string }[]) => rows.map(r => r.label);

describe('categories within a budget · most utilised first', () => {
  it('orders by spent ÷ limit, highest first', () => {
    const rows = [line('Groceries', 200, 1000), line('Dining', 450, 500), line('Travel', 300, 600)];
    expect(labels(sortByUtilisation(rows, r => r))).toEqual(['Dining', 'Travel', 'Groceries']);   // 90% · 50% · 20%
  });

  it('an overrun outranks a line just under its limit — utilisation is not clamped at 100%', () => {
    const rows = [line('Near', 99, 100), line('Over', 140, 100), line('Exactly', 100, 100)];
    expect(labels(sortByUtilisation(rows, r => r))).toEqual(['Over', 'Exactly', 'Near']);
  });

  it('spend against a zero limit is the most over; an unused zero limit sorts last', () => {
    const rows = [line('Unbudgeted spend', 50, 0), line('Half', 50, 100), line('Empty', 0, 0)];
    expect(labels(sortByUtilisation(rows, r => r))).toEqual(['Unbudgeted spend', 'Half', 'Empty']);
    expect(utilisation(50, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(utilisation(0, 0)).toBe(0);
  });

  it('ties break by larger spend, then label — never by input order', () => {
    const a = [line('Beta', 100, 200), line('Alpha', 100, 200), line('Gamma', 300, 600)];   // all 50%
    const expected = ['Gamma', 'Alpha', 'Beta'];
    expect(labels(sortByUtilisation(a, r => r))).toEqual(expected);
    expect(labels(sortByUtilisation([...a].reverse(), r => r))).toEqual(expected);
  });

  it('returns a new array and leaves the input untouched', () => {
    const rows = [line('Low', 1, 100), line('High', 90, 100)];
    const sorted = sortByUtilisation(rows, r => r);
    expect(sorted).not.toBe(rows);
    expect(labels(rows)).toEqual(['Low', 'High']);
  });
});

const month = (id: string, periodYear: number, periodMonth: number): Budget =>
  ({ id, limit: 1000, currency: 'INR', scope: 'month', periodYear, periodMonth });
const annual = (id: string, periodYear: number): Budget =>
  ({ id, limit: 12000, currency: 'INR', scope: 'annual', periodYear });

describe('budgets on the Budgets page · current month on top, oldest at the bottom', () => {
  const SEPT_11 = new Date(2026, 8, 11);   // local calendar, as the page checks it

  it('current month first, then older months newest to oldest', () => {
    const budgets = [month('jul', 2026, 7), month('sep', 2026, 9), month('jun', 2026, 6), month('aug', 2026, 8)];
    expect(sortBudgetsForDisplay(budgets, SEPT_11).map(b => b.id)).toEqual(['sep', 'aug', 'jul', 'jun']);
  });

  it('crosses year boundaries by date, not by month number', () => {
    const budgets = [month('dec25', 2025, 12), month('jan26', 2026, 1), month('nov25', 2025, 11)];
    expect(sortBudgetsForDisplay(budgets, new Date(2026, 0, 20)).map(b => b.id)).toEqual(['jan26', 'dec25', 'nov25']);
  });

  it('the annual budget covering this year sits right after the current month budget', () => {
    const budgets = [month('aug', 2026, 8), annual('y2026', 2026), month('sep', 2026, 9)];
    expect(sortBudgetsForDisplay(budgets, SEPT_11).map(b => b.id)).toEqual(['sep', 'y2026', 'aug']);
  });

  it('future periods follow the current month, soonest first; past periods stay below them', () => {
    const budgets = [month('dec', 2026, 12), month('aug', 2026, 8), month('oct', 2026, 10), month('sep', 2026, 9)];
    expect(sortBudgetsForDisplay(budgets, SEPT_11).map(b => b.id)).toEqual(['sep', 'oct', 'dec', 'aug']);
  });

  it('a full mixed history ends with the oldest period at the bottom', () => {
    const budgets = [
      annual('y2025', 2025), month('jul26', 2026, 7), month('dec25', 2025, 12), annual('y2026', 2026),
      month('sep26', 2026, 9), month('oct26', 2026, 10), month('aug26', 2026, 8),
      { id: 'custom-jun', limit: 500, currency: 'INR', periodStart: '2026-06-01', periodEnd: '2026-06-30' } as Budget,
    ];
    expect(sortBudgetsForDisplay(budgets, SEPT_11).map(b => b.id))
      .toEqual(['sep26', 'y2026', 'oct26', 'aug26', 'jul26', 'custom-jun', 'dec25', 'y2025']);
  });

  it('a legacy rolling budget (no period) applies to every month, so it stays with the current period', () => {
    const legacy = { id: 'legacy', category: 'groceries', limit: 400, currency: 'INR' } as Budget;
    const budgets = [month('aug', 2026, 8), legacy, month('sep', 2026, 9)];
    expect(budgetPeriodWindow(legacy)).toBeNull();
    expect(sortBudgetsForDisplay(budgets, SEPT_11).map(b => b.id)).toEqual(['sep', 'legacy', 'aug']);
  });

  it('does not depend on, or change, the input order', () => {
    const budgets = [month('jun', 2026, 6), month('sep', 2026, 9), month('aug', 2026, 8)];
    const expected = ['sep', 'aug', 'jun'];
    expect(sortBudgetsForDisplay(budgets, SEPT_11).map(b => b.id)).toEqual(expected);
    expect(sortBudgetsForDisplay([...budgets].reverse(), SEPT_11).map(b => b.id)).toEqual(expected);
    expect(budgets.map(b => b.id)).toEqual(['jun', 'sep', 'aug']);
  });

  it('a month window covers its real last day, including February', () => {
    expect(budgetPeriodWindow(month('feb', 2028, 2))).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(budgetPeriodWindow(month('sep', 2026, 9))).toEqual({ start: '2026-09-01', end: '2026-09-30' });
  });
});
