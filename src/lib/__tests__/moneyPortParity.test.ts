// Vyact Agent P1 — PARITY GATE for the server-side money tools.
//
// There are now TWO implementations of Vyact's money aggregates:
//   • the client original      — `react/src/lib/{calculations,accountBalance}.ts`
//   • the Deno/edge port       — `supabase/functions/_shared/money/calculations.ts`
//
// The port exists because WhatsApp has no browser: a server-hosted agent cannot
// call client TypeScript. Dual implementations DRIFT — that is the known cost of
// this approach, and this file is the only defence. It imports BOTH sides, runs
// them over shared golden fixtures, and asserts IDENTICAL results.
//
// RULES (architecture §7 layer 2, "Parity gate"):
//   1. If the two disagree, THE ORIGINAL WINS and the port is wrong. Production
//      has been computing the original's answer. Never relax an assertion here
//      to make a mismatch pass — fix the port, or report the mismatch.
//   2. Never edit the client originals to satisfy the port.
//   3. Money-model truth itself is pinned separately by
//      `moneyModel.invariants.test.ts` (INV-1..9). This file only proves the two
//      implementations agree; that file proves the answer is right.
//
// Fixture coverage is deliberately the set of shapes that actually break
// aggregates: empty sets, a single transaction, transfers, investments,
// `loan_emi`, splits, multi-currency (incl. JPY's 0-decimal exponent),
// negative/zero amounts, excluded rows, `balance_adjustment`, both transfer
// encodings (v7.0.3 paired + v7.2 single-row), and month/year boundaries.

import { describe, it, expect } from 'vitest';

// ── client originals (authoritative) ────────────────────────────────────────
import * as clientCalc from '../calculations';
import * as clientAcct from '../accountBalance';
import { convert as clientConvert } from '../format';
import { toDinero as clientToDinero, fromDinero as clientFromDinero, convertViaUsdRates as clientConvertViaUsd } from '../money';

// ── Deno/edge port (under test) ─────────────────────────────────────────────
import * as port from '../../../../supabase/functions/_shared/money/calculations';

import type { Transaction, Account, Asset, Debt, Budget, BudgetAllocation, ExchangeRates } from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN FIXTURES — shared by both implementations. Fixed dates (never `now`)
// so a failure is always a code change, never a calendar change.
// ─────────────────────────────────────────────────────────────────────────────

const RATES: ExchangeRates = { USD: 1, EUR: 0.92, GBP: 0.79, INR: 83.12, JPY: 151.4, AED: 3.67 };
const RATES_FLAT: ExchangeRates = { USD: 1 };
/** An unknown code exercises the "falls back to USD, rate defaults to 1" path. */
const RATES_SPARSE: ExchangeRates = { USD: 1, INR: 83.12 };

const BASES = ['USD', 'INR', 'EUR', 'JPY'] as const;   // JPY = exponent 0
const MK = '2026-03';

const EMPTY: Transaction[] = [];

const SINGLE: Transaction[] = [
  { id: 's1', type: 'expense', amount: 12.34, currency: 'USD', date: '2026-03-15', description: 'one', category: 'food_dining', accountId: 'acc-cash' },
];

