// Vyact — local cache invalidation at the session boundary (v10.20.7).
//
// WHY THIS EXISTS
// The local store is a CACHE of cloud state, but nothing ever invalidated it.
// Two consequences, both of which reached production:
//
//   1. PRIVACY. On a shared device, signing in as a second user left the first
//      user's cached households, transactions and accounts in localStorage. The
//      adapter reads the cache before the network answers, so the new user could
//      be shown the previous user's data.
//
//   2. GHOST ROWS. Rows that only ever existed locally — because their cloud
//      write had failed — were re-uploaded on the next sync and reappeared after
//      being deleted. `recurring_schedules` held ZERO rows in production for
//      months while devices rendered a full list and generated transactions from
//      it every week.
//
// THE RULE. The cache is dropped when it cannot be trusted:
//   • the signed-in user is not the user the cache was built for, or
//   • the cache was written by an older epoch (a deliberate, shipped reset).
// A routine re-login by the same user KEEPS its cache, so offline work and cold
// starts are unaffected.
//
// WHAT IS NEVER DROPPED. The pending write queue (`sync_queue`) — those are the
// user's own unsynced changes and dropping them would be data loss, which is the
// opposite of the point. They flush against the cloud after the purge.
import ls from './localStorageCompat';
import { kvPurgeWhere } from './kvStore';

/**
 * Bump to force a one-time purge on every device at next sign-in.
 *
 * v10.20.7 — the recurring reset. Devices carry schedules that never reached the
 * cloud (non-UUID ids, rejected with 22P02) and would otherwise be re-uploaded
 * by the next sync, undoing the server-side cleanup.
 *
 * v10.23.0 — the Accounts R1 reset. The server tombstoned duplicate Cash in
 * Hand rows and moved every account onto its household currency; a device
 * still caching the old rows would re-upload the duplicates (and their USD
 * currency) on the next sync.
 */
export const CACHE_EPOCH = 'v10.26.0';

const OWNER_KEY = 'cache_owner_uid';
const EPOCH_KEY = 'cache_epoch';

/** Entity caches — every one is re-fetchable from the cloud. */
const CACHED_SUFFIXES = [
  'transactions', 'budgets', 'budget_allocations', 'goals', 'members', 'debts',
  'assets', 'accounts', 'savedViews', 'recurring', 'notifications', 'rates',
  'profile', 'households', 'shared_splits', 'chat_history', 'budget_periods',
] as const;

/**
 * Per-household flags that describe the CACHE, not the user's intent. Leaving
 * them behind after a purge is what makes a reset fail: `recurring_backfilled_*`
 * suppresses a migration that should re-evaluate, and `cloud_synced_*` tells the
 * adapter it has already seen a non-empty cloud result.
 */
const SENTINEL_PREFIXES = [
  'cloud_synced_', 'recurring_backfilled_', 'recurring_rekeyed_', 'last_delta_',
  'cursor_', 'chat_history_',
];

/** Keys that must SURVIVE — the user's unsynced work and device preferences.
 *  `sync_queue` is the LEGACY localStorage queue key: the durable outbox moved
 *  to IndexedDB (audit F6) and is intentionally NOT purged — its ops are
 *  owner-stamped, so a different user's session will not flush them, and
 *  dropping them would be the data loss this module exists to prevent. */
const PRESERVE = new Set(['sync_queue', 'sync_dead_letter', 'theme', 'active_profile',
  'profiles_list', 'last_cloud_hid', 'migrated_v1']);

function isPurgeable(bareKey: string): boolean {
  if (PRESERVE.has(bareKey)) return false;
  if (SENTINEL_PREFIXES.some(p => bareKey.startsWith(p))) return true;
  // Household-scoped entity caches are `<householdId>_<suffix>`; anon ones are
  // the bare suffix.
  return CACHED_SUFFIXES.some(s => bareKey === s || bareKey.endsWith(`_${s}`));
}

/**
 * Drop every cached cloud entity and cache-describing sentinel.
 *
 * Returns the number of keys removed. Never throws — a browser with storage
 * disabled must still sign in.
 */
export async function purgeCachedCloudData(): Promise<number> {
  // 🔴 THE ENTITY CACHE IS IN INDEXEDDB, NOT localStorage.
  //
  // v10.20.7 shipped this function sweeping localStorage only. `kvStore` uses
  // IndexedDB as its primary backend and DELETES the localStorage copy after a
  // successful IDB write, so on a normal browser this cleared nothing — the
  // privacy guarantee was not delivered. Its unit tests passed because vitest
  // runs in node with a localStorage polyfill and no IndexedDB, so they
  // exercised the fallback path and never the real one. They now run against
  // fake-indexeddb.
  //
  // kvPurgeWhere sweeps every backend and bumps the cache generation, which is
  // what stops an in-flight cloud read repopulating what we just cleared.
  let removed = 0;
  try {
    removed = await kvPurgeWhere(isPurgeable);
  } catch { /* storage unavailable — nothing cached, nothing to purge */ }

  // Sweep raw localStorage too. kvStore only knows keys it wrote; the store and
  // its slices also persist `vt_*` values directly through localJson (sentinels
  // like cloud_synced_*, and pre-kvStore leftovers).
  try {
    const all: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) all.push(k);
    }
    for (const raw of all) {
      const bare = raw.startsWith('vt_') || raw.startsWith('ff_') ? raw.slice(3) : null;
      if (bare === null || !isPurgeable(bare)) continue;
      try { localStorage.removeItem(raw); removed++; } catch { /* keep going */ }
    }
  } catch { /* storage unavailable */ }

  return removed;
}

export type InvalidationOutcome =
  | { action: 'purged'; reason: 'different-user' | 'stale-epoch'; keysRemoved: number }
  | { action: 'kept'; reason: 'same-user' };

/**
 * Called once per established session. Decides whether the cache on this device
 * may be trusted for `userId`, and clears it if not.
 *
 * Pure decision + effect, no store access, so it is directly testable.
 */
export async function invalidateCacheForSession(userId: string): Promise<InvalidationOutcome> {
  let owner: string | null = null;
  let epoch: string | null = null;
  try {
    owner = ls.readString(OWNER_KEY);
    epoch = ls.readString(EPOCH_KEY);
  } catch { /* treated as absent → purge */ }

  const stamp = () => {
    try { ls.setString(OWNER_KEY, userId); ls.setString(EPOCH_KEY, CACHE_EPOCH); }
    catch { /* noop */ }
  };

  // A first-ever sign-in on this device has no owner recorded. Purge anyway: the
  // device may hold anonymous local-only data, or a cache from before this stamp
  // existed — which is precisely the untrusted case.
  if (owner !== userId) {
    const keysRemoved = await purgeCachedCloudData();
    stamp();
    return { action: 'purged', reason: 'different-user', keysRemoved };
  }
  if (epoch !== CACHE_EPOCH) {
    const keysRemoved = await purgeCachedCloudData();
    stamp();
    return { action: 'purged', reason: 'stale-epoch', keysRemoved };
  }
  return { action: 'kept', reason: 'same-user' };
}

/**
 * Called on sign-out. Leaving a signed-out device holding the last user's
 * ledger is the same privacy problem as (1) above, just deferred.
 */
export async function clearCacheOnSignOut(): Promise<number> {
  const removed = await purgeCachedCloudData();
  try { ls.removeBoth(OWNER_KEY); } catch { /* noop */ }
  return removed;
}
