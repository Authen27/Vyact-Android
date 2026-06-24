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
import { highestRole } from '../../lib/permissions';
import { setLocalString } from '../localJson';

export interface CloudAuthSlice {
  cloudEnabled: boolean;
  session: Session | null;
  sessionLoaded: boolean;
  myRole: AppRole | undefined;          // role in active household
  setSession: (session: Session | null, loaded?: boolean) => void;
  refreshHouseholds: () => Promise<void>;
}

export const createCloudAuthSlice: StateCreator<Store, [], [], CloudAuthSlice> = (set, get) => ({
  cloudEnabled: isCloudEnabled(),
  session: null,
  sessionLoaded: !isCloudEnabled(),     // local-only mode: instantly "loaded"
  myRole: undefined,

  // ── v4.1: AUTH + REALTIME ───────────────────────────────────
  setSession: (session, loaded = true) => {
    const wasSignedIn = Boolean(get().session);
    const isSignedIn = Boolean(session);
    set({ session, sessionLoaded: loaded });
    if (!wasSignedIn && isSignedIn) {
      // Just signed in — load households + data
      get().init();
    } else if (wasSignedIn && !isSignedIn) {
      // v6.4: Stash the last cloud household id BEFORE clearing state, so
      // the next sign-in can land back on it (its cache is still in
      // localStorage under legacy per-household keys). Without this we'd default to the
      // first household in the list, mis-key cache lookups, and the
      // HybridAdapter "transient empty" path would kick in needlessly.
      const cur = get().currentHouseholdId;
      if (cur && cur !== 'local') {
        try { setLocalString('last_cloud_hid', cur); } catch { /* noop */ }
      }
      // Just signed out — clear in-memory cloud state
      set({
        households: [], currentHouseholdId: 'local',
        transactions: [], budgets: [], goals: [], members: [],
        debts: [], assets: [], accounts: [], savedViews: [], myRole: undefined,
      });
    }
  },

  refreshHouseholds: async () => {
    const { adapter, currentHouseholdId } = get();
    const households = await adapter.listHouseholds();
    set({ households });
    // Compute my role in the active household by reading the memberships table
    // for the current user. The membership.role column carries the AppRole.
    if (supabase && get().session?.user) {
      try {
        const { data } = await supabase.from('memberships')
          .select('role')
          .eq('household_id', currentHouseholdId)
          .eq('user_id', get().session!.user.id)
          .maybeSingle();
        set({ myRole: (data?.role as AppRole) || undefined });
      } catch { /* offline — keep last known */ }
    } else {
      set({ myRole: 'owner' });   // local-only: you own everything
    }
    void highestRole; // suppress unused
  },
});
