// F1C-001..007 — v10.112.0 (F1c; audit INT-TXN-11; owner decisions 18 Oct 2026: the share is queued
// behind its transaction and sent by sync; "today's calls, repeat-safe").
// A split's sharing is a queued step: it waits for its transaction to land, is retried until it does,
// never holds up the household's transactions, and each run makes the cloud match the split, so a run
// cut off half-way is finished by the next and a repeat changes nothing. Before this, the Split form
// shared straight after QUEUEING the transaction: offline or before the transaction landed the cloud
// refused it (foreign key), and nothing tried again.
// Real outbox on IndexedDB (fake-indexeddb); an in-memory cloud that enforces the transaction FK.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('../supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../supabase')>()), isCloudEnabled: () => false, supabase: null,
}));
const email = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../splitEmail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../splitEmail')>()), sendSplitEmail: email.send,
}));

import { syncSharedSplit, shareIntentForTxn, type NewSharedSplitParticipant, type SplitShareIntent } from '../sharedSplits';
import { splitSavedNotice } from '../splitParticipants';
import { HybridAdapter } from '../hybridAdapter';
import { claimDue, ack, release, enqueueOp, nextWakeAt, IdbDriver, MemoryDriver, pendingCount, setDriverForTests } from '../sync/outbox';
import { CACHE_EPOCH } from '../cacheInvalidation';
import ls from '../localStorageCompat';
import { useStore } from '../../store';

const ROOT = resolvePath(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolvePath(ROOT, path), 'utf8');

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
beforeEach(() => {
  g.localStorage = new MemStorage();
  email.send.mockReset();
  email.send.mockResolvedValue({ ok: true, sent: 1, recipients: 1 });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete g.localStorage; });

// ── An in-memory cloud: shared_splits (FK to transactions) and shared_split_shares (unique per email,
// cascading with their split), read through the same query calls the app makes. ───────────────────
type Rec = Record<string, unknown> & { id: string };
class FakeCloud {
  transactions = new Set<string>();
  tables: Record<string, Rec[]> = { shared_splits: [], shared_split_shares: [] };
  writes: string[] = [];
  failures: { table: string; op: string; error: unknown }[] = [];
  private n = 0;
  next(prefix: string) { this.n++; return `${prefix}-${this.n}`; }
  client(): SupabaseClient {
    return { auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) }, from: (table: string) => new FakeQuery(this, table) } as unknown as SupabaseClient;
  }
  failNext(table: string, op: string, error: unknown) { this.failures.push({ table, op, error }); }
}
class FakeQuery {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private filters: [string, unknown][] = [];
  private payload: unknown;
  private one = false;
  constructor(private cloud: FakeCloud, private table: string) {}
  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  order() { return this; }
  single() { this.one = true; return this; }
  insert(rows: unknown) { this.op = 'insert'; this.payload = rows; return this; }
  update(row: unknown) { this.op = 'update'; this.payload = row; return this; }
  delete() { this.op = 'delete'; return this; }
  then<T>(resolve: (value: { data: unknown; error: unknown }) => T, reject?: (e: unknown) => T) {
    return Promise.resolve().then(() => this.run()).then(resolve, reject);
  }
  private matches = (row: Rec) => this.filters.every(([c, v]) => row[c] === v);
  private run(): { data: unknown; error: unknown } {
    const { cloud, table } = this;
    const failure = cloud.failures.findIndex(f => f.table === table && f.op === this.op);
    if (failure >= 0) return { data: null, error: cloud.failures.splice(failure, 1)[0].error };
    const rows = cloud.tables[table];
    if (this.op === 'select') return { data: rows.filter(this.matches).map(r => ({ ...r })), error: null };
    cloud.writes.push(`${this.op} ${table}`);
    if (this.op === 'insert') {
      const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Record<string, unknown>[];
      const made: Rec[] = [];
      for (const row of incoming) {
        if (table === 'shared_splits' && !cloud.transactions.has(String(row.txn_id))) {
          return { data: null, error: { code: '23503', message: 'insert or update on table "shared_splits" violates foreign key constraint' } };
        }
        if (table === 'shared_split_shares' && rows.some(r => r.split_id === row.split_id && r.email === row.email)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value' } };
        }
        const rec: Rec = { id: cloud.next(table === 'shared_splits' ? 'split' : 'share'), created_at: cloud.next('t'),
          ...(table === 'shared_split_shares' ? { paid: false, paid_at: null, settled_user_id: null } : { closed_at: null }), ...row };
        rows.push(rec);
        made.push(rec);
      }
      return { data: this.one ? made[0] : made, error: null };
    }
    if (this.op === 'update') {
      for (const row of rows.filter(this.matches)) Object.assign(row, this.payload);
      return { data: null, error: null };
    }
    const gone = rows.filter(this.matches);
    cloud.tables[table] = rows.filter(r => !gone.includes(r));
    if (table === 'shared_splits') {
      cloud.tables.shared_split_shares = cloud.tables.shared_split_shares.filter(s => !gone.some(sp => sp.id === s.split_id));
    }
    return { data: null, error: null };
  }
}

