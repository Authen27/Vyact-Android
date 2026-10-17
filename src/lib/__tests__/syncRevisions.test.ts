// W3c (v10.67.0; audit FE-SYN-01, FE-SYN-03, INT-TXN-02, INT-TXN-08; owner decision D15 "fix both
// now") — the sync layer keeps the SERVER's revisions, flushes writes made while the session could not
// be read, and rolls back a write the database refuses for good. Real outbox and cache on IndexedDB
// (fake-indexeddb), mocked cloud.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HybridAdapter } from '../hybridAdapter';
import { ConcurrencyConflictError } from '../supabaseAdapter';
import { enqueueOp, IdbDriver, pendingCount, setDriverForTests } from '../sync/outbox';
import { isTerminalRejection } from '../sync/conflict';
import { invalidateCacheForSession, clearCacheOnSignOut, CACHE_EPOCH } from '../cacheInvalidation';
import { cacheGeneration } from '../kvStore';
import ls from '../localStorageCompat';

type Row = { id: string; name?: string; updated_at?: string };

// The dead-letter buckets and the cache-owner stamp live in localStorage, which node lacks.
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

let driver: IdbDriver;
let adapter: HybridAdapter;
let hid: string;
let cloudUpsert: ReturnType<typeof vi.fn>;
let cloudRemove: ReturnType<typeof vi.fn>;
let changes: number;

