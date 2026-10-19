// Vyact — retry/backoff policy (TD-10, extracted in TD-26).
//
// v10.110.0 (F1a, audit FE-SYN-05; owner decision "retry until it lands") — there is no retry cap.
// A write that fails for a reason that can pass (no network, a timeout, a 5xx, a token to refresh,
// a schema still deploying) is tried again until it lands; only a write the database refuses, or a
// conflict, is set aside (lib/sync/conflict.ts). The old cap set a write aside after about 30 seconds
// of failures, so a captive-portal Wi-Fi or a minute of 503s parked every queued expense for good.

/** The longest wait between two tries of one write: 5 minutes. */
export const BACKOFF_CAP_MS = 5 * 60_000;

// Exponential backoff in ms: 2s, 4s, 8s … 256s, then every 5 minutes.
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_CAP_MS, 1000 * 2 ** attempts);
}