const intent = (txnId: string, participants: NewSharedSplitParticipant[], over: Partial<SplitShareIntent> = {}): SplitShareIntent =>
  ({ txnId, description: 'Dinner', currency: 'INR', totalAmount: 4500, txnType: 'expense', date: '2026-10-18', participants, ...over }) as SplitShareIntent;
const shares = (cloud: FakeCloud) => cloud.tables.shared_split_shares
  .map(s => [s.email, s.share, s.paid] as const).sort((l, r) => String(l[0]).localeCompare(String(r[0])));

describe('the share step makes the cloud match the split, repeat-safe (syncSharedSplit)', () => {
  it('F1C-001 · creates, repeats with no writes, finishes a run cut off half-way, edits around paid shares and deletes', async () => {
    const cloud = new FakeCloud();
    cloud.transactions.add('t1');
    const ravi = { email: 'ravi@example.com', share: 1500 }, meera = { email: 'meera@example.com', share: 1500 };

    // A run cut off between the split and its shares: the split exists, no shares.
    cloud.failNext('shared_split_shares', 'insert', new TypeError('Failed to fetch'));
    await expect(syncSharedSplit(cloud.client(), 'hh', intent('t1', [ravi, meera]))).rejects.toThrow('Failed to fetch');
    expect(cloud.tables.shared_splits).toHaveLength(1);
    expect(cloud.tables.shared_split_shares).toHaveLength(0);
    // The retry finishes it: still one split, both shares, two people to email.
    expect(await syncSharedSplit(cloud.client(), 'hh', intent('t1', [ravi, meera])))
      .toEqual({ splitId: cloud.tables.shared_splits[0].id, added: 2 });
    expect(cloud.tables.shared_splits).toHaveLength(1);
    expect(shares(cloud)).toEqual([['meera@example.com', 1500, false], ['ravi@example.com', 1500, false]]);

    // A repeat writes nothing and emails no one.
    cloud.writes = [];
    expect(await syncSharedSplit(cloud.client(), 'hh', intent('t1', [ravi, meera]))).toMatchObject({ added: 0 });
    expect(cloud.writes).toEqual([]);

    // Meera paid. The edit drops both and adds Sam, at a new total: Ravi's unpaid share goes, Meera's
    // paid share stays untouched, Sam is added (and only Sam is emailed).
    cloud.tables.shared_split_shares.find(s => s.email === 'meera@example.com')!.paid = true;
    const sam = { email: 'Sam@Example.com ', share: 2000 };
    expect(await syncSharedSplit(cloud.client(), 'hh', intent('t1', [sam], { totalAmount: 6000 } as Partial<SplitShareIntent>)))
      .toMatchObject({ added: 1 });
    expect(shares(cloud)).toEqual([['meera@example.com', 1500, true], ['sam@example.com', 2000, false]]);
    expect(cloud.tables.shared_splits[0].total_amount).toBe(6000);
    // An unpaid amount change is applied; a paid one never.
    await syncSharedSplit(cloud.client(), 'hh', intent('t1', [{ email: 'sam@example.com', share: 2500 }, { email: 'meera@example.com', share: 9 }]));
    expect(shares(cloud)).toEqual([['meera@example.com', 1500, true], ['sam@example.com', 2500, false]]);

    // Deleting the split removes it and its shares; a repeat is a no-op.
    expect(await syncSharedSplit(cloud.client(), 'hh', { txnId: 't1', deleted: true })).toBeNull();
    expect(cloud.tables.shared_splits).toEqual([]);
    expect(cloud.tables.shared_split_shares).toEqual([]);
    cloud.writes = [];
    expect(await syncSharedSplit(cloud.client(), 'hh', { txnId: 't1', deleted: true })).toBeNull();
    expect(cloud.writes).toEqual([]);
    // Nothing to share and nothing shared: nothing written.
    expect(await syncSharedSplit(cloud.client(), 'hh', intent('t1', []))).toBeNull();
    expect(cloud.writes).toEqual([]);
  });
});

