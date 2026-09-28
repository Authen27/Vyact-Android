import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../types';
import { baselineLabel, essentialRunway } from '../essentialRunway';

const NOW = '2026-09-11';
const txn = (patch: Partial<Transaction>): Transaction => ({ id: 't', type: 'expense', category: 'groceries', amount: 100, currency: 'USD', date: '2026-08-10', description: '', ...patch });
const needs = { groceries: 'need', rent_mortgage: 'need', shopping: 'want' } as const;
const run = (transactions: Transaction[], liquidAssets = 3000, classifications: Record<string, 'need' | 'want'> = { ...needs }) =>
  essentialRunway({ transactions, classifications, liquidAssets, baseCurrency: 'USD', rates: { USD: 1, EUR: 0.8 }, now: NOW });

describe('Essential-spend runway (v10.31.0)', () => {
  it('uses the last three completed months with recorded spending, never the current month', () => {
    const result = run([
      txn({ date: '2026-04-05', amount: 999 }), txn({ date: '2026-05-05', amount: 300 }),
      txn({ date: '2026-07-05', amount: 600 }), txn({ date: '2026-08-05', amount: 900 }),
      txn({ date: '2026-09-02', amount: 99999 }),
    ]);
    expect(result).toEqual({ status: 'ready', baselineMonths: ['2026-05', '2026-07', '2026-08'], averageEssential: 600, liquidAssets: 3000, months: 5 });
    expect(baselineLabel(result.baselineMonths)).toBe('May–Aug 2026');
  });

  it('counts only need-classified reportable spending, honours the live classification map, and converts currency', () => {
    const transactions = [
      txn({ amount: 200 }), txn({ category: 'shopping', amount: 400 }), txn({ category: 'rent_mortgage', amount: 80, currency: 'EUR' }),
      txn({ excluded: true, amount: 999 }), txn({ type: 'transfer', category: '', amount: 999 }), txn({ type: 'income', category: 'salary', amount: 999 }),
    ];
    expect(run(transactions).averageEssential).toBe(300);
    expect(run(transactions, 3000, { ...needs, shopping: 'need' }).averageEssential).toBe(700);
  });

  it('reports zero months for a non-positive liquid position, and no runway without a baseline or essential spend', () => {
    expect(run([txn({})], -50)).toMatchObject({ status: 'ready', months: 0, liquidAssets: -50 });
    expect(run([txn({ date: '2026-09-01' })])).toMatchObject({ status: 'no-baseline', months: null, baselineMonths: [] });
    expect(run([txn({ category: 'shopping' })])).toMatchObject({ status: 'no-essential-spend', months: null, averageEssential: 0 });
  });

  it('labels baselines within and across years', () => {
    expect(baselineLabel(['2026-08'])).toBe('Aug 2026');
    expect(baselineLabel(['2025-11', '2025-12', '2026-01'])).toBe('Nov 2025–Jan 2026');
    expect(baselineLabel([])).toBe('');
  });
});
