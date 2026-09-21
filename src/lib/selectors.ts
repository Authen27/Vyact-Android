import {
  monthlyData, totalBalance, computePulseScore, getInsights, spendByCategory,
  totalAssets, totalLiabilities, totalMonthlyDebtPayment,
} from './calculations';
import { computeNetWorth } from './netWorth';
import { compareTxnRecency } from './format';
import type {
  Transaction, Budget, BudgetAllocation, Goal, Debt, Asset, Account, Profile, ExchangeRates,
} from '../types';

// Subset of the Zustand store the selectors actually read. Kept local so
// we don't depend on the store module's full type graph (avoids a cycle).
interface StoreSlice {
  transactions: Transaction[];
  budgets: Budget[];
  budgetAllocations: BudgetAllocation[];
  goals: Goal[];
  debts: Debt[];
  assets: Asset[];
  accounts: Account[];
  profile: Profile;
  rates: ExchangeRates;
}

// Simple memoize-one implementation that compares args by reference.
function memoizeOne<TArgs extends readonly unknown[], TRes>(
  fn: (...args: TArgs) => TRes,
): (...args: TArgs) => TRes {
  let lastArgs: TArgs | null = null;
  let lastRes: TRes;
  return (...args: TArgs): TRes => {
    if (lastArgs && args.length === lastArgs.length && args.every((a, i) => a === lastArgs![i])) {
      return lastRes;
    }
    lastArgs = args;
    lastRes = fn(...args);
    return lastRes;
  };
}

const memoMonthlyData = memoizeOne((transactions: Transaction[], mk: string, base: string, rates: ExchangeRates) =>
  monthlyData(transactions, mk, base, rates),
);
export const selectMonthlyData = (mk: string) => (s: StoreSlice) => memoMonthlyData(s.transactions, mk, s.profile.baseCurrency, s.rates);

const memoTotalBalance = memoizeOne((transactions: Transaction[], base: string, rates: ExchangeRates) =>
  totalBalance(transactions, base, rates),
);
export const selectTotalBalance = (s: StoreSlice) => memoTotalBalance(s.transactions, s.profile.baseCurrency, s.rates);

const memoPulse = memoizeOne((transactions: Transaction[], budgets: Budget[], goals: Goal[], debts: Debt[], base: string, rates: ExchangeRates, allocations: BudgetAllocation[]) =>
  computePulseScore(transactions, budgets, goals, debts, base, rates, allocations),
);
export const selectPulse = (s: StoreSlice) => memoPulse(s.transactions, s.budgets, s.goals, s.debts, s.profile.baseCurrency, s.rates, s.budgetAllocations);

const memoInsights = memoizeOne((transactions: Transaction[], budgets: Budget[], goals: Goal[], debts: Debt[], assets: Asset[], base: string, rates: ExchangeRates) =>
  getInsights(transactions, budgets, goals, debts, assets, base, rates),
);
export const selectInsights = (s: StoreSlice) => memoInsights(s.transactions, s.budgets, s.goals, s.debts, s.assets, s.profile.baseCurrency, s.rates);

const memoSpend = memoizeOne((transactions: Transaction[], mk: string, base: string, rates: ExchangeRates) =>
  spendByCategory(transactions, mk, base, rates),
);
export const selectSpendByCategory = (mk: string) => (s: StoreSlice) => memoSpend(s.transactions, mk, s.profile.baseCurrency, s.rates);

const memoRecent = memoizeOne((transactions: Transaction[]) =>
  [...transactions].sort(compareTxnRecency).slice(0, 5));
export const selectRecentTxns = (s: StoreSlice) => memoRecent(s.transactions);

const memoTotalAssets = memoizeOne((assets: Asset[], base: string, rates: ExchangeRates) => totalAssets(assets, base, rates));
export const selectTotalAssets = (s: StoreSlice) => memoTotalAssets(s.assets, s.profile.baseCurrency, s.rates);

const memoTotalLiabilities = memoizeOne((debts: Debt[], base: string, rates: ExchangeRates) => totalLiabilities(debts, base, rates));
export const selectTotalLiabilities = (s: StoreSlice) => memoTotalLiabilities(s.debts, s.profile.baseCurrency, s.rates);

// ── Audit F3 — the canonical net-worth projection. ─────────────────────────
// Dashboard's Net Worth card and Ask Vyact used to read the STATIC
// assets/debts arrays while NetWorth.tsx read live account balances — three
// answers to one question. All surfaces now derive from this single
// projection (live account balances both sides, unlinked assets/debts,
// receivables excluded, one FX path).
const memoNetWorth = memoizeOne((
  assets: Asset[], accounts: Account[], debts: Debt[], transactions: Transaction[],
  base: string, rates: ExchangeRates,
) => computeNetWorth({ assets, accounts, debts, transactions }, base, rates));
export const selectNetWorth = (s: StoreSlice) => memoNetWorth(
  s.assets, s.accounts, s.debts, s.transactions, s.profile.baseCurrency, s.rates,
);

const memoMonthlyDebt = memoizeOne((debts: Debt[], base: string, rates: ExchangeRates) => totalMonthlyDebtPayment(debts, base, rates));
export const selectMonthlyDebtPayment = (s: StoreSlice) => memoMonthlyDebt(s.debts, s.profile.baseCurrency, s.rates);