describe('the share step waits for its transaction, in its own lane (outbox)', () => {
  afterEach(() => setDriverForTests(null));

  it('F1C-002 · it is claimed only after its transaction has landed, and wakes the queue only through it', async () => {
    setDriverForTests(new MemoryDriver());
    const now = Date.parse('2026-10-18T09:00:00Z');
    await enqueueOp({ ts: 1, op: 'upsert', entity: 'transactions', householdId: 'hh', payload: { id: 't1' } }, 'alice');
    await enqueueOp({ ts: 2, op: 'shareSplit', householdId: 'hh', payload: intent('t1', [{ email: 'ravi@example.com', share: 1 }]) }, 'alice');
    const first = await claimDue('w', now, 'alice');
    expect(first.map(op => op.op)).toEqual(['upsert']);              // the share waits behind it
    // The transaction is backing off (no network): the queue wakes when IT is due, not "now".
    await release(first[0], { attempts: 1, nextRetryAt: now + 4000 });
    expect(await nextWakeAt('alice')).toBe(now + 4000);
    const retried = await claimDue('w', now + 4000, 'alice');
    expect(retried.map(op => op.op)).toEqual(['upsert']);
    await ack(retried[0].opId, 'w');
    expect((await claimDue('w', now + 4000, 'alice')).map(op => op.op)).toEqual(['shareSplit']);
  });

  it('F1C-003 · a share step that keeps failing never holds up the household\'s transactions', async () => {
    setDriverForTests(new MemoryDriver());
    const now = Date.parse('2026-10-18T09:00:00Z');
    await enqueueOp({ ts: 1, op: 'shareSplit', householdId: 'hh', payload: intent('t0', [{ email: 'ravi@example.com', share: 1 }]) }, 'alice');
    const [share] = await claimDue('w', now, 'alice');
    await release(share, { attempts: 6, nextRetryAt: now + 300_000 });
    await enqueueOp({ ts: 2, op: 'upsert', entity: 'transactions', householdId: 'hh', payload: { id: 't9' } }, 'alice');
    expect((await claimDue('w', now + 1, 'alice')).map(op => (op.payload as { id?: string }).id)).toEqual(['t9']);
  });
});

// ── End to end through the sync adapter ────────────────────────────────────────────────────────────
let driver: IdbDriver;
let adapter: HybridAdapter;
let cloud: FakeCloud;
let cloudUpsert: ReturnType<typeof vi.fn>;
const hid = 'household-1';