/** The everything fixture. Every row here exists to break a specific aggregate. */
const FULL: Transaction[] = [
  // plain income / expense
  { id: 'f-inc', type: 'income', amount: 5000, currency: 'USD', date: '2026-03-01', description: 'salary', category: 'salary', toAccountId: 'acc-bank' },
  { id: 'f-exp', type: 'expense', amount: 800.55, currency: 'USD', date: '2026-03-02', description: 'groceries', category: 'groceries', accountId: 'acc-cash' },
  // float-drift bait: three dimes must sum to exactly 0.30, not 0.30000000000000004
  { id: 'f-d1', type: 'expense', amount: 0.10, currency: 'USD', date: '2026-03-03', description: 'dime', category: 'other_expense', accountId: 'acc-cash' },
  { id: 'f-d2', type: 'expense', amount: 0.10, currency: 'USD', date: '2026-03-03', description: 'dime', category: 'other_expense', accountId: 'acc-cash' },
  { id: 'f-d3', type: 'expense', amount: 0.10, currency: 'USD', date: '2026-03-03', description: 'dime', category: 'other_expense', accountId: 'acc-cash' },
  // MONEY MODEL — v7.2 single-row transfer: spend/income neutral, moves 2 accounts
  { id: 'f-xfer', type: 'transfer', amount: 1200, currency: 'USD', date: '2026-03-04', description: 'to savings', category: '', accountId: 'acc-cash', toAccountId: 'acc-bank' },
  // MONEY MODEL — v7.0.3 paired transfer encoding (type income/expense, category 'transfer')
  { id: 'f-xfer-a', type: 'expense', amount: 300, currency: 'USD', date: '2026-03-04', description: 'legacy leg out', category: 'transfer', accountId: 'acc-cash' },
  { id: 'f-xfer-b', type: 'income', amount: 300, currency: 'USD', date: '2026-03-04', description: 'legacy leg in', category: 'transfer', toAccountId: 'acc-bank' },
  // MONEY MODEL — investment contribution: spend/income neutral
  { id: 'f-inv', type: 'investment', amount: 500, currency: 'USD', date: '2026-03-05', description: 'index fund', category: '', accountId: 'acc-bank', toAccountId: 'acc-inv' },
  // MONEY MODEL — loan_emi SYSTEM_SPLIT: only the interest leg is spend
  { id: 'f-emi-int', type: 'expense', amount: 100, currency: 'USD', date: '2026-03-06', description: 'car loan interest', category: 'loan_emi', accountId: 'acc-bank' },
  { id: 'f-emi-prn', type: 'transfer', amount: 400, currency: 'USD', date: '2026-03-06', description: 'car loan principal', category: '', accountId: 'acc-bank', toAccountId: 'acc-loan' },
  // MONEY MODEL — reconciliation must never be spend (balance_adjustment is dropped)
  { id: 'f-adj', type: 'expense', amount: 42, currency: 'USD', date: '2026-03-07', description: 'drift', category: 'balance_adjustment', accountId: 'acc-cash' },
  // excluded from reports, but money still moved (balance must still change)
  { id: 'f-excl', type: 'expense', amount: 75, currency: 'USD', date: '2026-03-08', description: 'private', category: 'shopping', accountId: 'acc-cash', excluded: true },
  // multi-currency
  { id: 'f-inr', type: 'expense', amount: 2499.5, currency: 'INR', date: '2026-03-09', description: 'chai', category: 'food_dining', accountId: 'acc-cash' },
  { id: 'f-eur', type: 'income', amount: 1234.56, currency: 'EUR', date: '2026-03-10', description: 'eu invoice', category: 'freelance', toAccountId: 'acc-bank' },
  { id: 'f-jpy', type: 'expense', amount: 3300, currency: 'JPY', date: '2026-03-10', description: 'ramen', category: 'food_dining', accountId: 'acc-cash' },
  // currency the sparse rate table doesn't know (falls back to rate 1)
  { id: 'f-aed', type: 'expense', amount: 99.99, currency: 'AED', date: '2026-03-11', description: 'souk', category: 'shopping', accountId: 'acc-cash' },
  // zero and negative amounts (refunds are entered as negatives in the wild)
  { id: 'f-zero', type: 'expense', amount: 0, currency: 'USD', date: '2026-03-12', description: 'zero', category: 'other_expense', accountId: 'acc-cash' },
  { id: 'f-neg', type: 'expense', amount: -49.99, currency: 'USD', date: '2026-03-12', description: 'refund', category: 'shopping', accountId: 'acc-cash' },
  { id: 'f-neg-inc', type: 'income', amount: -10, currency: 'USD', date: '2026-03-12', description: 'clawback', category: 'other_income', toAccountId: 'acc-bank' },
  // splits — only `yourShare` counts toward spend
  {
    id: 'f-split-exp', type: 'expense', amount: 900, currency: 'USD', date: '2026-03-13', description: 'dinner', category: 'food_dining', accountId: 'acc-cash',
    split: { isSplit: true, totalAmount: 900, yourShare: 300, paidBy: 'me', participants: [
      { name: 'me', isYou: true, share: 300, paid: true },
      { name: 'Ana', share: 300, paid: false, email: 'ana@example.com' },
      { name: 'Bo', share: 300, paid: false },
    ] },
  },
  {
    id: 'f-split-inc', type: 'income', amount: 600, currency: 'EUR', date: '2026-03-13', description: 'shared refund', category: 'other_income', toAccountId: 'acc-bank',
    split: { isSplit: true, totalAmount: 600, yourShare: 200, paidBy: 'external', participants: [
      { name: 'me', isYou: true, share: 200, paid: false },
      { name: 'Cy', share: 400, paid: false },
    ] },
  },
  // legacy paymentMethod encoding (pre-v9 rows still in local caches)
  { id: 'f-legacy', type: 'expense', amount: 60, currency: 'USD', date: '2026-03-14', description: 'legacy row', category: 'travel', paymentMethod: 'cash' },
  { id: 'f-legacy-asset', type: 'income', amount: 250, currency: 'USD', date: '2026-03-14', description: 'legacy credit', category: 'other_income', paymentMethod: 'asset:asset-9' },
  // MONTH / YEAR BOUNDARIES — must land in the right bucket, never leak
  { id: 'b-feb-last', type: 'expense', amount: 11, currency: 'USD', date: '2026-02-28', description: 'feb last', category: 'food_dining', accountId: 'acc-cash' },
  { id: 'b-mar-first', type: 'expense', amount: 22, currency: 'USD', date: '2026-03-01', description: 'mar first', category: 'food_dining', accountId: 'acc-cash' },
  { id: 'b-mar-last', type: 'expense', amount: 33, currency: 'USD', date: '2026-03-31', description: 'mar last', category: 'food_dining', accountId: 'acc-cash' },
  { id: 'b-apr-first', type: 'expense', amount: 44, currency: 'USD', date: '2026-04-01', description: 'apr first', category: 'food_dining', accountId: 'acc-cash' },
  { id: 'b-dec-last', type: 'expense', amount: 55, currency: 'USD', date: '2025-12-31', description: 'dec last', category: 'food_dining', accountId: 'acc-cash' },
  { id: 'b-jan-first', type: 'expense', amount: 66, currency: 'USD', date: '2026-01-01', description: 'jan first', category: 'food_dining', accountId: 'acc-cash' },
];

