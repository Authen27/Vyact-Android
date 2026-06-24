// TD-14 — surface storage quota failures via a tiny pub/sub.
//
// Pre-TD-14 every `localStorage.setItem(...)` in the codebase was wrapped
// in `try { ... } catch { /* noop */ }`. That's safe (the app keeps
// running) but invisible: when a long-running household crosses the
// ~5 MB localStorage ceiling, writes silently disappear and the user
// has no idea their last edit didn't persist locally.
//
// This module is the seam the storage layer fires through when a write
// fails. The UI subscribes (see `App.tsx` toast hookup) and shows a
// "storage full" warning. Subscribers are weakly-held; no React.
//
// We deliberately do NOT throw — the original silent-swallow contract
// is preserved (the cloud queue is the source of truth for cloud-mode
// users and the user's edit is still in memory) — we only inform.

export type StorageEvent =
  | { kind: 'quota-exceeded'; key: string; bytes?: number; error: unknown };

type Listener = (e: StorageEvent) => void;
const listeners = new Set<Listener>();

export function onStorageEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitStorageEvent(e: StorageEvent): void {
  for (const l of listeners) {
    try { l(e); } catch { /* listener throw must not break the writer */ }
  }
  // Also fan-out via window event so non-React surfaces (e.g. error
  // tracking) can subscribe without importing this module.
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent('vt:storage-event', { detail: e })); } catch { /* noop */ }
  }
}

// Quota-exceeded detection. Different browsers throw different shapes.
export function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number; message?: string };
  if (e.name === 'QuotaExceededError') return true;                  // most browsers
  if (e.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;          // older Firefox
  if (e.code === 22 || e.code === 1014) return true;                 // legacy code numbers
  if (typeof e.message === 'string' && /quota/i.test(e.message)) return true;
  return false;
}