async function setUpAdapter(): Promise<void> {
  driver = new IdbDriver();
  await driver.transaction(rows => rows.clear());
  setDriverForTests(driver);
  vi.stubGlobal('navigator', { onLine: true });
  cloud = new FakeCloud();
  adapter = new HybridAdapter(cloud.client());
  vi.spyOn(adapter.cloud, 'currentUserId').mockResolvedValue('alice');
  vi.spyOn(adapter as unknown as { scheduleFlush: () => void }, 'scheduleFlush').mockImplementation(() => {});
  // A transaction that lands exists in the cloud from then on (the FK the share step needs).
  cloudUpsert = vi.spyOn(adapter.cloud, 'upsert').mockImplementation(async (_entity, _hid, row) => {
    const id = (row as { id: string }).id;
    cloud.transactions.add(id);
    return { ...(row as object), id, updated_at: 'rev-1' } as never;
  }) as unknown as ReturnType<typeof vi.fn>;
  ls.setString('cache_owner_uid', 'alice');
  ls.setString('cache_epoch', CACHE_EPOCH);
}
async function tearDownAdapter(): Promise<void> { await driver.close(); setDriverForTests(null); }
const idle = () => vi.waitFor(() => expect((adapter as unknown as { flushing: boolean }).flushing).toBe(false));
const settle = async () => { await idle(); await adapter.flushQueue(); await idle(); };
// The queue only sends rows with a real uuid (v6.4.2), as the app mints them.
const T1 = '11111111-1111-4111-8111-111111111111', T2 = '22222222-2222-4222-8222-222222222222';

