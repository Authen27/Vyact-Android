import { describe, it, expect } from 'vitest';
import type { Account, Asset, Debt, Transaction, ExchangeRates } from '../../types';
import { computeNetWorth } from '../netWorth';
import { buildSafeSummary } from '../aiSummary';

// CON-UNIT-119..122 — the canonical net-worth projection (audit F3).
//
// THE BUG THESE PIN: Dashboard, NetWorth.tsx and Ask Vyact each computed net
// worth differently. A newly created bank/investment ACCOUNT moved the Net
// Worth page but not the Dashboard or the assistant; a standalone credit-card
// or loan ACCOUNT contributed to no liability figure anywhere. There is now
// ONE projection, and every surface reads it.

const R: ExchangeRates = { USD: 1, GBP: 0.8, INR: 83 };

const ACCOUNTS: Account[] = [
  { id: 'cash', kind: 'cash', name: 'Cash', currency: 'USD', openingBalance: 500 },
  { id: 'bank', kind: 'bank', name: 'Bank', currency: 'USD', openingBalance: 2000 },
  { id: 'inv',  kind: 'investment', name: 'SIP', currency: 'USD', openingBalance: 5000 },
  // A standalone credit-card ACCOUNT — no Debt row. Owes 1200 (balance -1200).
  { id: 'cc',   kind: 'credit_card', name: 'Visa', currency: 'USD', openingBalance: -1200 },
  // A standalone loan ACCOUNT, explicitly linked to the debt below (debtId).
  { id: 'loan', kind: 'loan', name: 'Car', currency: 'USD', openingBalance: -8000, debtId: 'd-car' },
  // Archived: excluded.
  { id: 'old',  kind: 'bank', name: 'Old', currency: 'USD', openingBalance: 999, isArchived: true },
];

const DEBTS: Debt[] = [
  // Linked to the 'loan' account — counted ONCE (account side), not twice.
  { id: 'd-car', type: 'loan', name: 'Car', principal: 10000, currentBalance: 8000, interestRate: 7, minimumPayment: 300, currency: 'USD', direction: 'owed_by_me' },
  // A debt NO account represents — still a liability.
  { id: 'd-personal', type: 'personal', name: 'Family', principal: 0, currentBalance: 2500, interestRate: 0, minimumPayment: 100, currency: 'USD', direction: 'owed_by_me' },
  // A receivable — never a liability (v10.17).
  { id: 'd-recv', type: 'personal', name: 'Lent', principal: 0, currentBalance: 700, interestRate: 0, minimumPayment: 0, currency: 'USD', direction: 'owed_to_me' },
];

const ASSETS: Asset[] = [
  // A legacy asset no account wraps (real estate) — still an asset.
  { id: 'house', type: 'real_estate', name: 'House', value: 300000, currency: 'USD', liquidity: 'long' },
];

const TXNS: Transaction[] = [
  // A 400 expense out of the bank account this month.
  { id: 't1', type: 'expense', amount: 400, currency: 'USD', date: '2026-09-01', description: 'x', category: 'food', accountId: 'bank' },
];

function projection() {
  return computeNetWorth({ assets: ASSETS, accounts: ACCOUNTS, debts: DEBTS, transactions: TXNS }, 'USD', R);
}

describe('computeNetWorth — the one projection (audit F3)', () => {
  it('CON-UNIT-119 · asset side retains archived accounts and unlinked legacy assets', () => {
    const p = projection();
    // accounts: cash 500 + bank (2000 − 400) + investment 5000 = 7100; + house 300000
    expect(p.totalAssets).toBe(308099);
    expect(p.assetRows.some(r => r.id === 'old')).toBe(true);
    expect(p.assetRows.some(r => r.id === 'house' && r.source === 'asset')).toBe(true);
  });

  it('CON-UNIT-120 · liability side = live credit_card/loan account balances + unlinked debts, receivables excluded, linked debt counted once', () => {
    const p = projection();
    // cc 1200 + loan 8000 (account) + personal 2500 (debt) = 11700
    // d-car is NOT double-counted (the loan account represents it); the
    // receivable d-recv (700) is excluded.
    expect(p.totalLiabilities).toBe(11700);
    expect(p.liabilityRows.filter(r => r.debt?.id === 'd-car' || r.account?.id === 'loan')).toHaveLength(1);
    expect(p.liabilityRows.some(r => r.debt?.id === 'd-recv')).toBe(false);
    expect(p.netWorth).toBe(308099 - 11700);
  });
    it('CON-UNIT-908 - a positive card balance is owned credit, not debt', () => {
      const state = { assets: [], debts: [], transactions: [], accounts: [
        { id: 'credit', kind: 'credit_card' as const, name: 'Credit', currency: 'USD', openingBalance: 150 },
      ] };
      const projected = computeNetWorth(state, 'USD', R);
      expect(projected.totalAssets).toBe(150);
      expect(projected.totalLiabilities).toBe(0);
      expect(projected.netWorth).toBe(150);
    });
    it('CON-UNIT-909 - archiving retains value and opening balances are valued in account currency', () => {
      const state = { assets: [], debts: [], transactions: [], accounts: [
        { id: 'foreign', kind: 'bank' as const, name: 'Foreign', currency: 'GBP', openingBalance: 800, isArchived: true },
      ] };
      expect(computeNetWorth(state, 'USD', R).netWorth).toBe(1000);
    });

  it('CON-UNIT-121 · a NEW account with no asset/debt row moves the projection (the audit\'s divergence case)', () => {
    const before = projection();
    const withNew = computeNetWorth({
      assets: ASSETS,
      accounts: [...ACCOUNTS, { id: 'new', kind: 'bank', name: 'New', currency: 'USD', openingBalance: 1000 }],
      debts: DEBTS, transactions: TXNS,
    }, 'USD', R);
    expect(withNew.totalAssets).toBe(before.totalAssets + 1000);
    expect(withNew.netWorth).toBe(before.netWorth + 1000);
  });

  it('CON-UNIT-122 · Ask Vyact\'s SafeSummary reads the SAME projection (no drift)', () => {
    const summary = buildSafeSummary(
      TXNS, [], [], DEBTS, ASSETS,
      { baseCurrency: 'USD', household: 'family', language: 'en' } as never,
      R, ACCOUNTS, [],
    );
    const p = projection();
    expect(summary.netWorth.totalAssets).toBe(p.totalAssets);
    expect(summary.netWorth.totalLiabilities).toBe(p.totalLiabilities);
    expect(summary.netWorth.netWorth).toBe(p.netWorth);
  });
});
