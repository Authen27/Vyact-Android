import { describe, expect, it } from 'vitest';
import type { Account, Transaction } from '../../types';
import { buildPeriodData, reportAccountId, type ReportPeriod } from '../reportsModel';

const transaction = (patch: Partial<Transaction>): Transaction => ({ id: 'txn', date: '2026-03-10', type: 'expense', category: 'groceries', amount: 80, currency: 'EUR', description: '', ...patch });
const accounts = [
  { id: 'bank-one', kind: 'bank', name: 'One', currency: 'USD' },
  { id: 'bank-two', kind: 'bank', name: 'Two', currency: 'USD' },
  { id: 'cash-id', kind: 'cash', name: 'Cash in Hand', currency: 'USD' },
] as Account[];

describe('Reports periods and account attribution', () => {
  it('keeps twelve distinct monthly buckets when today is the 31st', () => {
    const rows = buildPeriodData('month', [], 'USD', {}, new Date(2026, 2, 31));
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map(row => row.start)).size).toBe(12);
    expect(rows.slice(-2).map(row => [row.start, row.end])).toEqual([['2026-02-01', '2026-02-28'], ['2026-03-01', '2026-03-31']]);
  });

  it('uses real leap-day and quarter boundaries', () => {
    const rows = buildPeriodData('month', [], 'USD', {}, new Date(2024, 2, 31));
    expect(rows[10].end).toBe('2024-02-29');
    const quarters = buildPeriodData('quarter', [], 'USD', {}, new Date(2026, 4, 31));
    expect(quarters.at(-1)).toMatchObject({ start: '2026-04-01', end: '2026-06-30' });
    expect(new Set(quarters.map(row => row.start)).size).toBe(8);
  });

  it('retains the intended rolling window lengths in each grouping', () => {
    for (const [period, count] of Object.entries({ day: 30, week: 12, month: 12, quarter: 8, year: 5 })) {
      const rows = buildPeriodData(period as ReportPeriod, [], 'USD', {}, new Date(2026, 0, 2));
      expect(rows).toHaveLength(count);
      expect(rows.every((row, index) => row.start <= row.end && (index === 0 || rows[index - 1].end < row.start))).toBe(true);
    }
  });

  it('uses reportable entries and central currency conversion in every chart bucket', () => {
    const rows = buildPeriodData('month', [
      transaction({}),
      transaction({ type: 'income', amount: 500, currency: 'USD', category: 'salary' }),
      transaction({ excluded: true, amount: 900 }),
      transaction({ category: 'transfer', amount: 900 }),
      transaction({ category: 'balance_adjustment', amount: 900 }),
      transaction({ type: 'transfer', category: '', amount: 900 }),
      transaction({ type: 'investment', category: '', amount: 900 }),
    ], 'USD', { USD: 1, EUR: 0.8 }, new Date(2026, 2, 31));
    expect(rows.at(-1)).toMatchObject({ income: 500, expense: 100, net: 400 });
  });

  it('attributes income to the destination and expenses to the paying account', () => {
    expect(reportAccountId(transaction({ type: 'income', toAccountId: 'bank-two' }), accounts)).toBe('bank-two');
    expect(reportAccountId(transaction({ accountId: 'bank-one' }), accounts)).toBe('bank-one');
  });

  it('resolves legacy cash but never assigns an unlinked entry to the first account', () => {
    expect(reportAccountId(transaction({ paymentMethod: 'cash' }), accounts)).toBe('cash-id');
    expect(reportAccountId(transaction({}), accounts)).toBe('');
    expect(reportAccountId(transaction({ accountId: 'unknown-id' }), accounts)).toBe('unknown-id');
  });
});