const TXN_SETS: Array<[string, Transaction[]]> = [
  ['empty', EMPTY],
  ['single', SINGLE],
  ['full', FULL],
];

const RATE_SETS: Array<[string, ExchangeRates]> = [
  ['flat', RATES_FLAT],
  ['full', RATES],
  ['sparse', RATES_SPARSE],
];

const ACCOUNTS: Account[] = [
  { id: 'acc-cash', kind: 'cash', name: 'Cash', currency: 'USD', openingBalance: 1000 },
  { id: 'acc-bank', kind: 'bank', name: 'Bank', currency: 'USD', openingBalance: 250.75, assetId: 'asset-9' },
  { id: 'acc-inv', kind: 'investment', name: 'Brokerage', currency: 'USD', openingBalance: 0, reconciliationOffset: 120.5 },
  { id: 'acc-loan', kind: 'loan', name: 'Car Loan', currency: 'USD', openingBalance: -8000 },
  { id: 'acc-cc', kind: 'credit_card', name: 'Visa', currency: 'USD', openingBalance: 0, assetId: 'asset-cc' },
  { id: 'acc-old', kind: 'bank', name: 'Archived', currency: 'USD', openingBalance: 999, isArchived: true },
  { id: 'acc-zero', kind: 'bank', name: 'No opening', currency: 'USD' },   // undefined openingBalance
];

const ASSETS: Asset[] = [
  { id: 'asset-9', type: 'checking', name: 'Bank (legacy)', value: 999999, currency: 'USD', liquidity: 'liquid' },
  { id: 'asset-cc', type: 'other', name: 'CC backing', value: 0, currency: 'USD', liquidity: 'liquid' },
  { id: 'asset-house', type: 'real_estate', name: 'House', value: 300000, currency: 'USD', liquidity: 'long' },
  // v10.26.0 (R4) — the offset exercises computeAssetValue in every liveAssetRows case.
  { id: 'asset-inr', type: 'investment', name: 'PPF', value: 1234567.89, currency: 'INR', liquidity: 'long', valuationOffset: -4321.09 },
  { id: 'asset-jpy', type: 'cash', name: 'Yen jar', value: 45000, currency: 'JPY', liquidity: 'liquid' },
  { id: 'asset-neg', type: 'other', name: 'Underwater', value: -500, currency: 'USD', liquidity: 'short' },
];

const DEBTS: Debt[] = [
  { id: 'd-cc', type: 'credit_card', name: 'Visa', principal: 0, currentBalance: 1500.25, interestRate: 18, minimumPayment: 50, currency: 'USD' },
  { id: 'd-car', type: 'loan', name: 'Car', principal: 20000, currentBalance: 8000, interestRate: 7, minimumPayment: 300, currency: 'USD' },
  { id: 'd-inr', type: 'personal', name: 'Family loan', principal: 0, currentBalance: 250000, interestRate: 0, minimumPayment: 5000, currency: 'INR' },
  // receivable — must NOT count as a liability
  { id: 'd-recv', type: 'personal', name: 'Lent to Sam', principal: 0, currentBalance: 500, interestRate: 0, minimumPayment: 0, currency: 'USD', direction: 'owed_to_me' },
  { id: 'd-zero', type: 'loan', name: 'Paid off', principal: 0, currentBalance: 0, interestRate: 0, minimumPayment: 0, currency: 'USD', direction: 'owed_by_me' },
];

const BUDGETS: Budget[] = [
  { id: 'b-legacy', category: 'food_dining', limit: 500, currency: 'USD', period: 'monthly' },
  { id: 'b-container', limit: 2000, currency: 'USD', scope: 'month', periodYear: 2026, periodMonth: 3, period: 'monthly', periodStart: '2026-03-01', periodEnd: '2026-03-31' },
  { id: 'b-orphan', limit: 100, currency: 'EUR', period: 'annual' },   // no category, no allocations → emits nothing
];

const ALLOCATIONS: BudgetAllocation[] = [
  { id: 'al-1', budgetId: 'b-container', category: 'groceries', amount: 400 },
  { id: 'al-2', budgetId: 'b-container', category: 'travel', amount: 150.5 },
];

const SCHEDULES = [
  { transactionTemplate: { type: 'expense', amount: 1200, currency: 'USD', category: 'rent_mortgage' }, frequency: 'monthly' },
  { transactionTemplate: { type: 'expense', amount: 30, currency: 'EUR', category: 'entertainment' }, frequency: 'weekly' },
  { transactionTemplate: { type: 'expense', amount: 900, currency: 'INR', category: 'insurance' }, frequency: 'yearly' },
  { transactionTemplate: { type: 'income', amount: 5000, currency: 'USD', category: 'salary' }, frequency: 'monthly' },   // skipped
  { transactionTemplate: { type: 'expense', amount: 0, currency: 'USD', category: 'other_expense' }, frequency: 'monthly' }, // skipped (falsy amount)
  { transactionTemplate: { type: 'transfer', amount: 100, currency: 'USD' }, frequency: 'monthly' },                       // skipped
];

const MONTH_KEYS = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-11'];

