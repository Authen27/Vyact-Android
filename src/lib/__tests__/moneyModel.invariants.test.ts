// Vyact v9 — txn-redesign §7 invariants (INV-1..INV-9). These pin the money
// model's load-bearing guarantees: transfers and investments never move
// spend/income, reconciliation forgives drift without fabricating a transaction,
// the EMI split is exact, balances/net-worth fold over real data, and categories
// stay type-scoped. If a future change makes any number untrue, one of these
// fails first.

import { describe, it, expect } from 'vitest';
import { computeAccountBalance, reconcileAccount } from '../accountBalance';
import { monthlyData, reportableTxns, spendByCategory, splitEmiPortions, totalAssets, totalLiabilities } from '../calculations';
import { CATEGORIES_BY_TYPE } from '../../constants';
import type { Transaction, Account, Asset, Debt, ExchangeRates } from '../../types';

const R: ExchangeRates = { USD: 1 };
const MK = new Date().toISOString().slice(0, 7);
const d = (day: string) => `${MK}-${day}`;

const CASH: Account = { id: 'acc-cash', kind: 'cash', name: 'Cash', currency: 'USD', openingBalance: 1000 };
const BANK: Account = { id: 'acc-bank', kind: 'bank', name: 'Bank', currency: 'USD', openingBalance: 0 };
const INVEST: Account = { id: 'acc-inv', kind: 'investment', name: 'Brokerage', currency: 'USD', openingBalance: 0 };

const base: Transaction[] = [
  { id: 'i', type: 'income',  amount: 5000, currency: 'USD', date: d('01'), description: '', category: 'salary', toAccountId: 'acc-cash' },
  { id: 'e', type: 'expense', amount: 800,  currency: 'USD', date: d('02'), description: '', category: 'food_dining', accountId: 'acc-cash' },
];

describe('§7 INV-1 — transfers are spend/income neutral', () => {
  it('INV-1 · a transfer changes no spend or income total', () => {
    const transfer: Transaction = { id: 't', type: 'transfer', amount: 1200, currency: 'USD', date: d('03'), description: '', category: '', accountId: 'acc-cash', toAccountId: 'acc-bank' };
    const before = monthlyData(base, MK, 'USD', R);
    const after = monthlyData([...base, transfer], MK, 'USD', R);
    expect(after.income).toBe(before.income);
    expect(after.expense).toBe(before.expense);
    // ...but it DOES move both account balances (−1200 cash, +1200 bank).
    expect(computeAccountBalance(CASH, [...base, transfer], 'USD', R)).toBe(1000 + 5000 - 800 - 1200);
    expect(computeAccountBalance(BANK, [...base, transfer], 'USD', R)).toBe(1200);
    expect(reportableTxns([...base, transfer]).some(t => t.id === 't')).toBe(false);
  });
});

describe('§7 INV-2 — investment contributions are spend/income neutral', () => {
  it('INV-2 · an investment buy is excluded from spend/income but moves balances', () => {
    const buy: Transaction = { id: 'v', type: 'investment', amount: 500, currency: 'USD', date: d('04'), description: '', category: '', accountId: 'acc-cash', toAccountId: 'acc-inv' };
    const before = monthlyData(base, MK, 'USD', R);
    const after = monthlyData([...base, buy], MK, 'USD', R);
    expect(after.expense).toBe(before.expense);
    expect(after.income).toBe(before.income);
    expect(computeAccountBalance(INVEST, [...base, buy], 'USD', R)).toBe(500);
    expect(spendByCategory([...base, buy], MK, 'USD', R)['']).toBeUndefined();
  });
});

