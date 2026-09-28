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
  const due = rows.filter(row => row.ownerUid === ownerUid).map(row => row.status === 'claimed'
    ? (row.claimedAt ?? 0) + CLAIM_STALE_MS + 1 : row.nextRetryAt ?? 0);
  return due.length ? Math.min(...due) : null;
}

export async function hasPendingEntity(ownerUid: string, householdId: string, entity: string, exceptOpId: string): Promise<boolean> {
  return (await getDriver().getAll()).some(row => row.ownerUid === ownerUid && row.householdId === householdId
    && row.entity === entity && row.opId !== exceptOpId);
}
