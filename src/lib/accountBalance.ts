// Vyact v9 — account balances + reconciliation (txn-redesign spec §2.6 / §6 R-AGG-4).
//
//   balance(account) = opening_balance
//     + Σ(amount WHERE credited:  income / transfer-in / investment-in)
//     − Σ(amount WHERE debited:   expense / transfer-out / investment-out)
//     + reconciliation_offset                                   (D2)
//
// D2 — reconciling a bank account OR updating an investment's value is a
// CORRECTION TO THE ACCOUNT'S BALANCE, never a transactions row. The delta is
// absorbed into accounts.reconciliation_offset with a dated quiet-log entry.
// The offset feeds net worth / balances and is structurally invisible to every
// spend/income/cash-flow aggregator (it is not in the transaction stream).
//
// Matching: post-migration rows carry real account uuids in accountId /
// toAccountId; pre-migration local caches may still hold the encoded
// paymentMethod scheme ('cash' / 'asset:<id>' / 'debt:<id>') — both match.

import type { Transaction, Account, ReconciliationEntry, Asset, Liquidity } from '../types';
import { effectiveAmount } from './calculations';
import { convert } from './format';
import type { ExchangeRates } from '../types';

/** The encoded legacy account key for an Account (paymentMethod scheme).
 *  Audit F2: liability accounts prefer the explicit debtId link (the old
 *  assetId: debt.id overload violated the FK). */
export function accountValueOf(account: Account): string {
  if (account.kind === 'cash') return 'cash';
  if (account.kind === 'credit_card') return `debt:${account.debtId ?? account.assetId ?? account.id}`;
  if (account.kind === 'loan') return `debt:${account.debtId ?? account.assetId ?? account.id}`;
  return `asset:${account.assetId || account.id}`;
}

function matches(account: Account, value: string | undefined): boolean {
  if (!value) return false;
  return value === account.id || value === accountValueOf(account);
}

/** The account a transaction's money LEFT (expense / transfer-out / investment-out). */
export function debitAccountOf(t: Transaction): string | undefined {
  return t.accountId ?? t.paymentMethod ?? undefined;
}

/** The account a transaction's money ARRIVED in (income / transfer-in / investment-in).
 *  Income falls back to the legacy single-field encoding for pre-v9 local rows. */
export function creditAccountOf(t: Transaction): string | undefined {
  if (t.type === 'income') return t.toAccountId ?? t.accountId ?? t.paymentMethod ?? undefined;
  return t.toAccountId ?? t.linkedToAssetId ?? undefined;
}

/** R-AGG-4 — an account's current balance. Pure fold over real transactions plus
 *  the D2 reconciliation offset. Excluded-from-reports txns still count (money moved). */
export function computeAccountBalance(
  account: Account,
  txns: Transaction[],
  baseCurrency: string,
  rates: ExchangeRates,
): number {
  let bal = (account.openingBalance ?? 0) + (account.reconciliationOffset ?? 0);
  for (const t of txns) {
    const amt = effectiveAmount(t, baseCurrency, rates);
    if (t.type === 'income') {
      if (matches(account, creditAccountOf(t))) bal += amt;
    } else if (t.type === 'expense') {
      if (matches(account, debitAccountOf(t))) bal -= amt;
    } else if (t.type === 'transfer' || t.type === 'investment') {
      if (matches(account, debitAccountOf(t)))  bal -= amt;
      if (matches(account, creditAccountOf(t))) bal += amt;
    }
  }
  return Math.round(bal * 100) / 100;
}

/** v10.26.0 (R4) — an investment ASSET's live value, folded exactly like an
 *  account: opening `value` + every buy into it − every withdrawal out of it +
 *  the valuation offset. A buy carries `accountId` (the money left that account)
 *  and `assetId`; a withdrawal carries `toAccountId` and `assetId`. Returned in
 *  the asset's own currency. An asset nothing moves into and with no offset is
 *  exactly its stated value, so every other asset type is unchanged. */
export function computeAssetValue(asset: Asset, txns: Transaction[], rates: ExchangeRates): number {
  let v = asset.value + (asset.valuationOffset ?? 0);
  for (const t of txns) {
    if (t.type !== 'investment' || t.assetId !== asset.id) continue;
    const amt = effectiveAmount(t, asset.currency, rates);
    // A withdrawal names ONLY a receiving account; anything else is a buy —
    // including a local-only buy paid from a legacy encoded `paymentMethod`,
    // which debits its account through debitAccountOf and must credit the asset
    // by the same amount or net worth would fall (v10.27.0).
    if (t.toAccountId && !t.accountId) v -= amt;
    else v += amt;
  }
  return Math.round(v * 100) / 100;
}