describe('§7 INV-3 — value updates are an offset, never a transaction', () => {
  it('INV-3 · investment value update moves balance via offset only', () => {
    const buy: Transaction = { id: 'v', type: 'investment', amount: 500, currency: 'USD', date: d('04'), description: '', category: '', accountId: 'acc-cash', toAccountId: 'acc-inv' };
    const txns = [...base, buy];
    // computed value 500; market says it's now 620 → +120 offset.
    const { patch, delta } = reconcileAccount(INVEST, 500, 620, 'investment');
    expect(delta).toBe(120);
    expect(patch.reconciliationOffset).toBe(120);
    // balance now reflects the stated value exactly...
    expect(computeAccountBalance({ ...INVEST, ...patch }, txns, 'USD', R)).toBe(620);
    // ...and spend/income are untouched (the offset is not in the txn stream).
    const m = monthlyData(txns, MK, 'USD', R);
    expect(m.income).toBe(5000);
    expect(m.expense).toBe(800);
  });

  it('INV-3b · reconcile writes a dated quiet-log entry and NO transaction', () => {
    const { patch } = reconcileAccount(BANK, 4200, 4250, 'bank');
    expect(patch.reconciliationLog).toHaveLength(1);
    expect(patch.reconciliationLog?.[0]).toMatchObject({ delta: 50, kind: 'bank', stated_value: 4250 });
    expect('adjustment' in (reconcileAccount(BANK, 4200, 4250, 'bank') as object)).toBe(false);
    // a no-op reconcile appends nothing.
    expect(reconcileAccount(BANK, 4200, 4200, 'bank').patch.reconciliationLog).toHaveLength(0);
  });
});

describe('§7 INV-5 — EMI split is exact (interest visible, principal a transfer)', () => {
  it('INV-5 · interest + principal == payment, principal never negative', () => {
    const { interest, principal } = splitEmiPortions(10000, 12, 500);
    expect(interest).toBeCloseTo(100, 6);            // 10000 × 0.01
    expect(principal).toBeCloseTo(400, 6);
    expect(Math.round((interest + principal) * 100) / 100).toBe(500);
    // a payment smaller than the interest accrual never produces negative principal.
    expect(splitEmiPortions(10000, 12, 50).principal).toBe(0);
  });
});

describe('§7 INV-6 — account balance folds opening + flows + offset', () => {
  it('INV-6 · balance = opening + credits − debits + offset', () => {
    expect(computeAccountBalance(CASH, base, 'USD', R)).toBe(1000 + 5000 - 800);
    expect(computeAccountBalance({ ...CASH, reconciliationOffset: -25 }, base, 'USD', R)).toBe(1000 + 5000 - 800 - 25);
  });
});

describe('§7 INV-7 — net worth = assets − liabilities (liability kinds negative)', () => {
  it('INV-7 · credit-card/loan balances subtract; receivables do not', () => {
    const assets: Asset[] = [
      { id: 'a1', type: 'investment', name: 'Brokerage', value: 12000, currency: 'USD', liquidity: 'long' },
      { id: 'a2', type: 'cash', name: 'Bank', value: 3000, currency: 'USD', liquidity: 'liquid' },
    ];
    const debts: Debt[] = [
      { id: 'd1', type: 'credit_card', name: 'Visa', principal: 0, currentBalance: 1500, interestRate: 18, minimumPayment: 50, currency: 'USD' },
      { id: 'd2', type: 'loan', name: 'Car', principal: 0, currentBalance: 8000, interestRate: 7, minimumPayment: 300, currency: 'USD' },
      // a receivable is NOT a liability — it must not subtract from net worth.
      { id: 'd3', type: 'personal', name: 'Lent to Sam', principal: 0, currentBalance: 500, interestRate: 0, minimumPayment: 0, currency: 'USD', direction: 'owed_to_me' },
    ];
    const netWorth = totalAssets(assets, 'USD', R) - totalLiabilities(debts, 'USD', R);
    expect(totalAssets(assets, 'USD', R)).toBe(15000);
    expect(totalLiabilities(debts, 'USD', R)).toBe(9500);   // receivable excluded
    expect(netWorth).toBe(5500);
  });
});

describe('§7 INV-9 — categories are type-scoped; transfers/investments carry none', () => {
  it('INV-9 · transfer and investment category pools are empty', () => {
    expect(CATEGORIES_BY_TYPE.transfer).toHaveLength(0);
    expect(CATEGORIES_BY_TYPE.investment).toHaveLength(0);
    expect(CATEGORIES_BY_TYPE.expense.length).toBeGreaterThan(0);
    expect(CATEGORIES_BY_TYPE.income.length).toBeGreaterThan(0);
    // no id appears in both the expense and income pools (disjoint scopes).
    const exp = new Set(CATEGORIES_BY_TYPE.expense.map(c => c.id));
    expect(CATEGORIES_BY_TYPE.income.some(c => exp.has(c.id))).toBe(false);
  });
});