// ─────────────────────────────────────────────────────────────────────────────
// 0. ANTI-DRIFT ROSTER — the guard that fires when someone adds a client
//    aggregate and forgets the port. Every runtime export of the two client
//    modules must be classified: ported (and therefore parity-tested below) or
//    deliberately not ported. A new export fails here until someone decides.
// ─────────────────────────────────────────────────────────────────────────────

const PORTED = [
  'txnAmountInBase', 'effectiveAmount', 'reportableTxns', 'monthlyData', 'totalBalance',
  'spendByCategory', 'spendByCategoryInRange', 'cumulativeSpendSeries',
  'budgetLines', 'resolveBudgetPeriod', 'budgetWindow', 'periodMonths', 'recurringForecastByCategory',
  'totalAssets', 'totalLiabilities', 'totalReceivables', 'liquidAssets', 'totalMonthlyDebtPayment',
  'computeEmi', 'splitEmiPortions', 'splitsOutstanding',
  'accountValueOf', 'debitAccountOf', 'creditAccountOf', 'computeAccountBalance',
  'liveAssetRows', 'liveTotalAssets',
  // v10.26.0 (R4) — investment assets fold like accounts.
  'computeAssetValue',
];

const NOT_PORTED = [
  // presentation / scoring, not aggregates
  'computePulseScore', 'pulseStatus', 'getInsights',
  // a projection the source itself places outside the money model
  'simulatePayoffInterest',
  // Dashboard-only read model: a month-filtered view over `budgetLines` (which
  // IS ported and parity-tested). The server never renders a dashboard month;
  // if Ask Vyact ever needs it, port it and move it to PORTED.
  'budgetLinesForMonth',
  // WRITE path: mints a timestamp and returns a patch to persist. Server writes
  // go through the RPC — duplicating the reconciliation write rule here is
  // exactly how the money model would drift.
  'reconcileAccount',
  // v10.26.0 (R4) — the same rule for an investment asset's "Update value".
  'reconcileAssetValue',
];