/** v10.26.0 (R4) — "Update value" on an investment asset. The same D2 rule as
 *  reconcileAccount: delta = stated − computed moves the valuation offset with a
 *  dated log entry; the opening `value` and the transaction stream are untouched.
 *  A value that already matches appends nothing. */
export function reconcileAssetValue(
  asset: Asset,
  computedValue: number,
  statedValue: number,
): { patch: Pick<Asset, 'valuationOffset' | 'valuationLog'>; delta: number } {
  const delta = Math.round((statedValue - computedValue) * 100) / 100;
  const entry: ReconciliationEntry = { at: new Date().toISOString(), delta, kind: 'investment', stated_value: statedValue };
  return {
    delta,
    patch: {
      valuationOffset: Math.round(((asset.valuationOffset ?? 0) + delta) * 100) / 100,
      valuationLog: [...(asset.valuationLog ?? []), ...(delta !== 0 ? [entry] : [])],
    },
  };
}

// ── Net Worth — live first-class-account balances, not a frozen linked asset ──
//
// Net Worth historically summed the static `assets` array. An `Account` with
// `assetId` set (the Phase-1 backfill, or the old "auto-create a backing
// asset" path removed in this change) represents the SAME real-world money as
// that asset — so once a live account exists for it, ITS computed balance
// (opening + ledger folds + reconciliation offset) is the accurate figure.
// Folding both would double-count; an asset with no linked account (illiquid
// legacy rows never wrapped as a spendable account — real estate, retirement)
// keeps contributing its own stated value, since nothing else tracks it.
export interface LiveAssetRow {
  id: string;
  name: string;
  /** Converted to the household's base currency. */
  value: number;
  currency: string;
  liquidity: Liquidity;
  source: 'account' | 'asset';
  account?: Account;
  asset?: Asset;
}

const ACCOUNT_LIQUIDITY: Partial<Record<Account['kind'], Liquidity>> = {
  cash: 'liquid', bank: 'liquid', investment: 'short',
};

/** The de-duped asset-side rows Net Worth renders/sums: live balances for
 *  every spendable account (cash/bank/investment; credit_card/loan are
 *  liabilities and excluded), plus any legacy asset NOT already represented
 *  by one of those accounts. */
export function liveAssetRows(
  assets: Asset[],
  accounts: Account[],
  txns: Transaction[],
  baseCurrency: string,
  rates: ExchangeRates,
): LiveAssetRow[] {
  const linkedAssetIds = new Set(accounts.map(a => a.assetId).filter((id): id is string => !!id));
  const accountRows: LiveAssetRow[] = accounts
    .filter(a => !a.isArchived && (a.kind === 'cash' || a.kind === 'bank' || a.kind === 'investment'))
    .map(a => ({
      id: a.id,
      name: a.name,
      value: computeAccountBalance(a, txns, baseCurrency, rates),
      currency: baseCurrency,
      liquidity: ACCOUNT_LIQUIDITY[a.kind] ?? 'liquid',
      source: 'account',
      account: a,
    }));
  const assetRows: LiveAssetRow[] = assets
    .filter(a => !linkedAssetIds.has(a.id))
    .map(a => ({
      id: a.id,
      name: a.name,
      // v10.26.0 (R4) — live: an investment asset folds its buys/withdrawals.
      value: convert(computeAssetValue(a, txns, rates), a.currency, baseCurrency, rates),
      currency: a.currency,
      liquidity: a.liquidity,
      source: 'asset',
      asset: a,
    }));
  return [...accountRows, ...assetRows];
}

export function liveTotalAssets(rows: LiveAssetRow[]): number {
  return Math.round(rows.reduce((s, r) => s + r.value, 0) * 100) / 100;
}

export interface ReconcileResult {
  /** Patch to persist on the account (offset + appended log entry). */
  patch: Pick<Account, 'reconciliationOffset' | 'reconciliationLog'>;
  delta: number;
}

/**
 * §2.6 — reconcile an account (kind 'bank') or update an investment's value
 * (kind 'investment') to a user-stated value. Computes
 * delta = stated − computed and absorbs it into the reconciliation offset with
 * a dated quiet-log entry. WRITES NO TRANSACTION — the drift is forgiven, not
 * fabricated into an event. Returns a null-delta no-op when already reconciled.
 */
export function reconcileAccount(
  account: Account,
  computedBalance: number,
  statedValue: number,
  kind: ReconciliationEntry['kind'],
): ReconcileResult {
  const delta = Math.round((statedValue - computedBalance) * 100) / 100;
  const entry: ReconciliationEntry = {
    at: new Date().toISOString(),
    delta,
    kind,
    stated_value: statedValue,
  };
  return {
    delta,
    patch: {
      reconciliationOffset: Math.round(((account.reconciliationOffset ?? 0) + delta) * 100) / 100,
      reconciliationLog: [...(account.reconciliationLog ?? []), ...(delta !== 0 ? [entry] : [])],
    },
  };
}
