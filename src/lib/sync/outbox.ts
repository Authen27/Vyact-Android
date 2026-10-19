// Vyact — the transactional outbox (audit F6). Replaces the localStorage
// read-modify-write queue that could lose an op enqueued while a flush was
// in flight (flush snapshotted the queue, awaited network, then OVERWROTE the
// file with its own `remaining` list — erasing anything appended meanwhile).
//
// THE CONTRACT
//   • One durable row per operation (IndexedDB), keyed by a stable opId.
//   • Enqueue is an insert; it can never erase another op.
//   • A flush CLAIMS a batch (status + worker id + timestamp), performs the
//     cloud writes, and ACKs by opId — deleting exactly the rows that
//     succeeded. Ops enqueued during the flush are simply still there.
//   • A claim goes stale after CLAIM_STALE_MS, so a tab that dies mid-flush
//     doesn't hold its ops hostage from other tabs.
//   • Every op is stamped with its owner's uid. A flush claims only the
//     current user's ops. Unowned/legacy ops remain quarantined, so on a shared device
//     user B's session never attempts — and dead-letters — user A's pending
//     writes (audit S5's "pending offline writes belonging to a previous
//     user" case). A's ops wait for A.
//   • Multi-tab serialisation lives in HybridAdapter via the Web Locks API;
//     this module stays storage-only and is fully testable in Node through
//     the memory driver.
//
// The legacy `sync_queue` localStorage key is migrated in once, then removed.

import ls from '../localStorageCompat';
import { uid } from '../format';
import { unexpected } from '../faults';
import type { QueueOp } from './types';
import { IdbDriver, type OutboxDriver } from './outboxStore';
export { IdbDriver, MemoryDriver, type OutboxDriver } from './outboxStore';

export interface StoredOp extends QueueOp {
  opId: string;
  seq: number;
  status: 'pending' | 'claimed';
  claimedBy?: string;
  claimedAt?: number;
  /** uid of the user who made the write; null = legacy/local-only. */
  ownerUid: string | null;
}

const CLAIM_STALE_MS = 60_000;
const LEGACY_KEY = 'sync_queue';

// ── IndexedDB driver (browser) ─────────────────────────────────────────────


// ── Module state (lazy — this module is imported at app boot) ──────────────

let driver: OutboxDriver | null = null;
let migration: Promise<void> | null = null;
let lastKnownCount = 0;

/** Test hook: inject a driver (null resets to the environment default). */
export function setDriverForTests(d: OutboxDriver | null): void {
  driver = d;
  migration = null;
  lastKnownCount = 0;
}

function getDriver(): OutboxDriver {
  if (!driver) {
    if (typeof indexedDB === 'undefined') throw new Error('Durable outbox requires IndexedDB');
    driver = new IdbDriver();
  }
  return driver;
}

