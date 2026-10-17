// Vyact v4.1 — HybridAdapter
// Reads-from-cache-first / writes-go-to-both pattern.
//   • Render path: instant paint from LocalStorage cache
//   • Background: refresh cache from Supabase
//   • Writes: optimistic local + queue + flush to cloud
//   • Offline: queue persists; flushes on reconnect
//
// This is the production adapter. SupabaseAdapter alone works but blocks the
// UI on every read; HybridAdapter is what FinFlow ships with.
//
// TD-26: the sync-queue mechanics (persistence, op-validity, dead-lettering,
// backoff, conflict resolution) live in `./sync/*`. This file keeps the
// cache-first read/no-clobber policy and a thin flush orchestrator that
// delegates to those modules.

import type {
  Profile, HouseholdMeta, ProfileTypeKey, Budget, BudgetAllocation,
  Transaction, Debt, Account, PayLoanCommand, PayLoanResult, LoanDue,
  AccountDependencies, AccountMoveResult,
} from '../types';
import {
  type DataAdapter, type Entity, LocalStorageAdapter,
} from './dataAdapter';
import ls from './localStorageCompat';
import { cacheGeneration, isCacheGenerationCurrent } from './kvStore';
import { SupabaseAdapter, ConcurrencyConflictError } from './supabaseAdapter';
import { droppedWrite, expected, unexpected } from './faults';
import { mergeSnapshot, type NetWorthSnapshot } from './netWorthSnapshots';
import { uid } from './format';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as syncQueue from './sync/syncQueue';
import * as outbox from './sync/outbox';
import * as deadLetter from './sync/deadLetter';
import { classifyFlushError } from './sync/conflict';
import { cacheOwnerUid } from './cacheInvalidation';

