// Vyact — cloud auth / session slice (TD-25 increment 6).
//
// Session lifecycle + the active-household role. setSession drives the
// sign-in/sign-out transitions (delegating bootstrap to init() via get());
// refreshHouseholds recomputes myRole from memberships. Moved verbatim from the
// store god-module; reads the rest of the store via get().
import type { StateCreator } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { AppRole } from '../../types';
import type { Store } from '../../store';
import { isCloudEnabled, supabase } from '../../lib/supabase';
import { highestRole, resolveMyRole } from '../../lib/permissions';
import { setLocalString } from '../localJson';
import { invalidateCacheForSession, clearCacheOnSignOut } from '../../lib/cacheInvalidation';
import { forgetPushOnDevice } from '../../lib/webPush';
import { stampHouseholdTimezone } from '../../lib/householdTimezone';
import { unexpected } from '../../lib/faults';
import { defaultProfile } from './dataSlice';

export interface CloudAuthSlice {
  cloudEnabled: boolean;
  session: Session | null;
  sessionLoaded: boolean;
  myRole: AppRole | undefined;          // role in active household
  setSession: (session: Session | null, loaded?: boolean) => void;
  refreshHouseholds: () => Promise<void>;
}

/** The in-memory cloud state cleared on sign-out (and, W8a FE-SYN-10, on a switch of user). */
export const SIGNED_OUT_STATE = {
  households: [], currentHouseholdId: 'local',
  transactions: [], budgets: [], goals: [], members: [],
  debts: [], assets: [], accounts: [], savedViews: [], myRole: undefined,
  budgetAllocations: [], recurringSchedules: [], notifications: [],
  sharedSplitsOwned: [], sharedSplitsWithMe: [],
  myInvitations: [], householdInvitations: [],
  // v10.110.0 (F1a, audit FE-SYN-04) — the profile and the net-worth history went with nothing.
  profile: defaultProfile, netWorthSnapshots: [], lastSyncedAt: null,
} satisfies Partial<Store>;

