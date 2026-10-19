// Vyact — sync-queue op shape (TD-26 extraction from hybridAdapter.ts).
import type { Entity } from '../dataAdapter';

export interface QueueOp {
  ts: number;
  /** `shareSplit` (v10.112.0, F1c): a split's sharing, payload `SplitShareIntent`; it waits behind its
   *  transaction's own queued writes (outbox `claimDue`). */
  op: 'upsert' | 'remove' | 'replaceAll' | 'updateProfile' | 'upsertRate' | 'shareSplit';
  entity?: Entity;
  householdId: string;
  payload?: unknown;
  id?: string;
  code?: string;
  rate?: number;
  /**
   * TD-03 (PR #11) — when set, the upsert is performed as a guarded
   * UPDATE (`WHERE id = ? AND updated_at = expectedUpdatedAt`). If the
   * cloud row has been touched since the caller's read, the op is moved
   * to `vt_sync_conflicts` (compat: legacy `sync_conflicts`) instead of being
   * silently dropped or retried.
   */
  expectedUpdatedAt?: string;
  /**
   * TD-10 (2026-06-01) — transient failures (network blip, 5xx) re-queue with an
   * exponential backoff (`nextRetryAt`). Since v10.110.0 (F1a) there is no cap: the
   * backoff tops out at 5 minutes and the op is tried until it lands. Only a refused
   * write or a conflict goes to a dead-letter bucket.
   */
  attempts?: number;
  nextRetryAt?: number;
  /**
   * W3c (v10.67.0; audit INT-TXN-08) — the cached row as it was BEFORE this write: null when the
   * write created it, the row itself for an update or a remove. When the cloud rejects the write for
   * good (a CHECK, a foreign key, a permission), the cache is put back exactly as it was. Undefined
   * only on an op queued by an older app, which is resolved by a full resync instead.
   */
  before?: unknown | null;
}
