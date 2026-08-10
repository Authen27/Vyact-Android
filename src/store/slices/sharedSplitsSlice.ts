// Vyact v10.14 — email-based cross-household split sharing (store slice).
// Cloud-only: a signed-out / local-only session has no verified email to key
// on, so every action here is a no-op unless `cloudEnabled && currentHouseholdId
// !== 'local'`. Reused by TransactionFormModal (create on submit) and
// Splits.tsx (the "shared with you" section + settle/close actions).
import type { StateCreator } from 'zustand';
import type { Store } from '../../store';
import type { SharedSplit } from '../../types';
import {
  createSharedSplit, fetchOwnedSharedSplits, fetchSharedWithMe,
  settleSharedSplitShare, markShareRowPaid, closeSharedSplit,
  resolveParticipantNames, updateSharedSplit, updateShareAmount,
  addShareToSplit, removeShare, deleteSharedSplit,
  type NewSharedSplitParticipant,
} from '../../lib/sharedSplits';
import { sendSplitEmail } from '../../lib/splitEmail';
import type { SharedSplitShare } from '../../types';

export interface SharedSplitsSlice {
  sharedSplitsOwned: SharedSplit[];
  sharedSplitsWithMe: SharedSplit[];
  refreshSharedSplits: () => Promise<void>;
  createSharedSplitForTxn: (input: {
    txnId?: string; description: string; currency: string; totalAmount: number;
    txnType: 'expense' | 'income'; date: string; participants: NewSharedSplitParticipant[];
  }) => Promise<SharedSplit | null>;
  /** v10.16 — edit an existing split's cloud rows, touching only unpaid shares.
   *  Creates the shared split if the txn had none but now has emailed members. */
  updateSharedSplitForTxn: (input: {
    txnId: string; description: string; currency: string; totalAmount: number;
    txnType: 'expense' | 'income'; date: string; participants: NewSharedSplitParticipant[];
  }) => Promise<void>;
  /** v10.16 — delete the shared split backing a txn (when the txn is deleted). */
  deleteSharedSplitForTxn: (txnId: string) => Promise<void>;
  settleMySplitShare: (shareId: string) => Promise<void>;
  markSplitShareRowPaid: (shareId: string) => Promise<void>;
  closeMySplit: (splitId: string) => Promise<void>;
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
      try { nameMap = await resolveParticipantNames(emails); } catch { /* names are best-effort */ }
      const withNames = (list: typeof owned) => list.map(sp => ({
        ...sp,
        shares: sp.shares.map((s: SharedSplitShare) => ({ ...s, name: nameMap[s.email.toLowerCase()] })),
      }));
      set({ sharedSplitsOwned: withNames(owned), sharedSplitsWithMe: withNames(withMe) });
    } catch {
      // Offline / RLS hiccup — keep whatever we already have; next refresh retries.
    }
  },

  createSharedSplitForTxn: async (input) => {
    const { cloudEnabled, currentHouseholdId, session } = get();
    if (!cloudEnabled || currentHouseholdId === 'local' || !session) return null;
    const created = await createSharedSplit({ ownerHouseholdId: currentHouseholdId, ...input });
    set({ sharedSplitsOwned: [created, ...get().sharedSplitsOwned] });
    // v10.15 — email each participant that a split was shared with them.
    void sendSplitEmail({ splitId: created.id, event: 'shared' });
    return created;
  },

  updateSharedSplitForTxn: async (input) => {
    const { cloudEnabled, currentHouseholdId, session } = get();
    if (!cloudEnabled || currentHouseholdId === 'local' || !session) return;
    const existing = get().sharedSplitsOwned.find(sp => sp.txnId === input.txnId);
    if (!existing) {
      // No shared split for this txn yet — create one if it now has emailed members.
      if (input.participants.length) await get().createSharedSplitForTxn(input);
      return;
    }
    await updateSharedSplit(existing.id, {
      description: input.description, currency: input.currency,
      totalAmount: input.totalAmount, txnType: input.txnType, date: input.date,
    });
    const byEmail = new Map(existing.shares.map(s => [s.email.toLowerCase(), s]));
    const want = new Map(input.participants.map(p => [p.email.toLowerCase(), p.share]));
    // Remove unpaid shares no longer present.
    for (const s of existing.shares) {
      if (!want.has(s.email.toLowerCase()) && !s.paid) await removeShare(s.id);
    }
    // Add new emails; bump amounts on existing unpaid shares. Paid shares are never touched.
    for (const [email, share] of want) {
      const cur = byEmail.get(email);
      if (!cur) await addShareToSplit(existing.id, email, share);
      else if (!cur.paid && cur.share !== share) await updateShareAmount(cur.id, share);
    }
    await get().refreshSharedSplits();
  },

  deleteSharedSplitForTxn: async (txnId) => {
    const { cloudEnabled, currentHouseholdId, session } = get();
    if (!cloudEnabled || currentHouseholdId === 'local' || !session) return;
    const existing = get().sharedSplitsOwned.find(sp => sp.txnId === txnId);
    if (!existing) return;
    try { await deleteSharedSplit(existing.id); } catch { /* best-effort */ }
    set({ sharedSplitsOwned: get().sharedSplitsOwned.filter(sp => sp.id !== existing.id) });
  },

  settleMySplitShare: async (shareId) => {
    await settleSharedSplitShare(shareId);
    await get().refreshSharedSplits();
    // v10.15 — tell the owner (server resolves their address) that I settled.
    void sendSplitEmail({ shareId, event: 'settled' });
    get().toast('Marked your share as settled', 'success');
  },

  markSplitShareRowPaid: async (shareId) => {
    await markShareRowPaid(shareId);
    await get().refreshSharedSplits();
    get().toast('Marked as settled', 'success');
  },

  closeMySplit: async (splitId) => {
    await closeSharedSplit(splitId);
    await get().refreshSharedSplits();
    // v10.15 — email participants that the split was closed.
    void sendSplitEmail({ splitId, event: 'closed' });
    get().toast('Split closed', 'success');
  },
});
