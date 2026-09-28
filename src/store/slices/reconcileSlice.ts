// Vyact — account reconciliation slice (TD-25 increment 3).
//
// The Money-Model B1.3 reconcile path + the §6 R-AGG-5 / D2 net-worth bridge.
// Extracted verbatim from the store god-module; reads/writes the rest of the
// store via `get()` (same store-wide handles), so behaviour is byte-identical.
import type { StateCreator } from 'zustand';
import type { Account, Asset } from '../../types';
import type { Store } from '../../store';
import {
  computeAccountBalance, reconcileAccount as buildReconcileOffset,
  computeAssetValue, reconcileAssetValue,
} from '../../lib/accountBalance';

export interface ReconcileSlice {
  /** Money-Model B1.3 — reconcile an account to a real balance by writing a dated
   *  Balance Adjustment transaction (never a silent overwrite), then mark the
   *  account balance confirmed. Returns the delta booked. */
  reconcileAccount: (account: Account, realBalance: number) => Promise<number>;
  /** v10.26.0 (R4) — "Update value" on an investment asset: the valuation offset
   *  absorbs stated − live with a dated log entry. Never a transaction, never a
   *  change to the opening value. Returns the delta booked. */
  updateAssetValue: (asset: Asset, statedValue: number) => Promise<number>;
}

export const createReconcileSlice: StateCreator<Store, [], [], ReconcileSlice> = (_set, get) => ({
  // v9 §2.6 (D2) — reconciliation is a BALANCE CORRECTION, never a transaction.
  // The delta between the computed and the user-stated balance is absorbed into
  // accounts.reconciliation_offset with a dated quiet-log entry. Same path for
  // bank reconcile and investment value updates (kind switches the log entry).
  reconcileAccount: async (account, realBalance) => {
    const { transactions, profile, rates, assets, debts } = get();
    const computed = computeAccountBalance(account, transactions, profile.baseCurrency, rates);
    const kind = account.kind === 'investment' ? 'investment' as const
      : account.kind === 'credit_card' ? 'credit_card' as const
      : 'bank' as const;
    const { patch, delta } = buildReconcileOffset(account, computed, realBalance, kind);
    const confirmedProv = { confidence: 'confirmed' as const, source: 'user' as const, confirmedAt: new Date().toISOString() };
    // v10.24.0 (R2) — stamped on EVERY reconcile, including one with no drift.
    // A matching statement changes no number and writes no log entry (INV-3b),
    // but it is still a check against a statement, so "not reconciled in N
    // days" must clear.
    await get().upsertAccount({ ...account, ...patch, ...confirmedProv, lastReconciledAt: confirmedProv.confirmedAt });
    // §6 R-AGG-5 / D2 — net worth folds over the Asset/Debt entities these
    // accounts were synthesised from, so the stated value MUST flow through to
    // the linked entity (else the offset would never reach net worth). The
    // stated balance is the new truth; provenance becomes confirmed/user.
    if (delta !== 0 && account.assetId) {
      if (account.kind === 'credit_card' || account.kind === 'loan') {
        const debt = debts.find(x => x.id === account.assetId);
        // a liability's stated value is its outstanding balance (non-negative).
        if (debt) await get().upsertDebt({ ...debt, currentBalance: Math.max(0, Math.abs(realBalance)), ...confirmedProv });
      } else {
        const asset = assets.find(x => x.id === account.assetId);
        if (asset) await get().upsertAsset({ ...asset, value: realBalance, lastUpdated: confirmedProv.confirmedAt, ...confirmedProv });
      }
    }
    return delta;
  },

  updateAssetValue: async (asset, statedValue) => {
    const { transactions, rates } = get();
    const { patch, delta } = reconcileAssetValue(asset, computeAssetValue(asset, transactions, rates), statedValue);
    const confirmedAt = new Date().toISOString();
    await get().upsertAsset({
      ...asset, ...patch,
      lastUpdated: confirmedAt.slice(0, 10),
      confidence: 'confirmed', source: 'user', confirmedAt,
    });
    return delta;
  },
});
