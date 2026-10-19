// F1A-001..012 — v10.110.0 (F1a; audit FE-SYN-04, FE-SYN-05, FE-SYN-08; owner decisions 18 Oct 2026).
// Sign-out clears every cache key the device writes for a household; a write that fails for a reason
// that can pass is retried until it lands, and set-aside writes are their owner's alone; "Synced" names
// the cloud read behind what is on screen, never the time of a read from the device's copy.
// Real outbox and cache on IndexedDB (fake-indexeddb), mocked cloud.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('../supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../supabase')>()), isCloudEnabled: () => false, supabase: null,
}));

import { ENTITIES, LocalStorageAdapter } from '../dataAdapter';
import { HybridAdapter } from '../hybridAdapter';
import { IdbDriver, pendingCount, setDriverForTests } from '../sync/outbox';
import { isTerminalRejection } from '../sync/conflict';
import { CACHE_EPOCH, clearCacheOnSignOut, invalidateCacheForSession, isPurgeable } from '../cacheInvalidation';
import { cacheGeneration, isCacheGenerationCurrent, kvGet, kvKeys, kvPurgeWhere, kvSet } from '../kvStore';
import ls from '../localStorageCompat';
import { useStore } from '../../store';
import { SIGNED_OUT_STATE } from '../../store/slices/cloudAuthSlice';
import { defaultProfile } from '../../store/slices/dataSlice';

const ROOT = resolvePath(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolvePath(ROOT, path), 'utf8');

// localStorage holds the dead-letter buckets, the owner stamp and the per-household copies; node lacks it.
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

