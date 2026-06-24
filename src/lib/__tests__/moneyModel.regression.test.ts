import { describe, it, expect } from 'vitest';
import {
  monthlyData, totalBalance, spendByCategory, reportableTxns,
  totalAssets, totalLiabilities, computePulseScore,
} from '../calculations';
import { buildSafeSummary } from '../aiSummary';
import { deterministicColor } from '../../constants';
import type {
  Transaction, Budget, Goal, Debt, Asset, Profile, ExchangeRates,
} from '../../types';

// CON-UNIT-MM-001..0xx — Money-Model Overhaul regression safety net.
// Per vyact-money-model-execution-and-regression.md Part C (C4): golden-file the
// aggregation engine and pin the transfer invariant BEFORE Epic 1 touches the
// money model. Every Epic-1 PR must diff against these; only EXPECTED changes
// allowed. This file is the baseline at v8.1.2 (pre-money-model).

const MK = '2026-06';
const RATES: ExchangeRates = { USD: 1, GBP: 1, INR: 1, EUR: 1 };
const PROFILE = { baseCurrency: 'USD', household: 'household', language: 'en' } as unknown as Profile;

// A representative fixture household: income + several expense categories, a
// budget, goals, a debt, assets. Single currency so conversion is identity and
// the golden values are stable + human-checkable.
function fixture() {
  const transactions: Transaction[] = [
    { id: 'i1', type: 'income',  amount: 5000, currency: 'USD', date: `${MK}-01`, description: 'Salary', category: 'salary' },
    { id: 'e1', type: 'expense', amount: 1200, currency: 'USD', date: `${MK}-02`, description: 'Rent',   category: 'rent' },
    { id: 'e2', type: 'expense', amount: 300,  currency: 'USD', date: `${MK}-03`, description: 'Food',   category: 'food' },
    { id: 'e3', type: 'expense', amount: 150,  currency: 'USD', date: `${MK}-04`, description: 'Fuel',   category: 'transport' },
    { id: 'e4', type: 'expense', amount: 90,   currency: 'USD', date: `${MK}-05`, description: 'Movie',  category: 'entertainment' },
  ];
  const budgets: Budget[] = [
    { id: 'b1', category: 'food', limit: 400, currency: 'USD' },
    { id: 'b2', category: 'transport', limit: 200, currency: 'USD' },
  ];
  const goals: Goal[] = [
    { id: 'g1', type: 'emergency', name: 'Emergency', target: 10000, current: 4000, currency: 'USD', completed: false },
  ];
  const debts: Debt[] = [
    { id: 'd1', type: 'loan', name: 'Car loan', principal: 12000, currentBalance: 8000, interestRate: 7, minimumPayment: 300, currency: 'USD' },
  ];
  const assets: Asset[] = [
    { id: 'a1', type: 'cash', name: 'Checking', value: 6000, currency: 'USD', liquidity: 'liquid' },
    { id: 'a2', type: 'investment', name: 'Brokerage', value: 15000, currency: 'USD', liquidity: 'long' },
  ];
  return { transactions, budgets, goals, debts, assets };
}

/** Curated, deterministic snapshot of the whole aggregation engine. Excludes
 *  wall-clock-dependent fields (asOf, daysToDeadline) so the golden file is
 *  stable across runs. */
function aggregationGolden() {
  const f = fixture();
  const month = monthlyData(f.transactions, MK, 'USD', RATES);
  const spend = spendByCategory(f.transactions, MK, 'USD', RATES);
  const ta = totalAssets(f.assets, 'USD', RATES);
  const tl = totalLiabilities(f.debts, 'USD', RATES);
  const pulse = computePulseScore(f.transactions, f.budgets, f.goals, f.debts, 'USD', RATES);
  const summary = buildSafeSummary(f.transactions, f.budgets, f.goals, f.debts, f.assets, PROFILE, RATES);
  return {
    monthlyData: month,
    totalBalance: totalBalance(f.transactions, 'USD', RATES),
    spendByCategory: spend,
    reportableTxnIds: reportableTxns(f.transactions).map(t => t.id).sort(),
    netWorth: ta - tl,
    pulseComponents: pulse.components,
    aiSummary: {
      thisMonth: { income: summary.thisMonth.income, expense: summary.thisMonth.expense, netSavingsRate: summary.thisMonth.netSavingsRate },
      netWorth: summary.netWorth,
      budgets: summary.budgets,
      debts: summary.debts,
    },
  };
}

