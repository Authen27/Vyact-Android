// Vyact v9 — txn-redesign §7 invariants. These pin the money model's
// load-bearing guarantees: transfers and investments never move spend/income,
// reconciliation forgives drift without fabricating a transaction, the EMI
// split is exact, balances/net-worth fold over real data, and categories stay
// type-scoped. If a future change makes any number untrue, one of these fails
// first.
//
// 🔴 THE LABELS BELOW ARE OFF-BY-ONE FROM THE SPEC, from INV-4 onward.
//
// This file's numbering drifted when it was written and has been quoted as
// "INV-1..9" ever since, which made the gaps at 4 and 8 look like missing
// coverage. They are not missing — they are covered under a different label.
// The mapping to `vyact-txn-redesign-architect-spec_1.md` §7 is:
//
//   spec INV-1  transfer_neutral      → INV-1   ✅
//   spec INV-2  investment_neutral    → INV-2   ✅
//   spec INV-3  value_update          → INV-3   ✅  (+ INV-3b reconcile_no_txn)
//   spec INV-4  emi_split             → INV-5   ✅
//   spec INV-5  account_balance       → INV-6   ✅
//   spec INV-6  networth_recon        → INV-7   ✅  (+ INV-7b live-account de-dupe)
//   spec INV-7  atomicity             →  —      ❌  NOT COVERED — see below
//   spec INV-8  category_scope        → INV-9   ✅
//   spec INV-9  migration_recon       →  —      one-time v9 migration check, not a
//                                               standing invariant
//
// The labels are deliberately NOT renumbered: they are cited by id in the
// CHANGELOG and in source comments, and silently reassigning them would make
// that history point at the wrong guarantee.
//
// ❌ The one real gap is spec INV-7 (atomicity): "force-fail any leg of an EMI
// or transfer — the ENTIRE event rolls back, zero state change". Nothing here
// asserts it, because the store has no transactional boundary to assert against
// yet; it is tracked as the "atomic reversal" release blocker. Do not add a
// placeholder for it — the inventory gate rejects skipped and TODO cases, and a
// green placeholder would be worse than an acknowledged gap.

import { describe, it, expect } from 'vitest';
import { computeAccountBalance, reconcileAccount, liveAssetRows, liveTotalAssets, computeAssetValue, reconcileAssetValue } from '../accountBalance';
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

// v10.26.0 (R4) — INV-2 REWRITTEN DELIBERATELY. An investment now moves money
// between an ACCOUNT and an investment ASSET (Net Worth), not between two
// accounts. The guarantee is unchanged in spirit and stronger in letter: no
// spend, no income, and the account and the asset move by the same amount, so
// net worth does not move at all.
const FUND: Asset = { id: 'ast-fund', type: 'investment', name: 'Index fund', value: 0, currency: 'USD', liquidity: 'short' };
const worth = (assets: Asset[], txns: Transaction[]) =>
  liveTotalAssets(liveAssetRows(assets, [CASH, BANK], txns, 'USD', R));

