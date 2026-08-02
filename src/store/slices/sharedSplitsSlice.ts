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
  type NewSharedSplitParticipant,
} from '../../lib/sharedSplits';

export interface SharedSplitsSlice {
  sharedSplitsOwned: SharedSplit[];
  sharedSplitsWithMe: SharedSplit[];
  refreshSharedSplits: () => Promise<void>;
  createSharedSplitForTxn: (input: {
    txnId?: string; description: string; currency: string; totalAmount: number;
    txnType: 'expense' | 'income'; date: string; participants: NewSharedSplitParticipant[];
  }) => Promise<SharedSplit | null>;
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
      set({ sharedSplitsOwned: owned, sharedSplitsWithMe: withMe });
    } catch {
      // Offline / RLS hiccup — keep whatever we already have; next refresh retries.
    }
  },

  createSharedSplitForTxn: async (input) => {
    const { cloudEnabled, currentHouseholdId, session } = get();
    if (!cloudEnabled || currentHouseholdId === 'local' || !session) return null;
    const created = await createSharedSplit({ ownerHouseholdId: currentHouseholdId, ...input });
    set({ sharedSplitsOwned: [created, ...get().sharedSplitsOwned] });
    return created;
  },

  settleMySplitShare: async (shareId) => {
    await settleSharedSplitShare(shareId);
    await get().refreshSharedSplits();
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
    get().toast('Split closed', 'success');
  },
});