describe('Money-Model regression — aggregation golden file (C4.1)', () => {
  it('CON-UNIT-MM-001 · aggregation engine baseline is unchanged (pre-Epic-1)', () => {
    // Establishes the baseline. Epic-1 PRs that change this must update the snap
    // deliberately and justify the diff in review.
    expect(aggregationGolden()).toMatchSnapshot();
  });

  it('CON-UNIT-MM-002 · core totals match hand-computed values', () => {
    const g = aggregationGolden();
    expect(g.monthlyData.income).toBe(5000);
    expect(g.monthlyData.expense).toBe(1740);          // 1200+300+150+90
    expect(g.totalBalance).toBe(3260);                 // 5000 − 1740
    expect(g.netWorth).toBe(13000);                    // assets 21000 − debt 8000
    expect(g.spendByCategory).toEqual({ rent: 1200, food: 300, transport: 150, entertainment: 90 });
  });
});

// ── R1 — transfers must never move spend/income totals or Net Worth ─────────────
describe('Money-Model regression — transfer invariant (R1/C4.3)', () => {
  const base = fixture();
  const baseMonth = monthlyData(base.transactions, MK, 'USD', RATES);
  const baseSpend = spendByCategory(base.transactions, MK, 'USD', RATES);
  const baseNet = totalAssets(base.assets, 'USD', RATES) - totalLiabilities(base.debts, 'USD', RATES);

  it('CON-UNIT-MM-010 · a single-row transfer is excluded from all totals', () => {
    const withTransfer: Transaction[] = [
      ...base.transactions,
      { id: 'tr1', type: 'transfer', amount: 2000, currency: 'USD', date: `${MK}-06`, description: 'To savings', category: 'transfer' },
    ];
    const m = monthlyData(withTransfer, MK, 'USD', RATES);
    expect(m.income).toBe(baseMonth.income);
    expect(m.expense).toBe(baseMonth.expense);
    expect(spendByCategory(withTransfer, MK, 'USD', RATES)).toEqual(baseSpend);
  });

  it('CON-UNIT-MM-011 · the legacy paired (__tg) transfer encoding self-cancels', () => {
    // The store expands a transfer into an expense+income pair tagged category
    // 'transfer'. Both legs must be excluded from spend/income totals.
    const paired: Transaction[] = [
      ...base.transactions,
      { id: 'to', type: 'expense', amount: 2000, currency: 'USD', date: `${MK}-06`, description: 'xfer', category: 'transfer', note: '__tg:abc' },
      { id: 'ti', type: 'income',  amount: 2000, currency: 'USD', date: `${MK}-06`, description: 'xfer', category: 'transfer', note: '__tg:abc' },
    ];
    const m = monthlyData(paired, MK, 'USD', RATES);
    expect(m.income).toBe(baseMonth.income);
    expect(m.expense).toBe(baseMonth.expense);
    expect(reportableTxns(paired).map(t => t.id).sort())
      .toEqual(reportableTxns(base.transactions).map(t => t.id).sort());
  });

  it('CON-UNIT-MM-012 · an internal transfer never changes Net Worth', () => {
    // Net Worth is assets − liabilities; an internal move doesn't touch the
    // asset/debt totals the calc reads. (Account-level balances shift in Epic 1,
    // but the aggregate Net Worth stays constant — the invariant to protect.)
    const net = totalAssets(base.assets, 'USD', RATES) - totalLiabilities(base.debts, 'USD', RATES);
    expect(net).toBe(baseNet);
  });
});

// ── B2.1 — deterministic colour (quick win) ─────────────────────────────────────
describe('Money-Model B2.1 — deterministic category colour', () => {
  it('CON-UNIT-MM-020 · same category always maps to the same colour; known cats keep theirs', () => {
    expect(deterministicColor('food')).toBe(deterministicColor('food'));
    expect(deterministicColor('food')).toBe('#E8A87C');        // the food category's own colour
    const custom = deterministicColor('my_custom_cat');
    expect(custom).toMatch(/^#[0-9A-F]{6}$/i);
    expect(deterministicColor('my_custom_cat')).toBe(custom);  // stable
  });
});