describe('§7 INV-2 — investment contributions are spend/income neutral', () => {
  it('INV-2 · a buy is excluded from spend/income, moves the account down and the asset up by the same amount — net worth unchanged', () => {
    const buy: Transaction = { id: 'v', type: 'investment', amount: 500, currency: 'USD', date: d('04'), description: '', category: '', accountId: 'acc-cash', assetId: 'ast-fund' };
    const before = monthlyData(base, MK, 'USD', R);
    const after = monthlyData([...base, buy], MK, 'USD', R);
    expect(after.expense).toBe(before.expense);
    expect(after.income).toBe(before.income);
    expect(computeAccountBalance(CASH, [...base, buy], 'USD', R)).toBe(computeAccountBalance(CASH, base, 'USD', R) - 500);
    expect(computeAssetValue(FUND, [...base, buy], R)).toBe(500);
    expect(worth([FUND], [...base, buy])).toBe(worth([FUND], base));
    expect(spendByCategory([...base, buy], MK, 'USD', R)['']).toBeUndefined();
  });

  it('INV-2b · a withdrawal moves the asset down and the receiving account up — net worth unchanged', () => {
    const buy: Transaction = { id: 'v', type: 'investment', amount: 500, currency: 'USD', date: d('04'), description: '', category: '', accountId: 'acc-cash', assetId: 'ast-fund' };
    const out: Transaction = { id: 'w', type: 'investment', amount: 200, currency: 'USD', date: d('05'), description: '', category: '', toAccountId: 'acc-bank', assetId: 'ast-fund' };
    const txns = [...base, buy, out];
    expect(computeAssetValue(FUND, txns, R)).toBe(300);
    expect(computeAccountBalance(BANK, txns, 'USD', R)).toBe(200);
    expect(worth([FUND], txns)).toBe(worth([FUND], base));
    const m = monthlyData(txns, MK, 'USD', R);
    expect(m.income).toBe(5000);
    expect(m.expense).toBe(800);
  });

  it('INV-2c · a legacy investment ACCOUNT row still folds — caches and local households predate R4', () => {
    const legacy: Transaction = { id: 'v', type: 'investment', amount: 500, currency: 'USD', date: d('04'), description: '', category: '', accountId: 'acc-cash', toAccountId: 'acc-inv' };
    expect(computeAccountBalance(INVEST, [...base, legacy], 'USD', R)).toBe(500);
    expect(monthlyData([...base, legacy], MK, 'USD', R).expense).toBe(800);
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

  it('INV-3c · an investment ASSET value update moves the valuation offset only — opening value and spend untouched', () => {
    const buy: Transaction = { id: 'v', type: 'investment', amount: 500, currency: 'USD', date: d('04'), description: '', category: '', accountId: 'acc-cash', assetId: 'ast-fund' };
    const txns = [...base, buy];
    const { patch, delta } = reconcileAssetValue(FUND, computeAssetValue(FUND, txns, R), 620);
    expect(delta).toBe(120);
    expect(patch.valuationOffset).toBe(120);
    expect(patch.valuationLog?.[0]).toMatchObject({ delta: 120, kind: 'investment', stated_value: 620 });
    const updated = { ...FUND, ...patch };
    expect(updated.value).toBe(0);                                  // the opening value never moves
    expect(computeAssetValue(updated, txns, R)).toBe(620);
    expect(monthlyData(txns, MK, 'USD', R).expense).toBe(800);
    expect(reconcileAssetValue(updated, 620, 620).patch.valuationLog).toHaveLength(1);   // no-op appends nothing
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

describe('§7 INV-7b — Net Worth asset side reads live account balances, de-duped against linked legacy assets', () => {
  it('INV-7b · a linked account replaces its asset (no double-count) and folds live transactions', () => {
    // `bank1` was Phase-1-backfilled from `asset1` (assetId links them) — its
    // live balance must be used INSTEAD of asset1's frozen static value.
    const bank1: Account = { id: 'acc-1', kind: 'bank', name: 'Chase', currency: 'USD', assetId: 'asset-1', openingBalance: 1000 };
    // `inv1` is a fresh investment account created directly (no backing asset
    // at all — the old auto-create-a-shadow-asset path is gone).
    const inv1: Account = { id: 'acc-2', kind: 'investment', name: 'Brokerage', currency: 'USD', openingBalance: 5000 };
    const assets: Asset[] = [
      { id: 'asset-1', type: 'checking', name: 'Chase (legacy)', value: 999999, currency: 'USD', liquidity: 'liquid' },
      // A genuine illiquid asset with no first-class account — keeps
      // contributing its own stated value.
      { id: 'asset-2', type: 'real_estate', name: 'House', value: 300000, currency: 'USD', liquidity: 'long' },
    ];
    const txns: Transaction[] = [
      { id: 'x1', type: 'income', amount: 200, currency: 'USD', date: d('05'), description: '', category: 'salary', toAccountId: 'acc-1' },
    ];
    const rows = liveAssetRows(assets, [bank1, inv1], txns, 'USD', R);

    // asset-1 must NOT appear — acc-1 (its linked account) represents it instead.
    expect(rows.find(r => r.id === 'asset-1')).toBeUndefined();
    const bankRow = rows.find(r => r.id === 'acc-1')!;
    expect(bankRow.source).toBe('account');
    expect(bankRow.value).toBe(1000 + 200); // opening + the live credit, NOT the frozen 999999

    const invRow = rows.find(r => r.id === 'acc-2')!;
    expect(invRow.source).toBe('account');
    expect(invRow.value).toBe(5000);
    expect(invRow.liquidity).toBe('short');

    const houseRow = rows.find(r => r.id === 'asset-2')!;
    expect(houseRow.source).toBe('asset');
    expect(houseRow.value).toBe(300000);

    expect(liveTotalAssets(rows)).toBe(1200 + 5000 + 300000);
  });

  it('INV-7c · an investment asset contributes its LIVE folded value; every other asset its stated value', () => {
    const fund: Asset = { id: 'ast-f', type: 'investment', name: 'Delhi', value: 0, currency: 'INR', liquidity: 'short', valuationOffset: 46870 };
    const house: Asset = { id: 'ast-h', type: 'real_estate', name: 'Plot', value: 3600000, currency: 'INR', liquidity: 'long' };
    const txns: Transaction[] = [
      { id: 'b1', type: 'investment', amount: 1200, currency: 'INR', date: d('01'), description: '', category: '', accountId: 'acc-cash', assetId: 'ast-f' },
      { id: 'b2', type: 'investment', amount: 1200, currency: 'INR', date: d('02'), description: '', category: '', accountId: 'acc-cash', assetId: 'ast-f' },
      { id: 'b3', type: 'investment', amount: 10, currency: 'INR', date: d('03'), description: '', category: '', accountId: 'acc-cash', assetId: 'ast-f' },
      { id: 'w1', type: 'investment', amount: 500, currency: 'INR', date: d('04'), description: '', category: '', toAccountId: 'acc-cash', assetId: 'ast-f' },
    ];
    const INR: ExchangeRates = { USD: 1, INR: 1 };
    const rows = liveAssetRows([fund, house], [], txns, 'INR', INR);
    expect(rows.find(r => r.id === 'ast-f')!.value).toBe(48780);   // the production figure, preserved
    expect(rows.find(r => r.id === 'ast-h')!.value).toBe(3600000);
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
