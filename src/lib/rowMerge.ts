// Vyact — row-by-row merging of lists keyed by id (v10.111.0; Track F1b, audit FE-SYN-06 and
// INT-TXN-10; owner decision 18 Oct 2026: "row-level merge").
//
// A save shows at once and stays on screen until its write lands. Two readers used to undo that:
//   • a refresh that read the device's copy BEFORE a save and applied AFTER it put the old list back
//     (the store; `keepLocalChanges`);
//   • a cloud pull replaced a row whose write was still queued: an edit reverted, a delete came back,
//     a row created offline vanished until it was sent (the cache; `overlayQueued`).
// Pure: no store, no storage.

type Row = { id: string };

/** The list with `row` in place of the row with its id, or appended. */
export function withRow<T extends Row>(rows: readonly T[], row: T): T[] {
  const index = rows.findIndex(existing => existing.id === row.id);
  if (index < 0) return [...rows, row];
  const next = [...rows];
  next[index] = row;
  return next;
}

/** The list with each of `changed` in place of its row, or appended (one pass). */
export function withRows<T extends Row>(rows: readonly T[], changed: readonly T[]): T[] {
  if (!changed.length) return [...rows];
  const byId = new Map(changed.map(row => [row.id, row]));
  const next = rows.map(row => {
    const replacement = byId.get(row.id);
    if (!replacement) return row;
    byId.delete(row.id);
    return replacement;
  });
  return [...next, ...byId.values()];
}

/** The list without the row with this id. */
export function withoutRow<T extends Row>(rows: readonly T[], id: string): T[] {
  return rows.filter(row => row.id !== id);
}

/**
 * The store's side (FE-SYN-06). `fresh` is what a refresh read; `before` and `now` are the store's
 * list when the refresh started and when it lands. A row this device changed, added or deleted in
 * between keeps its on-screen state; every other row takes the refresh. The store replaces a row's
 * object whenever it changes it, so "changed in between" is an identity check against `before`.
 */
export function keepLocalChanges<T extends Row>(fresh: T[], before: readonly T[], now: readonly T[]): T[] {
  if (before === now) return fresh;
  const beforeById = new Map(before.map(row => [row.id, row]));
  const nowById = new Map(now.map(row => [row.id, row]));
  const touched = new Set<string>();
  for (const row of now) if (beforeById.get(row.id) !== row) touched.add(row.id);
  for (const row of before) if (!nowById.has(row.id)) touched.add(row.id);
  if (!touched.size) return fresh;
  const out: T[] = [];
  const placed = new Set<string>();
  for (const row of fresh) {
    if (!touched.has(row.id)) { out.push(row); continue; }
    const mine = nowById.get(row.id);
    if (mine) { out.push(mine); placed.add(row.id); }   // edited here: keep it; deleted here: leave it out
  }
  for (const row of now) if (touched.has(row.id) && !placed.has(row.id)) out.push(row);   // added here
  return out;
}

/** What the outbox still holds for a row: its latest queued write. */
export type QueuedWrite = 'upsert' | 'remove';

/**
 * The cache's side (INT-TXN-10). `fresh` is the cloud's list; `cached` is the device's copy; `queued`
 * maps each row id with a write still waiting to be sent to that write. A queued edit or new row keeps
 * the device's version and a queued delete stays deleted; every other row takes the cloud's. Once the
 * write lands, the server's row replaces the device's (the flush folds it back).
 */
export function overlayQueued<T extends Row>(fresh: readonly T[], cached: readonly T[], queued: ReadonlyMap<string, QueuedWrite>): T[] {
  if (!queued.size) return [...fresh];
  const local = new Map(cached.map(row => [row.id, row]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const row of fresh) {
    seen.add(row.id);
    const write = queued.get(row.id);
    if (write === 'remove') continue;
    out.push(write === 'upsert' ? (local.get(row.id) ?? row) : row);
  }
  for (const [id, write] of queued) {
    const mine = local.get(id);
    if (write === 'upsert' && !seen.has(id) && mine) out.push(mine);
  }
  return out;
}

/**
 * The cache's side for a delta pull: the changed rows and tombstones the cloud returned, applied to the
 * device's copy, except where a write is still queued (as `overlayQueued`). A row the copy already holds
 * at the same server revision is left alone, so the pull's overlap window (F1b) re-reads rows without
 * rewriting the list. Returns `cached` itself when nothing changes.
 */
export function mergeCloudDelta<T extends Row & { updated_at?: string }>(
  cached: T[], rows: readonly T[], tombstones: readonly string[], queued: ReadonlyMap<string, QueuedWrite>,
): T[] {
  const byId = new Map(cached.map(row => [row.id, row]));
  const changed = rows.filter(row => {
    if (!row?.id || queued.has(row.id)) return false;
    const mine = byId.get(row.id);
    return !(mine && mine.updated_at !== undefined && mine.updated_at === row.updated_at);
  });
  const removed = new Set(tombstones.filter(id => !queued.has(id) && byId.has(id)));
  if (!changed.length && !removed.size) return cached;
  return withRows(cached, changed).filter(row => !removed.has(row.id));
}

/**
 * F1b (audit FE-SYN-07, DB-OPS-10) — where a delta pull starts: `overlapMs` before the cursor. A row's
 * updated_at is when its database transaction STARTED, so a slower transaction can commit after rows
 * stamped later were already pulled, behind the cursor. Re-reading the window picks it up; rows already
 * held are skipped (`mergeCloudDelta`). A bare timestamp, so the first page reads `>=` it.
 */
export function overlapStart(cursor: string, overlapMs: number): string {
  const bar = cursor.indexOf('|');
  const at = Date.parse(bar < 0 ? cursor : cursor.slice(0, bar));
  return Number.isNaN(at) ? cursor : new Date(at - overlapMs).toISOString();
}

/** Whether delta cursor `a` (`<updated_at>|<id>`) is past `b`. */
export function cursorAfter(a: string, b: string): boolean {
  const split = (cursor: string): [string, string] => {
    const bar = cursor.indexOf('|');
    return bar < 0 ? [cursor, ''] : [cursor.slice(0, bar), cursor.slice(bar + 1)];
  };
  const [ta, ia] = split(a);
  const [tb, ib] = split(b);
  const pa = Date.parse(ta);
  const pb = Date.parse(tb);
  if (!Number.isNaN(pa) && !Number.isNaN(pb) && pa !== pb) return pa > pb;
  return ta === tb ? ia > ib : ta > tb;   // same millisecond: the microseconds, then the id
}
