// Vyact — dead-letter buckets for ops the cloud rejected (TD-26 extraction).
//   • sync_conflicts — TD-03 optimistic-concurrency conflicts (terminal).
//   • sync_failed    — writes the database refused for good (W3c), and, from apps before v10.110.0,
//                      ops that ran out of retries. Since F1a a network failure is never set aside.
// Storage keys are unchanged from hybridAdapter.ts.
//
// v10.110.0 (F1a, audit FE-SYN-05; owner decision) — every entry belongs to the person whose write
// it was (`ownerUid`, stamped by the outbox). Counts, Dismiss and the rows Dismiss re-reads only ever
// see the signed-in person's entries: before this, the next person on a shared device was told
// "4 changes failed to sync" about someone else's writes, and Dismiss deleted them.
import ls from '../localStorageCompat';
import { expected, unexpected } from '../faults';
import type { QueueOp } from './types';
import { requeueOp } from './outbox';

const CONFLICTS_KEY = 'sync_conflicts';
const FAILED_KEY = 'sync_failed';
export type DeadLetterBucket = typeof CONFLICTS_KEY | typeof FAILED_KEY;

type Entry = QueueOp & { ownerUid?: string | null; error?: string };

function read(bucket: DeadLetterBucket): Entry[] {
  try { return ls.readJson<Entry[]>(bucket) || []; } catch { return []; }
}
function write(bucket: DeadLetterBucket, list: Entry[]): void {
  try {
    if (list.length) ls.setJson(bucket, list);
    else ls.removeBoth(bucket);
  } catch (e) { expected(e, `sync.deadLetter:persist:${bucket}`); }
}
const isOwners = (ownerUid: string | null) => (entry: Entry) => !!ownerUid && entry.ownerUid === ownerUid;

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
  // TD-24: a write that will never reach the cloud — an unexpected fault, in addition to the
  // dead-letter bucket the UI surfaces.
  unexpected(error, `sync.flushQueue:set-aside:${op.op}:${op.entity ?? ''}`);
  try {
    const list = ls.readJson<Entry[]>(FAILED_KEY) || [];
    list.push({ ...op, error: describeError(error) });
    try { ls.setJson(FAILED_KEY, list); } catch (e) { expected(e, 'sync.recordFailed:persist'); }
  } catch (e) { expected(e, 'sync.recordFailed'); }
}

/** PostgREST errors are plain objects: "[object Object]" told nobody anything (W3c). */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; message?: unknown; details?: unknown };
    const text = [e.code, e.message, e.details].filter(Boolean).map(String).join(' · ');
    if (text) return text;
  }
  return String(error);
}

/** The households and entities a person's entries in a bucket refer to (Dismiss re-reads them). */
export function deadLetterTargets(bucket: DeadLetterBucket, ownerUid: string | null): { householdId: string; entity: string }[] {
  const seen = new Set<string>();
  return read(bucket).filter(isOwners(ownerUid)).filter(op => op.entity).filter(op => {
    const key = `${op.householdId}:${op.entity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(op => ({ householdId: op.householdId, entity: op.entity as string }));
}

/** W3c — the households and entities the person's conflicts refer to (Dismiss re-reads them). */
export function conflictTargets(ownerUid: string | null): { householdId: string; entity: string }[] {
  return deadLetterTargets(CONFLICTS_KEY, ownerUid);
}

export function pendingConflictCount(ownerUid: string | null): number {
  return read(CONFLICTS_KEY).filter(isOwners(ownerUid)).length;
}

/** Drop the person's conflicts; anyone else's stay. */
export function clearConflicts(ownerUid: string | null): void {
  write(CONFLICTS_KEY, read(CONFLICTS_KEY).filter(entry => !isOwners(ownerUid)(entry)));
}

export function pendingFailedCount(ownerUid: string | null): number {
  return read(FAILED_KEY).filter(isOwners(ownerUid)).length;
}

/** Drop the person's set-aside writes; anyone else's stay. */
export function clearFailed(ownerUid: string | null): void {
  write(FAILED_KEY, read(FAILED_KEY).filter(entry => !isOwners(ownerUid)(entry)));
}

/**
 * F1a — entries recorded before the outbox stamped an owner (audit F6) carry none. They are given to
 * the device's cache owner at the same two points as ownerless queued writes (`adoptOwnerless`): that
 * person signing back in, or leaving. Never to whoever happens to sign in next.
 */
export function adoptOwnerlessDeadLetters(ownerUid: string): void {
  for (const bucket of [CONFLICTS_KEY, FAILED_KEY] as const) {
    const list = read(bucket);
    if (!list.some(entry => !entry.ownerUid)) continue;
    write(bucket, list.map(entry => (entry.ownerUid ? entry : { ...entry, ownerUid })));
  }
}

/**
 * Re-queue a dead-lettered op for another flush attempt (R5). For conflict ops
 * we strip `expectedUpdatedAt` so the retry is an unconditional last-write-wins;
 * retry counters reset so it isn't instantly re-dropped. Audit F6: retries
 * re-enter the durable outbox (owner-stamped to the retrying user); the caller
 * kicks the flush once this resolves.
 */
export async function retryDeadLettered(
  bucket: DeadLetterBucket,
  ownerUid: string | null,
): Promise<void> {
  try {
    const list = read(bucket);
    if (!list.length) return;
    const retained: typeof list = [];
    for (const op of list) {
      if (!isOwners(ownerUid)(op)) { retained.push(op); continue; }
      await requeueOp(
        { ...op, attempts: 0, nextRetryAt: undefined, expectedUpdatedAt: undefined },
        ownerUid,
      );
    }
    write(bucket, retained);
  } catch (e) { unexpected(e, 'deadLetter.retryAll'); }
}
