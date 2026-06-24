import {
  monthlyData, totalBalance, computePulseScore, getInsights, spendByCategory,
  totalAssets, totalLiabilities, totalMonthlyDebtPayment,
} from './calculations';
import { transactionSortValue } from './format';
import type {
  Transaction, Budget, Goal, Debt, Asset, Profile, ExchangeRates,
} from '../types';

// Subset of the Zustand store the selectors actually read. Kept local so
// we don't depend on the store module's full type graph (avoids a cycle).
interface StoreSlice {
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  debts: Debt[];
  assets: Asset[];
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

const memoPulse = memoizeOne((transactions: Transaction[], budgets: Budget[], goals: Goal[], debts: Debt[], base: string, rates: ExchangeRates) =>
  computePulseScore(transactions, budgets, goals, debts, base, rates),
);
export const selectPulse = (s: StoreSlice) => memoPulse(s.transactions, s.budgets, s.goals, s.debts, s.profile.baseCurrency, s.rates);

const memoInsights = memoizeOne((transactions: Transaction[], budgets: Budget[], goals: Goal[], debts: Debt[], assets: Asset[], base: string, rates: ExchangeRates) =>
  getInsights(transactions, budgets, goals, debts, assets, base, rates),
);
export const selectInsights = (s: StoreSlice) => memoInsights(s.transactions, s.budgets, s.goals, s.debts, s.assets, s.profile.baseCurrency, s.rates);

const memoSpend = memoizeOne((transactions: Transaction[], mk: string, base: string, rates: ExchangeRates) =>
  spendByCategory(transactions, mk, base, rates),
);
export const selectSpendByCategory = (mk: string) => (s: StoreSlice) => memoSpend(s.transactions, mk, s.profile.baseCurrency, s.rates);

const memoRecent = memoizeOne((transactions: Transaction[]) => [...transactions].sort((a, b) => transactionSortValue(b) - transactionSortValue(a) || b.id.localeCompare(a.id)).slice(0, 5));
export const selectRecentTxns = (s: StoreSlice) => memoRecent(s.transactions);

const memoTotalAssets = memoizeOne((assets: Asset[], base: string, rates: ExchangeRates) => totalAssets(assets, base, rates));
export const selectTotalAssets = (s: StoreSlice) => memoTotalAssets(s.assets, s.profile.baseCurrency, s.rates);

const memoTotalLiabilities = memoizeOne((debts: Debt[], base: string, rates: ExchangeRates) => totalLiabilities(debts, base, rates));
export const selectTotalLiabilities = (s: StoreSlice) => memoTotalLiabilities(s.debts, s.profile.baseCurrency, s.rates);

const memoMonthlyDebt = memoizeOne((debts: Debt[], base: string, rates: ExchangeRates) => totalMonthlyDebtPayment(debts, base, rates));
export const selectMonthlyDebtPayment = (s: StoreSlice) => memoMonthlyDebt(s.debts, s.profile.baseCurrency, s.rates);
