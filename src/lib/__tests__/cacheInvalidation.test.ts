// CON-UNIT-099..104 + 128..130 — cache invalidation at the session boundary.
//
// 🔴 THESE TESTS RUN AGAINST REAL INDEXEDDB SEMANTICS (fake-indexeddb).
//
// The v10.20.7 version of this suite used a localStorage polyfill in the node
// environment. It passed — and the code it was pinning cleared NOTHING on a real
// browser, because `kvStore` uses IndexedDB as its primary backend and deletes
// the localStorage copy after a successful IDB write. The tests exercised the
// fallback path and reported a privacy guarantee that was not delivered.
//
// Importing 'fake-indexeddb/auto' installs a real IDB implementation on
// globalThis BEFORE kvStore is imported, so the code under test takes the same
// branch it takes in the browser.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  get length() { return this.m.size; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
}
const g = globalThis as unknown as { localStorage?: MemStorage };

const HID = '1c859cf7-6a30-4db5-b615-3ecf94c8a02c';
const ALICE = 'aaaaaaaa-0000-4000-8000-000000000001';
const BOB   = 'bbbbbbbb-0000-4000-8000-000000000002';

beforeEach(async () => {
  g.localStorage = new MemStorage();
  // Close the connection first — otherwise deleteDatabase blocks on it.
  const { _closeKvForTests } = await import('../kvStore');
  await _closeKvForTests();
  // Drop the IDB database so each test starts from a clean store.
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('vyact');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});
afterEach(() => { delete g.localStorage; });

/** Populate the device exactly as the app does — through kvStore, so the data
 *  lands in IndexedDB rather than in localStorage. */
async function seedDeviceFor(uid: string) {
  const { kvSet } = await import('../kvStore');
  const ls = (await import('../localStorageCompat')).default;
  const { CACHE_EPOCH } = await import('../cacheInvalidation');

  await kvSet(`${HID}_transactions`, [{ id: 't1', amount: 999 }]);
  await kvSet(`${HID}_accounts`, [{ id: 'a1' }]);
  await kvSet(`${HID}_recurring`, [{ id: 'bf-legacy' }]);
  await kvSet('households', [{ id: 'h1' }]);
  // The user's own unsynced work must survive; the outbox is a SEPARATE IDB
  // database (`vyact_outbox`), so it is structurally out of reach here.
  await kvSet('sync_queue', [{ op: 'upsert' }]);
  await kvSet('theme', 'dark');

  ls.setString(`cloud_synced_${HID}`, '1');
  ls.setString('cache_owner_uid', uid);
  ls.setString('cache_epoch', CACHE_EPOCH);
}

