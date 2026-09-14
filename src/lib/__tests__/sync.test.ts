import { describe, it, expect, beforeEach, vi } from 'vitest';
import { backoffMs, MAX_RETRIES } from '../sync/backoff';
import { isQueueOpIdValid, readQueue, writeQueue, enqueue } from '../sync/syncQueue';
import { classifyFlushError } from '../sync/conflict';
import {
  recordConflict, recordFailed, pendingConflictCount, pendingFailedCount,
  clearConflicts, clearFailed, retryDeadLettered,
} from '../sync/deadLetter';
import * as outbox from '../sync/outbox';
import { MemoryDriver } from '../sync/outbox';
import type { QueueOp } from '../sync/types';
import { ConcurrencyConflictError } from '../supabaseAdapter';

// TD-26 — pins the sync-queue mechanics extracted out of hybridAdapter.ts. The
// concerns (backoff, op-validity + persistence, flush-error resolution, dead-
// lettering) are now independently testable; behaviour must stay identical.

// The queue persists via localStorageCompat → localStorage. Polyfill it.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}

const UUID = '11111111-1111-1111-1111-111111111111';
const op = (over: Partial<QueueOp> = {}): QueueOp =>
  ({ ts: 1, op: 'upsert', householdId: 'h1', payload: { id: UUID }, ...over });

beforeEach(() => { (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage(); });

describe('sync/backoff — TD-26', () => {
  it('CON-UNIT-072 · exponential backoff 2/4/8/16/32s capped at 60s; MAX_RETRIES=5', () => {
    expect(MAX_RETRIES).toBe(5);
    expect([backoffMs(1), backoffMs(2), backoffMs(3), backoffMs(4), backoffMs(5)]).toEqual([2000, 4000, 8000, 16000, 32000]);
    expect(backoffMs(6)).toBe(60000);   // cap kicks in
    expect(backoffMs(12)).toBe(60000);
  });
});

describe('sync/conflict — TD-26', () => {
  it('CON-UNIT-073 · a ConcurrencyConflictError is terminal (never retried)', () => {
    const e = new ConcurrencyConflictError('budgets', UUID, '2026-01-01T00:00:00Z');
    expect(classifyFlushError(e, op())).toEqual({ kind: 'conflict' });
  });
  it('CON-UNIT-074 · a transient error retries with incremented attempts + backoff, then dead-letters at the cap', () => {
    const r = classifyFlushError(new Error('network'), op({ attempts: 0 }));
    expect(r.kind).toBe('retry');
    if (r.kind === 'retry') {
      expect(r.op.attempts).toBe(1);
      expect(r.op.nextRetryAt).toBeGreaterThan(Date.now() - 1);
    }
    // attempts 4 → 5 == MAX_RETRIES → failed
    expect(classifyFlushError(new Error('network'), op({ attempts: 4 }))).toEqual({ kind: 'failed' });
  });
});

describe('sync/syncQueue — TD-26', () => {
  it('CON-UNIT-075 · isQueueOpIdValid: upsert/remove require a UUID; id-less ops are always valid', () => {
    expect(isQueueOpIdValid(op())).toBe(true);
    expect(isQueueOpIdValid(op({ payload: { id: 'mpe036yty4vnauz7yif' } }))).toBe(false);
    expect(isQueueOpIdValid(op({ op: 'remove', id: UUID, payload: undefined }))).toBe(true);
    expect(isQueueOpIdValid(op({ op: 'remove', id: 'bad', payload: undefined }))).toBe(false);
    expect(isQueueOpIdValid(op({ op: 'updateProfile', payload: {} }))).toBe(true);
    expect(isQueueOpIdValid(op({ op: 'upsertRate', code: 'EUR', rate: 1, payload: undefined }))).toBe(true);
  });
  it('CON-UNIT-076 · enqueue/readQueue/writeQueue round-trip; the poisoned-op replay partitions cleanly', () => {
    enqueue(op({ ts: 1 }));                                    // valid UUID
    enqueue(op({ ts: 2, payload: { id: 'not-a-uuid' } }));     // poisoned — would be dropped on flush
    enqueue(op({ ts: 3, op: 'updateProfile', payload: {} }));  // id-less, valid
    const q = readQueue();
    expect(q).toHaveLength(3);
    const survivors = q.filter(isQueueOpIdValid);
    expect(survivors.map(o => o.ts)).toEqual([1, 3]);
    writeQueue(survivors);
    expect(readQueue()).toHaveLength(2);
  });
});

describe('sync/deadLetter — TD-26', () => {
  // Audit F6: retryDeadLettered now drains into the DURABLE OUTBOX (async,
  // owner-stamped) instead of the legacy localStorage queue, and the caller
  // (HybridAdapter) owns kicking the flush. The contract pinned here is
  // unchanged in substance: the bucket clears and each op re-enters the queue
  // with retries reset and the concurrency precondition stripped (LWW retry).
  it('CON-UNIT-077 · record → count → clear on both buckets; retry drains into the outbox owner-stamped', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // recordFailed → unexpected → console.error
    outbox.setDriverForTests(new MemoryDriver());
    recordConflict({ ...op({ ts: 9, expectedUpdatedAt: '2026-01-01T00:00:00Z' }), ownerUid: 'user-1' } as QueueOp);
    expect(pendingConflictCount()).toBe(1);
    recordFailed(op({ ts: 10 }), new Error('boom'));
    expect(pendingFailedCount()).toBe(1);

    await retryDeadLettered('sync_conflicts', 'user-1');
    expect(pendingConflictCount()).toBe(0);
    const requeued = (await outbox.claimDue('w', Date.now(), 'user-1')).find(o => o.ts === 9);
    expect(requeued).toBeTruthy();
    expect(requeued!.expectedUpdatedAt).toBeUndefined();  // stripped → unconditional LWW retry
    expect(requeued!.attempts).toBe(0);
    expect(requeued!.ownerUid).toBe('user-1');            // stamped to the retrying user

    clearFailed();
    expect(pendingFailedCount()).toBe(0);
    clearConflicts();
    outbox.setDriverForTests(null);
    vi.restoreAllMocks();
  });
});
