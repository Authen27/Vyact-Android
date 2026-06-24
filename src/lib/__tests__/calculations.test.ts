import { describe, it, expect } from 'vitest';
import {
  reportableTxns, effectiveAmount, monthlyData, totalBalance,
  spendByCategory, totalAssets, totalLiabilities, liquidAssets,
  computePulseScore, splitsOutstanding,
} from '../calculations';
import { DEFAULT_RATES } from '../../constants';
import type { Transaction, Budget, Goal, Debt, Asset } from '../../types';

// Test scenarios CON-UNIT-012..026, CON-UNIT-046. See docs/TEST_SCENARIOS.md.
//
// TD-01 phase B (PR #9) migrated every aggregator in `calculations.ts` to fold
// in dinero space. Tests that used `toBeCloseTo(x, 10)` to tolerate the old
// float drift are tightened here to strict `.toBe(x)` for cases where the
// math is now exact. `CON-UNIT-046` is a new test that pins the specific
// drift the migration eliminates.

const R = DEFAULT_RATES;
const USD = 'USD';

function txn(over: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    type: 'expense',
    amount: 0,
    currency: 'USD',
    date: '2026-05-10',
    description: 'x',
    category: 'general',
    ...over,
  };
}

describe('reportableTxns', () => {
  it('CON-UNIT-012 · excludes private/excluded txns and isolates investment + transfer', () => {
    const txns = [
      txn({ type: 'income', amount: 100 }),
      txn({ type: 'expense', amount: 40 }),
      txn({ type: 'expense', amount: 999, excluded: true }), // private
      txn({ type: 'investment', amount: 500 }),              // isolated
      txn({ type: 'transfer', amount: 300 }),                // isolated
    ];
    const r = reportableTxns(txns);
    expect(r).toHaveLength(2);
    expect(r.every(t => t.type === 'income' || t.type === 'expense')).toBe(true);
    expect(r.some(t => t.excluded)).toBe(false);
  });
});

describe('effectiveAmount', () => {
  it('CON-UNIT-013 · uses the full amount for non-split txns', () => {
    expect(effectiveAmount(txn({ amount: 100 }), USD, R)).toBe(100);
  });
  it('CON-UNIT-014 · uses only yourShare for a split txn', () => {
    const t = txn({
      amount: 120,
      split: { isSplit: true, totalAmount: 120, yourShare: 40, paidBy: 'me', participants: [] },
    });
    expect(effectiveAmount(t, USD, R)).toBe(40);
  });
  it('CON-UNIT-015 · converts a foreign-currency amount into base', () => {
    // 92 EUR @ rate 0.92 → USD = exactly 100 with dinero + banker's rounding.
    // (Pre-TD-01 phase A this was `~100.00...` via floats — now strict.)
    expect(effectiveAmount(txn({ amount: 92, currency: 'EUR' }), USD, R)).toBe(100);
  });
});

describe('monthlyData', () => {
  const txns = [
    txn({ type: 'income', amount: 5000, date: '2026-05-01' }),
    txn({ type: 'expense', amount: 1200, date: '2026-05-15' }),
    txn({ type: 'expense', amount: 800, date: '2026-05-20' }),
    txn({ type: 'expense', amount: 9999, date: '2026-04-30' }), // different month
  ];
  it('CON-UNIT-016 · sums income/expense within the month and computes net', () => {
    const d = monthlyData(txns, '2026-05', USD, R);
    expect(d.income).toBe(5000);
    expect(d.expense).toBe(2000);
    expect(d.net).toBe(3000);
  });
  it('CON-UNIT-017 · ignores transactions outside the requested month', () => {
    expect(monthlyData(txns, '2026-05', USD, R).expense).not.toBe(11999);
  });
});

describe('totalBalance', () => {
  it('CON-UNIT-018 · income adds, expense subtracts', () => {
    const txns = [
      txn({ type: 'income', amount: 1000 }),
      txn({ type: 'expense', amount: 250 }),
      txn({ type: 'expense', amount: 250 }),
    ];
    expect(totalBalance(txns, USD, R)).toBe(500);
  });

  it('CON-UNIT-046 · [TD-01 phase B] repeated additions do not drift in float (0.1 problem)', () => {
    // The canonical "0.1 + 0.2 !== 0.3" class of float bug, applied to
    // FinFlow: summing many small same-currency expenses. Pre-phase B the
    // reducer fell into `Number + Number` and accumulated drift; post-phase
    // B the reduction happens in dinero (integer cents add) and is exact.
    const ten = Array.from({ length: 10 }, () =>
      txn({ type: 'expense', amount: 0.10 }),
    );
    // 10 expenses of $0.10 → balance = -$1.00 exactly. With pre-phase-B
    // float math this would have produced something like -1.0000000000000002.
    expect(totalBalance(ten, USD, R)).toBe(-1.00);
  });
});