export class HybridAdapter implements DataAdapter {
  cache: LocalStorageAdapter;
  cloud: SupabaseAdapter;
  private flushing = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleFlush(at: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flushQueue().catch(error => unexpected(error, 'sync.retry'));
    }, Math.max(100, at - Date.now()));
  }
  /** Audit F6 — identifies this tab's flush worker in outbox claims. */
  private workerId = uid();

  // ── W3c (v10.67.0; audit FE-SYN-01, INT-TXN-02) — server revisions, never the device clock ──
  // The cache keeps the SERVER's updated_at. After one of THIS device's writes lands, the server
  // gives the row a new revision; the app's own copy still holds the revision it edited from. That
  // pair is remembered, so the next edit (made on top of our own write) is sent with the new
  // revision instead of failing as a false conflict. A genuine edit from another device still
  // changes the revision underneath and is still caught.
  private ownRevisions = new Map<string, { from?: string; to: string }>();
  private rowKey(entity: string, householdId: string, id: string): string { return `${householdId}:${entity}:${id}`; }
  private preconditionFor(entity: Entity, householdId: string, id: string, expectedUpdatedAt?: string): string | undefined {
    const own = this.ownRevisions.get(this.rowKey(entity, householdId, id));
    return own && own.from === expectedUpdatedAt ? own.to : expectedUpdatedAt;
  }

  // W3c — the store re-reads the cache when a rejected write is rolled back (or a conflict is
  // dismissed). Background syncs do NOT notify: the store's refresh would start another sync.
  private cacheListeners = new Set<() => void>();
  onCacheChanged(listener: () => void): () => void {
    this.cacheListeners.add(listener);
    return () => { this.cacheListeners.delete(listener); };
  }
  private emitCacheChanged(): void {
    for (const listener of this.cacheListeners) {
      try { listener(); } catch (e) { unexpected(e, 'sync:cacheListener'); }
    }
  }

  /**
   * W3c (audit FE-SYN-03) — who a queued write belongs to. The session can be unreadable (its token
   * expired while offline) while the device's cache owner is still signed in; stamping null then
   * meant the write was never flushed. Never null in cloud mode while the cache has an owner.
   */
  private async ownerForWrite(): Promise<string | null> {
    return (await this.cloud.currentUserId()) ?? cacheOwnerUid();
  }

  // v10.30.0 — cloud-freshness bookkeeping for the Net Worth snapshot writer.
  // `cloudAppliedAt`: when a cloud read for household:entity last landed in the
  // cache THIS session. `servedFresh`: whether the most recent list() for that
  // key returned rows a cloud read had already confirmed.
  private cloudAppliedAt = new Map<string, number>();
  private servedFresh = new Map<string, boolean>();
  private noteCloudApplied(entity: Entity, householdId: string): void {
    this.cloudAppliedAt.set(`${householdId}:${entity}`, Date.now());
  }

  constructor(client: SupabaseClient) {
    this.cache = new LocalStorageAdapter();
    this.cloud = new SupabaseAdapter(client);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => { this.flushQueue(); });
    }
  }

  // ── Read path: cache first, then refresh in background ─────
  // v6.4: A previous implementation unconditionally replaced the local cache
  // with whatever the cloud returned. If the cloud returned [] for any
  // reason — transient RLS hiccup, schema not deployed, momentary empty
  // response, network glitch surfacing as 200 — the local cache (and thus
  // every page in the app on the next refresh) was wiped. That was the root
  // cause of "data lost on refresh / sign-out → sign-in".
  //
  // Rules now:
  //   1. Cloud throws  → leave cache untouched.
  //   2. Cloud returns non-empty → replace cache, mark sentinel as synced.
  //   3. Cloud returns [] AND we have prior cache rows AND we have NOT yet
  //      observed a non-empty success for this (hid, entity) → treat as
  //      transient, leave cache untouched. A "force resync" can override.
  //   4. Cloud returns [] AND sentinel says we've synced before → trust the
  //      empty (the user really did delete everything) and clear cache.
  async list<T = unknown>(entity: Entity, householdId: string): Promise<T[]> {
    // v10.20.8 — capture the cache generation BEFORE any cloud read. If the
    // session changes while this request is in flight, the response belongs to
    // the previous user and must not be written into the new one's cache.
    const gen = cacheGeneration();
    const freshKey = `${householdId}:${entity}`;
    const servedAt = Date.now();
    const cached = await this.cache.list<T>(entity, householdId);
    // TD-06: prefer the incremental path once we have a cursor. The cursor
    // is only set after a successful full pull, so the first sync per
    // (hid, entity) still goes through `list()` and replaces the cache
    // wholesale (preserving the v6.4 no-clobber semantics).
    const cursor = entity === 'members' ? null : this.readCursor(entity, householdId);
    // v7.0.2: Cold-start await. On the very first login on a fresh device
    // the cache is empty AND we've never recorded a sync sentinel. The
    // previous fire-and-forget path returned [] immediately, the store
    // settled to empty, and the dashboard rendered blank — only a manual
    // refresh picked up the cloud rows that landed milliseconds later in
    // the cache. We now await the initial pull in that one case so the
    // first paint already has data. Returning users still get the snappy
    // stale-while-revalidate behaviour because `hasSynced` is true for them.
    const coldStart = !cursor && cached.length === 0 && !this.hasSynced(entity, householdId);
    if (coldStart) {
      try {
        const fresh = await this.cloud.list<T>(entity, householdId);
        await this.applyCloudList(entity, householdId, cached as unknown[], fresh as unknown[], gen);
        this.servedFresh.set(freshKey, this.cloudAppliedAt.has(freshKey));
        return await this.cache.list<T>(entity, householdId);
      } catch {
        // Network error on first load — fall through to cached []. The
        // user sees an empty state instead of a hang; next refresh retries.
        this.servedFresh.set(freshKey, false);
        return cached;
      }
    }
    if (cursor) {
      this.cloud.listSince(entity as Exclude<Entity, 'members'>, householdId, cursor)
        .then(delta => this.applyCloudDelta(entity, householdId, delta, gen))
        .catch(() => {/* network error — cache stays */});
    } else {
      this.cloud.list<T>(entity, householdId)
        .then(fresh => this.applyCloudList(entity, householdId, cached as unknown[], fresh as unknown[], gen))
        .catch(() => {/* network error — cache stays */});
    }
    // Served from cache: fresh only if a cloud read had landed before this read began.
    const appliedAt = this.cloudAppliedAt.get(freshKey);
    this.servedFresh.set(freshKey, appliedAt !== undefined && appliedAt <= servedAt);
    return cached;
  }

  private hasSynced(entity: Entity, householdId: string): boolean {
    try {
      return ls.readString(`cloud_synced_${householdId}_${entity}`) === '1';
    } catch { return false; }
  }
  private markSynced(entity: Entity, householdId: string): void {
    try { ls.setString(`cloud_synced_${householdId}_${entity}`, '1'); } catch { /* noop */ }
  }
  private async applyCloudList(entity: Entity, householdId: string, cached: unknown[], fresh: unknown[], gen?: number): Promise<void> {
    // A purge ran while this read was in flight — the rows belong to a session
    // that has ended. Writing them would re-seed the cache we just cleared,
    // which is how a second user on a shared device was shown the first
    // user's data even after invalidation.
    if (gen !== undefined && !isCacheGenerationCurrent(gen)) return;
    if (fresh.length > 0) {
      await this.cache.replaceAll(entity, householdId, fresh);
      this.markSynced(entity, householdId);
      this.noteCloudApplied(entity, householdId);
      // TD-06: seed the delta-sync cursor with the max(updated_at) of the
      // freshly pulled page so the next refresh can skip straight to a
      // bounded `updated_at > cursor` query.
      if (entity !== 'members') this.seedCursorFromRows(entity, householdId, fresh);
      return;
    }
    // fresh is empty
    if (cached.length === 0 || this.hasSynced(entity, householdId)) {
      // Either the cache was already empty (no-op) or we trust this empty.
      await this.cache.replaceAll(entity, householdId, fresh);
      this.markSynced(entity, householdId);
      this.noteCloudApplied(entity, householdId);
      return;
    }
    // Defensive: cached has data, we've never seen a non-empty cloud
    // response for this (hid, entity). Treat as transient, keep cache.
    if (typeof console !== 'undefined') {
      console.warn(`[Vyact sync] Empty cloud response for ${entity}@${householdId}; keeping ${cached.length} cached rows. Use forceFullResync to override.`);
    }
  }

  // TD-06 cursor plumbing. The cursor is the largest `updated_at` we've
  // already merged into the local cache for this (hid, entity). Stored
  // per-device so each tab/browser drives its own incremental pull.
  private cursorKey(entity: Entity, householdId: string): string {
    return `cursor_${householdId}_${entity}`;
  }
  private readCursor(entity: Entity, householdId: string): string | null {
    try { return ls.readString(this.cursorKey(entity, householdId)) || null; } catch { return null; }
  }
  private writeCursor(entity: Entity, householdId: string, value: string): void {
    try { ls.setString(this.cursorKey(entity, householdId), value); } catch { /* noop */ }
  }
  private seedCursorFromRows(entity: Entity, householdId: string, rows: unknown[]): void {
    // Audit F8 — seed the COMPOSITE (updated_at, id) cursor so a burst of
    // same-millisecond rows cannot strand the delta sync on a repeated page.
    let maxU: string | null = null;
    let maxI: string | null = null;
    for (const r of rows) {
      const row = r as { id?: string; updated_at?: string } | null;
      if (!row?.updated_at) continue;
      if (!maxU || row.updated_at > maxU
          || (row.updated_at === maxU && (row.id ?? '') > (maxI ?? ''))) {
        maxU = row.updated_at;
        maxI = row.id ?? '';
      }
    }
    if (maxU) this.writeCursor(entity, householdId, `${maxU}|${maxI ?? ''}`);
  }

  private async applyCloudDelta(
    entity: Entity,
    householdId: string,
    delta: { rows: unknown[]; tombstones: string[]; maxUpdatedAt: string | null },
    gen: number,
  ): Promise<void> {
    if (!isCacheGenerationCurrent(gen)) return;
    // Empty delta is the steady-state happy path — nothing changed since the
    // cursor. No cache touch, no cursor bump.
    if (delta.rows.length === 0 && delta.tombstones.length === 0) {
      this.noteCloudApplied(entity, householdId);   // the cloud confirmed nothing changed
      return;
    }
    for (const row of delta.rows) {
      if (!isCacheGenerationCurrent(gen)) return;
      const r = row as { id?: string };
      if (!r.id) continue;
      await this.cache.put(entity, householdId, r as { id: string });   // W3c: the server's own updated_at
    }
    for (const id of delta.tombstones) {
      if (!isCacheGenerationCurrent(gen)) return;
      try { await this.cache.remove(entity, householdId, id); } catch { /* row may already be gone */ }
    }
    if (delta.maxUpdatedAt && isCacheGenerationCurrent(gen)) this.writeCursor(entity, householdId, delta.maxUpdatedAt);
    if (isCacheGenerationCurrent(gen)) this.noteCloudApplied(entity, householdId);
  }

  /** Clear the synced sentinel for a household so the next list() treats
   *  empty cloud responses as transient again. Call when you suspect
   *  cache corruption or want to re-trust the cloud. */
  forceFullResync(householdId: string): void {
    const entities: Entity[] = ['transactions','budgets','goals','debts','assets','members','accounts','savedViews','recurring','budgetAllocations'];
    for (const e of entities) {
      try { ls.removeBoth(`cloud_synced_${householdId}_${e}`); } catch { /* noop */ }
      // TD-06: also drop the delta-sync cursor so the next list() refills it.
      try { ls.removeBoth(`cursor_${householdId}_${e}`); } catch { /* noop */ }
    }
  }

  // ── Write path: cache + durable outbox + try flush ─────────
  async upsert<T extends { id?: string }>(entity: Entity, householdId: string, record: T, expectedUpdatedAt?: string): Promise<T & { id: string }> {
    // The cache write always succeeds — it's per-tab and not subject to
    // cross-user concurrency. The version precondition only applies to
    // the cloud leg, which is queued and flushed below.
    const id = record.id || uid();
    const before = await this.cache.getById<{ id: string; updated_at?: string }>(entity, householdId, id);
    // W3c: the cached row keeps the SERVER revision it had (none yet for a new row) — the device
    // clock must never become the next edit's precondition.
    const local = await this.cache.put(entity, householdId,
      { ...record, id, updated_at: before?.updated_at ?? undefined } as T & { id: string });
    // Audit F6: the outbox insert is durable and can never erase another op.
    // Owner-stamped so another user's session on this device never flushes it.
    await outbox.enqueueOp(
      { ts: Date.now(), op: 'upsert', entity, householdId, payload: local,
        expectedUpdatedAt: this.preconditionFor(entity, householdId, id, expectedUpdatedAt), before: before ?? null },
      await this.ownerForWrite(),
    );
    void this.flushQueue();
    return local;
  }
  async remove(entity: Entity, householdId: string, id: string): Promise<void> {
    const before = await this.cache.getById<{ id: string }>(entity, householdId, id);
    await this.cache.remove(entity, householdId, id);
    await outbox.enqueueOp(
      { ts: Date.now(), op: 'remove', entity, householdId, id, before: before ?? null },
      await this.ownerForWrite(),
    );
    void this.flushQueue();
  }
  async createBudgetChecked(householdId: string, budget: Partial<Budget>): Promise<Budget> {
    // Budgets are period singletons → create is an ONLINE, synchronous check
    // against the DB authority (not the optimistic queue), so a duplicate (incl.
    // another member's unsynced one) is rejected up front rather than silently
    // dead-lettered. The returned, DB-id'd row is then written to cache.
    const saved = await this.cloud.createBudgetChecked(householdId, budget);
    try { await this.cache.put('budgets', householdId, saved); } catch { /* cache is best-effort */ }
    return saved;
  }
  async upsertBudgetWithAllocations(
    householdId: string,
    budget: Partial<Budget>,
    allocations: Partial<BudgetAllocation>[],
    mode: 'create' | 'replace',
  ): Promise<{ budget: Budget; allocations: BudgetAllocation[] }> {
    // Online-synchronous (like createBudgetChecked): the atomic RPC is the
    // durability boundary, NOT the optimistic queue — so a child allocation can no
    // longer silently dead-letter into vt_sync_failed and never reach the cloud.
    const res = await this.cloud.upsertBudgetWithAllocations(householdId, budget, allocations, mode);
    // Seed cache with the authoritative rows (best-effort): the budget + a SCOPED
    // replace of just this budget's allocations (preserve other budgets' cached rows).
    try { await this.cache.put('budgets', householdId, res.budget); } catch { /* best-effort */ }
    try {
      const cached = await this.cache.list('budgetAllocations', householdId) as Array<{ budgetId?: string }>;
      const others = cached.filter(a => a.budgetId !== res.budget.id);
      await this.cache.replaceAll('budgetAllocations', householdId, [...others, ...res.allocations]);
    } catch { /* best-effort */ }
    return res;
  }
  async replaceAll<T = unknown>(entity: Entity, householdId: string, records: T[]): Promise<T[]> {
    await this.cache.replaceAll(entity, householdId, records);
    await outbox.enqueueOp(
      { ts: Date.now(), op: 'replaceAll', entity, householdId, payload: records },
      await this.ownerForWrite(),
    );
    void this.flushQueue();
    return records;
  }

  // Profile is per-user in cloud; cache it locally per-household for parity.
  async updateProfile(householdId: string, patch: Partial<Profile>): Promise<Profile> {
    await this.cache.updateProfile(householdId, patch);
    await outbox.enqueueOp(
      { ts: Date.now(), op: 'updateProfile', householdId, payload: patch },
      await this.ownerForWrite(),
    );
    void this.flushQueue();
    return (await this.getProfile(householdId))!;
  }
  async getProfile(householdId: string): Promise<Profile | null> {
    // Try cloud first for source of truth, fall back to cache
    try {
      const cloud = await this.cloud.getProfile(householdId);
      if (cloud) {
        await this.cache.updateProfile(householdId, cloud);
        return cloud;
      }
    } catch { /* offline — use cache */ }
    return this.cache.getProfile(householdId);
  }

  // v7.3 — pre-aggregated breakouts. Forward to cloud only; the cache is
  // raw txns, so callers fold client-side when these throw / undefined.
  async queryTxnByMember(householdId: string) {
    if (!this.cloud.queryTxnByMember) return undefined;
    try { return await this.cloud.queryTxnByMember(householdId); }
    catch { return undefined; }
  }
  async queryTxnByAccount(householdId: string) {
    if (!this.cloud.queryTxnByAccount) return undefined;
    try { return await this.cloud.queryTxnByAccount(householdId); }
    catch { return undefined; }
  }

  // ── Households: cloud is source of truth ───────────────────
  async listHouseholds(): Promise<HouseholdMeta[]> {
    try {
      const cloud = await this.cloud.listHouseholds();
      try { ls.setJson('cloud_households', cloud); } catch { /* noop */ }
      return cloud;
    } catch {
      try { return ls.readJson<HouseholdMeta[]>('cloud_households') || []; }
      catch { return []; }
    }
  }
  async createHousehold(name: string, type: ProfileTypeKey, baseCurrency = 'USD'): Promise<HouseholdMeta> {
    const created = await this.cloud.createHousehold(name, type, baseCurrency);
    const list = await this.listHouseholds();
    ls.setJson('cloud_households', [...list, created]);
    return created;
  }
  async updateHousehold(id: string, patch: Partial<HouseholdMeta>): Promise<HouseholdMeta> {
    return this.cloud.updateHousehold(id, patch);
  }
  async deleteHousehold(id: string): Promise<void> {
    return this.cloud.deleteHousehold(id);
  }
  async getActiveHousehold(): Promise<string> {
    return this.cloud.getActiveHousehold();
  }
  async setActiveHousehold(id: string): Promise<string> {
    return this.cloud.setActiveHousehold(id);
  }

  // ── Flush orchestrator ─────────────────────────────────────
  // Audit F6 — the outbox (lib/sync/outbox.ts) owns durability. This loop
  // CLAIMS the due batch, performs the cloud writes, and ACKs by opId. An op
  // enqueued mid-flush is simply claimed by the next flush — there is no
  // queue snapshot left to overwrite. Multi-tab serialisation is the Web
  // Locks API (one flusher per origin); without it we fall back to the
  // instance flag.
  private async withFlushLock(fn: () => Promise<void>): Promise<void> {
    const locks = typeof navigator !== 'undefined'
      ? (navigator as Navigator & { locks?: LockManager }).locks
      : undefined;
    if (!locks) {
      if (this.flushing) return;
      this.flushing = true;
      try { await fn(); } finally { this.flushing = false; }
      return;
    }
    await locks.request('vyact-outbox-flush', { ifAvailable: true }, async (lock) => {
      // Another tab holds the lock — it claims this tab's ops too (same
      // origin, same owner filter), so skipping is safe.
      if (!lock) { this.scheduleFlush(Date.now() + 1000); return; }
      await fn();
    });
  }

  async flushQueue(): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    await this.withFlushLock(async () => {
      const ownerUid = await this.cloud.currentUserId();
      if (!ownerUid) return;
      for (let round = 0; round < 100; round++) {
      const claimed = await outbox.claimDue(this.workerId, Date.now(), ownerUid);
      if (!claimed.length) break;
      for (const op of claimed) {
        if (await this.cloud.currentUserId() !== ownerUid) {
          await outbox.release(op, {});
          continue;
        }
        // v6.4.2: Drop ops carrying a non-UUID id. Records created before the
        // uid()→crypto.randomUUID() fix have ids like "mpe036yty4vnauz7yif",
        // which the uuid PK columns reject with 22P02. Retrying them forever
        // permanently jams the outbox and blocks all later (valid) ops from
        // flushing. We drop them with a structured fault rather than silently.
        if (!syncQueue.isQueueOpIdValid(op)) {
          droppedWrite('sync.flushQueue', `${op.op} ${op.entity ?? ''} id=${(op.payload as { id?: string })?.id ?? op.id ?? '?'}`);
          deadLetter.recordFailed(op, new Error('Operation contains an invalid entity ID'));
          await outbox.ack(op.opId, this.workerId);
          continue;
        }
        try {
          let serverRevision: string | undefined;
          if      (op.op === 'upsert') {
            const gen = cacheGeneration();
            const saved = await this.cloud.upsert(op.entity!, op.householdId, op.payload as { id?: string }, op.expectedUpdatedAt);
            serverRevision = (saved as { updated_at?: string }).updated_at;
            // W3c: remember our own revision step, so an edit made on top of this write (from the
            // app's copy, which still holds the old revision) is sent with the new one.
            if (serverRevision) {
              this.ownRevisions.set(this.rowKey(op.entity!, op.householdId, saved.id), { from: op.expectedUpdatedAt, to: serverRevision });
            }
            // Audit F7 — fold the server-returned authoritative row (and its
            // fresh updated_at) back into the cache, so a second edit before
            // the next refresh carries a CURRENT concurrency precondition
            // rather than a stale or missing one. W3c: per ROW (it was skipped whenever any
            // other op for the whole entity was still queued).
            if (isCacheGenerationCurrent(gen)
                && !await outbox.hasPendingRow(ownerUid, op.householdId, op.entity!, saved.id, op.opId)) {
              await this.cache.put(op.entity!, op.householdId, saved as { id: string });
            }
          }
          else if (op.op === 'remove')        await this.cloud.remove(op.entity!, op.householdId, op.id!);
          else if (op.op === 'replaceAll')    await this.cloud.replaceAll(op.entity!, op.householdId, op.payload as unknown[]);
          else if (op.op === 'updateProfile') await this.cloud.updateProfile(op.householdId, op.payload as Partial<Profile>);
          // W3b (D14): exchange rates are retired — a rate edit queued by an older app has nothing to
          // write to and no figure reads it. It is acknowledged (and recorded), never dead-lettered.
          else if (op.op === 'upsertRate')    expected(new Error('retired op: upsertRate'), 'sync:upsertRate retired');
          // v6.4: a successful write proves we have valid cloud connectivity
          // and RLS access to this (hid, entity); mark synced so subsequent
          // empty list responses are trusted, not treated as transient.
          if (op.entity) this.markSynced(op.entity, op.householdId);
          await outbox.ack(op.opId, this.workerId, serverRevision);
        } catch (e) {
          const outcome = classifyFlushError(e, op);
          if (outcome.kind === 'conflict') {
            // TD-03 — terminal: dead-letter to sync_conflicts; the UI surfaces it.
            deadLetter.recordConflict(op);
            if (typeof console !== 'undefined') {
              const cc = e as ConcurrencyConflictError;
              console.warn('[Vyact sync] Concurrency conflict — op dead-lettered:', op.entity, cc.id, 'expected', cc.expectedUpdatedAt);
            }
            await outbox.ack(op.opId, this.workerId);
            continue;
          }
          if (outcome.kind === 'rejected') {
            // W3c (audit INT-TXN-08) — the database refused the write itself (a CHECK, a foreign
            // key, a permission, a trigger rule). Retrying cannot help, so it is dead-lettered at
            // once, together with every later write to the same row (they carry the same change),
            // and the cache goes back to how it was before the first of them. The store re-reads
            // it, so the screen stops showing a change the cloud will never hold.
            deadLetter.recordFailed(op, e);
            for (const later of await outbox.takeLaterOpsForRow(op)) {
              deadLetter.recordFailed(later, new Error('Not sent: an earlier change to this item was refused'));
            }
            await this.rollback(op);
            await outbox.ack(op.opId, this.workerId);
            this.emitCacheChanged();
            continue;
          }
          if (outcome.kind === 'failed') {
            // TD-10 — retries exhausted: dead-letter to sync_failed.
            deadLetter.recordFailed(op, e);
            if (typeof console !== 'undefined') {
              console.warn('[Vyact sync] Op exhausted retries — moved to dead-letter:', op.op, op.entity, e);
            }
            await outbox.ack(op.opId, this.workerId);
            continue;
          }
          // Transient — release back to pending with the backoff patch; the
          // next flush after nextRetryAt claims it again.
          await outbox.release(op, outcome.op);
        }
      }
      }
      // Refresh the synchronous badge count after the batch.
      await outbox.pendingCount();
      const nextWake = await outbox.nextWakeAt(ownerUid);
      if (nextWake !== null) this.scheduleFlush(nextWake);
    });
  }

  // ── Queue / dead-letter surface (delegated to ./sync/*) ─────
  pendingOpCount(): number {
    // Audit F6 — the durable outbox is async (IndexedDB); the badge reads the
    // best-known count, refreshed on every enqueue / claim / ack / flush.
    return outbox.pendingCountSync();
  }

  /**
   * Number of ops dead-lettered due to a concurrency conflict, awaiting user
   * review. Surfaced by the SyncConflictBanner (TD-03 phase B).
   */
  pendingConflictCount(): number {
    return deadLetter.pendingConflictCount();
  }

  /** Drop all dead-lettered conflict ops (SyncConflictBanner "Dismiss"). */
  clearConflicts(): void {
    deadLetter.clearConflicts();
  }

  /**
   * W3c — "Dismiss": the conflicting edits are abandoned, so the rows they touched are read again
   * from the cloud NOW and the cache holds the server's version (until this, the dismissed edit
   * stayed on screen until a full resync happened to run).
   */
  async dismissConflicts(): Promise<void> {
    const targets = deadLetter.conflictTargets();
    deadLetter.clearConflicts();
    const gen = cacheGeneration();
    for (const { householdId, entity } of targets) {
      try {
        const cached = await this.cache.list(entity as Entity, householdId);
        const fresh = await this.cloud.list(entity as Entity, householdId);
        await this.applyCloudList(entity as Entity, householdId, cached as unknown[], fresh as unknown[], gen);
      } catch (e) { expected(e, `sync:dismissConflicts:${entity}`); }
    }
    this.emitCacheChanged();
  }

  /** W3c — put the cache back to how it was before a rejected write. */
  private async rollback(op: outbox.StoredOp): Promise<void> {
    const id = op.op === 'upsert' ? (op.payload as { id?: string } | undefined)?.id : op.id;
    if (!op.entity || !id || (op.op !== 'upsert' && op.op !== 'remove')) return;
    if (op.before === undefined) {
      // Queued by an app from before v10.67.0: no snapshot. The next read takes the server's rows.
      this.forceFullResync(op.householdId);
      return;
    }
    const gen = cacheGeneration();
    try {
      if (!isCacheGenerationCurrent(gen)) return;
      if (op.before === null) {
        if (op.op === 'upsert') await this.cache.remove(op.entity, op.householdId, id);   // the row never existed
      } else {
        await this.cache.put(op.entity, op.householdId, op.before as { id: string });
      }
    } catch (e) { unexpected(e, `sync:rollback:${op.entity}`); }
  }

  /**
   * R4 (sync fix) — number of ops that exhausted their retries and are now in
   * the `sync_failed` dead-letter bucket, surfaced so "all synced" can't lie.
   */
  pendingFailedCount(): number {
    return deadLetter.pendingFailedCount();
  }

  /** Drop the dead-lettered failed ops after the user has reviewed them. */
  clearFailed(): void {
    deadLetter.clearFailed();
  }

  /**
   * R5 (sync fix) — re-queue a dead-lettered op for another flush attempt
   * (conflict/failed review UI's "Retry"). Conflict ops retry as unconditional
   * last-write-wins; the flush is kicked off once the bucket is drained.
   * Audit F6: retries re-enter the durable outbox, owner-stamped to the
   * current user (they are the one reviewing and retrying).
   */
  retryDeadLettered(bucket: 'sync_conflicts' | 'sync_failed'): void {
    void (async () => {
      await deadLetter.retryDeadLettered(bucket, await this.cloud.currentUserId());
      void this.flushQueue();
    })();
  }

  /**
   * W4f (D19) — the loan commands. The cloud RPC is the durability boundary (one database
   * transaction each); its rows are then adopted into the cache as the SERVER's rows (cache.put, W3c)
   * WITHOUT enqueueing — the write already landed. Legs an undo removed leave the cache too.
   */
  private async adoptLoanRows(householdId: string, rows: {
    transactions?: Transaction[]; debts?: Debt[]; accounts?: (Account | null)[]; removedTransactionIds?: string[];
  }): Promise<void> {
    const gen = cacheGeneration();
    try {
      for (const t of rows.transactions ?? []) { if (!isCacheGenerationCurrent(gen)) return; await this.cache.put('transactions', householdId, t); }
      for (const d of rows.debts ?? []) { if (!isCacheGenerationCurrent(gen)) return; await this.cache.put('debts', householdId, d); }
      for (const a of rows.accounts ?? []) { if (!a || !isCacheGenerationCurrent(gen)) continue; await this.cache.put('accounts', householdId, a); }
      for (const id of rows.removedTransactionIds ?? []) { if (!isCacheGenerationCurrent(gen)) return; await this.cache.remove('transactions', householdId, id); }
    } catch { /* cache is best-effort; the cloud write is authoritative and the next refresh re-reads it */ }
    this.emitCacheChanged();
  }

  async payLoan(householdId: string, cmd: PayLoanCommand): Promise<PayLoanResult> {
    const res = await this.cloud.payLoan(householdId, cmd);
    await this.adoptLoanRows(householdId, { transactions: res.transactions, debts: [res.debt], accounts: [res.loanAccount] });
    return res;
  }

  loanDue(householdId: string, debtId: string): Promise<LoanDue> {
    return this.cloud.loanDue(householdId, debtId);
  }

  async reverseLoanPayment(householdId: string, operationId: string): Promise<{ debt: Debt | null; removedTransactionIds: string[] }> {
    const res = await this.cloud.reverseLoanPayment(householdId, operationId);
    await this.adoptLoanRows(householdId, { debts: res.debt ? [res.debt] : [], removedTransactionIds: res.removedTransactionIds });
    return res;
  }

  async markLoanPaidOff(householdId: string, debtId: string, note?: string): Promise<{ debt: Debt; loanAccount: Account | null }> {
    const res = await this.cloud.markLoanPaidOff(householdId, debtId, note);
    await this.adoptLoanRows(householdId, { debts: [res.debt], accounts: [res.loanAccount] });
    return res;
  }

  async deleteDebt(householdId: string, debtId: string): Promise<void> {
    await this.cloud.deleteDebt(householdId, debtId);
    try { await this.cache.remove('debts', householdId, debtId); } catch { /* the next refresh drops it */ }
    this.emitCacheChanged();
  }

  /**
   * v10.23.0 (R1) — the server-owned Cash in Hand. The returned row replaces
   * EVERY cached cash account: the database guarantees one, so any other cash
   * row in the cache is stale and would double-count if it survived.
   */
  async ensureCashAccount(householdId: string): Promise<Account | null> {
    const gen = cacheGeneration();
    const cash = await this.cloud.ensureCashAccount(householdId);
    if (!cash) return null;
    try {
      if (!isCacheGenerationCurrent(gen)) return cash;
      const cached = await this.cache.list<Account>('accounts', householdId);
      if (!isCacheGenerationCurrent(gen)) return cash;
      await this.cache.replaceAll('accounts', householdId,
        [...cached.filter(row => row.id !== cash.id && row.kind !== 'cash'), cash]);
    } catch { /* cache is best-effort; the cloud row is authoritative */ }
    return cash;
  }

  /**
   * v10.30.0 — recorded Net Worth snapshots: the cache first (awaiting the cloud
   * only when the cache is empty); the cloud's rows then refresh the cache.
   */
  async listNetWorthSnapshots(householdId: string): Promise<NetWorthSnapshot[]> {
    const gen = cacheGeneration();
    const cached = await this.cache.listNetWorthSnapshots(householdId);
    const pull = this.cloud.listNetWorthSnapshots(householdId).then(async rows => {
      if (isCacheGenerationCurrent(gen)) await this.cache.replaceNetWorthSnapshots(householdId, rows);
      return rows;
    });
    if (cached.length === 0) {
      try { return await pull; } catch (error) { expected(error, 'netWorthSnapshots.list'); return cached; }
    }
    pull.catch(error => expected(error, 'netWorthSnapshots.list'));
    return cached;
  }

  /** v10.30.0 — online only: the database decides which row stands for the month. */
  async recordNetWorthSnapshot(householdId: string, snapshot: NetWorthSnapshot): Promise<NetWorthSnapshot | null> {
    const gen = cacheGeneration();
    const stored = await this.cloud.recordNetWorthSnapshot(householdId, snapshot);
    if (!stored) return null;
    try {
      if (!isCacheGenerationCurrent(gen)) return stored;
      const cached = await this.cache.listNetWorthSnapshots(householdId);
      if (!isCacheGenerationCurrent(gen)) return stored;
      await this.cache.replaceNetWorthSnapshots(householdId,
        mergeSnapshot(cached.filter(row => row.month !== stored.month), stored));
    } catch { /* cache is best-effort; the cloud row is authoritative */ }
    return stored;
  }

  /** v10.30.0 — see DataAdapter.positionIsCloudFresh. */
  positionIsCloudFresh(householdId: string): boolean {
    return (['transactions', 'accounts', 'assets', 'debts'] as Entity[])
      .every(entity => this.servedFresh.get(`${householdId}:${entity}`) === true);
  }

  /** v10.24.0 (R2) — always asks the server: a cached answer could be stale. */
  async accountDependencies(householdId: string, accountId: string): Promise<AccountDependencies> {
    return this.cloud.accountDependencies(householdId, accountId);
  }

  /** v10.24.0 (R2) — the server decides; the cache drops the row only after it succeeded. */
  async deleteAccountGuarded(householdId: string, accountId: string): Promise<void> {
    await this.cloud.deleteAccountGuarded(householdId, accountId);
    await this.dropCachedAccount(householdId, accountId);
  }

  /**
   * v10.24.0 (R2) — transactions, schedules and the destination's offset all
   * change server-side in one transaction. The cache drops the tombstoned
   * account here; the store refreshes the rest from the cloud.
   */
  async moveAccountAndDelete(householdId: string, fromId: string, toId: string): Promise<AccountMoveResult> {
    const res = await this.cloud.moveAccountAndDelete(householdId, fromId, toId);
    await this.dropCachedAccount(householdId, fromId);
    return res;
  }

  private async dropCachedAccount(householdId: string, accountId: string): Promise<void> {
    const gen = cacheGeneration();
    try {
      const cached = await this.cache.list<Account>('accounts', householdId);
      if (!isCacheGenerationCurrent(gen)) return;
      await this.cache.replaceAll('accounts', householdId, cached.filter(row => row.id !== accountId));
    } catch { /* cache is best-effort; the next refresh reconciles it */ }
  }
}
