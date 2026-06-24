// Vyact — flush-error resolution (TD-26 extraction). Decides what happens to a
// queued op when its cloud write throws, encapsulating the TD-03 concurrency
// rule and the TD-10 bounded-retry/backoff policy. Pure — no storage, no logging.
import { ConcurrencyConflictError } from '../supabaseAdapter';
import { backoffMs, MAX_RETRIES } from './backoff';
import type { QueueOp } from './types';

export type FlushOutcome =
  /** TD-03 — terminal: precondition won't re-match; dead-letter to sync_conflicts. */
  | { kind: 'conflict' }
  /** TD-10 — retries exhausted; dead-letter to sync_failed. */
  | { kind: 'failed' }
  /** TD-10 — transient; re-queue with incremented attempts + a backoff window. */
  | { kind: 'retry'; op: QueueOp };

export function classifyFlushError(err: unknown, op: QueueOp): FlushOutcome {
  // TD-03 — a concurrency conflict is a *terminal* outcome, not a retryable
  // transient failure: retrying keeps failing because the precondition won't
  // suddenly match again. Do NOT push it back into the main queue.
  if (err instanceof ConcurrencyConflictError) return { kind: 'conflict' };
  // TD-10 — bounded retry with exponential backoff; past the cap, dead-letter.
  const attempts = (op.attempts ?? 0) + 1;
  if (attempts >= MAX_RETRIES) return { kind: 'failed' };
  return { kind: 'retry', op: { ...op, attempts, nextRetryAt: Date.now() + backoffMs(attempts) } };
}
