// Vyact — sync-queue op shape (TD-26 extraction from hybridAdapter.ts).
import type { Entity } from '../dataAdapter';

export interface QueueOp {
  ts: number;
  op: 'upsert' | 'remove' | 'replaceAll' | 'updateProfile' | 'upsertRate';
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
   * TD-10 (2026-06-01) — bounded retry. Transient failures (network blip,
   * 5xx) re-queue with an exponential backoff (`nextRetryAt`) and a hard
   * cap (`MAX_RETRIES`). Past the cap the op is moved to the
   * `vt_sync_failed` dead-letter bucket so it stops jamming flushes.
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
