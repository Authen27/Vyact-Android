// F1B-001..011 — v10.111.0 (F1b; audit FE-SYN-06, INT-TXN-10, FE-SYN-07, DB-OPS-10; owner decisions
// 18 Oct 2026: "row-level merge" and "a 2-minute overlap and every page").
// A save shows at once and stays on screen until its write lands: a refresh keeps the rows this device
// changed while it was in flight, a save lands in the current list, a cloud pull leaves a row with a
// queued write as the device has it, and two cache writers never drop each other's rows. A delta pull
// re-reads 2 minutes behind its cursor (a late commit is fetched) and every page before it counts as fresh.
// Real cache and outbox on IndexedDB (fake-indexeddb), mocked cloud.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('../supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../supabase')>()), isCloudEnabled: () => false, supabase: null,
}));

import { LocalStorageAdapter, type Entity } from '../dataAdapter';
import { HybridAdapter } from '../hybridAdapter';
import { ConcurrencyConflictError } from '../supabaseAdapter';
import { IdbDriver, setDriverForTests } from '../sync/outbox';
import { CACHE_EPOCH } from '../cacheInvalidation';
import { cacheGeneration } from '../kvStore';
import ls from '../localStorageCompat';
import { cursorAfter, keepLocalChanges, mergeCloudDelta, overlapStart, overlayQueued } from '../rowMerge';
import { useStore } from '../../store';
import type { Transaction } from '../../types';

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
beforeEach(() => { g.localStorage = new MemStorage(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete g.localStorage; });

const gate = () => { let open!: () => void; const wait = new Promise<void>(resolve => { open = resolve; }); return { wait, open }; };
type Row = { id: string; name?: string; updated_at?: string };

describe('the merge rules (pure)', () => {
  it('F1B-001 · keepLocalChanges, overlayQueued, mergeCloudDelta, overlapStart and cursorAfter', () => {
    const a = { id: 'a', v: 1 }, b = { id: 'b', v: 1 }, c = { id: 'c', v: 1 };
    const before = [a, b, c];
    // Nothing changed here meanwhile: the refresh wins outright (same list).
    const fresh = [{ id: 'a', v: 2 }, { id: 'b', v: 2 }, { id: 'c', v: 2 }];
    expect(keepLocalChanges(fresh, before, before)).toBe(fresh);
    // Edited a, deleted b, added d here: those keep the screen's state; c takes the refresh, in its order.
    const a2 = { id: 'a', v: 9 }, d = { id: 'd', v: 1 };
    expect(keepLocalChanges(fresh, before, [a2, c, d])).toEqual([a2, { id: 'c', v: 2 }, d]);

    const queued = new Map<string, 'upsert' | 'remove'>([['a', 'upsert'], ['b', 'remove'], ['n', 'upsert']]);
    const cached = [{ id: 'a', v: 'mine' }, { id: 'n', v: 'new here' }];
    expect(overlayQueued([{ id: 'a', v: 'cloud' }, { id: 'b', v: 'cloud' }, { id: 'c', v: 'cloud' }], cached, queued))
      .toEqual([{ id: 'a', v: 'mine' }, { id: 'c', v: 'cloud' }, { id: 'n', v: 'new here' }]);
    expect(overlayQueued([{ id: 'c', v: 1 }], [], new Map())).toEqual([{ id: 'c', v: 1 }]);

    const copy = [{ id: 'a', updated_at: 'r1' }, { id: 'b', updated_at: 'r1' }];
    expect(mergeCloudDelta(copy, [{ id: 'a', updated_at: 'r1' }], [], new Map())).toBe(copy);   // re-read, same revision
    expect(mergeCloudDelta(copy, [{ id: 'a', updated_at: 'r2' }, { id: 'z', updated_at: 'r1' }], ['b'], new Map()))
      .toEqual([{ id: 'a', updated_at: 'r2' }, { id: 'z', updated_at: 'r1' }]);
    expect(mergeCloudDelta(copy, [{ id: 'a', updated_at: 'r2' }], ['b'], new Map([['a', 'upsert'], ['b', 'remove']]))).toBe(copy);

    expect(overlapStart('2026-10-18T09:00:10.000Z|A', 120_000)).toBe('2026-10-18T08:58:10.000Z');
    expect(overlapStart('2026-10-18T09:00:10.123456+00:00', 120_000)).toBe('2026-10-18T08:58:10.123Z');
    expect(cursorAfter('2026-10-18T09:00:20+00:00|b', '2026-10-18T09:00:10+00:00|z')).toBe(true);
    expect(cursorAfter('2026-10-18T09:00:10.1234+00:00|a', '2026-10-18T09:00:10.12345+00:00|a')).toBe(false);
    expect(cursorAfter('2026-10-18T09:00:10+00:00|b', '2026-10-18T09:00:10+00:00|a')).toBe(true);
  });
});

// ── The store (FE-SYN-06) ────────────────────────────────────────────────────────────────────────
class GatedAdapter extends LocalStorageAdapter {
  profileGate: Promise<void> | null = null;
  upsertGate: Promise<void> | null = null;
  listsRead = 0;
  async list<T = unknown>(entity: Entity, householdId: string): Promise<T[]> {
    const rows = await super.list<T>(entity, householdId);
    this.listsRead++;
    return rows;
  }
  async getProfile(householdId: string) {
    if (this.profileGate) await this.profileGate;   // a refresh's cloud read of the profile
    return super.getProfile(householdId);
  }
  async upsert<T extends { id?: string } = { id?: string }>(entity: Entity, householdId: string, record: T, expected?: string) {
    if (this.upsertGate) await this.upsertGate;     // a save still on its way to the device's copy
    return super.upsert(entity, householdId, record, expected);
  }
}
const txn = (id: string, amount: number) => ({ id, type: 'expense', amount, currency: 'USD', date: '2026-10-10',
  description: id, category: 'groceries', accountId: 'bank' }) as Transaction;
const amounts = () => useStore.getState().transactions.map(t => [t.id, t.amount]);

async function storeWith(adapter: GatedAdapter): Promise<string> {
  const hid = crypto.randomUUID();
  await adapter.replaceAll('accounts', hid, [{ id: 'bank', kind: 'bank', name: 'Bank', currency: 'USD', openingBalance: 0 }]);
  await adapter.replaceAll('transactions', hid, [txn('a', 10), txn('b', 20), txn('c', 30)]);
  useStore.setState({ ...useStore.getInitialState(), adapter, currentHouseholdId: hid, cloudEnabled: false, myRole: 'owner',
    refreshNotifications: vi.fn().mockResolvedValue(undefined), toast: vi.fn() });
  await useStore.getState().refresh();
  return hid;
}

describe('a save made during a refresh stays on screen (FE-SYN-06)', () => {
  it('F1B-002 · a refresh that read before a save, an edit and a delete keeps all three; other rows take the refresh', async () => {
    const adapter = new GatedAdapter();
    const hid = await storeWith(adapter);
    expect(amounts()).toEqual([['a', 10], ['b', 20], ['c', 30]]);
    await adapter.put('transactions', hid, txn('c', 33));    // the cloud brought c's new amount to the copy

    const profile = gate();
    adapter.profileGate = profile.wait;
    adapter.listsRead = 0;
    const landing = useStore.getState().refresh();
    await vi.waitFor(() => expect(adapter.listsRead).toBe(10));   // every list is read; the profile waits
    adapter.profileGate = null;

    await useStore.getState().upsertTransaction(txn('t', 40));                                   // a save
    await useStore.getState().upsertTransaction({ ...useStore.getState().transactions[0], amount: 11 });   // an edit
    await useStore.getState().removeTransaction('b');                                                // a delete
    profile.open();
    await landing;
    // Before F1b the refresh put back [a 10, b 20, c 33]: the save gone, the edit undone, the delete back.
    expect(amounts()).toEqual([['a', 11], ['c', 33], ['t', 40]]);
  });

  it('F1B-003 · a save lands in the current list: a refresh that landed while it was saving is not undone', async () => {
    const adapter = new GatedAdapter();
    const hid = await storeWith(adapter);
    await adapter.put('transactions', hid, txn('c', 33));
    const write = gate();
    adapter.upsertGate = write.wait;
    const saving = useStore.getState().upsertTransaction(txn('t', 40));
    await useStore.getState().refresh();                          // lands while the save waits
    expect(amounts()).toEqual([['a', 10], ['b', 20], ['c', 33]]);
    adapter.upsertGate = null;
    write.open();
    await saving;
    // Before F1b the save wrote back the list it read first: c went back to 30.
    expect(amounts()).toEqual([['a', 10], ['b', 20], ['c', 33], ['t', 40]]);
  });
});

// ── The cache (INT-TXN-10, FE-SYN-06) and the delta pull (FE-SYN-07, DB-OPS-10) ───────────────────
let driver: IdbDriver;
let adapter: HybridAdapter;
let hid: string;
let cloudUpsert: ReturnType<typeof vi.fn>;

async function setUpAdapter(): Promise<void> {
  driver = new IdbDriver();
  await driver.transaction(rows => rows.clear());
  setDriverForTests(driver);
  vi.stubGlobal('navigator', { onLine: true });
  hid = crypto.randomUUID();
  adapter = new HybridAdapter({} as SupabaseClient);
  vi.spyOn(adapter.cloud, 'currentUserId').mockResolvedValue('alice');
  vi.spyOn(adapter as unknown as { scheduleFlush: () => void }, 'scheduleFlush').mockImplementation(() => {});
  cloudUpsert = vi.spyOn(adapter.cloud, 'upsert') as unknown as ReturnType<typeof vi.fn>;
  ls.setString('cache_owner_uid', 'alice');
  ls.setString('cache_epoch', CACHE_EPOCH);
}
async function tearDownAdapter(): Promise<void> { await driver.close(); setDriverForTests(null); }
const idle = () => vi.waitFor(() => expect((adapter as unknown as { flushing: boolean }).flushing).toBe(false));
const settle = async () => { await idle(); await adapter.flushQueue(); await idle(); };
const cachedRows = (entity: Entity = 'accounts') => adapter.cache.list<Row>(entity, hid);
const cached = async (id: string) => (await cachedRows()).find(r => r.id === id);
const internals = () => adapter as unknown as {
  applyCloudDelta: (...args: unknown[]) => Promise<void>;
  applyCloudList: (...args: unknown[]) => Promise<void>;
  cloudAppliedAt: Map<string, number>;
};
const applyDelta = (rows: Row[], tombstones: string[] = []) =>
  internals().applyCloudDelta('accounts', hid, { rows, tombstones, maxUpdatedAt: null }, cacheGeneration());
const applyList = async (rows: Row[]) =>
  internals().applyCloudList('accounts', hid, await cachedRows(), rows, cacheGeneration());
const at = (hhmmss: string) => `2026-10-18T${hhmmss}.000Z`;

describe('a cloud pull never replaces a row with a queued write (INT-TXN-10)', () => {
  beforeEach(setUpAdapter);
  afterEach(tearDownAdapter);

  it('F1B-004 · a queued edit survives a delta pull; once it lands, the server\'s row replaces it', async () => {
    const id = crypto.randomUUID();
    await adapter.cache.put('accounts', hid, { id, name: 'Start', updated_at: at('09:00:00') });
    vi.stubGlobal('navigator', { onLine: false });
    await adapter.upsert<Row>('accounts', hid, { id, name: 'Mine' }, at('09:00:00'));
    await applyDelta([{ id, name: 'Theirs', updated_at: at('09:05:00') }]);
    expect((await cached(id))?.name).toBe('Mine');                  // it used to revert to 'Theirs'

    vi.stubGlobal('navigator', { onLine: true });
    cloudUpsert.mockResolvedValue({ id, name: 'Mine', updated_at: at('09:06:00') });
    await settle();
    expect(await cached(id)).toEqual({ id, name: 'Mine', updated_at: at('09:06:00') });
    await applyDelta([{ id, name: 'Theirs, later', updated_at: at('09:07:00') }]);
    expect((await cached(id))?.name).toBe('Theirs, later');         // nothing queued now: the cloud's
  });

  it('F1B-005 · a row created offline survives a full pull, and a queued delete never comes back', async () => {
    const made = crypto.randomUUID(), gone = crypto.randomUUID(), other = crypto.randomUUID();
    await adapter.cache.put('accounts', hid, { id: gone, name: 'Gone', updated_at: at('09:00:00') });
    vi.stubGlobal('navigator', { onLine: false });
    await adapter.upsert<Row>('accounts', hid, { id: made, name: 'Made offline' });
    await adapter.remove('accounts', hid, gone);
    await applyList([{ id: gone, name: 'Gone', updated_at: at('09:00:00') }, { id: other, name: 'Theirs', updated_at: at('09:01:00') }]);
    expect((await cachedRows()).map(r => r.name)).toEqual(['Theirs', 'Made offline']);
    await applyDelta([{ id: gone, name: 'Gone, renamed elsewhere', updated_at: at('09:02:00') }]);
    expect(await cached(gone)).toBeUndefined();
  });

  it('F1B-006 · an edit made elsewhere meanwhile is still a conflict when the queued write lands', async () => {
    const id = crypto.randomUUID();
    await adapter.cache.put('accounts', hid, { id, name: 'Start', updated_at: at('09:00:00') });
    vi.stubGlobal('navigator', { onLine: false });
    await adapter.upsert<Row>('accounts', hid, { id, name: 'Mine' }, at('09:00:00'));
    await applyDelta([{ id, name: 'Theirs', updated_at: at('09:05:00') }]);
    vi.stubGlobal('navigator', { onLine: true });
    cloudUpsert.mockRejectedValueOnce(new ConcurrencyConflictError('accounts', id, at('09:00:00')));
    await settle();
    expect(adapter.pendingConflictCount()).toBe(1);                 // "changed elsewhere", never overwritten silently
    expect((await cached(id))?.name).toBe('Mine');                  // shown until Dismiss or Re-apply
  });

  it('F1B-007 · writers to one cached list run one at a time: none drops another\'s row', async () => {
    const cache = new LocalStorageAdapter();
    const h = crypto.randomUUID();
    await Promise.all([
      ...Array.from({ length: 25 }, (_, i) => cache.put('transactions', h, { id: `r${i}` })),
      cache.updateList<{ id: string }>('transactions', h, rows => [...rows, { id: 'via-update' }]),
      cache.upsert('transactions', h, { id: 'via-upsert' }),
    ]);
    expect((await cache.list('transactions', h)).length).toBe(27);

    // A save and a cloud pull at the same moment both land.
    const mine = crypto.randomUUID(), theirs = crypto.randomUUID();
    vi.stubGlobal('navigator', { onLine: false });
    await Promise.all([
      adapter.upsert<Row>('accounts', hid, { id: mine, name: 'Mine' }),
      applyDelta([{ id: theirs, name: 'Theirs', updated_at: at('09:00:00') }]),
    ]);
    expect((await cachedRows()).map(r => r.name).sort()).toEqual(['Mine', 'Theirs']);
  });
});

// A fake cloud table read exactly as SupabaseAdapter.listSince reads it: a bare timestamp is `>=`, a
// composite cursor is the (updated_at, id) keyset; ordered, limited, tombstones split out.
type CloudRow = { id: string; updated_at: string; deleted_at?: string | null };
function fakeListSince(table: CloudRow[]) {
  return async (_entity: unknown, _household: unknown, since: string, limit = 500) => {
    const bar = since.indexOf('|');
    const [ts, id] = bar < 0 ? [since, ''] : [since.slice(0, bar), since.slice(bar + 1)];
    const page = table
      .filter(r => (id ? r.updated_at > ts || (r.updated_at === ts && r.id > id) : r.updated_at >= ts))
      .sort((l, r) => l.updated_at.localeCompare(r.updated_at) || l.id.localeCompare(r.id))
      .slice(0, limit);
    const last = page[page.length - 1];
    return {
      rows: page.filter(r => !r.deleted_at).map(({ id: rowId, updated_at }) => ({ id: rowId, updated_at })),
      tombstones: page.filter(r => r.deleted_at).map(r => r.id),
      maxUpdatedAt: last ? `${last.updated_at}|${last.id}` : null,
    };
  };
}
const startFrom = async (rows: CloudRow[], cursor: string) => {
  await adapter.cache.replaceAll('transactions', hid, rows);
  ls.setString(`cursor_${hid}_transactions`, cursor);
};

describe('a delta pull re-reads 2 minutes back and reads every page (FE-SYN-07, DB-OPS-10)', () => {
  beforeEach(setUpAdapter);
  afterEach(tearDownAdapter);

  it('F1B-008 · a row whose transaction started earlier but committed after the last pull is fetched', async () => {
    // L was stamped 09:00:05 when its transaction started, but committed after this device had pulled A
    // (09:00:10). A pull strictly after the cursor never fetched it.
    const table: CloudRow[] = [
      { id: 'A', updated_at: at('09:00:10') }, { id: 'L', updated_at: at('09:00:05') }, { id: 'B', updated_at: at('09:00:20') },
    ];
    const since = vi.spyOn(adapter.cloud, 'listSince').mockImplementation(fakeListSince(table) as never);
    await startFrom([{ id: 'A', updated_at: at('09:00:10') }], `${at('09:00:10')}|A`);
    await adapter.list('transactions', hid);
    await adapter.cloudSettled();
    expect((await cachedRows('transactions')).map(r => r.id).sort()).toEqual(['A', 'B', 'L']);
    expect(since.mock.calls[0][2]).toBe(at('08:58:10'));           // the first page starts 2 minutes back
    expect(ls.readString(`cursor_${hid}_transactions`)).toBe(`${at('09:00:20')}|B`);
  });

  it('F1B-009 · 1,201 new rows are read in three pages, and the entity counts as fresh only after the last', async () => {
    const table: CloudRow[] = Array.from({ length: 1201 }, (_, i) =>
      ({ id: `r${String(i).padStart(4, '0')}`, updated_at: new Date(Date.parse(at('10:00:00')) + i).toISOString() }));
    const since = vi.spyOn(adapter.cloud, 'listSince').mockImplementation(fakeListSince(table) as never);
    await startFrom([], `${at('09:00:00')}|x`);
    await adapter.list('transactions', hid);
    await adapter.cloudSettled();
    expect(since).toHaveBeenCalledTimes(3);
    expect(since.mock.calls[1][2]).toBe(`${table[499].updated_at}|${table[499].id}`);   // then the exact keyset
    expect(await cachedRows('transactions')).toHaveLength(1201);
    expect(internals().cloudAppliedAt.has(`${hid}:transactions`)).toBe(true);
  });

  it('F1B-010 · a full page with no answer after it is not fresh; the next pull carries on from that page', async () => {
    const table: CloudRow[] = Array.from({ length: 700 }, (_, i) =>
      ({ id: `r${String(i).padStart(4, '0')}`, updated_at: new Date(Date.parse(at('10:00:00')) + i * 1000).toISOString() }));
    const pages = fakeListSince(table);
    const since = vi.spyOn(adapter.cloud, 'listSince')
      .mockImplementationOnce(pages as never)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(pages as never);
    await startFrom([], `${at('09:00:00')}|x`);
    await adapter.list('transactions', hid);
    await adapter.cloudSettled();
    expect(await cachedRows('transactions')).toHaveLength(500);
    expect(internals().cloudAppliedAt.has(`${hid}:transactions`)).toBe(false);   // a Net Worth snapshot waits
    expect(ls.readString(`cursor_${hid}_transactions`)).toBe(`${table[499].updated_at}|${table[499].id}`);

    await adapter.list('transactions', hid);
    await adapter.cloudSettled();
    expect(since.mock.calls[2][2]).toBe(overlapStart(`${table[499].updated_at}|x`, 120_000));
    expect(await cachedRows('transactions')).toHaveLength(700);
    expect(internals().cloudAppliedAt.has(`${hid}:transactions`)).toBe(true);
  });

  it('F1B-011 · re-reading the overlap rewrites nothing when nothing changed, and a deleted row goes', async () => {
    const table: CloudRow[] = [{ id: 'A', updated_at: at('09:00:10') }, { id: 'B', updated_at: at('09:00:20') }];
    vi.spyOn(adapter.cloud, 'listSince').mockImplementation(fakeListSince(table) as never);
    await startFrom([{ id: 'A', updated_at: at('09:00:10') }, { id: 'B', updated_at: at('09:00:20') }], `${at('09:00:20')}|B`);
    const write = vi.spyOn(adapter.cache as unknown as { write: (...a: unknown[]) => Promise<void> }, 'write');
    await adapter.list('transactions', hid);
    await adapter.cloudSettled();
    expect(write).not.toHaveBeenCalled();

    table[0] = { id: 'A', updated_at: at('09:00:30'), deleted_at: at('09:00:30') };
    await adapter.list('transactions', hid);
    await adapter.cloudSettled();
    expect((await cachedRows('transactions')).map(r => r.id)).toEqual(['B']);
  });
});