export const createCloudAuthSlice: StateCreator<Store, [], [], CloudAuthSlice> = (set, get) => ({
  cloudEnabled: isCloudEnabled(),
  session: null,
  sessionLoaded: !isCloudEnabled(),     // local-only mode: instantly "loaded"
  myRole: undefined,

  // ── v4.1: AUTH + REALTIME ───────────────────────────────────
  setSession: (session, loaded = true) => {
    const prevUid = get().session?.user?.id;
    const wasSignedIn = Boolean(get().session);
    const isSignedIn = Boolean(session);
    set({ session, sessionLoaded: loaded });
    // W8a (audit FE-SYN-10): a DIFFERENT user signed in without a sign-out in between (another tab,
    // or a magic link opened while signed in). The previous user's ledger was left loaded and their
    // cache never purged. Treat it as sign-out + sign-in: clear memory now, purge, then hydrate.
    const switchedUser = wasSignedIn && isSignedIn && !!prevUid && prevUid !== session?.user?.id;
    if (switchedUser) {
      void forgetPushOnDevice();
      set({ ...SIGNED_OUT_STATE });
    }
    if ((!wasSignedIn && isSignedIn) || switchedUser) {
      // 🔴 INVALIDATE THE LOCAL CACHE BEFORE LOADING ANYTHING (v10.20.7).
      //
      // The local store is a CACHE of cloud state and nothing ever invalidated
      // it. On a shared device that meant a second user could be shown the
      // first user's data — the adapter answers from cache before the network
      // replies. It also meant rows whose cloud write had FAILED lived on
      // locally and were re-uploaded by the next sync, so a deleted schedule
      // came back. `recurring_schedules` held zero rows in production for
      // months while devices rendered a full list from cache.
      //
      // This must run BEFORE init(), or init() hydrates from the very cache we
      // are about to discard. The user's unsynced write queue is preserved.
      // 🔴 AWAIT THE PURGE BEFORE HYDRATING (v10.20.8).
      //
      // v10.20.7 called this fire-and-forget, so init() raced it and could read
      // the very cache being cleared. The purge is genuinely async now that it
      // clears IndexedDB, so the race is real rather than theoretical.
      const uid = session?.user?.id;
      if (uid) {
        void invalidateCacheForSession(uid)
          .catch(() => { /* fault-ok: a device with storage disabled must still sign in */ })
          .then(() => { get().init(); });
      } else {
        get().init();
      }
    } else if (wasSignedIn && !isSignedIn) {
      // v6.4: Stash the last cloud household id BEFORE clearing state, so
      // the next sign-in can land back on it (its cache is still in
      // localStorage under legacy per-household keys). Without this we'd default to the
      // first household in the list, mis-key cache lookups, and the
      // HybridAdapter "transient empty" path would kick in needlessly.
      const cur = get().currentHouseholdId;
      if (cur && cur !== 'local') {
        try { setLocalString('last_cloud_hid', cur); } catch { /* fault-ok: device storage is optional (private mode, quota); the household is picked again at the next sign-in */ }
      }
      // And drop the cached ledger from the device. Leaving a signed-out
      // machine holding the last user's transactions is the same privacy
      // problem as the sign-in case, only deferred. `last_cloud_hid` above is
      // deliberately preserved so the next sign-in still lands on the right
      // household.
      // Async now that it clears IndexedDB. Not awaited: the in-memory state is
      // cleared synchronously below, and the next sign-in awaits its own purge
      // before hydrating — so a slow disk cannot leave stale rows visible.
      // T5b — a cache that couldn't be cleared is a signed-out device still holding a ledger: recorded loudly.
      void clearCacheOnSignOut().catch(e => unexpected(e, 'signOut.clearCache'));
      // W7a (FE-PLT-08): an expired/revoked session never ran signOut()'s push unregister — drop the
      // device's subscription locally (a no-op after an explicit sign-out, which already did).
      void forgetPushOnDevice();
      // Just signed out — clear in-memory cloud state
      set({ ...SIGNED_OUT_STATE });
    }
  },

  refreshHouseholds: async () => {
    const { adapter, currentHouseholdId, cloudEnabled } = get();
    const households = await adapter.listHouseholds();
    set({ households });

    // WHO AM I IN THIS HOUSEHOLD? The rule itself is `resolveMyRole` in
    // lib/permissions.ts, beside `can()` — the two halves of one policy, and
    // pure so they can be tested without a Supabase client.
    //
    // This slice only supplies the three facts the rule needs. Note the middle
    // case: the old code keyed its 'owner' fallback on "no session" instead of
    // "no cloud", so a signed-out CLOUD user resolved to 'owner'. Unreachable
    // then, live the moment App.tsx started calling this on boot.
    const hasSession = Boolean(supabase && get().session?.user);
    if (!cloudEnabled || !hasSession) {
      set({ myRole: resolveMyRole({ cloudEnabled, hasSession }) });
      void get().refreshInvitations();
      return;
    }
    try {
      const { data } = await supabase!.from('memberships')
        .select('role')
        .eq('household_id', currentHouseholdId)
        .eq('user_id', get().session!.user.id)
        .maybeSingle();
      const myRole = resolveMyRole({
        cloudEnabled, hasSession, membershipRole: data?.role as AppRole | null,
      });
      // T5b (XC-ARC-10) — the role is for the household it was read for; a switch meanwhile reads again.
      if (get().currentHouseholdId === currentHouseholdId) set({ myRole });
      // W3a — the server reads "today" in the household's zone; the owner's device supplies it once.
      if (myRole === 'owner') void stampHouseholdTimezone(currentHouseholdId);
    } catch { /* fault-ok: offline: the last known role is kept */ }
    // v10.95.0 (#9) — the bell's invitation cards follow the household list and the role in it.
    void get().refreshInvitations();
    void highestRole; // suppress unused
  },
});
