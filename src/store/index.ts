// Vyact — store composition root (TD-25).
//
// The former 1,167-line `store.ts` god-module is now a set of Zustand domain
// slices under `store/slices/`. This file folds them into a single `useStore`
// and defines the `Store` type (the union of every slice). The public hook and
// its type are byte-identical to the pre-split store, so the ~41 consumers that
// `import { useStore } from '../store'` are unaffected.
import { create } from 'zustand';
import { createModalSlice, type ModalSlice } from './slices/modalSlice';
import { createReconcileSlice, type ReconcileSlice } from './slices/reconcileSlice';
import { createNotifySlice, type NotifySlice } from './slices/notifySlice';
import { createRecurringSlice, type RecurringSlice } from './slices/recurringSlice';
import { createCloudAuthSlice, type CloudAuthSlice } from './slices/cloudAuthSlice';
import { createSyncSlice, type SyncSlice } from './slices/syncSlice';
import { createDataSlice, type DataSlice } from './slices/dataSlice';
import { createCrudSlice, type CrudSlice } from './slices/crudSlice';
import { createSharedSplitsSlice, type SharedSplitsSlice } from './slices/sharedSplitsSlice';
import { createInvitationsSlice, type InvitationsSlice } from './slices/invitationsSlice';
import { exposeStoreForE2E } from './testHooks';

export interface Store extends
  ModalSlice, ReconcileSlice, NotifySlice, RecurringSlice,
  CloudAuthSlice, SyncSlice, DataSlice, CrudSlice, SharedSplitsSlice, InvitationsSlice {}

export const useStore = create<Store>((set, get, api) => ({
  ...createModalSlice(set, get, api),
  ...createReconcileSlice(set, get, api),
  ...createNotifySlice(set, get, api),
  ...createRecurringSlice(set, get, api),
  ...createCloudAuthSlice(set, get, api),
  ...createSyncSlice(set, get, api),
  ...createDataSlice(set, get, api),
  ...createCrudSlice(set, get, api),
  ...createSharedSplitsSlice(set, get, api),
  ...createInvitationsSlice(set, get, api),
}));

// Expose the store to E2E tests in non-production builds (read-only access).
exposeStoreForE2E(useStore);

// W3c (v10.67.0) — when the sync layer rolls back a write the database refused, or a conflict is
// dismissed, the cache changes underneath the store; re-read it so the screen matches. Debounced:
// one refresh for a burst. (Background syncs do not notify, so this cannot loop.)
{
  let pending: ReturnType<typeof setTimeout> | null = null;
  const adapter = useStore.getState().adapter as { onCacheChanged?: (listener: () => void) => () => void };
  adapter.onCacheChanged?.(() => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => { pending = null; void useStore.getState().refresh(); }, 250);
  });
}
