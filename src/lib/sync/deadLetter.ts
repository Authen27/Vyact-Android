// Vyact — dead-letter buckets for ops the cloud rejected (TD-26 extraction).
//   • sync_conflicts — TD-03 optimistic-concurrency conflicts (terminal).
//   • sync_failed    — TD-10 retry-exhausted ops.
// Storage keys and behaviour are unchanged from hybridAdapter.ts.
import ls from '../localStorageCompat';
import { expected, unexpected } from '../faults';
import type { QueueOp } from './types';
import { readQueue, writeQueue } from './syncQueue';

const CONFLICTS_KEY = 'sync_conflicts';
const FAILED_KEY = 'sync_failed';

export function recordConflict(op: QueueOp): void {
  // A concurrency conflict is a normal, surfaced outcome (the banner reads
  // sync_conflicts) — degraded path, classify expected.
  try {
    const list = ls.readJson<QueueOp[]>(CONFLICTS_KEY) || [];
    list.push(op);
    try { ls.setJson(CONFLICTS_KEY, list); } catch (e) { expected(e, 'sync.recordConflict:persist'); }
  } catch (e) { expected(e, 'sync.recordConflict'); }
}

export function recordFailed(op: QueueOp, error: unknown): void {
  // TD-24: a write that exhausted its retries failed to reach the cloud — an
  // unexpected fault, in addition to the dead-letter bucket the UI surfaces.
  unexpected(error, `sync.flushQueue:exhausted-retries:${op.op}:${op.entity ?? ''}`);
  try {
    const list = ls.readJson<Array<QueueOp & { error?: string }>>(FAILED_KEY) || [];
    list.push({ ...op, error: error instanceof Error ? error.message : String(error) });
    try { ls.setJson(FAILED_KEY, list); } catch (e) { expected(e, 'sync.recordFailed:persist'); }
  } catch (e) { expected(e, 'sync.recordFailed'); }
}

export function pendingConflictCount(): number {
  try {
    const list = ls.readJson<QueueOp[]>(CONFLICTS_KEY) || [];
    return list.length;
  } catch { return 0; }
}

export function clearConflicts(): void {
  try { ls.removeBoth(CONFLICTS_KEY); } catch { /* noop */ }
}

export function pendingFailedCount(): number {
  try {
    const list = ls.readJson<QueueOp[]>(FAILED_KEY) || [];
    return list.length;
  } catch { return 0; }
}

export function clearFailed(): void {
  try { ls.removeBoth(FAILED_KEY); } catch { /* noop */ }
}

/**
 * Re-queue a dead-lettered op for another flush attempt (R5). For conflict ops
 * we strip `expectedUpdatedAt` so the retry is an unconditional last-write-wins;
 * retry counters reset so it isn't instantly re-dropped. `flush` is invoked
 * after the bucket is drained back into the main queue.
 */
export function retryDeadLettered(bucket: 'sync_conflicts' | 'sync_failed', flush: () => void): void {
  try {
    const list = ls.readJson<QueueOp[]>(bucket) || [];
    if (!list.length) return;
    const queue = readQueue();
    for (const op of list) {
      queue.push({ ...op, attempts: 0, nextRetryAt: undefined, expectedUpdatedAt: undefined });
    }
    writeQueue(queue);
    ls.removeBoth(bucket);
    flush();
  } catch { /* storage error — non-fatal */ }
}
