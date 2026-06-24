import { describe, it, expect } from 'vitest';
import {
  computeAccountBalance, reconcileAccount, accountValueOf,
} from '../accountBalance';
import { copyBudgets, suggestBudget, budgetHistory, budgetRollup } from '../budgetIntel';
import { monthlyData } from '../calculations';
import type {
  Transaction, Budget, Debt, Goal, Asset, Account, RecurringSchedule, ExchangeRates,
} from '../../types';

// CON-UNIT-MM-100..0xx — Money-Model engine tests, v9 txn-redesign semantics
// (INV-1..INV-3b pins). Pure functions; every figure folds over real data.

const R: ExchangeRates = { USD: 1 };
const MK = new Date().toISOString().slice(0, 7);
const d = (day: string) => `${MK}-${day}`;

const CASH: Account = { id: 'acc-cash', kind: 'cash', name: 'Cash', currency: 'USD', openingBalance: 500 };
const BANK: Account = { id: 'acc-bank', kind: 'bank', name: 'Bank', currency: 'USD', assetId: 'bank1', openingBalance: 0 };
const INVEST: Account = { id: 'acc-inv', kind: 'investment', name: 'SIP', currency: 'USD', openingBalance: 0 };

// ── Epic 1 / v9: account balances + reconciliation (R-AGG-4 / §2.6) ─────────────
describe('accountBalance — R-AGG-4 + D2 offset', () => {
  const txns: Transaction[] = [
    // v9 matrix: income credits to_account; expense debits account;
    // transfer/investment touch both legs; transfer-class carries no category.
    { id: '1', type: 'income',  amount: 1000, currency: 'USD', date: d('01'), description: '', category: 'salary', toAccountId: 'acc-cash' },
    { id: '2', type: 'expense', amount: 200,  currency: 'USD', date: d('02'), description: '', category: 'food_dining', accountId: 'acc-cash' },
    { id: '3', type: 'transfer',   amount: 300, currency: 'USD', date: d('03'), description: '', category: '', accountId: 'acc-cash', toAccountId: 'asset:bank1' },
    { id: '4', type: 'investment', amount: 150, currency: 'USD', date: d('04'), description: '', category: '', accountId: 'acc-cash', toAccountId: 'acc-inv' },
  ];

  it('CON-UNIT-MM-100 · balance = opening + credits − debits + offset (all types)', () => {
    // cash: 500 + 1000 − 200 − 300 − 150 = 850
    expect(computeAccountBalance(CASH, txns, 'USD', R)).toBe(850);
    // bank (matched via legacy encoded value): 0 + 300 transfer-in = 300
    expect(computeAccountBalance(BANK, txns, 'USD', R)).toBe(300);
    // investment: 0 + 150 contribution-in = 150 (INV-2: net-worth-neutral move)
    expect(computeAccountBalance(INVEST, txns, 'USD', R)).toBe(150);
    // offset feeds the balance (D2)
    expect(computeAccountBalance({ ...CASH, reconciliationOffset: 42 }, txns, 'USD', R)).toBe(892);
  });

  it('CON-UNIT-MM-101 · accountValueOf encodes kinds to the legacy paymentMethod scheme', () => {
    expect(accountValueOf({ id: 'a', kind: 'cash', name: 'Cash', currency: 'USD' } as Account)).toBe('cash');
    expect(accountValueOf({ id: 'a', kind: 'bank', name: 'C', currency: 'USD', assetId: 'x' } as Account)).toBe('asset:x');
    expect(accountValueOf({ id: 'a', kind: 'credit_card', name: 'V', currency: 'USD', assetId: 'd1' } as Account)).toBe('debt:d1');
  });

  it('CON-UNIT-MM-102 · INV-3b: reconcile = offset + quiet log, NO transaction', () => {
    // computed 850, user states 950 → offset +100, dated log entry, no txn row.
    const up = reconcileAccount(CASH, 850, 950, 'bank');
    expect(up.delta).toBe(100);
    expect(up.patch.reconciliationOffset).toBe(100);
    expect(up.patch.reconciliationLog).toHaveLength(1);
    expect(up.patch.reconciliationLog?.[0]).toMatchObject({ delta: 100, kind: 'bank', stated_value: 950 });
    expect('adjustment' in up).toBe(false);                  // nothing transaction-shaped
    // stated lower → negative offset; already reconciled → no log entry
    expect(reconcileAccount(CASH, 850, 800, 'bank').delta).toBe(-50);
    expect(reconcileAccount(CASH, 850, 850, 'bank').patch.reconciliationLog).toHaveLength(0);
  });

  it('CON-UNIT-MM-103 · INV-3: value update moves balance, never spend/income', () => {
    // investment value update: stated 200 vs computed 150 → offset +50
    const { patch, delta } = reconcileAccount(INVEST, 150, 200, 'investment');
    expect(delta).toBe(50);
    expect(patch.reconciliationLog?.[0].kind).toBe('investment');
    // the offset lives OUTSIDE the transaction stream — spend/income cannot change
    const before = monthlyData(txns, MK, 'USD', R);
    expect(before.income).toBe(1000);
    expect(before.expense).toBe(200);   // transfer + investment excluded (INV-1/INV-2)
    // balance reflects the user-stated value exactly
    expect(computeAccountBalance({ ...INVEST, ...patch }, txns, 'USD', R)).toBe(200);
  });
});