beforeEach(async () => {
  g.localStorage = new MemStorage();
  driver = new IdbDriver();
  await driver.transaction(rows => rows.clear());
  setDriverForTests(driver);
  vi.stubGlobal('navigator', { onLine: true });
  hid = crypto.randomUUID();
  adapter = new HybridAdapter({} as SupabaseClient);
  vi.spyOn(adapter.cloud, 'currentUserId').mockResolvedValue('alice');
  vi.spyOn(adapter as unknown as { scheduleFlush: () => void }, 'scheduleFlush').mockImplementation(() => {});
  cloudUpsert = vi.spyOn(adapter.cloud, 'upsert') as unknown as ReturnType<typeof vi.fn>;
  cloudRemove = vi.spyOn(adapter.cloud, 'remove') as unknown as ReturnType<typeof vi.fn>;
  changes = 0;
  adapter.onCacheChanged(() => { changes++; });
  adapter.clearConflicts();
  adapter.clearFailed?.();
  ls.setString('cache_owner_uid', 'alice');
  ls.setString('cache_epoch', CACHE_EPOCH);
});
afterEach(async () => { await driver.close(); setDriverForTests(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete g.localStorage; });

// flushQueue() returns at once while another flush (the one each write starts) is running; wait it out.
const idle = () => vi.waitFor(() => expect((adapter as unknown as { flushing: boolean }).flushing).toBe(false));
const settle = async () => { await idle(); await adapter.flushQueue(); await idle(); };
const cached = async (id: string) => (await adapter.cache.list<Row>('accounts', hid)).find(r => r.id === id);

describe('server revisions, never the device clock (FE-SYN-01, INT-TXN-02)', () => {
  it('CON-UNIT-W3-D15-001 · a row created here, then edited from the app’s own copy, is sent with the server’s revision — no false conflict', async () => {
    const id = crypto.randomUUID();
    cloudUpsert.mockResolvedValueOnce({ id, name: 'A', updated_at: 'rev-1' })
      .mockResolvedValueOnce({ id, name: 'B', updated_at: 'rev-2' });
    const local = await adapter.upsert<Row>('accounts', hid, { id, name: 'A' });
    expect(local.updated_at).toBeUndefined();                     // never the device clock
    await settle();
    expect((await cached(id))?.updated_at).toBe('rev-1');         // the server row folded back
    await adapter.upsert<Row>('accounts', hid, { ...local, name: 'B' }, local.updated_at);
    await settle();
    expect(cloudUpsert.mock.calls[1][3]).toBe('rev-1');
    expect(adapter.pendingConflictCount()).toBe(0);

    // A delta from the cloud keeps the server's stamp too (it used to be restamped on arrival).
    await (adapter as unknown as { applyCloudDelta: (...a: unknown[]) => Promise<void> })
      .applyCloudDelta('accounts', hid, { rows: [{ id, name: 'C', updated_at: 'rev-9' }], tombstones: [], maxUpdatedAt: 'rev-9' }, cacheGeneration());
    expect((await cached(id))?.updated_at).toBe('rev-9');
  });

  it('CON-UNIT-W3-D15-002 · two edits in a row from the same stale copy both land; another device’s edit is still a conflict', async () => {
    const id = crypto.randomUUID();
    await adapter.cache.put('accounts', hid, { id, name: 'Start', updated_at: 'rev-1' });
    cloudUpsert.mockResolvedValueOnce({ id, name: 'Once', updated_at: 'rev-2' })
      .mockResolvedValueOnce({ id, name: 'Twice', updated_at: 'rev-3' });
    const copy: Row = { id, name: 'Start', updated_at: 'rev-1' };   // the store's copy is not refreshed in between
    await adapter.upsert('accounts', hid, { ...copy, name: 'Once' }, copy.updated_at);
    await settle();
    await adapter.upsert('accounts', hid, { ...copy, name: 'Twice' }, copy.updated_at);
    await settle();
    expect(cloudUpsert.mock.calls.map(c => c[3])).toEqual(['rev-1', 'rev-2']);
    expect(adapter.pendingConflictCount()).toBe(0);

    // Someone else changed it since rev-3: the guarded update fails and it IS a conflict — kept on screen.
    cloudUpsert.mockRejectedValueOnce(new ConcurrencyConflictError('accounts', id, 'rev-3'));
    await adapter.upsert('accounts', hid, { ...copy, name: 'Mine' }, 'rev-3');
    await settle();
    expect(adapter.pendingConflictCount()).toBe(1);
    expect((await cached(id))?.name).toBe('Mine');
  });
});

describe('writes made while the session could not be read (FE-SYN-03)', () => {
  it('CON-UNIT-W3-D15-003 · a write queued with an unreadable session belongs to the cache owner and is sent', async () => {
    const id = crypto.randomUUID();
    vi.mocked(adapter.cloud.currentUserId).mockResolvedValue(null);   // token expired while offline
    vi.stubGlobal('navigator', { onLine: false });
    await adapter.upsert('accounts', hid, { id, name: 'Offline' });
    expect(await pendingCount('alice')).toBe(1);
    expect(await pendingCount(null)).toBe(0);
    vi.mocked(adapter.cloud.currentUserId).mockResolvedValue('alice');
    vi.stubGlobal('navigator', { onLine: true });
    cloudUpsert.mockResolvedValue({ id, name: 'Offline', updated_at: 'rev-1' });
    await settle();
    expect(cloudUpsert).toHaveBeenCalledTimes(1);
    expect(await pendingCount('alice')).toBe(0);
  });

  it('CON-UNIT-W3-D15-004 · ownerless writes go to their own user — never to the next person who signs in', async () => {
    await enqueueOp({ ts: 1, op: 'updateProfile', householdId: hid, payload: { name: 'Alice' } }, null);
    // Bob signs in on Alice's device: her ownerless write is hers, not his.
    await invalidateCacheForSession('bob');
    expect(await pendingCount('alice')).toBe(1);
    expect(await pendingCount('bob')).toBe(0);

    await enqueueOp({ ts: 2, op: 'updateProfile', householdId: hid, payload: { name: 'Bob' } }, null);
    await clearCacheOnSignOut();                                   // Bob signs out: it stays Bob's
    expect(await pendingCount('bob')).toBe(1);

    ls.setString('cache_owner_uid', 'carol'); ls.setString('cache_epoch', CACHE_EPOCH);
    await enqueueOp({ ts: 3, op: 'updateProfile', householdId: hid, payload: { name: 'Carol' } }, null);
    await invalidateCacheForSession('carol');                      // Carol returns: hers can go out
    expect(await pendingCount('carol')).toBe(1);
    expect(await pendingCount(null)).toBe(0);
  });
});

describe('a write the database refuses is rolled back, not retried (INT-TXN-08)', () => {
  it('CON-UNIT-W3-D15-005 · refused insert, update and remove: dead-lettered at once and the cache put back', async () => {
    // A new row the database refuses: it disappears from the cache.
    const created = crypto.randomUUID();
    cloudUpsert.mockRejectedValueOnce({ code: '23514', message: 'violates check constraint' });
    await adapter.upsert('accounts', hid, { id: created, name: 'Bad' });
    await settle();
    expect(cloudUpsert).toHaveBeenCalledTimes(1);                  // no retry
    expect(await cached(created)).toBeUndefined();
    expect(adapter.pendingFailedCount?.()).toBe(1);
    expect(changes).toBeGreaterThan(0);                            // the store is told to re-read

    // An edit refused by a foreign key: the row is back to what it was.
    const edited = crypto.randomUUID();
    await adapter.cache.put('accounts', hid, { id: edited, name: 'Original', updated_at: 'rev-1' });
    cloudUpsert.mockRejectedValueOnce({ code: '23503', message: 'violates foreign key' });
    await adapter.upsert('accounts', hid, { id: edited, name: 'Broken' }, 'rev-1');
    await settle();
    expect(await cached(edited)).toEqual({ id: edited, name: 'Original', updated_at: 'rev-1' });

    // A delete the person may not make (a viewer): the row comes back.
    const removed = crypto.randomUUID();
    await adapter.cache.put('accounts', hid, { id: removed, name: 'Keep', updated_at: 'rev-1' });
    cloudRemove.mockRejectedValueOnce({ code: '42501', message: 'permission denied' });
    await adapter.remove('accounts', hid, removed);
    await settle();
    expect(await cached(removed)).toEqual({ id: removed, name: 'Keep', updated_at: 'rev-1' });
    expect(await pendingCount('alice')).toBe(0);
  });

  it('CON-UNIT-W3-D15-006 · later writes to a refused row go with it; a network failure is still retried', async () => {
    const id = crypto.randomUUID();
    await adapter.cache.put('accounts', hid, { id, name: 'Original', updated_at: 'rev-1' });
    vi.stubGlobal('navigator', { onLine: false });
    await adapter.upsert('accounts', hid, { id, name: 'Edit one' }, 'rev-1');
    await adapter.upsert('accounts', hid, { id, name: 'Edit two' }, 'rev-1');
    vi.stubGlobal('navigator', { onLine: true });
    cloudUpsert.mockRejectedValue({ code: 'P0001', message: 'HOUSEHOLD_FULL' });
    await settle();
    expect(cloudUpsert).toHaveBeenCalledTimes(1);
    expect(adapter.pendingFailedCount?.()).toBe(2);
    expect(await cached(id)).toEqual({ id, name: 'Original', updated_at: 'rev-1' });

    const other = crypto.randomUUID();
    cloudUpsert.mockReset();
    cloudUpsert.mockRejectedValue(new TypeError('Failed to fetch'));
    await adapter.upsert('accounts', hid, { id: other, name: 'Later' });
    await settle();
    expect(await pendingCount('alice')).toBe(1);                   // queued for another try
    expect((await cached(other))?.name).toBe('Later');             // and still shown
  });

  it('CON-UNIT-W3-D15-007 · what counts as refused: integrity, data, permission and trigger errors; not network, JWT or schema lag', () => {
    for (const code of ['23514', '23503', '23505', '23502', '22P02', '22023', '42501', 'P0001']) {
      expect(isTerminalRejection({ code }), code).toBe(true);
    }
    for (const err of [new TypeError('Failed to fetch'), { code: '' }, { code: 'PGRST301' }, { code: 'PGRST204' },
      { code: '40001' }, { code: '57014' }, { code: '08006' }, new Error('timeout')]) {
      expect(isTerminalRejection(err), JSON.stringify(err)).toBe(false);
    }
  });
});

describe('dismissing a conflict discards the unsaved edit (W3c)', () => {
  it('CON-UNIT-W3-D15-008 · Dismiss re-reads the rows from the cloud, so the screen shows the server’s version', async () => {
    const id = crypto.randomUUID();
    await adapter.cache.put('accounts', hid, { id, name: 'Start', updated_at: 'rev-1' });
    cloudUpsert.mockRejectedValueOnce(new ConcurrencyConflictError('accounts', id, 'rev-1'));
    await adapter.upsert('accounts', hid, { id, name: 'Mine' }, 'rev-1');
    await settle();
    expect((await cached(id))?.name).toBe('Mine');
    vi.spyOn(adapter.cloud, 'list').mockResolvedValue([{ id, name: 'Theirs', updated_at: 'rev-5' }] as never);
    changes = 0;
    await adapter.dismissConflicts();
    expect(adapter.pendingConflictCount()).toBe(0);
    expect(await cached(id)).toEqual({ id, name: 'Theirs', updated_at: 'rev-5' });
    expect(changes).toBe(1);
  });
});