describe('sign-out clears the device (FE-SYN-04)', () => {
  it('F1A-001 · every cache key written for a household goes at sign-out; set-aside writes and device settings stay', async () => {
    const hid = `hh-${crypto.randomUUID()}`;
    const cache = new LocalStorageAdapter();
    for (const entity of ENTITIES) await cache.upsert(entity, hid, { id: `${entity}-1` });
    await cache.updateProfile(hid, { name: 'Alice' } as never);
    await cache.recordNetWorthSnapshot(hid, { month: '2026-10', totalAssets: 900_000, totalLiabilities: 100_000,
      netWorth: 800_000, liquidAssets: 200_000, currency: 'INR' } as never);
    // The household's other copies on the device: the bell, Pip's history, the onboarding answers
    // (take-home pay, cash, debts), the household list and the sync sentinels.
    ls.setJson(`notifications_${hid}`, [{ id: 'n1', title: 'Rent ₹15,000 due' }]);
    ls.setJson(`chat_history_${hid}`, [{ q: 'how am I doing?' }]);
    localStorage.setItem(`vt_onboarding_${hid}`, JSON.stringify({ baseline: { takeHome: 90_000, cash: 40_000 } }));
    ls.setJson('cloud_households', [{ id: hid, name: 'Home' }]);
    ls.setString(`cloud_synced_${hid}_transactions`, '1');
    ls.setString(`cursor_${hid}_transactions`, '2026-10-18T00:00:00Z|x');
    // What must survive: the person's set-aside writes (owner-stamped) and device settings.
    ls.setJson('sync_failed', [{ ts: 1, op: 'upsert', householdId: hid, ownerUid: 'alice' }]);
    ls.setString('theme', 'dark');
    ls.setString('last_cloud_hid', hid);
    ls.setString('cache_owner_uid', 'alice');

    await clearCacheOnSignOut();

    expect((await kvKeys()).filter(key => key.includes(hid))).toEqual([]);
    expect(await kvKeys()).not.toContain('cloud_households');
    expect(ls.readJson<unknown[]>('sync_failed')).toHaveLength(1);
    expect(ls.readString('theme')).toBe('dark');
    expect(ls.readString('last_cloud_hid')).toBe(hid);
  });

  it('F1A-002 · every key the local adapter reads or writes is purgeable (a new cache cannot be missed)', () => {
    const src = read('react/src/lib/dataAdapter.ts');
    const suffixes = [...src.matchAll(/this\.(?:read|readForWrite|write|removeBoth|updateList|exclusive)(?:<[^>]*>)?\(\s*'([^']+)'/g)].map(m => m[1]);
    expect(suffixes).toEqual(expect.arrayContaining(['profile', 'budgetAllocations', 'net_worth_snapshots']));
    // profiles_list is the local-only household list (no cloud copy), kept on purpose.
    for (const suffix of new Set(suffixes)) {
      if (suffix === 'profiles_list') continue;
      expect(isPurgeable(`hh-1_${suffix}`), suffix).toBe(true);
    }
    for (const entity of ENTITIES) expect(isPurgeable(`hh-1_${entity}`), entity).toBe(true);
    expect(isPurgeable('hh-1_budget_allocations')).toBe(true);           // the old spelling, on older devices
    for (const kept of ['sync_queue', 'sync_conflicts', 'sync_failed', 'theme', 'last_cloud_hid', 'notification_prefs']) {
      expect(isPurgeable(kept), kept).toBe(false);
    }
  });

  it('F1A-003 · a same-user epoch reset keeps the onboarding copy; a change of person removes it', async () => {
    ls.setString('cache_owner_uid', 'alice');
    ls.setString('cache_epoch', 'v-old');
    localStorage.setItem('vt_onboarding_hh-2', JSON.stringify({ state: 'completed' }));
    await kvSet('hh-2_transactions', [{ id: 't1' }]);
    expect(await invalidateCacheForSession('alice')).toMatchObject({ action: 'purged', reason: 'stale-epoch' });
    expect(await kvGet('hh-2_transactions')).toBeNull();
    // Kept: offline, an empty copy would send Alice back through onboarding, which writes again.
    expect(localStorage.getItem('vt_onboarding_hh-2')).not.toBeNull();
    expect(await invalidateCacheForSession('bob')).toMatchObject({ action: 'purged', reason: 'different-user' });
    expect(localStorage.getItem('vt_onboarding_hh-2')).toBeNull();
  });

  it('F1A-004 · the purge moves the cache generation BEFORE deleting, so a read landing mid-purge cannot write back', async () => {
    await kvSet('hh-3_transactions', [{ id: 't1' }]);
    const before = cacheGeneration();
    let during: number | null = null;
    await kvPurgeWhere(() => { during ??= cacheGeneration(); return true; });
    expect(during).not.toBeNull();
    expect(during).not.toBe(before);
    expect(isCacheGenerationCurrent(before)).toBe(false);
  });

  it('F1A-005 · signing out clears the profile, the net-worth history and the sync time from memory; an explicit sign-out waits for the purge', () => {
    expect(SIGNED_OUT_STATE).toMatchObject({ profile: defaultProfile, netWorthSnapshots: [], lastSyncedAt: null });
    expect(read('react/src/lib/auth.ts')).toMatch(/await sb\(\)\.auth\.signOut\(\);[\s\S]*?await clearCacheOnSignOut\(\)/);
  });
});

// ── The sync adapter, as syncRevisions.test.ts drives it ─────────────────────────────────────────
type Row = { id: string; name?: string; updated_at?: string };
let driver: IdbDriver;
let adapter: HybridAdapter;
let hid: string;
let cloudUpsert: ReturnType<typeof vi.fn>;
let changes: number;

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
  changes = 0;
  adapter.onCacheChanged(() => { changes++; });
  ls.setString('cache_owner_uid', 'alice');
  ls.setString('cache_epoch', CACHE_EPOCH);
}
async function tearDownAdapter(): Promise<void> { await driver.close(); setDriverForTests(null); }
const idle = () => vi.waitFor(() => expect((adapter as unknown as { flushing: boolean }).flushing).toBe(false));
const settle = async () => { await idle(); await adapter.flushQueue(); await idle(); };
const cached = async (id: string) => (await adapter.cache.list<Row>('accounts', hid)).find(r => r.id === id);

