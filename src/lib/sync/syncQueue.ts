// Vyact — the optimistic write queue: persistence + op-validity (TD-26
// extraction from hybridAdapter.ts). Storage key and semantics are unchanged.
import ls from '../localStorageCompat';
import { unexpected } from '../faults';
import type { QueueOp } from './types';

const QUEUE_KEY = 'sync_queue';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A queued op is syncable only if any id it carries is a valid UUID (cloud PK
// columns are uuid). Ops without an id (updateProfile, upsertRate, replaceAll)
// are always allowed; the entity-row ops (upsert/remove) must carry a UUID.
export function isQueueOpIdValid(op: QueueOp): boolean {
  if (op.op === 'remove') return typeof op.id === 'string' && UUID_RE.test(op.id);
  if (op.op === 'upsert') {
    const id = (op.payload as { id?: string } | undefined)?.id;
    return typeof id === 'string' && UUID_RE.test(id);
  }
  return true;
}

export function readQueue(): QueueOp[] {
  try {
    return ls.readJson<QueueOp[]>(QUEUE_KEY) || [];
  } catch { return []; }
}

export function writeQueue(q: QueueOp[]): void {
  // TD-24: failing to persist the queue loses pending writes on reload — that
  // is silent data loss, not a best-effort noop. Classify it as unexpected.
  try { ls.setJson(QUEUE_KEY, q); } catch (e) { unexpected(e, 'sync.writeQueue:persist'); }
}

export function enqueue(op: QueueOp): void {
  const queue = readQueue();
  queue.push(op);
  writeQueue(queue);
}
