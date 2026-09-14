// Vyact — THE canonical net-worth projection (audit F3).
//
// BEFORE THIS MODULE there were three answers to "what am I worth":
//   • NetWorth.tsx — live account balances (correct, but only its own page),
//   • Dashboard selectors — the static `assets`/`debts` arrays (a new bank
//     account never moved the dashboard's net worth),
//   • Ask Vyact's SafeSummary — the static `assets` array again.
// A newly created account moved one surface and not the others; a standalone
// credit-card or loan ACCOUNT (which the account editor permits) contributed
// to NO liability figure anywhere.
//
// THE RULE (one source of truth)
//   ASSET side  — every cash/bank/investment ACCOUNT at its
//                 computed ledger balance, PLUS legacy assets no account
//                 represents (de-duped by assetId — liveAssetRows' rule).
//   LIABILITY side — every credit_card/loan ACCOUNT at its
//                 computed ledger balance (this is what makes a standalone
//                 card/loan account count), PLUS debts no account represents
//                 (de-duped by debtId), MINUS receivables the v10.17 rule
//                 excludes ('owed_to_me' never counts).
//
//   Every figure passes through the SAME currency conversion (format.convert
//   → dinero, USD-based rate table). Nothing here does ad-hoc FX.
//
// NetWorth.tsx, the Dashboard selectors and Ask Vyact's summary all read this
// projection. If you change what net worth IS, you change it here, once.

import type { Account, Asset, Debt, Transaction, ExchangeRates, Liquidity } from '../types';
import { computeAccountBalance, liveAssetRows, liveTotalAssets } from './accountBalance';
import { convert } from './format';

export interface LiabilityRow {
  id: string;
  name: string;
  /** Owed amount as a POSITIVE number, in base currency. */
  value: number;
  currency: string;
  source: 'account' | 'debt';
  account?: Account;
  debt?: Debt;
}

export interface NetWorthProjection {
  baseCurrency: string;
  assetRows: ReturnType<typeof liveAssetRows>;
  liabilityRows: LiabilityRow[];
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  /** Liquid assets (cash/bank accounts + liquid legacy assets). */
  liquidAssets: number;
}

const LIABILITY_KINDS: ReadonlySet<Account['kind']> = new Set(['credit_card', 'loan']);

/** Liability-side rows: liability accounts at their live balances, plus any
 *  owed-by-me debt no account represents. */
export function liveLiabilityRows(
  debts: Debt[],
  accounts: Account[],
  txns: Transaction[],
  baseCurrency: string,
  rates: ExchangeRates,
): LiabilityRow[] {
    const liveAccounts = accounts.filter(a => LIABILITY_KINDS.has(a.kind));
  const linkedDebtIds = new Set(
    liveAccounts.map(a => a.debtId).filter((id): id is string => !!id),
  );
  const accountRows: LiabilityRow[] = liveAccounts
    .filter(a => LIABILITY_KINDS.has(a.kind))
    .map(a => ({
      id: a.id,
      name: a.name,
        value: Math.max(0, -convert(computeAccountBalance(a, txns, a.currency, rates), a.currency, baseCurrency, rates)),
      currency: baseCurrency,
      source: 'account',
      account: a,
    }));
  const debtRows: LiabilityRow[] = debts
    .filter(d => d.direction !== 'owed_to_me')        // v10.17 — receivables excluded
    .filter(d => !linkedDebtIds.has(d.id))
    .map(d => ({
      id: d.id,
      name: d.name,
      value: convert(d.currentBalance, d.currency, baseCurrency, rates),
      currency: d.currency,
      source: 'debt',
      debt: d,
    }));
  return [...accountRows, ...debtRows];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The ONE net-worth projection. Reads only store state; writes nothing.
 * Pure — parity-portable to the server unchanged.
 */
export function computeNetWorth(
  state: {
    assets: Asset[];
    accounts: Account[];
    debts: Debt[];
    transactions: Transaction[];
  },
  baseCurrency: string,
  rates: ExchangeRates,
): NetWorthProjection {
  const { assets, accounts, debts, transactions } = state;
    const valuationAccounts = accounts.map(account => ({ ...account, isArchived: false }));
    const assetRows = liveAssetRows(assets, valuationAccounts, transactions, baseCurrency, rates)
      .map(row => row.account ? { ...row,
        account: accounts.find(account => account.id === row.id),
        value: convert(computeAccountBalance(row.account, transactions, row.account.currency, rates), row.account.currency, baseCurrency, rates),
      } : row);
    for (const account of accounts.filter(account => LIABILITY_KINDS.has(account.kind))) {
      const value = convert(computeAccountBalance(account, transactions, account.currency, rates), account.currency, baseCurrency, rates);
      if (value > 0) assetRows.push({ id: account.id, name: account.name, value,
        currency: baseCurrency, liquidity: 'liquid', source: 'account', account });
    }
  const liabilityRows = liveLiabilityRows(debts, accounts, transactions, baseCurrency, rates);
  const totalAssets = liveTotalAssets(assetRows);
  const totalLiabilities = round2(liabilityRows.reduce((s, r) => s + r.value, 0));
  const liquidAssets = round2(
    assetRows.filter(r => r.liquidity === ('liquid' as Liquidity)).reduce((s, r) => s + r.value, 0),
  );
  return {
    baseCurrency,
    assetRows,
    liabilityRows,
    totalAssets,
    totalLiabilities,
    netWorth: round2(totalAssets - totalLiabilities),
    liquidAssets,
  };
}
