// Vyact — sync coordination + UI chrome slice (TD-25 increment 7).
//
// R3/R4 refresh-based sync surface (manualRefresh full-sweep, subscribeRealtime
// convergence triggers, lastSyncedAt) plus the small UI state the store owns
// (theme, loading, toasts). Moved verbatim; reads the store via get().
import type { StateCreator } from 'zustand';
import type { Theme } from '../../types';
import type { Store } from '../../store';
import { readLocalString, setLocalString } from '../localJson';
import { subscribeBudgets } from '../../lib/realtime';

export interface ToastMsg { id: string; text: string; type: 'success' | 'error' | 'info' | 'warning'; }

export interface SyncSlice {
  theme: Theme;
  loading: boolean;
  toasts: ToastMsg[];
  // R4 (sync fix) — refresh-based sync surface.
  lastSyncedAt: number | null;        // epoch ms of the last successful pull
  manualRefresh: () => Promise<void>; // full-sweep resync behind the Refresh button
  subscribeRealtime: (householdId: string) => () => void;
  setTheme: (t: Theme) => void;
  toast: (text: string, type?: ToastMsg['type']) => void;
  dismissToast: (id: string) => void;
}

export const createSyncSlice: StateCreator<Store, [], [], SyncSlice> = (set, get) => ({
  theme: (readLocalString('theme', 'warm') as Theme) || 'warm',
  loading: true,
  toasts: [],
  lastSyncedAt: null,   // R4 (sync fix) — set by refresh() on success

  // R4 (sync fix) — manual full-sweep resync behind the Refresh control.
  // Clears the per-device delta cursors + synced sentinels (forceFullResync)
  // so the next refresh does a FULL pull of every entity — this is also the
  // R1 safety net that catches any tombstone a delta window might have missed
  // (a deleted row whose timestamp somehow fell outside the cursor). Falls back
  // to a plain refresh in local-only mode (no forceFullResync on the adapter).
  manualRefresh: async () => {
    const { adapter, currentHouseholdId } = get();
    const fullSweep = (adapter as { forceFullResync?: (hid: string) => void }).forceFullResync;
    if (typeof fullSweep === 'function' && currentHouseholdId) {
      try { fullSweep.call(adapter, currentHouseholdId); } catch { /* noop */ }
    }
    await get().refresh();
  },

  // R3 (sync fix): refresh-based sync, not real-time.
  // Per the product decision, devices converge ON REFRESH rather than via a
  // live socket. The previous `postgres_changes` subscription was also
  // misconfigured (no `table`, one household filter for every table — it could
  // not reliably deliver). We retire it and instead pull whenever the app is
  // likely stale: the tab becomes visible, the window regains focus, the device
  // comes back online, plus a gentle foreground poll. A trailing debounce
  // collapses bursts and avoids overlapping reads clobbering each other.
  subscribeRealtime: (householdId) => {
    if (typeof window === 'undefined') return () => {/* noop */};
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => { debounce = null; void get().refresh(); }, 400);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') trigger(); };
    // Foreground-only poll (90s) so a long-open tab still converges without a
    // manual action; skipped while hidden to avoid waking a backgrounded tab.
    const poll = setInterval(() => { if (document.visibilityState === 'visible') trigger(); }, 90_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', trigger);
    window.addEventListener('online', trigger);
    // v9.5.0 — near-real-time budgets: a household-scoped Supabase Realtime socket
    // that refetches ONLY budgets on any change. This is an accelerator on top of
    // the refresh triggers above — if the socket drops, the triggers still converge.
    const unsubBudgets = get().cloudEnabled
      ? subscribeBudgets(householdId, () => { void get().refetchBudgets(); })
      : () => { /* local-only: no socket */ };
    return () => {
      if (debounce) clearTimeout(debounce);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', trigger);
      window.removeEventListener('online', trigger);
      unsubBudgets();
    };
  },

  setTheme: (theme) => {
    setLocalString('theme', theme);
    set({ theme });
    const root = document.documentElement;
    if (theme === 'system') {
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', dark);
      root.dataset.theme = dark ? 'dark' : 'warm';
    } else {
      root.classList.toggle('dark', theme === 'dark');
      root.dataset.theme = theme;
    }
  },

  toast: (text, type = 'success') => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    set(s => ({ toasts: [...s.toasts, { id, text, type }] }));
    setTimeout(() => get().dismissToast(id), 3200);
  },
  dismissToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
});
