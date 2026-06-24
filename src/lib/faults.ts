// Vyact — fault taxonomy (TD-24).
//
// The app is offline-first, so it deliberately swallows many failures and keeps
// going. The problem that motivated this module: "offline cache read failed,
// continue" and "a write was silently dropped / a contract was violated" shared
// one mute `catch {}` code path. In a money app the second class is a
// correctness/trust bug (silent data loss), not forgiving UX — exactly the class
// behind the v9.3.x budget dead-letters.
//
// Two classifiers replace bare catches:
//   • expected(err, ctx)   — a normal degraded path (offline, cache miss, best-
//                            effort storage). Debug-only; never surfaced to users.
//   • unexpected(err, ctx) — a contract violation, data corruption, or a DROPPED
//                            WRITE. One structured record + console.error + a
//                            pluggable transport (Sentry-style). Still NON-throwing
//                            so the offline-happy path is never broken.
//
// Both append to a bounded in-memory ring buffer so an in-app diagnostics view
// (or a test) can read recent faults without a network dependency.

export type FaultKind = 'expected' | 'unexpected';

export interface FaultRecord {
  kind: FaultKind;
  /** Stable `module.operation` tag, e.g. `sync.flushQueue:dropped-op`. */
  context: string;
  message: string;
  at: number;
}

type FaultTransport = (record: FaultRecord) => void;

const RING_MAX = 50;
const ring: FaultRecord[] = [];
let transport: FaultTransport | null = null;

const isDev = (() => {
  try { return Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV); }
  catch { return false; }
})();

function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err == null) return '';
  return String(err);
}

function push(kind: FaultKind, context: string, err: unknown): FaultRecord {
  const rec: FaultRecord = { kind, context, message: toMessage(err), at: Date.now() };
  ring.push(rec);
  if (ring.length > RING_MAX) ring.shift();
  return rec;
}

/** Register a sink for `unexpected` faults (e.g. Sentry). Pass `null` to clear. */
export function setFaultTransport(t: FaultTransport | null): void {
  transport = t;
}

/** Recent faults, oldest→newest. Read-only snapshot for an in-app diagnostics view. */
export function getFaults(): readonly FaultRecord[] {
  return ring.slice();
}

export function clearFaults(): void {
  ring.length = 0;
}

/**
 * A normal degraded path in offline-first operation. Recorded for diagnostics
 * and debug-logged in dev, but never escalated and never shown to users.
 */
export function expected(err: unknown, context: string): void {
  push('expected', context, err);
  if (isDev) console.debug(`[fault:expected] ${context}: ${toMessage(err)}`);
}

/**
 * An unexpected fault — a violated contract, corrupt data, or a write that was
 * dropped before reaching the cloud. Produces exactly one structured record,
 * logs to console.error, and forwards to the transport if one is registered.
 * Never throws: the caller's degraded path must still proceed.
 */
export function unexpected(err: unknown, context: string): void {
  const rec = push('unexpected', context, err);
  console.error(`[fault:unexpected] ${context}: ${rec.message}`, err);
  if (transport) {
    try { transport(rec); } catch { /* a broken transport must never break the caller */ }
  }
}

/**
 * Convenience for the highest-stakes case: a user's write was dropped before it
 * reached the cloud. Always `unexpected`. `detail` describes the op.
 */
export function droppedWrite(context: string, detail: string): void {
  unexpected(new Error(`dropped write: ${detail}`), context);
}