describe('a failed write is retried until it lands, and set-aside writes are their owner\'s (FE-SYN-05)', () => {
  beforeEach(setUpAdapter);
  afterEach(tearDownAdapter);

  it('F1A-006 · a write that fails ten times with no network stays queued and on screen, then lands', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T09:00:00Z'));
    const id = crypto.randomUUID();
    cloudUpsert.mockRejectedValue(new TypeError('Failed to fetch'));
    await adapter.upsert<Row>('accounts', hid, { id, name: 'Tea ₹50' });
    for (let i = 0; i < 10; i++) {
      await settle();
      vi.setSystemTime(Date.now() + 6 * 60_000);        // past the longest backoff (5 minutes)
    }
    expect(cloudUpsert).toHaveBeenCalledTimes(10);
    expect(await pendingCount('alice')).toBe(1);          // never set aside (it used to be after 5 tries)
    expect(adapter.pendingFailedCount()).toBe(0);
    expect((await cached(id))?.name).toBe('Tea ₹50');

    cloudUpsert.mockResolvedValue({ id, name: 'Tea ₹50', updated_at: 'rev-1' });
    await settle();
    expect(cloudUpsert).toHaveBeenCalledTimes(11);
    expect(await pendingCount('alice')).toBe(0);
    expect((await cached(id))?.updated_at).toBe('rev-1');
  });

  it('F1A-007 · set aside: a refused write and a request the API refuses; retried: network, JWT and schema lag', () => {
    for (const code of ['23514', '42501', 'P0001', 'PGRST102', 'PGRST116']) {
      expect(isTerminalRejection({ code }), code).toBe(true);
    }
    for (const err of [new TypeError('Failed to fetch'), { code: 'PGRST204' }, { code: 'PGRST205' }, { code: 'PGRST301' },
      { code: '42703' }, { code: '42P01' }, { code: '57014' }, { code: '503' }]) {
      expect(isTerminalRejection(err), JSON.stringify(err)).toBe(false);
    }
  });

  it('F1A-008 · another person on the device neither sees nor dismisses someone\'s set-aside write', async () => {
    const id = crypto.randomUUID();
    cloudUpsert.mockRejectedValueOnce({ code: '23514', message: 'violates check constraint' });
    await adapter.upsert('accounts', hid, { id, name: 'Refused' });
    await settle();
    expect(adapter.pendingFailedCount()).toBe(1);

    ls.setString('cache_owner_uid', 'bob');               // Bob is signed in on Alice's tablet
    expect(adapter.pendingFailedCount()).toBe(0);
    expect(adapter.pendingConflictCount()).toBe(0);
    adapter.clearFailed();
    await adapter.dismissFailed();
    ls.setString('cache_owner_uid', 'alice');
    expect(adapter.pendingFailedCount()).toBe(1);         // still Alice's to review
  });

  it('F1A-009 · a set-aside entry from before owners were stamped goes to the cache owner when they sign back in', async () => {
    ls.setJson('sync_conflicts', [{ ts: 1, op: 'upsert', entity: 'accounts', householdId: hid, payload: { id: 'x' } }]);
    expect(adapter.pendingConflictCount()).toBe(0);
    await invalidateCacheForSession('alice');             // same user, current epoch: kept, and adopted
    expect(adapter.pendingConflictCount()).toBe(1);
    await invalidateCacheForSession('bob');               // a different person signs in
    ls.setString('cache_owner_uid', 'bob');
    expect(adapter.pendingConflictCount()).toBe(0);
    ls.setString('cache_owner_uid', 'alice');
    expect(adapter.pendingConflictCount()).toBe(1);
  });

  it('F1A-010 · Dismiss on a set-aside write re-reads its rows, so the screen shows the cloud\'s version', async () => {
    const id = crypto.randomUUID();
    await adapter.cache.put('accounts', hid, { id, name: 'Unsaved', updated_at: 'rev-1' });
    ls.setJson('sync_failed', [{ ts: 1, op: 'upsert', entity: 'accounts', householdId: hid, payload: { id }, ownerUid: 'alice' }]);
    vi.spyOn(adapter.cloud, 'list').mockResolvedValue([{ id, name: 'Saved', updated_at: 'rev-4' }] as never);
    await adapter.dismissFailed();
    expect(adapter.pendingFailedCount()).toBe(0);
    expect(await cached(id)).toEqual({ id, name: 'Saved', updated_at: 'rev-4' });
    expect(changes).toBe(1);
  });
});

