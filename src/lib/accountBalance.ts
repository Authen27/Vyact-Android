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

import type { Transaction, Account, ReconciliationEntry } from '../types';
import { effectiveAmount } from './calculations';
import type { ExchangeRates } from '../types';

/** The encoded legacy account key for an Account (paymentMethod scheme). */
export function accountValueOf(account: Account): string {
  if (account.kind === 'cash') return 'cash';
  if (account.kind === 'credit_card') return `debt:${account.assetId || account.id}`;
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
