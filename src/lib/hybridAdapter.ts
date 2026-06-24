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
  Profile, ExchangeRates, HouseholdMeta, ProfileTypeKey, Budget, BudgetAllocation,
} from '../types';
import {
  type DataAdapter, type Entity, LocalStorageAdapter,
} from './dataAdapter';
import ls from './localStorageCompat';
import { SupabaseAdapter, ConcurrencyConflictError } from './supabaseAdapter';
import { droppedWrite } from './faults';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { QueueOp } from './sync/types';
import * as syncQueue from './sync/syncQueue';
import * as deadLetter from './sync/deadLetter';
import { classifyFlushError } from './sync/conflict';

export class HybridAdapter implements DataAdapter {
  cache: LocalStorageAdapter;
  cloud: SupabaseAdapter;
  private flushing = false;

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
        await this.applyCloudList(entity, householdId, cached as unknown[], fresh as unknown[]);
        return await this.cache.list<T>(entity, householdId);
      } catch {
        // Network error on first load — fall through to cached []. The
        // user sees an empty state instead of a hang; next refresh retries.
        return cached;
      }
    }
    if (cursor) {
      this.cloud.listSince(entity as Exclude<Entity, 'members'>, householdId, cursor)
        .then(delta => this.applyCloudDelta(entity, householdId, delta))
        .catch(() => {/* network error — cache stays */});
    } else {
      this.cloud.list<T>(entity, householdId)
        .then(fresh => this.applyCloudList(entity, householdId, cached as unknown[], fresh as unknown[]))
        .catch(() => {/* network error — cache stays */});
    }
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
  private async applyCloudList(entity: Entity, householdId: string, cached: unknown[], fresh: unknown[]): Promise<void> {
    if (fresh.length > 0) {
      await this.cache.replaceAll(entity, householdId, fresh);
      this.markSynced(entity, householdId);
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
    let max: string | null = null;
    for (const r of rows) {
      const u = (r as { updated_at?: string } | null)?.updated_at;
      if (u && (!max || u > max)) max = u;
    }
    if (max) this.writeCursor(entity, householdId, max);
  }

  private async applyCloudDelta(
    entity: Entity,
    householdId: string,
    delta: { rows: unknown[]; tombstones: string[]; maxUpdatedAt: string | null },
  ): Promise<void> {
    // Empty delta is the steady-state happy path — nothing changed since the
    // cursor. No cache touch, no cursor bump.
    if (delta.rows.length === 0 && delta.tombstones.length === 0) return;
    for (const row of delta.rows) {
      const r = row as { id?: string };
      if (!r.id) continue;
      await this.cache.upsert(entity, householdId, r as { id: string });
    }
    for (const id of delta.tombstones) {
      try { await this.cache.remove(entity, householdId, id); } catch { /* row may already be gone */ }
    }
    if (delta.maxUpdatedAt) this.writeCursor(entity, householdId, delta.maxUpdatedAt);
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

  // ── Write path: cache + queue + try flush ──────────────────
  async upsert<T extends { id?: string }>(entity: Entity, householdId: string, record: T, expectedUpdatedAt?: string): Promise<T & { id: string }> {
    // The cache write always succeeds — it's per-tab and not subject to
    // cross-user concurrency. The version precondition only applies to
    // the cloud leg, which is queued and flushed below.
    const local = await this.cache.upsert(entity, householdId, record);
    syncQueue.enqueue({ ts: Date.now(), op: 'upsert', entity, householdId, payload: local, expectedUpdatedAt });
    this.flushQueue();
    return local;
  }
  async remove(entity: Entity, householdId: string, id: string): Promise<void> {
    await this.cache.remove(entity, householdId, id);
    syncQueue.enqueue({ ts: Date.now(), op: 'remove', entity, householdId, id });
    this.flushQueue();
  }
  async createBudgetChecked(householdId: string, budget: Partial<Budget>): Promise<Budget> {
    // Budgets are period singletons → create is an ONLINE, synchronous check
    // against the DB authority (not the optimistic queue), so a duplicate (incl.
    // another member's unsynced one) is rejected up front rather than silently
    // dead-lettered. The returned, DB-id'd row is then written to cache.
    const saved = await this.cloud.createBudgetChecked(householdId, budget);
    try { await this.cache.upsert('budgets', householdId, saved); } catch { /* cache is best-effort */ }
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
    try { await this.cache.upsert('budgets', householdId, res.budget); } catch { /* best-effort */ }
    try {
      const cached = await this.cache.list('budgetAllocations', householdId) as Array<{ budgetId?: string }>;
      const others = cached.filter(a => a.budgetId !== res.budget.id);
      await this.cache.replaceAll('budgetAllocations', householdId, [...others, ...res.allocations]);
    } catch { /* best-effort */ }
    return res;
  }
  async replaceAll<T = unknown>(entity: Entity, householdId: string, records: T[]): Promise<T[]> {
    await this.cache.replaceAll(entity, householdId, records);
    syncQueue.enqueue({ ts: Date.now(), op: 'replaceAll', entity, householdId, payload: records });
    this.flushQueue();
    return records;
  }
  async upsertRate(householdId: string, code: string, rate: number): Promise<void> {
    await this.cache.upsertRate(householdId, code, rate);
    syncQueue.enqueue({ ts: Date.now(), op: 'upsertRate', householdId, code, rate });
    this.flushQueue();
  }

  // Profile is per-user in cloud; cache it locally per-household for parity.
  async updateProfile(householdId: string, patch: Partial<Profile>): Promise<Profile> {
    await this.cache.updateProfile(householdId, patch);
    syncQueue.enqueue({ ts: Date.now(), op: 'updateProfile', householdId, payload: patch });
    this.flushQueue();
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
  async getRates(householdId: string): Promise<ExchangeRates> {
    try {
      const cloud = await this.cloud.getRates(householdId);
      // Hydrate local cache
      for (const [code, rate] of Object.entries(cloud)) {
        await this.cache.upsertRate(householdId, code, rate);
      }
      return await this.cache.getRates(householdId);
    } catch {
      return this.cache.getRates(householdId);
    }
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
  // The queue mechanics live in ./sync/*; this loop drives them: skip ops
  // inside their backoff window, drop un-syncable ops, perform the cloud write,
  // and route a thrown error through classifyFlushError → dead-letter or retry.
  async flushQueue(): Promise<void> {
    if (this.flushing) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    this.flushing = true;
    try {
      const queue = syncQueue.readQueue();
      const remaining: QueueOp[] = [];
      const now = Date.now();
      for (const op of queue) {
        // TD-10: respect per-op backoff window; defer until nextRetryAt.
        if (op.nextRetryAt && op.nextRetryAt > now) {
          remaining.push(op);
          continue;
        }
        // v6.4.2: Drop ops carrying a non-UUID id. Records created before the
        // uid()→crypto.randomUUID() fix have ids like "mpe036yty4vnauz7yif",
        // which the uuid PK columns reject with 22P02. Retrying them forever
        // permanently jams the queue and blocks all later (valid) ops from
        // flushing. We drop them with a warning rather than retain them.
        if (!syncQueue.isQueueOpIdValid(op)) {
          // TD-24: this is a user write the contract can't honour (non-UUID id) —
          // it is permanently DROPPED. Record exactly one structured fault rather
          // than a mute console.warn, so silent write-loss is observable.
          droppedWrite('sync.flushQueue', `${op.op} ${op.entity ?? ''} id=${(op.payload as { id?: string })?.id ?? op.id ?? '?'}`);
          continue;
        }
        try {
          if      (op.op === 'upsert')        await this.cloud.upsert(op.entity!, op.householdId, op.payload as { id?: string }, op.expectedUpdatedAt);
          else if (op.op === 'remove')        await this.cloud.remove(op.entity!, op.householdId, op.id!);
          else if (op.op === 'replaceAll')    await this.cloud.replaceAll(op.entity!, op.householdId, op.payload as unknown[]);
          else if (op.op === 'updateProfile') await this.cloud.updateProfile(op.householdId, op.payload as Partial<Profile>);
          else if (op.op === 'upsertRate')    await this.cloud.upsertRate(op.householdId, op.code!, op.rate!);
          // v6.4: a successful write proves we have valid cloud connectivity
          // and RLS access to this (hid, entity); mark synced so subsequent
          // empty list responses are trusted, not treated as transient.
          if (op.entity) this.markSynced(op.entity, op.householdId);
        } catch (e) {
          const outcome = classifyFlushError(e, op);
          if (outcome.kind === 'conflict') {
            // TD-03 — terminal: dead-letter to sync_conflicts; the UI surfaces it.
            deadLetter.recordConflict(op);
            if (typeof console !== 'undefined') {
              const cc = e as ConcurrencyConflictError;
              console.warn('[Vyact sync] Concurrency conflict — op dead-lettered:', op.entity, cc.id, 'expected', cc.expectedUpdatedAt);
            }
            continue;
          }
          if (outcome.kind === 'failed') {
            // TD-10 — retries exhausted: dead-letter to sync_failed.
            deadLetter.recordFailed(op, e);
            if (typeof console !== 'undefined') {
              console.warn('[Vyact sync] Op exhausted retries — moved to dead-letter:', op.op, op.entity, e);
            }
            continue;
          }
          remaining.push(outcome.op);
        }
      }
      syncQueue.writeQueue(remaining);
    } finally {
      this.flushing = false;
    }
  }

  // ── Queue / dead-letter surface (delegated to ./sync/*) ─────
  pendingOpCount(): number {
    return syncQueue.readQueue().length;
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
   */
  retryDeadLettered(bucket: 'sync_conflicts' | 'sync_failed'): void {
    deadLetter.retryDeadLettered(bucket, () => this.flushQueue());
  }
}
