// Vyact — flush-error resolution (TD-26 extraction). Decides what happens to a
// queued op when its cloud write throws, encapsulating the TD-03 concurrency
// rule and the TD-10 bounded-retry/backoff policy. Pure — no storage, no logging.
import { ConcurrencyConflictError, WriteNotAppliedError } from '../supabaseAdapter';
import { backoffMs, MAX_RETRIES } from './backoff';
import type { QueueOp } from './types';

export type FlushOutcome =
  /** TD-03 — terminal: precondition won't re-match; dead-letter to sync_conflicts. */
  | { kind: 'conflict' }
  /** W3c — terminal: the database refused the write itself; dead-letter at once and roll back. */
  | { kind: 'rejected' }
  /** TD-10 — retries exhausted; dead-letter to sync_failed. */
  | { kind: 'failed' }
  /** TD-10 — transient; re-queue with incremented attempts + a backoff window. */
  | { kind: 'retry'; op: QueueOp };

/**
 * W3c (v10.67.0; audit INT-TXN-08) — a write the database refuses for good: an integrity or data
 * error (SQLSTATE 23xxx / 22xxx — a CHECK, a foreign key, a duplicate, a bad value), a permission
 * (42501), a rule raised by a trigger (P0001), or a write that changed no row. Retrying cannot make
 * it succeed, so it is not retried. Everything else — no network, a JWT to refresh (PGRST3xx), a
 * schema cache still catching up after a deploy (PGRST204), a timeout, a 5xx — stays transient.
 * PostgREST errors arrive as plain objects carrying `code`, with no HTTP status.
 */
const TERMINAL_CODE = /^(23\d{3}|22[0-9A-Z]{3}|42501|P0001)$/;
export function isTerminalRejection(err: unknown): boolean {
  if (err instanceof WriteNotAppliedError) return true;
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code ?? '') : '';
  return TERMINAL_CODE.test(code);
}

export function classifyFlushError(err: unknown, op: QueueOp): FlushOutcome {
  // TD-03 — a concurrency conflict is a *terminal* outcome, not a retryable
  // transient failure: retrying keeps failing because the precondition won't
  // suddenly match again. Do NOT push it back into the main queue.
  if (err instanceof ConcurrencyConflictError) return { kind: 'conflict' };
  if (isTerminalRejection(err)) return { kind: 'rejected' };
  // TD-10 — bounded retry with exponential backoff; past the cap, dead-letter.
  const attempts = (op.attempts ?? 0) + 1;
  if (attempts >= MAX_RETRIES) return { kind: 'failed' };
  return { kind: 'retry', op: { ...op, attempts, nextRetryAt: Date.now() + backoffMs(attempts) } };
}
