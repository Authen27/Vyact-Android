// Vyact — retry/backoff policy (TD-10, extracted in TD-26).
export const MAX_RETRIES = 5;

// Exponential backoff in ms: 2s, 4s, 8s, 16s, 32s (capped at 60s).
export function backoffMs(attempts: number): number {
  return Math.min(60_000, 1000 * 2 ** attempts);
}