describe('parity roster — no client aggregate escapes classification', () => {
  it('every client export is either ported or explicitly excluded', () => {
    const clientExports = [
      ...Object.keys(clientCalc),
      ...Object.keys(clientAcct),
    ].filter(k => typeof (clientCalc as Record<string, unknown>)[k] === 'function'
               || typeof (clientAcct as Record<string, unknown>)[k] === 'function');
    const classified = new Set([...PORTED, ...NOT_PORTED]);
    const unclassified = clientExports.filter(k => !classified.has(k));
    expect(unclassified).toEqual([]);
  });

  it('every function claimed as ported actually exists on both sides', () => {
    for (const name of PORTED) {
      const onClient = (clientCalc as Record<string, unknown>)[name] ?? (clientAcct as Record<string, unknown>)[name];
      expect(typeof onClient, `client.${name}`).toBe('function');
      expect(typeof (port as Record<string, unknown>)[name], `port.${name}`).toBe('function');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. MONEY PRIMITIVES — the dinero boundary the port reimplements from scratch.
//    If these drift, every aggregate below drifts with them.
// ─────────────────────────────────────────────────────────────────────────────

describe('parity — money primitives (dinero boundary)', () => {
  const AMOUNTS = [0, -0, 0.005, 0.01, 0.1, 1, 1.005, 12.34, 99.99, -49.99, 1234.56, 1_000_000.01, 2499.5, 3300, 45000];
  const CODES = ['USD', 'EUR', 'INR', 'JPY', 'AED', 'XXX'];   // XXX = unknown → USD fallback

  it('toDinero/fromDinero round-trip identically', () => {
    for (const code of CODES) {
      for (const a of AMOUNTS) {
        expect(port.fromDinero(port.toDinero(a, code)), `${a} ${code}`)
          .toBe(clientFromDinero(clientToDinero(a, code)));
      }
    }
  });

  it('convertViaUsdRates agrees for every currency pair and rate table', () => {
    for (const [rname, rates] of RATE_SETS) {
      for (const from of CODES) {
        for (const to of CODES) {
          for (const a of AMOUNTS) {
            const expected = clientFromDinero(clientConvertViaUsd(clientToDinero(a, from), to, rates));
            const actual = port.fromDinero(port.convertViaUsdRates(port.toDinero(a, from), to, rates));
            expect(actual, `${a} ${from}→${to} rates=${rname}`).toBe(expected);
          }
        }
      }
    }
  });

  it('convert() agrees with format.ts convert()', () => {
    for (const [, rates] of RATE_SETS) {
      for (const from of CODES) {
        for (const to of CODES) {
          for (const a of AMOUNTS) {
            expect(port.convert(a, from, to, rates), `${a} ${from}→${to}`)
              .toBe(clientConvert(a, from, to, rates));
          }
        }
      }
    }
  });

  it('integer folding is exact on both sides (0.10 × 3 === 0.30)', () => {
    const dimes = [0.1, 0.1, 0.1];
    const portSum = port.fromDinero(port.sumDinero(dimes, d => port.toDinero(d, 'USD'), 'USD'));
    expect(portSum).toBe(0.3);
    // and the client agrees, via the aggregate that actually uses it
    const only = FULL.filter(t => t.id.startsWith('f-d'));
    expect(port.spendByCategory(only, MK, 'USD', RATES_FLAT).other_expense)
      .toBe(clientCalc.spendByCategory(only, MK, 'USD', RATES_FLAT).other_expense);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. REPORTABILITY + CASH FLOW
// ─────────────────────────────────────────────────────────────────────────────

describe('parity — reportableTxns (the money-model filter)', () => {
  for (const [sname, txns] of TXN_SETS) {
    it(`${sname}: identical reportable set`, () => {
      const expected = clientCalc.reportableTxns(txns).map(t => t.id);
      expect(port.reportableTxns(txns).map(t => t.id)).toEqual(expected);
    });
  }

  it('full: transfers, investments, balance_adjustment and excluded are all dropped by BOTH', () => {
    const ids = new Set(port.reportableTxns(FULL).map(t => t.id));
    for (const dropped of ['f-xfer', 'f-xfer-a', 'f-xfer-b', 'f-inv', 'f-emi-prn', 'f-adj', 'f-excl']) {
      expect(ids.has(dropped), dropped).toBe(false);
    }
    // ...and the interest leg of the EMI IS spend.
    expect(ids.has('f-emi-int')).toBe(true);
  });
});

describe('parity — monthlyData / totalBalance (cash flow)', () => {
  for (const [sname, txns] of TXN_SETS) {
    for (const [rname, rates] of RATE_SETS) {
      for (const base of BASES) {
        it(`${sname} · ${rname} · ${base}: monthlyData across month & year boundaries`, () => {
          for (const mk of MONTH_KEYS) {
            expect(port.monthlyData(txns, mk, base, rates), `${mk}`)
              .toStrictEqual(clientCalc.monthlyData(txns, mk, base, rates));
          }
        });

        it(`${sname} · ${rname} · ${base}: totalBalance`, () => {
          expect(port.totalBalance(txns, base, rates)).toBe(clientCalc.totalBalance(txns, base, rates));
        });
      }
    }
  }
});

describe('parity — per-transaction amounts', () => {
  for (const [, rates] of RATE_SETS) {
    for (const base of BASES) {
      it(`${base}: txnAmountInBase + effectiveAmount (splits use yourShare)`, () => {
        for (const t of FULL) {
          expect(port.txnAmountInBase(t, base, rates), `${t.id} raw`)
            .toBe(clientCalc.txnAmountInBase(t, base, rates));
          expect(port.effectiveAmount(t, base, rates), `${t.id} effective`)
            .toBe(clientCalc.effectiveAmount(t, base, rates));
        }
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. SPEND BY CATEGORY / PERIOD
// ─────────────────────────────────────────────────────────────────────────────

describe('parity — spendByCategory / spendByCategoryInRange', () => {
  for (const [sname, txns] of TXN_SETS) {
    for (const [rname, rates] of RATE_SETS) {
      for (const base of BASES) {
        it(`${sname} · ${rname} · ${base}: by month key`, () => {
          for (const mk of MONTH_KEYS) {
            expect(port.spendByCategory(txns, mk, base, rates), mk)
              .toStrictEqual(clientCalc.spendByCategory(txns, mk, base, rates));
          }
        });

        it(`${sname} · ${rname} · ${base}: by explicit range (incl. inverted + single-day)`, () => {
          const ranges: Array<[string, string]> = [
            ['2026-03-01', '2026-03-31'],   // whole month
            ['2026-02-28', '2026-03-01'],   // straddles a month boundary
            ['2025-12-31', '2026-01-01'],   // straddles a year boundary
            ['2026-03-13', '2026-03-13'],   // single day
            ['2026-04-01', '2026-03-01'],   // inverted → empty
            ['2020-01-01', '2030-12-31'],   // everything
          ];
          for (const [s, e] of ranges) {
            expect(port.spendByCategoryInRange(txns, s, e, base, rates), `${s}..${e}`)
              .toStrictEqual(clientCalc.spendByCategoryInRange(txns, s, e, base, rates));
          }
        });
      }
    }
  }

  it('the last cumulative point equals the range total on BOTH sides', () => {
    const cats = new Set(['food_dining', 'groceries', 'other_expense']);
    const series = port.cumulativeSpendSeries(FULL, cats, '2026-03-01', '2026-03-31', 'USD', RATES);
    const clientSeries = clientCalc.cumulativeSpendSeries(FULL, cats, '2026-03-01', '2026-03-31', 'USD', RATES);
    expect(series).toStrictEqual(clientSeries);
    const inRange = clientCalc.spendByCategoryInRange(FULL, '2026-03-01', '2026-03-31', 'USD', RATES);
    const total = [...cats].reduce((s, c) => s + (inRange[c] || 0), 0);
    expect(series[series.length - 1].cumulative).toBeCloseTo(total, 10);
  });
});

describe('parity — cumulativeSpendSeries', () => {
  const CAT_SETS: Array<[string, Set<string>]> = [
    ['empty set', new Set<string>()],
    ['one category', new Set(['food_dining'])],
    ['several', new Set(['food_dining', 'groceries', 'shopping', 'other_expense'])],
  ];
  for (const [sname, txns] of TXN_SETS) {
    for (const [cname, cats] of CAT_SETS) {
      for (const base of BASES) {
        it(`${sname} · ${cname} · ${base}`, () => {
          const windows: Array<[string, string]> = [
            ['2026-03-01', '2026-03-31'],
            ['2026-02-26', '2026-03-03'],   // crosses a month boundary
            ['2025-12-29', '2026-01-02'],   // crosses a year boundary
            ['2026-03-31', '2026-03-01'],   // inverted → []
          ];
          for (const [s, u] of windows) {
            expect(port.cumulativeSpendSeries(txns, cats, s, u, base, RATES), `${s}..${u}`)
              .toStrictEqual(clientCalc.cumulativeSpendSeries(txns, cats, s, u, base, RATES));
          }
        });
      }
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. BUDGET WINDOWS / LINES
// ─────────────────────────────────────────────────────────────────────────────

describe('parity — budget period helpers', () => {
  it('budgetLines flattens containers + legacy budgets identically', () => {
    expect(port.budgetLines(BUDGETS, ALLOCATIONS)).toStrictEqual(clientCalc.budgetLines(BUDGETS, ALLOCATIONS));
    expect(port.budgetLines(BUDGETS, [])).toStrictEqual(clientCalc.budgetLines(BUDGETS, []));
    expect(port.budgetLines([], ALLOCATIONS)).toStrictEqual(clientCalc.budgetLines([], ALLOCATIONS));
  });

  it('resolveBudgetPeriod agrees (incl. leap February and December rollover)', () => {
    const cases: Array<['month' | 'annual', number, number]> = [
      ['month', 2026, 3], ['month', 2024, 2], ['month', 2026, 2], ['month', 2026, 12],
      ['month', 2026, 1], ['annual', 2026, 1], ['annual', 2025, 7],
    ];
    for (const [scope, y, m] of cases) {
      expect(port.resolveBudgetPeriod(scope, y, m), `${scope} ${y}-${m}`)
        .toStrictEqual(clientCalc.resolveBudgetPeriod(scope, y, m));
    }
  });

  it('budgetWindow agrees for every period at fixed anchor dates', () => {
    const anchors = [new Date('2026-03-15T12:00:00Z'), new Date('2026-01-01T12:00:00Z'), new Date('2026-07-04T12:00:00Z'), new Date('2026-12-31T12:00:00Z')];
    const periods: Array<Budget['period']> = ['monthly', 'quarterly', 'half_yearly', 'annual', 'custom', undefined];
    for (const anchor of anchors) {
      for (const period of periods) {
        const b = { period, periodStart: '2026-05-05', periodEnd: '2026-06-06' };
        expect(port.budgetWindow(b, anchor), `${period} @ ${anchor.toISOString()}`)
          .toStrictEqual(clientCalc.budgetWindow(b, anchor));
        // custom with no explicit range falls back to the current month
        const bare = { period };
        expect(port.budgetWindow(bare, anchor), `${period} bare @ ${anchor.toISOString()}`)
          .toStrictEqual(clientCalc.budgetWindow(bare, anchor));
      }
    }
  });

  it('periodMonths agrees', () => {
    for (const p of ['monthly', 'quarterly', 'half_yearly', 'annual', 'custom', undefined] as const) {
      expect(port.periodMonths(p), String(p)).toBe(clientCalc.periodMonths(p));
    }
  });

  it('recurringForecastByCategory agrees (income/transfer/zero rows skipped)', () => {
    for (const [, rates] of RATE_SETS) {
      for (const base of BASES) {
        for (const [s, e] of [['2026-03-01', '2026-03-31'], ['2026-01-01', '2026-12-31'], ['2026-03-05', '2026-03-05'], ['2026-03-31', '2026-03-01']]) {
          expect(port.recurringForecastByCategory(SCHEDULES, s, e, base, rates), `${base} ${s}..${e}`)
            .toStrictEqual(clientCalc.recurringForecastByCategory(SCHEDULES, s, e, base, rates));
        }
        expect(port.recurringForecastByCategory([], '2026-03-01', '2026-03-31', base, rates))
          .toStrictEqual(clientCalc.recurringForecastByCategory([], '2026-03-01', '2026-03-31', base, rates));
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. NET WORTH COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

describe('parity — balance sheet aggregates', () => {
  const ASSET_SETS: Array<[string, Asset[]]> = [['empty', []], ['one', [ASSETS[0]]], ['all', ASSETS]];
  const DEBT_SETS: Array<[string, Debt[]]> = [['empty', []], ['one', [DEBTS[0]]], ['all', DEBTS]];

  for (const [rname, rates] of RATE_SETS) {
    for (const base of BASES) {
      it(`${rname} · ${base}: totalAssets / liquidAssets`, () => {
        for (const [aname, assets] of ASSET_SETS) {
          expect(port.totalAssets(assets, base, rates), `${aname} assets`).toBe(clientCalc.totalAssets(assets, base, rates));
          expect(port.liquidAssets(assets, base, rates), `${aname} liquid`).toBe(clientCalc.liquidAssets(assets, base, rates));
        }
      });

      it(`${rname} · ${base}: totalLiabilities / totalReceivables / totalMonthlyDebtPayment`, () => {
        for (const [dname, debts] of DEBT_SETS) {
          expect(port.totalLiabilities(debts, base, rates), `${dname} liab`).toBe(clientCalc.totalLiabilities(debts, base, rates));
          expect(port.totalReceivables(debts, base, rates), `${dname} recv`).toBe(clientCalc.totalReceivables(debts, base, rates));
          expect(port.totalMonthlyDebtPayment(debts, base, rates), `${dname} min`).toBe(clientCalc.totalMonthlyDebtPayment(debts, base, rates));
        }
      });

      it(`${rname} · ${base}: net worth (assets − liabilities) is identical end-to-end`, () => {
        const clientNw = clientCalc.totalAssets(ASSETS, base, rates) - clientCalc.totalLiabilities(DEBTS, base, rates);
        const portNw = port.totalAssets(ASSETS, base, rates) - port.totalLiabilities(DEBTS, base, rates);
        expect(portNw).toBe(clientNw);
        // the receivable never subtracts
        expect(port.totalLiabilities(DEBTS, base, rates)).toBe(port.totalLiabilities(DEBTS.filter(d => d.direction !== 'owed_to_me'), base, rates));
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. ACCOUNT BALANCES
// ─────────────────────────────────────────────────────────────────────────────

describe('parity — account resolution + balances', () => {
  it('accountValueOf / debitAccountOf / creditAccountOf agree', () => {
    for (const a of ACCOUNTS) {
      expect(port.accountValueOf(a), a.id).toBe(clientAcct.accountValueOf(a));
    }
    for (const t of FULL) {
      expect(port.debitAccountOf(t), `${t.id} debit`).toBe(clientAcct.debitAccountOf(t));
      expect(port.creditAccountOf(t), `${t.id} credit`).toBe(clientAcct.creditAccountOf(t));
    }
  });

  for (const [sname, txns] of TXN_SETS) {
    for (const [rname, rates] of RATE_SETS) {
      for (const base of BASES) {
        it(`${sname} · ${rname} · ${base}: computeAccountBalance for every account`, () => {
          for (const a of ACCOUNTS) {
            expect(port.computeAccountBalance(a, txns, base, rates), `${a.id}`)
              .toBe(clientAcct.computeAccountBalance(a, txns, base, rates));
          }
          // a reconciliation offset is an account offset, never a transaction —
          // adding one must move the balance identically on both sides.
          const withOffset: Account = { ...ACCOUNTS[0], reconciliationOffset: -37.42 };
          expect(port.computeAccountBalance(withOffset, txns, base, rates))
            .toBe(clientAcct.computeAccountBalance(withOffset, txns, base, rates));
        });
      }
    }
  }

  it('excluded rows still move the balance on both sides (money moved)', () => {
    const without = FULL.filter(t => t.id !== 'f-excl');
    const cash = ACCOUNTS[0];
    const dClient = clientAcct.computeAccountBalance(cash, FULL, 'USD', RATES_FLAT) - clientAcct.computeAccountBalance(cash, without, 'USD', RATES_FLAT);
    const dPort = port.computeAccountBalance(cash, FULL, 'USD', RATES_FLAT) - port.computeAccountBalance(cash, without, 'USD', RATES_FLAT);
    expect(dPort).toBe(dClient);
    expect(Math.round(dPort * 100) / 100).toBe(-75);
  });

  it('a transfer moves both legs identically and changes no spend/income', () => {
    const withoutXfer = FULL.filter(t => t.id !== 'f-xfer');
    for (const base of BASES) {
      const before = clientCalc.monthlyData(withoutXfer, MK, base, RATES);
      const after = port.monthlyData(FULL, MK, base, RATES);
      const clientAfter = clientCalc.monthlyData(FULL, MK, base, RATES);
      expect(after).toStrictEqual(clientAfter);
      expect(after.income).toBe(before.income);
      expect(after.expense).toBe(before.expense);
    }
  });
});

describe('parity — live net-worth asset rows (de-dupe against linked assets)', () => {
  for (const [sname, txns] of TXN_SETS) {
    for (const [rname, rates] of RATE_SETS) {
      for (const base of BASES) {
        it(`${sname} · ${rname} · ${base}: liveAssetRows + liveTotalAssets`, () => {
          const expected = clientAcct.liveAssetRows(ASSETS, ACCOUNTS, txns, base, rates);
          const actual = port.liveAssetRows(ASSETS, ACCOUNTS, txns, base, rates);
          expect(actual.map(r => ({ id: r.id, name: r.name, value: r.value, currency: r.currency, liquidity: r.liquidity, source: r.source })))
            .toStrictEqual(expected.map(r => ({ id: r.id, name: r.name, value: r.value, currency: r.currency, liquidity: r.liquidity, source: r.source })));
          expect(port.liveTotalAssets(actual)).toBe(clientAcct.liveTotalAssets(expected));
          // linked legacy assets must not double-count on either side
          expect(actual.find(r => r.id === 'asset-9')).toBeUndefined();
          expect(actual.find(r => r.id === 'asset-cc')).toBeUndefined();
          // archived accounts are excluded
          expect(actual.find(r => r.id === 'acc-old')).toBeUndefined();
          // liability accounts are not asset rows
          expect(actual.find(r => r.id === 'acc-loan')).toBeUndefined();
          expect(actual.find(r => r.id === 'acc-cc')).toBeUndefined();
        });
      }
    }
  }

  it('empty inputs produce identical empty results', () => {
    expect(port.liveAssetRows([], [], [], 'USD', RATES)).toStrictEqual(clientAcct.liveAssetRows([], [], [], 'USD', RATES));
    expect(port.liveTotalAssets([])).toBe(clientAcct.liveTotalAssets([]));
  });
});

// v10.26.0 (R4) — an investment ASSET folds its buys and withdrawals.
describe('parity — investment asset live value (computeAssetValue)', () => {
  const FUND: Asset = { id: 'asset-fund', type: 'investment', name: 'Delhi', value: 0, currency: 'INR', liquidity: 'short', valuationOffset: 46870 };
  const ASSET_TXNS: Transaction[] = [
    { id: 'r4-b1', type: 'investment', amount: 1200, currency: 'INR', date: '2026-03-01', description: 'buy', category: '', accountId: 'acc-cash', assetId: 'asset-fund' },
    { id: 'r4-b2', type: 'investment', amount: 10.55, currency: 'EUR', date: '2026-03-02', description: 'fx buy', category: '', accountId: 'acc-bank', assetId: 'asset-fund' },
    { id: 'r4-w1', type: 'investment', amount: 500, currency: 'INR', date: '2026-03-03', description: 'withdraw', category: '', toAccountId: 'acc-bank', assetId: 'asset-fund' },
    // v10.27.0 — a local-only buy paid from a legacy encoded picker value (no account uuid).
    { id: 'r4-enc', type: 'investment', amount: 33.3, currency: 'INR', date: '2026-03-03', description: 'encoded buy', category: '', paymentMethod: 'cash', assetId: 'asset-fund' },
    { id: 'r4-other', type: 'investment', amount: 999, currency: 'INR', date: '2026-03-03', description: 'other asset', category: '', accountId: 'acc-cash', assetId: 'asset-inr' },
    { id: 'r4-legacy', type: 'investment', amount: 77, currency: 'USD', date: '2026-03-04', description: 'legacy two-account row', category: '', accountId: 'acc-bank', toAccountId: 'acc-inv' },
    { id: 'r4-noise', type: 'expense', amount: 5, currency: 'INR', date: '2026-03-04', description: 'not an investment', category: 'other_expense', accountId: 'acc-cash', assetId: 'asset-fund' },
  ];
  for (const [rname, rates] of RATE_SETS) {
    it(`${rname}: every asset's live value matches`, () => {
      for (const a of [FUND, ...ASSETS]) {
        expect(port.computeAssetValue(a, ASSET_TXNS, rates), a.id).toBe(clientAcct.computeAssetValue(a, ASSET_TXNS, rates));
      }
    });
    for (const base of BASES) {
      it(`${rname} · ${base}: liveAssetRows with asset-based investments`, () => {
        const txns = [...FULL, ...ASSET_TXNS];
        const pick = (rows: ReturnType<typeof clientAcct.liveAssetRows>) => rows.map(r => ({ id: r.id, value: r.value, source: r.source }));
        expect(pick(port.liveAssetRows([FUND, ...ASSETS], ACCOUNTS, txns, base, rates)))
          .toStrictEqual(pick(clientAcct.liveAssetRows([FUND, ...ASSETS], ACCOUNTS, txns, base, rates)));
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. LOAN / EMI + SPLITS
// ─────────────────────────────────────────────────────────────────────────────

describe('parity — EMI (loan_emi SYSTEM_SPLIT boundary)', () => {
  const CASES: Array<[number, number, number]> = [
    [10000, 12, 500], [10000, 12, 50], [10000, 0, 500], [0, 12, 500],
    [250000, 8.5, 5000], [8000, 7, 300], [1500.25, 18, 50], [100, 12, 0],
  ];

  it('splitEmiPortions agrees, and interest + principal === payment', () => {
    for (const [bal, rate, pay] of CASES) {
      const expected = clientCalc.splitEmiPortions(bal, rate, pay);
      const actual = port.splitEmiPortions(bal, rate, pay);
      expect(actual, `${bal}/${rate}/${pay}`).toStrictEqual(expected);
      expect(actual.principal).toBeGreaterThanOrEqual(0);
    }
  });

  it('computeEmi agrees', () => {
    for (const [p, r, n] of [[20000, 7, 60], [20000, 0, 60], [0, 7, 60], [20000, 7, 0], [1_000_000, 8.5, 240]] as const) {
      expect(port.computeEmi(p, r, n), `${p}/${r}/${n}`).toBe(clientCalc.computeEmi(p, r, n));
    }
  });
});

describe('parity — splitsOutstanding', () => {
  for (const [sname, txns] of TXN_SETS) {
    for (const [rname, rates] of RATE_SETS) {
      for (const base of BASES) {
        it(`${sname} · ${rname} · ${base}`, () => {
          const expected = clientCalc.splitsOutstanding(txns, base, rates);
          const actual = port.splitsOutstanding(txns, base, rates);
          expect(actual.owedToYou).toBe(expected.owedToYou);
          expect(actual.youOwe).toBe(expected.youOwe);
          expect(actual.owedDetails.map(d => [d.txn.id, d.participant.name]))
            .toStrictEqual(expected.owedDetails.map(d => [d.txn.id, d.participant.name]));
          expect(actual.youOweDetails.map(d => [d.txn.id, d.participant.name]))
            .toStrictEqual(expected.youOweDetails.map(d => [d.txn.id, d.participant.name]));
        });
      }
    }
  }
});