// ── Epic 2: budget intelligence ─────────────────────────────────────────────────
describe('budgetIntel — read-only inference (A8)', () => {
  it('CON-UNIT-MM-110 · copyBudgets clones category + limit without ids', () => {
    const out = copyBudgets([{ id: 'b1', category: 'food', limit: 400, currency: 'USD' }]);
    expect(out).toEqual([{ category: 'food', limit: 400, currency: 'USD', period: 'monthly' }]);
    expect((out[0] as { id?: string }).id).toBeUndefined();
  });

  it('CON-UNIT-MM-111 · suggestBudget proposes from recurring + debts + goals, traceably', () => {
    const recurring: RecurringSchedule[] = [
      { id: 'r1', frequency: 'monthly', startDate: d('01'), nextDueDate: d('01'),
        transactionTemplate: { type: 'expense', amount: 1200, currency: 'USD', description: '', category: 'rent' } as Omit<Transaction,'id'|'date'> },
    ];
    const debts: Debt[] = [{ id: 'd1', type: 'loan', name: 'L', principal: 0, currentBalance: 5000, interestRate: 8, minimumPayment: 250, currency: 'USD' }];
    const goals: Goal[] = [{ id: 'g1', type: 'savings', name: 'Trip', target: 1200, current: 0, currency: 'USD', completed: false }];
    const s = suggestBudget({ transactions: [], debts, goals, recurring, baseCurrency: 'USD', rates: R });
    expect(s.find(x => x.category === 'rent')).toMatchObject({ limit: 1200, basis: 'recurring' });
    expect(s.find(x => x.category === 'loan_emi')).toMatchObject({ limit: 250, basis: 'debt' });
    expect(s.find(x => x.category === 'savings')?.basis).toBe('goal');
  });

  it('CON-UNIT-MM-112 · budgetRollup nests category budgets under monthly/annual totals', () => {
    // a monthly 400 + an annual 1200 (→ 100/mo) roll up to 500/mo, 6000/yr.
    const r = budgetRollup([
      { category: 'food', limitBase: 400, period: 'monthly' },
      { category: 'insurance', limitBase: 1200, period: 'annual' },
    ]);
    expect(r.monthlyTotal).toBe(500);
    expect(r.annualTotal).toBe(6000);
    expect(r.children.find(c => c.category === 'insurance')?.monthly).toBe(100);
  });

  it('CON-UNIT-MM-113 · budgetHistory reports budget vs actual per month', () => {
    const txns: Transaction[] = [
      { id: '1', type: 'expense', amount: 350, currency: 'USD', date: d('05'), description: '', category: 'food' },
    ];
    const hist = budgetHistory(txns, [{ id: 'b', category: 'food', limit: 400, currency: 'USD' }], 'USD', R, 6);
    const cur = hist.find(h => h.monthKey === MK)!;
    expect(cur.budgeted).toBe(400);
    expect(cur.actual).toBe(350);
    expect(cur.variance).toBe(50);   // saved 50
  });
});

// (Epic 3 goals/tax-as-lenses tests removed — goals & tax are no longer modules.)

// ── R7 — provenance lifecycle: estimated → confirmed ────────────────────────────
describe('provenance lifecycle (R7/C4.4)', () => {
  it('CON-UNIT-MM-130 · an estimate is flagged until confirmed; reconcile confirms it', async () => {
    const { isEstimate, confirmedPctFromEntities, onboardingProvenance } = await import('../onboardingState');
    const est = onboardingProvenance();                 // estimated / onboarding
    expect(isEstimate(est)).toBe(true);
    expect(confirmedPctFromEntities([est])).toBe(0);
    // reconciliation marks the value confirmed (what the store does post-reconcile)
    const confirmed = { confidence: 'confirmed' as const, source: 'user' as const, confirmedAt: new Date().toISOString() };
    expect(isEstimate(confirmed)).toBe(false);
    expect(confirmedPctFromEntities([confirmed])).toBe(100);
    // v9 (INV-3b): reconcile produces an account offset + dated quiet-log entry,
    // never a transaction — the stated value is itself the user's confirmation.
    const { patch, delta } = reconcileAccount(CASH, 1000, 1200, 'bank');
    expect(delta).toBe(200);
    expect(patch.reconciliationLog?.[0]).toMatchObject({ delta: 200, stated_value: 1200 });
  });
});
