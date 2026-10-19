// Vyact — flush-error resolution (TD-26 extraction). Decides what happens to a
// queued op when its cloud write throws, encapsulating the TD-03 concurrency
// rule and the TD-10 bounded-retry/backoff policy. Pure — no storage, no logging.
import { ConcurrencyConflictError, WriteNotAppliedError } from '../supabaseAdapter';
import { backoffMs } from './backoff';
import type { QueueOp } from './types';

export type FlushOutcome =
  /** TD-03 — terminal: precondition won't re-match; dead-letter to sync_conflicts. */
  | { kind: 'conflict' }
  /** W3c — terminal: the database refused the write itself; dead-letter at once and roll back. */
  | { kind: 'rejected' }
  /** TD-10 / F1a — transient; re-queue with incremented attempts + a backoff window, with no cap. */
  | { kind: 'retry'; op: QueueOp };

/**
 * W3c (v10.67.0; audit INT-TXN-08) — a write the database refuses for good: an integrity or data
 * error (SQLSTATE 23xxx / 22xxx — a CHECK, a foreign key, a duplicate, a bad value), a permission
 * (42501), a rule raised by a trigger (P0001), or a write that changed no row. Retrying cannot make
 * it succeed, so it is not retried. Everything else — no network, a JWT to refresh (PGRST3xx), a
 * schema cache still catching up after a deploy (PGRST2xx), a timeout, a 5xx — stays transient.
 * PostgREST errors arrive as plain objects carrying `code`, with no HTTP status.
 * v10.110.0 (F1a) — a request the API itself refuses (PGRST1xx: a malformed filter, body or range)
 * is refused too: it would be sent again unchanged, and with no retry cap it would hold back every
 * later write to the same entity.
 */
const TERMINAL_CODE = /^(23\d{3}|22[0-9A-Z]{3}|42501|P0001|PGRST1\d\d)$/;
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
  // F1a (FE-SYN-05) — anything else can pass: try again, backing off to every 5 minutes, until it lands.
  const attempts = (op.attempts ?? 0) + 1;
  return { kind: 'retry', op: { ...op, attempts, nextRetryAt: Date.now() + backoffMs(attempts) } };
}
