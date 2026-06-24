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
}