describe('spendByCategory', () => {
  it('CON-UNIT-019 · groups expense totals by category for the month', () => {
    const txns = [
      txn({ category: 'food', amount: 100 }),
      txn({ category: 'food', amount: 50 }),
      txn({ category: 'rent', amount: 900 }),
      txn({ type: 'income', category: 'salary', amount: 5000 }), // not an expense
    ];
    const s = spendByCategory(txns, '2026-05', USD, R);
    expect(s.food).toBe(150);
    expect(s.rent).toBe(900);
    expect(s.salary).toBeUndefined();
  });
});

describe('balance sheet helpers', () => {
  const assets: Asset[] = [
    { id: 'a1', type: 'cash', name: 'Checking', value: 10000, currency: 'USD', liquidity: 'liquid' },
    { id: 'a2', type: 'property', name: 'House', value: 300000, currency: 'USD', liquidity: 'long' },
  ];
  const debts: Debt[] = [
    { id: 'd1', type: 'mortgage', name: 'Home loan', principal: 250000, currentBalance: 200000, interestRate: 5, minimumPayment: 1170, currency: 'USD' },
  ];
  it('CON-UNIT-020 · totalAssets sums all asset values', () => {
    expect(totalAssets(assets, USD, R)).toBe(310000);
  });
  it('CON-UNIT-021 · liquidAssets sums only liquid assets', () => {
    expect(liquidAssets(assets, USD, R)).toBe(10000);
  });
  it('CON-UNIT-022 · totalLiabilities sums debt balances', () => {
    expect(totalLiabilities(debts, USD, R)).toBe(200000);
  });
});

describe('computePulseScore', () => {
  it('CON-UNIT-023 · returns a total in [0,100] with the four components present (goals removed)', () => {
    const txns = [
      txn({ type: 'income', amount: 5000, date: '2026-05-01' }),
      txn({ type: 'expense', amount: 2000, date: '2026-05-10' }),
    ];
    const budgets: Budget[] = [{ id: 'b1', category: 'general', limit: 3000, currency: 'USD' }];
    const debts: Debt[] = [];
    const p = computePulseScore(txns, budgets, [], debts, USD, R);
    expect(p.total).toBeGreaterThanOrEqual(0);
    expect(p.total).toBeLessThanOrEqual(100);
    expect(Object.keys(p.components).sort()).toEqual(['budget', 'debt', 'savings', 'trend']);
  });
  it('CON-UNIT-024 · higher debt-to-income lowers the debt component', () => {
    // Date the income into the CURRENT month so the DTI ratio is actually
    // exercised (pulse score reads nowMonthKey()); avoids calendar drift.
    const curMonthDate = `${new Date().toISOString().slice(0, 7)}-01`;
    const lowDtiTxns = [txn({ type: 'income', amount: 10000, date: curMonthDate })];
    // Debt-free is intentionally EXCLUDED from the score, so compare two
    // debt-bearing households: a crushing DTI must score below a light one.
    const highDebt: Debt[] = [{ id: 'd', type: 'loan', name: 'L', principal: 0, currentBalance: 5000, interestRate: 10, minimumPayment: 6000, currency: 'USD' }];
    const lowDebt: Debt[] = [{ id: 'd2', type: 'loan', name: 'L2', principal: 0, currentBalance: 1000, interestRate: 5, minimumPayment: 500, currency: 'USD' }];
    const high = computePulseScore(lowDtiTxns, [], [], highDebt, USD, R);
    const low = computePulseScore(lowDtiTxns, [], [], lowDebt, USD, R);
    expect(high.components.debt).toBeLessThan(low.components.debt);
  });
});

describe('splitsOutstanding', () => {
  it('CON-UNIT-025 · tallies amounts owed TO you when you paid', () => {
    const t = txn({
      amount: 120,
      split: {
        isSplit: true, totalAmount: 120, yourShare: 40, paidBy: 'me',
        participants: [
          { name: 'me', isYou: true, share: 40, paid: true },
          { name: 'Alex', share: 40, paid: false },
          { name: 'Sam', share: 40, paid: false },
        ],
      },
    });
    const r = splitsOutstanding([t], USD, R);
    expect(r.owedToYou).toBe(80);
    expect(r.youOwe).toBe(0);
    expect(r.owedDetails).toHaveLength(2);
  });
  it('CON-UNIT-026 · tallies what YOU owe when someone external paid', () => {
    const t = txn({
      amount: 90,
      split: {
        isSplit: true, totalAmount: 90, yourShare: 30, paidBy: 'external',
        participants: [
          { name: 'me', isYou: true, share: 30, paid: false },
          { name: 'Jordan', share: 60, paid: true },
        ],
      },
    });
    const r = splitsOutstanding([t], USD, R);
    expect(r.youOwe).toBe(30);
    expect(r.owedToYou).toBe(0);
  });
});