describe('"Synced" names the cloud read behind the screen (FE-SYN-08)', () => {
  beforeEach(setUpAdapter);
  afterEach(tearDownAdapter);
  const SYNCED = ['transactions', 'accounts', 'budgets', 'budgetAllocations', 'debts', 'assets', 'recurring'] as const;
  const listAll = async () => { for (const entity of SYNCED) await adapter.list(entity, hid); };

  it('F1A-011 · no time while every cloud read fails; the time of the read the rows came from, never "now"', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t = (hhmm: string) => new Date(`2026-10-18T${hhmm}:00Z`).getTime();
    const list = vi.spyOn(adapter.cloud, 'list').mockRejectedValue(new TypeError('Failed to fetch'));
    vi.setSystemTime(t('09:00'));
    await listAll();
    expect(adapter.cloudReadAt(hid)).toBeNull();          // nothing came from the cloud

    list.mockResolvedValue([{ id: 'r1', updated_at: '2026-10-18T08:00:00Z' }] as never);
    vi.setSystemTime(t('09:01'));
    await listAll();                                      // first read on the device: waits for the cloud
    expect(adapter.cloudReadAt(hid)).toBe(t('09:01'));

    // Steady state: served from the copy while the cloud is read in the background. Every read fails
    // for an hour: the time stays at 09:01.
    const since = vi.spyOn(adapter.cloud, 'listSince').mockRejectedValue(new TypeError('Failed to fetch'));
    vi.setSystemTime(t('10:00'));
    await listAll();
    await adapter.cloudSettled();
    vi.setSystemTime(t('10:05'));
    await listAll();
    expect(adapter.cloudReadAt(hid)).toBe(t('09:01'));

    // The cloud answers again at 10:10; the next read is served from what it brought.
    since.mockResolvedValue({ rows: [], tombstones: [], maxUpdatedAt: null } as never);
    vi.setSystemTime(t('10:10'));
    await listAll();
    await adapter.cloudSettled();
    vi.setSystemTime(t('10:11'));
    await listAll();
    expect(adapter.cloudReadAt(hid)).toBe(t('10:10'));
  });

  it('F1A-012 · the store shows that time, keeps the last one when there is none, and paints again once the cloud reads land', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
    class CloudyAdapter extends LocalStorageAdapter {
      at: number | null = null;
      cloudReadAt() { return this.at; }
      cloudSettled = vi.fn(async () => { this.at = Date.parse('2026-10-18T11:59:30Z'); });
    }
    const cloudy = new CloudyAdapter();
    useStore.setState({ ...useStore.getInitialState(), adapter: cloudy, currentHouseholdId: crypto.randomUUID(),
      cloudEnabled: true, lastSyncedAt: null, refreshNotifications: vi.fn().mockResolvedValue(undefined), toast: vi.fn() });
    await useStore.getState().refresh();
    expect(useStore.getState().lastSyncedAt).toBeNull();    // the badge says "Syncing…", not "Synced · just now"

    cloudy.at = Date.parse('2026-10-18T11:40:00Z');
    await useStore.getState().refresh();
    expect(useStore.getState().lastSyncedAt).toBe(Date.parse('2026-10-18T11:40:00Z'));
    cloudy.at = null;
    await useStore.getState().refresh();
    expect(useStore.getState().lastSyncedAt).toBe(Date.parse('2026-10-18T11:40:00Z'));

    await useStore.getState().settleFromCloud();
    expect(cloudy.cloudSettled).toHaveBeenCalledTimes(1);
    expect(useStore.getState().lastSyncedAt).toBe(Date.parse('2026-10-18T11:59:30Z'));
    await useStore.getState().manualRefresh();
    expect(cloudy.cloudSettled).toHaveBeenCalledTimes(2);

    // Local-only mode has no cloud: a refresh is the latest there is.
    useStore.setState({ adapter: new LocalStorageAdapter(), cloudEnabled: false });
    await useStore.getState().refresh();
    expect(useStore.getState().lastSyncedAt).toBe(Date.parse('2026-10-18T12:00:00Z'));

    const badge = read('react/src/components/layout/SyncStatusBadge.tsx');
    expect(badge).toMatch(/lastSyncedAt \? `Synced · \$\{agoLabel\(lastSyncedAt\)\}` : 'Syncing…'/);
    const slice = read('react/src/store/slices/dataSlice.ts');
    expect(slice).toMatch(/set\(\{ loading: false \}\);[\s\S]*?void get\(\)\.settleFromCloud\(\);/);
    // A switch of household starts its own clock: no time carried over from the last one.
    expect(slice).toMatch(/set\(\{ currentHouseholdId: id, lastSyncedAt: null \}\);[\s\S]*?await get\(\)\.refresh\(\);\s*void get\(\)\.settleFromCloud\(\);/);
  });
});
