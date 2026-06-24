// Vyact — store-local persistence helpers (TD-25 extraction).
//
// Thin try/catch wrappers over localStorageCompat used by the store and its
// slices for per-household cached state. Moved out of store.ts verbatim so the
// extracted slices can share them without a circular dependency on the store.
import ls from '../lib/localStorageCompat';

export function readLocalJson<T>(suffix: string, fallback: T): T {
  try {
    const val = ls.readJson<T>(suffix);
    return val !== null ? val : fallback;
  } catch {
    return fallback;
  }
}

export function readLocalString(suffix: string, fallback: string | null = null): string | null {
  try {
    const v = ls.readString(suffix);
    return v !== null ? v : fallback;
  } catch {
    return fallback;
  }
}

export function setLocalJson(suffix: string, value: unknown): void {
  try { ls.setJson(suffix, value); } catch { /* noop */ }
}

export function setLocalString(suffix: string, value: string): void {
  try { ls.setString(suffix, value); } catch { /* noop */ }
}

export function removeLocal(suffix: string): void {
  try { ls.removeBoth(suffix); } catch { /* noop */ }
}
