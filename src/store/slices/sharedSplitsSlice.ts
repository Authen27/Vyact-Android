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
  resolveParticipantNames,
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
