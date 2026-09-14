import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// CON-UNIT-105..112 — the transactional outbox (audit F6).
//
// THE BUG THESE PIN
// The old queue snapshotted localStorage, awaited network I/O, then overwrote
// the key with its own `remaining` list. An op enqueued DURING a flush was
// appended to storage and then erased by the in-flight flush's write — silent
// write-loss. The outbox replaces that with durable per-op rows and
// claim/ack-by-id, which cannot erase an op it never claimed.

import * as outbox from '../sync/outbox';
import { MemoryDriver } from '../sync/outbox';
import type { QueueOp } from '../sync/types';

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

const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function op(partial: Partial<QueueOp> = {}): QueueOp {
  return {
    ts: Date.now(), op: 'upsert', entity: 'transactions',
    householdId: 'h1', payload: { id: UUID_A },
    ...partial,
  };
}

beforeEach(() => {
  outbox.setDriverForTests(new MemoryDriver());
  g.localStorage = new MemStorage();
});
afterEach(() => {
  outbox.setDriverForTests(null);
  delete g.localStorage;
});

describe('outbox — durable per-op rows (audit F6)', () => {
  it('CON-UNIT-105 · enqueue assigns a stable opId and a monotonic seq', async () => {
    const a = await outbox.enqueueOp(op(), 'user-1');
    const b = await outbox.enqueueOp(op({ payload: { id: UUID_B } }), 'user-1');
    expect(a.opId).toBeTruthy();
    expect(b.opId).not.toBe(a.opId);
    expect(b.seq).toBeGreaterThan(a.seq);
    expect(a.status).toBe('pending');
    expect(a.ownerUid).toBe('user-1');
    expect(await outbox.pendingCount()).toBe(2);
  });

  it('CON-UNIT-106 · claim marks ops and a second claim while fresh returns nothing', async () => {
    await outbox.enqueueOp(op(), 'user-1');
    await outbox.enqueueOp(op({ payload: { id: UUID_B } }), 'user-1');
    const first = await outbox.claimDue('worker-1', Date.now(), 'user-1');
    expect(first).toHaveLength(1);
    expect(first.every(o => o.status === 'claimed' && o.claimedBy === 'worker-1')).toBe(true);
    const again = await outbox.claimDue('worker-1', Date.now(), 'user-1');
    expect(again).toHaveLength(0);                             // already claimed
    await outbox.ack(first[0].opId, 'worker-1');
    const following = await outbox.claimDue('worker-1', Date.now(), 'user-1');
    expect(following).toHaveLength(1);
    expect(following[0].seq).toBeGreaterThan(first[0].seq);
  });

  it('CON-UNIT-107 · THE RACE — an op enqueued DURING a flush survives it', async () => {
    // Sequence of the old bug: flush reads queue [A] → awaits network for A →
    // B is enqueued meanwhile → flush writes `remaining=[]` and B is gone.
    const a = await outbox.enqueueOp(op(), 'user-1');
    const claimed = await outbox.claimDue('worker-1', Date.now(), 'user-1');
    expect(claimed.map(o => o.opId)).toEqual([a.opId]);

    // Mid-flush: the "network request" for A is in flight; the user saves B.
    const b = await outbox.enqueueOp(op({ payload: { id: UUID_B } }), 'user-1');

    // A's write completes; the flush acks exactly A.
    await outbox.ack(a.opId);

    // The next flush MUST find B — it was never in the first claim's snapshot.
    const next = await outbox.claimDue('worker-1', Date.now(), 'user-1');
    expect(next.map(o => o.opId)).toEqual([b.opId]);
    await outbox.ack(b.opId);
    expect(await outbox.pendingCount()).toBe(0);
  });

  it('CON-UNIT-108 · backoff — an op inside nextRetryAt is not claimed; release re-queues it', async () => {
    await outbox.enqueueOp(op({ attempts: 1, nextRetryAt: Date.now() + 60_000 }), 'user-1');
    expect(await outbox.claimDue('worker-1', Date.now(), 'user-1')).toHaveLength(0);

    // The flush's transient-failure path: release with a new backoff patch.
    const [claimed] = await outbox.claimDue('worker-1', Date.now() + 61_000, 'user-1');
    await outbox.release(
      claimed,
      { attempts: 2, nextRetryAt: Date.now() - 1 },
    );
    const due = await outbox.claimDue('worker-1', Date.now(), 'user-1');
    expect(due).toHaveLength(1);
    expect(due[0].attempts).toBe(2);
    expect(due[0].status).toBe('claimed');
  });

  it('CON-UNIT-109 · a stale claim (dead tab) is reclaimable by another worker', async () => {
    await outbox.enqueueOp(op(), 'user-1');
    await outbox.claimDue('worker-1', Date.now(), 'user-1');
    // worker-1 dies without acking. 61s later a different worker claims.
    const later = Date.now() + 61_000;
    const reclaimed = await outbox.claimDue('worker-2', later, 'user-1');
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].claimedBy).toBe('worker-2');
  });

  it('CON-UNIT-110 · owner filtering — user B never claims user A\'s pending writes', async () => {
    await outbox.enqueueOp(op(), 'user-a');
    await outbox.enqueueOp(op({ payload: { id: UUID_B } }), null);   // legacy/unowned
    // User B's flush: only the unowned op.
    const forB = await outbox.claimDue('w', Date.now(), 'user-b');
    expect(forB).toHaveLength(0);
    // User A returns: their op is still there.
    const forA = await outbox.claimDue('w', Date.now() + 61_000, 'user-a');
    expect(forA).toHaveLength(1);
    expect(await outbox.pendingCount('user-b')).toBe(0);
    expect(await outbox.pendingCount('user-a')).toBe(1);
    expect(await outbox.pendingCount()).toBe(2);
  });

  it('CON-UNIT-111 · the legacy localStorage queue migrates in once, ownerless, and is removed', async () => {
    g.localStorage!.setItem('vt_sync_queue', JSON.stringify([op(), op({ payload: { id: UUID_B } })]));
    const fresh = await outbox.enqueueOp(op(), 'user-1');
    expect(fresh.opId).toBeTruthy();
    const all = await outbox.claimDue('w', Date.now(), 'user-1');
    expect(all).toHaveLength(1);
    // Legacy ops came in with null owner, ordered BEFORE the new op.
    expect(all[0].opId).toBe(fresh.opId);
    expect(await outbox.pendingCount()).toBe(3);
    // The legacy key is gone and a second migration does not duplicate.
    expect(g.localStorage!.getItem('vt_sync_queue')).toBeNull();
    outbox.setDriverForTests(new MemoryDriver());   // reset migrated flag
    g.localStorage!.setItem('vt_sync_queue', JSON.stringify([op()]));
    await outbox.enqueueOp(op(), 'user-1');
    expect(await outbox.pendingCount()).toBe(2);    // imported once, not twice
  });

  it('CON-UNIT-112 · ack removes exactly one op; pendingCountSync tracks mutations', async () => {
    const a = await outbox.enqueueOp(op(), 'user-1');
    await outbox.enqueueOp(op({ payload: { id: UUID_B } }), 'user-1');
    expect(outbox.pendingCountSync()).toBe(2);
    await outbox.ack(a.opId);
    expect(outbox.pendingCountSync()).toBe(1);
    await outbox.ack('nonexistent');   // no-op, no throw
    expect(outbox.pendingCountSync()).toBe(1);
  });
});
