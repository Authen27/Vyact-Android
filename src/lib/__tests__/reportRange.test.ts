import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../types';
import {
  effectiveGrouping, firstReportableDate, groupingFromParam, rangeBuckets, rangeFromParams, rangeLabel, resolveRange, writeRangeParams,
} from '../reportRange';

const NOW = '2026-09-11';
const txn = (patch: Partial<Transaction>): Transaction => ({ id: 't', type: 'expense', category: 'groceries', amount: 10, currency: 'USD', date: '2026-09-05', description: '', ...patch });

describe('Reports date range (v10.31.0)', () => {
  it('resolves every preset to inclusive calendar dates ending today', () => {
    expect(resolveRange({ preset: 'this-month' }, null, NOW)).toEqual({ preset: 'this-month', from: '2026-09-01', to: NOW });
    expect(resolveRange({ preset: 'last-3m' }, null, NOW).from).toBe('2026-07-01');
    expect(resolveRange({ preset: 'last-6m' }, null, NOW).from).toBe('2026-04-01');
    expect(resolveRange({ preset: 'last-12m' }, null, NOW).from).toBe('2025-10-01');
    expect(resolveRange({ preset: 'ytd' }, null, NOW).from).toBe('2026-01-01');
    expect(resolveRange({ preset: 'all' }, '2024-03-15', NOW)).toEqual({ preset: 'all', from: '2024-03-15', to: NOW });
    expect(resolveRange({ preset: 'all' }, null, NOW).from).toBe('2026-09-01');
    expect(resolveRange({ preset: 'nonsense' }, null, NOW).preset).toBe('last-12m');
    expect(resolveRange({ preset: 'last-3m' }, null, '2026-01-31').from).toBe('2025-11-01');
  });

  it('accepts a valid custom range, clamps a future end to today, and rejects invalid or reversed input', () => {
    expect(resolveRange({ preset: 'custom', from: '2026-02-01', to: '2026-02-28' }, null, NOW)).toEqual({ preset: 'custom', from: '2026-02-01', to: '2026-02-28' });
    expect(resolveRange({ preset: 'custom', from: '2026-08-01', to: '2027-01-01' }, null, NOW).to).toBe(NOW);
    expect(resolveRange({ preset: 'custom', from: '2026-02-30', to: '2026-03-31' }, null, NOW).preset).toBe('last-12m');
    expect(resolveRange({ preset: 'custom', from: '2026-05-01', to: '2026-04-01' }, null, NOW).preset).toBe('last-12m');
    expect(resolveRange({ preset: 'custom', from: '2026-10-01', to: '2026-12-01' }, null, NOW).preset).toBe('last-12m');
  });

  it('builds calendar buckets clamped to the range and marks partial edges, including leap February', () => {
    const months = rangeBuckets([], { from: '2026-07-01', to: NOW }, 'month', 'USD', {});
    expect(months.map(bucket => [bucket.label, bucket.start, bucket.end, bucket.partial])).toEqual([
      ["Jul '26", '2026-07-01', '2026-07-31', false], ["Aug '26", '2026-08-01', '2026-08-31', false], ["Sep '26", '2026-09-01', NOW, true],
    ]);
    expect(rangeBuckets([], { from: '2024-02-01', to: '2024-03-31' }, 'month', 'USD', {})[0].end).toBe('2024-02-29');
    const weeks = rangeBuckets([], { from: '2026-09-02', to: NOW }, 'week', 'USD', {});
    expect(weeks[0]).toMatchObject({ label: 'Aug 30', start: '2026-09-02', end: '2026-09-05', partial: true });
    expect(weeks.at(-1)).toMatchObject({ start: '2026-09-06', end: NOW, partial: true });
    expect(rangeBuckets([], { from: '2026-01-01', to: NOW }, 'quarter', 'USD', {}).map(bucket => bucket.label)).toEqual(["Q1 '26", "Q2 '26", "Q3 '26"]);
  });

  it('coarsens a grouping that would draw more than 60 buckets, and says so', () => {
    expect(effectiveGrouping({ from: '2023-09-01', to: NOW }, 'day')).toEqual({ grouping: 'month', coarsened: true });
    expect(effectiveGrouping({ from: '2026-08-01', to: NOW }, 'day')).toEqual({ grouping: 'day', coarsened: false });
    expect(effectiveGrouping({ from: '1990-01-01', to: NOW }, 'month').grouping).toBe('year');
  });

  it('sums only reportable entries dated inside the range, through central FX', () => {
    const rows = rangeBuckets([
      txn({}), txn({ type: 'income', category: 'salary', amount: 100 }), txn({ amount: 8, currency: 'EUR' }),
      txn({ excluded: true, amount: 999 }), txn({ type: 'transfer', category: '', amount: 999 }),
      txn({ date: '2026-06-30', amount: 999 }), txn({ date: '2026-09-12', amount: 999 }),
    ], { from: '2026-07-01', to: NOW }, 'month', 'USD', { USD: 1, EUR: 0.8 });
    expect(rows.at(-1)).toMatchObject({ income: 100, expense: 20, net: 80 });
    expect(rows[0]).toMatchObject({ income: 0, expense: 0 });
    expect(firstReportableDate([txn({ date: '2025-01-02', type: 'transfer', category: '' }), txn({ date: '2025-03-04' })])).toBe('2025-03-04');
  });

  it('round-trips through the URL without colliding with from=savings', () => {
    const custom = resolveRange({ preset: 'custom', from: '2026-02-01', to: '2026-02-28' }, null, NOW);
    const params = writeRangeParams(new URLSearchParams('from=savings'), custom, 'week');
    expect(params.get('from')).toBe('savings');
    expect(rangeFromParams(params, null, NOW)).toEqual(custom);
    expect(groupingFromParam(params.get('group'))).toBe('week');
    const preset = writeRangeParams(params, resolveRange({ preset: 'ytd' }, null, NOW), 'month');
    expect(preset.has('start')).toBe(false);
    expect(groupingFromParam('fortnight')).toBe('month');
    expect(rangeLabel(custom)).toBe('1 Feb 2026 – 28 Feb 2026');
  });
});
