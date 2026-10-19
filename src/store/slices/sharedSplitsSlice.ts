// Vyact v10.14 — email-based cross-household split sharing (store slice).
// Cloud-only: a signed-out / local-only session has no verified email to key
// on, so every action here is a no-op unless `cloudEnabled && currentHouseholdId
// !== 'local'`. Reused by TransactionFormModal (create on submit) and
// Splits.tsx (the "shared with you" section + settle/close actions).
import type { StateCreator } from 'zustand';
import type { Store } from '../../store';
import type { SharedSplit } from '../../types';
import {
  fetchOwnedSharedSplits, fetchSharedWithMe,
  settleSharedSplitShare, closeSharedSplit,
  resolveParticipantNames,
  type NewSharedSplitParticipant, type SplitShareIntent,
} from '../../lib/sharedSplits';
import { sendSplitEmail, splitEmailNotice, type SplitEmailEvent } from '../../lib/splitEmail';
import type { SharedSplitShare } from '../../types';
import { expected } from '../../lib/faults';

type SplitShareInput = {
  txnId: string; description: string; currency: string; totalAmount: number;
  txnType: 'expense' | 'income'; date: string; participants: NewSharedSplitParticipant[];
};

export interface SharedSplitsSlice {
  sharedSplitsOwned: SharedSplit[];
  sharedSplitsWithMe: SharedSplit[];
  refreshSharedSplits: () => Promise<void>;
  /** F1c (v10.112.0) — QUEUE the sharing of a new split; sync sends it once its transaction lands. */
  createSharedSplitForTxn: (input: SplitShareInput) => Promise<void>;
  /** v10.16 — edit an existing split's cloud rows, touching only unpaid shares; creates the shared
   *  split if the txn had none but now has emailed members. Queued since F1c. */
  updateSharedSplitForTxn: (input: SplitShareInput) => Promise<void>;
  /** v10.16 — delete the shared split backing a txn (when the txn is deleted). Queued since F1c. */
  deleteSharedSplitForTxn: (txnId: string) => Promise<void>;
  settleMySplitShare: (shareId: string) => Promise<void>;
  closeMySplit: (splitId: string) => Promise<void>;
}

/** T5b (v10.121.0; audit BE-FN-09) — send a split email after the action, and say so if it didn't go out. */
function emailAndTell(get: () => Store, args: { splitId?: string; shareId?: string; event: SplitEmailEvent }): void {
  void sendSplitEmail(args).then(result => {
    const notice = splitEmailNotice(result, args.event);
    if (notice) get().toast(notice, 'info');
  });
}

/** F1c — queue one split-sharing step (cloud households only; local-only mode has no one to share with). */
async function queueShare(get: () => Store, intent: SplitShareIntent): Promise<void> {
  const { cloudEnabled, currentHouseholdId, session, adapter } = get();
  if (!cloudEnabled || currentHouseholdId === 'local' || !session) return;
  const queue = (adapter as { queueSplitShare?: (householdId: string, intent: SplitShareIntent) => Promise<void> }).queueSplitShare;
  if (typeof queue !== 'function') return;
  await queue.call(adapter, currentHouseholdId, intent);
}

export const createSharedSplitsSlice: StateCreator<Store, [], [], SharedSplitsSlice> = (set, get) => ({
  sharedSplitsOwned: [],
  sharedSplitsWithMe: [],

  refreshSharedSplits: async () => {
    const { cloudEnabled, currentHouseholdId, session } = get();
    if (!cloudEnabled || currentHouseholdId === 'local' || !session) return;
    try {
      const [owned, withMe] = await Promise.all([fetchOwnedSharedSplits(), fetchSharedWithMe()]);
      // Enrich each share with the participant's display name (one RPC for all
      // emails across both lists) so the UI can show "Manu · email", not a bare
      // address (feedback item 1).
      const emails = [...owned, ...withMe].flatMap(sp => sp.shares.map(s => s.email));
      let nameMap: Record<string, string> = {};
      try { nameMap = await resolveParticipantNames(emails); } catch { /* fault-ok: a name is a nicety; the email is shown instead */ }
      const withNames = (list: typeof owned) => list.map(sp => ({
        ...sp,
        shares: sp.shares.map((s: SharedSplitShare) => ({ ...s, name: nameMap[s.email.toLowerCase()] })),
      }));
      set({ sharedSplitsOwned: withNames(owned), sharedSplitsWithMe: withNames(withMe) });
    } catch (e) {
      // Offline / RLS hiccup — keep whatever we already have; next refresh retries.
      expected(e, 'sharedSplits.refresh');
    }
  },

  // v10.112.0 (F1c, audit INT-TXN-11; owner: "today's calls, repeat-safe") — create, edit and delete
  // QUEUE the split's sharing behind its transaction (`queueSplitShare`); sync makes the cloud match the
  // split once the transaction has landed, retrying until it does. The people added are emailed then
  // (v10.15; W1c: only new people, once), and the store re-reads its shared splits
  // (`onSplitShared`, wired in store/index.ts). Before, these called the cloud straight away, failed
  // offline or before the transaction had landed, and nothing tried again.
  createSharedSplitForTxn: async (input) => {
    if (!input.participants.length) return;
    await queueShare(get, input);
  },

  updateSharedSplitForTxn: async (input) => {
    await queueShare(get, input);
  },

  deleteSharedSplitForTxn: async (txnId) => {
    await queueShare(get, { txnId, deleted: true });
    // The split is gone from this person's list at once; the queued step removes it from the cloud.
    set({ sharedSplitsOwned: get().sharedSplitsOwned.filter(sp => sp.txnId !== txnId) });
  },

  settleMySplitShare: async (shareId) => {
    await settleSharedSplitShare(shareId);
    await get().refreshSharedSplits();
    get().toast('Marked your share as settled', 'success');
    // v10.15 — tell the owner (server resolves their address) that I settled.
    emailAndTell(get, { shareId, event: 'settled' });
  },

  closeMySplit: async (splitId) => {
    await closeSharedSplit(splitId);
    await get().refreshSharedSplits();
    get().toast('Split closed', 'success');
    // v10.15 — email participants that the split was closed.
    emailAndTell(get, { splitId, event: 'closed' });
  },
});