describe('sharing through the sync queue (INT-TXN-11)', () => {
  beforeEach(setUpAdapter);
  afterEach(tearDownAdapter);

  it('F1C-004 · a split saved offline is shared once online: the transaction first, then its shares, emailed once', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await adapter.upsert('transactions', hid, { id: T1, type: 'expense', amount: 4500 });
    await adapter.queueSplitShare(hid, intent(T1, [{ email: 'ravi@example.com', share: 1500 }, { email: 'meera@example.com', share: 1500 }]));
    expect(await pendingCount('alice')).toBe(2);
    expect(cloud.tables.shared_splits).toEqual([]);                  // nothing sent offline, nothing failed

    const landed = vi.fn();
    adapter.onSplitShared(landed);
    vi.stubGlobal('navigator', { onLine: true });
    // Back online, the transaction's first send fails (a blip) and backs off. The share must wait for
    // it, not run and be refused for a transaction the cloud doesn't have yet.
    cloudUpsert.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await settle();
    expect(await pendingCount('alice')).toBe(2);
    expect(adapter.pendingFailedCount()).toBe(0);
    const [txnRetry] = await claimDue('probe', Date.now() + 10 * 60_000, 'alice');
    expect(txnRetry.op).toBe('upsert');
    await release(txnRetry, { nextRetryAt: 0 });
    await settle();
    expect(cloudUpsert).toHaveBeenCalledTimes(2);
    expect(cloud.tables.shared_splits).toHaveLength(1);               // the FK held: the transaction was there first
    expect(shares(cloud)).toEqual([['meera@example.com', 1500, false], ['ravi@example.com', 1500, false]]);
    expect(await pendingCount('alice')).toBe(0);
    await vi.waitFor(() => expect(landed).toHaveBeenCalledWith({ ok: true, sent: 1, recipients: 1 }));
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(email.send).toHaveBeenCalledWith({ splitId: cloud.tables.shared_splits[0].id, event: 'shared' });

    // Sent again (a retry after a lost acknowledgement): nothing changes, no second email.
    await adapter.queueSplitShare(hid, intent(T1, [{ email: 'ravi@example.com', share: 1500 }, { email: 'meera@example.com', share: 1500 }]));
    await settle();
    expect(cloud.tables.shared_splits).toHaveLength(1);
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('F1C-005 · a network failure while sharing is retried until it lands, and later transactions still go', async () => {
    await adapter.upsert('transactions', hid, { id: T1, type: 'expense', amount: 4500 });
    await settle();
    cloud.failNext('shared_splits', 'select', new TypeError('Failed to fetch'));
    await adapter.queueSplitShare(hid, intent(T1, [{ email: 'ravi@example.com', share: 1500 }]));
    await settle();
    expect(await pendingCount('alice')).toBe(1);                      // queued for another try, never set aside
    expect(adapter.pendingFailedCount()).toBe(0);
    await adapter.upsert('transactions', hid, { id: T2, type: 'expense', amount: 10 });
    await settle();
    expect(cloud.transactions.has(T2)).toBe(true);                   // not held up by the share
    // The retry lands.
    const queued = await claimDue('probe', Date.now() + 10 * 60_000, 'alice');
    await release(queued[0], { nextRetryAt: 0 });
    await settle();
    expect(shares(cloud)).toEqual([['ravi@example.com', 1500, false]]);
    expect(await pendingCount('alice')).toBe(0);
  });

  it('F1C-006 · a share whose transaction the database refused is set aside with it, never stuck', async () => {
    cloudUpsert.mockRejectedValueOnce({ code: '23514', message: 'violates check constraint' });
    await adapter.upsert('transactions', hid, { id: T1, type: 'expense', amount: -1 });
    await adapter.queueSplitShare(hid, intent(T1, [{ email: 'ravi@example.com', share: 1500 }]));
    await settle();
    expect(adapter.pendingFailedCount()).toBe(2);                     // both shown in the failed-writes banner
    expect(await pendingCount('alice')).toBe(0);
    expect(cloud.tables.shared_splits).toEqual([]);
  });
});

describe('the Split form and the store queue the sharing', () => {
  it('F1C-007 · create, edit and delete queue a step (cloud only); the form no longer reports a failed share', async () => {
    const queueSplitShare = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ ...useStore.getInitialState(), adapter: { queueSplitShare } as never, cloudEnabled: true,
      currentHouseholdId: 'hh', session: { user: { id: 'alice' } } as never,
      sharedSplitsOwned: [{ id: 's1', txnId: 't1' }, { id: 's2', txnId: 't2' }] as never });
    const input = { txnId: 't1', description: 'Dinner', currency: 'INR', totalAmount: 4500, txnType: 'expense' as const,
      date: '2026-10-18', participants: [{ email: 'ravi@example.com', share: 1500 }] };
    await useStore.getState().createSharedSplitForTxn(input);
    await useStore.getState().updateSharedSplitForTxn({ ...input, participants: [] });
    await useStore.getState().deleteSharedSplitForTxn('t1');
    expect(queueSplitShare.mock.calls).toEqual([['hh', input], ['hh', { ...input, participants: [] }], ['hh', { txnId: 't1', deleted: true }]]);
    expect(useStore.getState().sharedSplitsOwned.map(sp => sp.id)).toEqual(['s2']);
    // A new split with no one to share with queues nothing; neither does a local-only household.
    await useStore.getState().createSharedSplitForTxn({ ...input, participants: [] });
    useStore.setState({ cloudEnabled: false });
    await useStore.getState().createSharedSplitForTxn(input);
    expect(queueSplitShare).toHaveBeenCalledTimes(3);

    expect(splitSavedNotice(false, [])).toBe('Split added');
    expect(splitSavedNotice(true, [])).toBe('Split updated');
    expect(splitSavedNotice(false, ['Ravi', 'Meera'])).toBe("Split saved. It's shared with Ravi and Meera once you're online.");
    const form = read('react/src/components/splits/SplitFormModal.tsx');
    expect(form).not.toMatch(/sharing failed/);
    expect(form).toMatch(/toast\(splitSavedNotice\(editing, sharedOnceOnline\), 'success'\)/);
    expect(read('react/src/store/index.ts')).toMatch(/adapter\.onSplitShared\?\.\([\s\S]*?refreshSharedSplits\(\)/);
  });
});