describe('cacheInvalidation · the cache that actually exists is the one cleared', () => {
  it('CON-UNIT-099 · a different user gets none of the previous user\'s IndexedDB data', async () => {
    const { kvGet } = await import('../kvStore');
    const { invalidateCacheForSession } = await import('../cacheInvalidation');
    await seedDeviceFor(ALICE);

    // Precondition: prove the seed really is in IDB, or the test proves nothing.
    expect(await kvGet(`${HID}_transactions`)).not.toBeNull();

    const out = await invalidateCacheForSession(BOB);
    expect(out.action).toBe('purged');
    expect(out.reason).toBe('different-user');

    // THE PRIVACY ASSERTION — and the one v10.20.7 could not actually make.
    expect(await kvGet(`${HID}_transactions`)).toBeNull();
    expect(await kvGet(`${HID}_accounts`)).toBeNull();
    expect(await kvGet('households')).toBeNull();
  });

  it('CON-UNIT-100 · the same user at the same epoch keeps their cache', async () => {
    const { kvGet } = await import('../kvStore');
    const { invalidateCacheForSession } = await import('../cacheInvalidation');
    await seedDeviceFor(ALICE);

    const out = await invalidateCacheForSession(ALICE);
    expect(out.action).toBe('kept');
    expect(await kvGet(`${HID}_transactions`)).not.toBeNull();
  });

  it('CON-UNIT-101 · a stale epoch purges even for the same user', async () => {
    const { kvGet } = await import('../kvStore');
    const ls = (await import('../localStorageCompat')).default;
    const { invalidateCacheForSession, CACHE_EPOCH } = await import('../cacheInvalidation');
    await seedDeviceFor(ALICE);
    ls.setString('cache_epoch', 'v10.20.7');   // the epoch whose purge did nothing

    const out = await invalidateCacheForSession(ALICE);
    expect(out.action).toBe('purged');
    expect(out.reason).toBe('stale-epoch');
    expect(await kvGet(`${HID}_recurring`)).toBeNull();
    expect(ls.readString('cache_epoch')).toBe(CACHE_EPOCH);
  });

  it('CON-UNIT-102 · unsynced work and device preferences survive the purge', async () => {
    const { kvGet } = await import('../kvStore');
    const { invalidateCacheForSession } = await import('../cacheInvalidation');
    await seedDeviceFor(ALICE);

    await invalidateCacheForSession(BOB);
    // Dropping these would be DATA LOSS — the opposite of the point.
    expect(await kvGet('sync_queue')).not.toBeNull();
    expect(await kvGet('theme')).toBe('dark');
  });

  it('CON-UNIT-103 · cache-describing sentinels are cleared with the data', async () => {
    const ls = (await import('../localStorageCompat')).default;
    const { purgeCachedCloudData } = await import('../cacheInvalidation');
    await seedDeviceFor(ALICE);

    await purgeCachedCloudData();
    // `cloud_synced_*` tells the adapter it has already seen a non-empty cloud
    // result. Left behind, it changes how the NEXT empty response is treated.
    expect(ls.readString(`cloud_synced_${HID}`)).toBeNull();
  });

  it('CON-UNIT-104 · signing out leaves no ledger on the device', async () => {
    const { kvGet } = await import('../kvStore');
    const ls = (await import('../localStorageCompat')).default;
    const { clearCacheOnSignOut } = await import('../cacheInvalidation');
    await seedDeviceFor(ALICE);

    await clearCacheOnSignOut();
    expect(await kvGet(`${HID}_transactions`)).toBeNull();
    expect(ls.readString('cache_owner_uid')).toBeNull();
    expect(await kvGet('sync_queue')).not.toBeNull();
  });
});

describe('cache generation · an in-flight read cannot repopulate a purged cache', () => {
  it('CON-UNIT-128 · the generation advances on every purge', async () => {
    const { cacheGeneration, isCacheGenerationCurrent } = await import('../kvStore');
    const { purgeCachedCloudData } = await import('../cacheInvalidation');
    await seedDeviceFor(ALICE);

    const before = cacheGeneration();
    expect(isCacheGenerationCurrent(before)).toBe(true);

    await purgeCachedCloudData();

    // A response captured before the purge is now recognisably stale. This is
    // what HybridAdapter.applyCloudList checks before writing cloud rows.
    expect(isCacheGenerationCurrent(before)).toBe(false);
    expect(isCacheGenerationCurrent(cacheGeneration())).toBe(true);
  });

  it('CON-UNIT-129 · a read that started before the purge is rejected after it', async () => {
    const { cacheGeneration, isCacheGenerationCurrent, kvSet, kvGet } = await import('../kvStore');
    const { purgeCachedCloudData } = await import('../cacheInvalidation');
    await seedDeviceFor(ALICE);

    // Simulate the real race: Alice's list() captures the generation, the
    // session changes and purges, then Alice's response resolves.
    const genAtRequestStart = cacheGeneration();
    await purgeCachedCloudData();

    if (isCacheGenerationCurrent(genAtRequestStart)) {
      await kvSet(`${HID}_transactions`, [{ id: 'alice-row' }]);
    }
    expect(await kvGet(`${HID}_transactions`), 'Alice\'s in-flight rows must not land').toBeNull();
  });

  it('CON-UNIT-130 · purging twice is safe and keeps advancing', async () => {
    const { cacheGeneration } = await import('../kvStore');
    const { purgeCachedCloudData } = await import('../cacheInvalidation');
    await seedDeviceFor(ALICE);

    const g0 = cacheGeneration();
    await purgeCachedCloudData();
    await purgeCachedCloudData();
    expect(cacheGeneration()).toBe(g0 + 2);
  });
});
