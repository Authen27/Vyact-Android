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
import { ENTITIES } from './dataAdapter';
import { adoptOwnerless } from './sync/outbox';
import { adoptOwnerlessDeadLetters } from './sync/deadLetter';
import { expected, unexpected } from './faults';

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

/**
 * Entity caches (`<householdId>_<suffix>`, or the bare suffix for the anon household) — every one is
 * re-fetchable from the cloud. v10.110.0 (F1a, audit FE-SYN-04): the entities come from the adapter's
 * own list, so a new entity is purged without anyone remembering to add it here; this list used to say
 * 'budget_allocations' (kept below for older devices) and miss the net-worth history.
 * syncDevice.test.ts (F1A-001) fails when the adapter writes a cache key that nothing here purges.
 */
const CACHED_SUFFIXES: readonly string[] = [
  ...ENTITIES,
  'budget_allocations', 'net_worth_snapshots', 'rates', 'profile', 'households',
  'shared_splits', 'chat_history', 'budget_periods', 'notifications',
];

/**
 * Per-household keys named `<prefix><householdId>`. Most are flags that describe the CACHE, not the
 * user's intent: leaving them behind after a purge is what makes a reset fail (`recurring_backfilled_*`
 * suppresses a migration that should re-evaluate, and `cloud_synced_*` tells the adapter it has already
 * seen a non-empty cloud result). `notifications_` is the bell's copy (amounts and payees, F1a).
 */
const SENTINEL_PREFIXES = [
  'cloud_synced_', 'recurring_backfilled_', 'recurring_rekeyed_', 'last_delta_',
  'cursor_', 'chat_history_', 'notifications_',
];

/**
 * F1a (FE-SYN-04) — caches that go when the PERSON changes (sign-out, another user signing in), but not
 * on a same-user epoch reset. The onboarding copy holds the take-home pay, cash and debts typed at setup;
 * it is the household's (`households.onboarding`), refilled at the next sign-in. On an epoch reset the
 * same person may be offline, and an empty copy would send them back through onboarding, which writes
 * an opening balance, a paycheck and a budget again.
 */
const PERSON_PREFIXES = ['onboarding_'];

/** Keys that must SURVIVE — the user's unsynced work and device preferences.
 *  `sync_queue` is the LEGACY localStorage queue key: the durable outbox moved
 *  to IndexedDB (audit F6) and is intentionally NOT purged — its ops are
 *  owner-stamped, so a different user's session will not flush them, and
 *  dropping them would be the data loss this module exists to prevent.
 *  The set-aside writes (`sync_conflicts`, `sync_failed`) stay for the same reason (F1a, owner): they
 *  are owner-stamped too, and only their owner sees, retries or dismisses them. */
const PRESERVE = new Set(['sync_queue', 'sync_conflicts', 'sync_failed', 'theme', 'active_profile',
  'profiles_list', 'last_cloud_hid', 'migrated_v1']);

/** What a purge clears: the cloud caches (`cache`), or those and the person's own copies (`person`). */
export type PurgeScope = 'cache' | 'person';

export function isPurgeable(bareKey: string, scope: PurgeScope = 'cache'): boolean {
  if (PRESERVE.has(bareKey)) return false;
  if (SENTINEL_PREFIXES.some(p => bareKey.startsWith(p))) return true;
  if (scope === 'person' && PERSON_PREFIXES.some(p => bareKey.startsWith(p))) return true;
  // Household-scoped entity caches are `<householdId>_<suffix>`; anon ones are
  // the bare suffix.
  return CACHED_SUFFIXES.some(s => bareKey === s || bareKey.endsWith(`_${s}`));
}

/**
 * Drop every cached cloud entity and cache-describing sentinel (and, for `person`, the person's own
 * copies).
 *
 * Returns the number of keys removed. Never throws — a browser with storage
 * disabled must still sign in.
 */
export async function purgeCachedCloudData(scope: PurgeScope = 'cache'): Promise<number> {
  const purgeable = (key: string) => isPurgeable(key, scope);
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
    removed = await kvPurgeWhere(purgeable);
  } catch (e) { unexpected(e, 'cacheInvalidation.purge:kv'); }

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
      if (bare === null || !purgeable(bare)) continue;
      try { localStorage.removeItem(raw); removed++; } catch { /* fault-ok: one key that cannot be removed does not stop the rest */ }
    }
  } catch { /* fault-ok: localStorage unavailable: nothing was kept there to purge */ }

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
/** W3c — the user this device's cache belongs to (stamped at sign-in), or null. */
export function cacheOwnerUid(): string | null {
  try { return ls.readString(OWNER_KEY) || null; } catch { return null; }
}

/**
 * W3c (audit FE-SYN-03) — writes queued while the session could not be read carry no owner and are
 * never flushed. They are given to the user they belong to, at the only two points where that is
 * certain: the cache owner signing back in, and the cache owner leaving (sign-out, or another user
 * signing in on this device). Never at flush time — that would let the next user upload them.
 */
async function adoptFor(ownerUid: string | null): Promise<void> {
  if (!ownerUid) return;
  try { await adoptOwnerless(ownerUid); } catch (e) { expected(e, 'cache:adoptOwnerless'); }
  // F1a (FE-SYN-05) — set-aside writes from before they carried an owner go the same way.
  adoptOwnerlessDeadLetters(ownerUid);
}

export async function invalidateCacheForSession(userId: string): Promise<InvalidationOutcome> {
  let owner: string | null = null;
  let epoch: string | null = null;
  try {
    owner = ls.readString(OWNER_KEY);
    epoch = ls.readString(EPOCH_KEY);
  } catch { /* fault-ok: unreadable counts as absent, which purges: the safe side */ }

  const stamp = () => {
    try { ls.setString(OWNER_KEY, userId); ls.setString(EPOCH_KEY, CACHE_EPOCH); }
    catch { /* fault-ok: an unwritten stamp purges again at the next sign-in: the safe side */ }
  };

  // A first-ever sign-in on this device has no owner recorded. Purge anyway: the
  // device may hold anonymous local-only data, or a cache from before this stamp
  // existed — which is precisely the untrusted case.
  if (owner !== userId) {
    await adoptFor(owner);   // the previous user's ownerless writes stay theirs
    const keysRemoved = await purgeCachedCloudData('person');
    stamp();
    return { action: 'purged', reason: 'different-user', keysRemoved };
  }
  await adoptFor(userId);    // the same user is back: their ownerless writes can go out
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
  await adoptFor(cacheOwnerUid());   // before the owner stamp goes: they stay the outgoing user's
  const removed = await purgeCachedCloudData('person');
  try { ls.removeBoth(OWNER_KEY); } catch { /* fault-ok: an owner stamp left behind only makes the next sign-in compare against it */ }
  return removed;
}
