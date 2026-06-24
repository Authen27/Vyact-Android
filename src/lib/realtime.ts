// Vyact — Supabase Realtime accelerator (v9.5.0).
//
// Near-real-time budget sync. A household-scoped subscription to `budgets` +
// `budget_allocations` row changes that fires a debounced budgets-only refetch.
// It LAYERS on the refresh-based sync model (R3): if the socket drops or never
// connects, budgets still converge on the next refresh (visibility/focus/online/
// poll) — so there is no regression, only an acceleration.
import { supabase } from './supabase';
import { expected } from './faults';

/**
 * Subscribe to budget changes for one household. `onChange` is debounced (~400ms,
 * to collapse the budget + multi-row allocation burst of a single save) and fires
 * whenever a `budgets` / `budget_allocations` row in this household is inserted,
 * updated, or deleted (a soft-delete is an UPDATE — the refetch's `deleted_at`
 * filter drops it). RLS authorizes the subscriber, so a member receives events
 * only for households they can read. Returns an unsubscribe function; no-op when
 * cloud is disabled or the household is local-only.
 */
export function subscribeBudgets(householdId: string, onChange: () => void): () => void {
  if (!supabase || !householdId || householdId === 'local') return () => { /* noop */ };
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const trigger = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { debounce = null; onChange(); }, 400);
  };
  const filter = `household_id=eq.${householdId}`;
  const channel = supabase
    .channel(`budgets:${householdId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'budgets', filter }, trigger)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_allocations', filter }, trigger)
    .subscribe();
  return () => {
    if (debounce) clearTimeout(debounce);
    try { supabase!.removeChannel(channel); } catch (e) { expected(e, 'realtime.subscribeBudgets:teardown'); }
  };
}