/** One-time import of the legacy localStorage queue. */
async function migrateLegacyOnce(): Promise<void> {
  migration ??= (async () => {
    const legacy = ls.readJson<QueueOp[]>(LEGACY_KEY) ?? [];
    if (!legacy.length) return;
    await getDriver().transaction(rows => {
      let seq = [...rows.values()].reduce((max, row) => Math.max(max, row.seq), 0);
      legacy.forEach((op, index) => {
        const opId = `legacy:${index}:${JSON.stringify(op)}`;
        if (!rows.has(opId)) rows.set(opId, { ...op, opId, seq: ++seq, status: 'pending', ownerUid: null });
      });
    });
    if (JSON.stringify(ls.readJson(LEGACY_KEY)) === JSON.stringify(legacy)) ls.removeBoth(LEGACY_KEY);
  })().catch(error => { migration = null; throw error; });
  await migration;
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Append one durable op. Never modifies or removes another op. */
export async function enqueueOp(op: QueueOp, ownerUid: string | null): Promise<StoredOp> {
  try {
    await migrateLegacyOnce();
    const stored = await getDriver().transaction(rows => {
      const seq = [...rows.values()].reduce((max, row) => Math.max(max, row.seq), 0) + 1;
      const next: StoredOp = { ...op, opId: uid(), seq, status: 'pending', ownerUid };
      rows.set(next.opId, next);
      return next;
    });
    await pendingCount();
    return stored;
  } catch (e) {
    // A failed enqueue is silent write-loss — the binding rule applies.
    unexpected(e, 'sync.outbox:enqueue');
    throw e;
  }
}

/**
 * Claim the due ops for one worker: pending (or stale-claimed), past their
 * backoff window, owned by this user, oldest first per entity.
 */
/**
 * F1c (v10.112.0; audit INT-TXN-11) — a split's sharing step references its transaction, so it waits
 * while any earlier write of that transaction is still queued. It has its own lane (`shareSplit`), so a
 * share that keeps failing never holds up the household's transactions.
 */
function waitsForItsTransaction(op: StoredOp, rows: Iterable<StoredOp>): boolean {
  if (op.op !== 'shareSplit') return false;
  const txnId = (op.payload as { txnId?: string } | undefined)?.txnId;
  for (const other of rows) {
    if (other.seq < op.seq && other.ownerUid === op.ownerUid && other.householdId === op.householdId
        && other.entity === 'transactions' && ((other.payload as { id?: string } | undefined)?.id ?? other.id) === txnId) {
      return true;
    }
  }
  return false;
}

export async function claimDue(workerId: string, now: number, ownerUid: string | null): Promise<StoredOp[]> {
  await migrateLegacyOnce();
  if (!ownerUid) return [];
  return getDriver().transaction(rows => {
    const claimed: StoredOp[] = [];
    const blocked = new Set<string>();
    for (const op of [...rows.values()].sort((left, right) => left.seq - right.seq)) {
      if (op.ownerUid !== ownerUid) continue;
      const resource = `${op.householdId}:${op.entity ?? op.op}`;
      if (blocked.has(resource)) continue;
      blocked.add(resource);
      if (waitsForItsTransaction(op, rows.values())) continue;   // F1c: claimed once its transaction lands
      if ((op.status === 'claimed' && (op.claimedAt ?? 0) >= now - CLAIM_STALE_MS)
          || (op.nextRetryAt ?? 0) > now) continue;
      const next: StoredOp = { ...op, status: 'claimed', claimedBy: workerId, claimedAt: now };
      rows.set(op.opId, next);
      claimed.push(next);
    }
    lastKnownCount = rows.size;
    return claimed;
  });
}

/** Acknowledge a completed op — delete exactly that row. */
export async function ack(opId: string, workerId?: string, serverRevision?: string): Promise<void> {
  await getDriver().transaction(rows => {
    const current = rows.get(opId);
    if (!current || (workerId && current.claimedBy !== workerId)) return;
    rows.delete(opId);
    if (serverRevision && current.op === 'upsert') {
      const entityId = (current.payload as { id?: string })?.id;
      const next = [...rows.values()].filter(row => row.ownerUid === current.ownerUid
        && row.householdId === current.householdId && row.entity === current.entity && row.op === 'upsert'
        && (row.payload as { id?: string })?.id === entityId && row.seq > current.seq)
        .sort((left, right) => left.seq - right.seq)[0];
      if (next) rows.set(next.opId, { ...next, expectedUpdatedAt: serverRevision });
    }
  });
  await pendingCount();
}

/** Return a claimed op to pending with an updated backoff patch (retry). */
export async function release(op: StoredOp, patch: Partial<QueueOp>): Promise<void> {
  await getDriver().transaction(rows => {
    const current = rows.get(op.opId);
    if (!current || current.claimedBy !== op.claimedBy) return;
    rows.set(op.opId, { ...current, ...patch, opId: current.opId, ownerUid: current.ownerUid,
      status: 'pending', claimedBy: undefined, claimedAt: undefined });
  });
}

/** Re-add an op from a dead-letter bucket (R5 retry path). */
export async function requeueOp(op: QueueOp, ownerUid: string | null): Promise<void> {
  await enqueueOp(op, ownerUid);
}

/** Authoritative count (also refreshes the synchronous badge value). */
export async function pendingCount(ownerUid?: string | null): Promise<number> {
  await migrateLegacyOnce();
  const all = await getDriver().getAll();
  const n = ownerUid === undefined
    ? all.length
    : all.filter(o => o.ownerUid === ownerUid).length;
  lastKnownCount = n;
  return n;
}

/** Best-known synchronous count for UI badges; refreshed on every mutation. */
export function pendingCountSync(): number {
  return lastKnownCount;
}

export async function nextWakeAt(ownerUid: string): Promise<number | null> {
  const rows = await getDriver().getAll();
  // W8a (audit FE-SYN-11): only each resource's HEAD op can be claimed (claimDue blocks the rest behind
  // it), so only heads decide the wake time. A follower with no backoff used to read as "due now" while
  // its head waited out a backoff, and the flush loop polled every 100 ms for the whole wait.
  const heads = new Map<string, StoredOp>();
  for (const row of [...rows].sort((left, right) => left.seq - right.seq)) {
    if (row.ownerUid !== ownerUid) continue;
    const resource = `${row.householdId}:${row.entity ?? row.op}`;
    if (!heads.has(resource)) heads.set(resource, row);
  }
  // F1c: a sharing step waiting for its transaction is woken by that transaction's own head, never "now".
  const due = [...heads.values()].filter(row => !waitsForItsTransaction(row, rows)).map(row => row.status === 'claimed'
    ? (row.claimedAt ?? 0) + CLAIM_STALE_MS + 1 : row.nextRetryAt ?? 0);
  return due.length ? Math.min(...due) : null;
}

/**
 * F1b (v10.111.0; audit INT-TXN-10) — the rows of one household's entity that still have a write
 * queued, each mapped to its latest write. A cloud pull leaves exactly these rows as the device has
 * them (`overlayQueued`). Only the given owner's ops count: the cache belongs to them.
 */
export async function queuedWrites(ownerUid: string | null, householdId: string, entity: string): Promise<Map<string, 'upsert' | 'remove'>> {
  const out = new Map<string, 'upsert' | 'remove'>();
  if (!ownerUid) return out;
  const rows = (await getDriver().getAll())
    .filter(row => row.ownerUid === ownerUid && row.householdId === householdId && row.entity === entity
      && (row.op === 'upsert' || row.op === 'remove'))
    .sort((left, right) => left.seq - right.seq);
  for (const row of rows) {
    const id = (row.payload as { id?: string } | undefined)?.id ?? row.id;
    if (id) out.set(id, row.op as 'upsert' | 'remove');
  }
  return out;
}

/** W3c — is another op for this ROW still queued? (The fold-back used to check the whole entity.) */
export async function hasPendingRow(ownerUid: string, householdId: string, entity: string, id: string, exceptOpId: string): Promise<boolean> {
  return (await getDriver().getAll()).some(row => row.ownerUid === ownerUid && row.householdId === householdId
    && row.entity === entity && row.opId !== exceptOpId
    && ((row.payload as { id?: string } | undefined)?.id ?? row.id) === id);
}

/**
 * W3c — remove and return the ops queued AFTER `op` for the same row. When the database rejects a
 * write for good, every later write to that row carries the same change and would fail the same way;
 * they are dead-lettered together and the row is rolled back to before the first one.
 */
export async function takeLaterOpsForRow(op: StoredOp): Promise<StoredOp[]> {
  const id = (op.payload as { id?: string } | undefined)?.id ?? op.id;
  if (!id || !op.entity) return [];
  const taken = await getDriver().transaction(rows => {
    const later = [...rows.values()].filter(row => row.ownerUid === op.ownerUid && row.householdId === op.householdId
      && row.entity === op.entity && row.seq > op.seq
      && ((row.payload as { id?: string } | undefined)?.id ?? row.id) === id);
    for (const row of later) rows.delete(row.opId);
    return later;
  });
  await pendingCount();
  return taken;
}

/**
 * W3c (audit FE-SYN-03) — give ownerless ops (queued while the session could not be read, or migrated
 * from the pre-outbox queue) to the user they belong to. Called ONLY where that user is known for
 * certain: the same user returning (the cache owner is them), and sign-out / a switch of user (the
 * outgoing owner) — never at flush time, which would let the NEXT user upload them.
 */
export async function adoptOwnerless(ownerUid: string): Promise<number> {
  await migrateLegacyOnce();
  const n = await getDriver().transaction(rows => {
    let count = 0;
    for (const [opId, row] of rows) {
      if (row.ownerUid === null) { rows.set(opId, { ...row, ownerUid }); count++; }
    }
    return count;
  });
  return n;
}

export async function hasPendingEntity(ownerUid: string, householdId: string, entity: string, exceptOpId: string): Promise<boolean> {
  return (await getDriver().getAll()).some(row => row.ownerUid === ownerUid && row.householdId === householdId
    && row.entity === entity && row.opId !== exceptOpId);
}