// T5B-001..002 — v10.121.0 (T5b; owner, 19 Oct 2026: "queue it"). Marking a person paid settles their
// cloud share through the same queued step. It used to call the cloud straight from the Splits page and
// swallow the failure, so offline the other household kept seeing the money as owed; and a person ticked
// paid in the Split form never reached the cloud at all.
describe('marking a person paid goes through the queued share step (T5b)', () => {
  it('T5B-001 · the step settles a share marked paid, once, never un-settles one, and a new person can arrive paid', async () => {
    const cloud = new FakeCloud();
    cloud.transactions.add('t1');
    const ravi = { email: 'ravi@example.com', share: 1500 }, meera = { email: 'meera@example.com', share: 1500 };
    await syncSharedSplit(cloud.client(), 'hh', intent('t1', [ravi, meera]));
    expect(shares(cloud)).toEqual([['meera@example.com', 1500, false], ['ravi@example.com', 1500, false]]);

    // Ravi is marked paid: his share is settled with a time, Meera's untouched.
    cloud.writes = [];
    await syncSharedSplit(cloud.client(), 'hh', intent('t1', [{ ...ravi, paid: true }, meera]));
    expect(shares(cloud)).toEqual([['meera@example.com', 1500, false], ['ravi@example.com', 1500, true]]);
    expect(cloud.tables.shared_split_shares.find(s => s.email === 'ravi@example.com')!.paid_at).toEqual(expect.any(String));
    expect(cloud.writes).toEqual(['update shared_split_shares']);
    // A repeat writes nothing; a later step that no longer says paid never un-settles him.
    cloud.writes = [];
    await syncSharedSplit(cloud.client(), 'hh', intent('t1', [{ ...ravi, paid: true }, meera]));
    await syncSharedSplit(cloud.client(), 'hh', intent('t1', [ravi, meera]));
    expect(cloud.writes).toEqual([]);
    expect(shares(cloud)).toEqual([['meera@example.com', 1500, false], ['ravi@example.com', 1500, true]]);
    // A changed amount and paid together are one write; a person added already paid arrives paid.
    await syncSharedSplit(cloud.client(), 'hh', intent('t1', [ravi, { ...meera, share: 1400, paid: true }, { email: 'sam@example.com', share: 100, paid: true }]));
    expect(shares(cloud)).toEqual([['meera@example.com', 1400, true], ['ravi@example.com', 1500, true], ['sam@example.com', 100, true]]);
  });

  it('T5B-002 · the step is built from the split row (paid ticks included), and the Splits page queues it instead of calling the cloud', async () => {
    const txn = {
      id: 't1', type: 'expense' as const, amount: 3000, currency: 'INR', date: '2026-10-19', description: 'Dinner',
      split: { isSplit: true as const, totalAmount: 3000, yourShare: 1000, paidBy: 'me' as const, participants: [
        { name: 'You', isYou: true, share: 1000, paid: true },
        { name: 'Ravi', share: 1000, paid: true, paidOn: '2026-10-19', email: 'ravi@example.com' },
        { name: 'Meera', share: 1000, paid: false, email: 'meera@example.com' },
        { name: 'Cash friend', share: 0, paid: false },
      ] },
    };
    expect(shareIntentForTxn(txn)).toEqual({
      txnId: 't1', description: 'Dinner', currency: 'INR', totalAmount: 3000, txnType: 'expense', date: '2026-10-19',
      participants: [{ email: 'ravi@example.com', share: 1000, paid: true }, { email: 'meera@example.com', share: 1000 }],
    });
    expect(shareIntentForTxn({ ...txn, split: undefined })).toBeNull();

    const queueSplitShare = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ ...useStore.getInitialState(), adapter: { queueSplitShare } as never, cloudEnabled: true,
      currentHouseholdId: 'hh', session: { user: { id: 'alice' } } as never });
    await useStore.getState().updateSharedSplitForTxn(shareIntentForTxn(txn)!);
    expect(queueSplitShare).toHaveBeenCalledWith('hh', expect.objectContaining({
      participants: expect.arrayContaining([{ email: 'ravi@example.com', share: 1000, paid: true }]) }));
    expect('markSplitShareRowPaid' in useStore.getState()).toBe(false);

    const page = read('react/src/pages/Splits.tsx');
    expect(page).not.toMatch(/markSplitShareRowPaid|markShareRowPaid/);
    expect(page).toMatch(/const intent = shareIntentForTxn\(txn\);\s*if \(intent\?\.participants\.length\) await updateSharedSplitForTxn\(intent\);/);
    expect(read('react/src/components/splits/SplitFormModal.tsx')).toMatch(/const cloudInput = shareIntentForTxn\(txn\)!;/);
  });
});
