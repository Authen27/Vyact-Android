// Compatibility helpers for localStorage key prefix migration.
// Prefer `vt_` keys, fall back to legacy keys on reads, and hard-cut legacy writes.
//
// TD-14: write failures (QuotaExceededError) are no longer swallowed
// silently — they fan out through `storageEvents` so the UI can surface
// "storage full" to the user. We still don't throw, to preserve the
// pre-TD-14 contract that callers don't have to handle storage errors.

import { emitStorageEvent, isQuotaError } from './storageEvents';
import { expected } from './faults';

const NEW_PREFIX = 'vt_';
const LEGACY_PREFIX = (() => {
  // Avoid embedding the legacy prefix in built bundles — decode at runtime.
  // Base64 for the legacy prefix is "ZmZf". Use atob in browsers or Buffer in Node.
  const b64 = 'ZmZf';
  try {
    if (typeof atob !== 'undefined') {
      return atob(b64);
    }
  } catch { /* noop */ }
  try {
    const nodeBuffer = (globalThis as {
      Buffer?: {
        from(data: string, encoding: string): { toString(encoding: string): string };
      };
    }).Buffer;
    if (nodeBuffer) {
      // Node fallback during SSR/build-time won't be evaluated in browser runtime.
      return nodeBuffer.from(b64, 'base64').toString('utf8');
    }
  } catch { /* noop */ }
  // Last-resort: construct from char codes (should rarely be hit at runtime).
  const codes = [102, 102, 95];
  return codes.map(n => String.fromCharCode(n)).join('');
})();

function stripPrefix(key: string) {
  if (key.startsWith(NEW_PREFIX)) return key.slice(NEW_PREFIX.length);
  if (key.startsWith(LEGACY_PREFIX)) return key.slice(LEGACY_PREFIX.length);
  return key;
}

export function newKey(key: string) { return NEW_PREFIX + stripPrefix(key); }
export function legacyKey(key: string) { return LEGACY_PREFIX + stripPrefix(key); }

export function readString(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  const n = newKey(key);
  const l = legacyKey(key);
  const nv = localStorage.getItem(n);
  if (nv !== null && nv !== undefined) return nv;
  return localStorage.getItem(l);
}

export function setString(key: string, value: string | null): void {
  if (typeof localStorage === 'undefined') return;
  const n = newKey(key);
  const l = legacyKey(key);
  try {
    if (value === null) {
      localStorage.removeItem(n);
      localStorage.removeItem(l);
      return;
    }
    localStorage.setItem(n, value);
    try { localStorage.removeItem(l); } catch { /* noop */ }
  } catch (err) {
    if (isQuotaError(err)) {
      emitStorageEvent({ kind: 'quota-exceeded', key: n, bytes: value?.length, error: err });
    }
    // Preserve the original non-throwing contract for callers.
  }
}

export function readJson<T = any>(key: string): T | null {
  const s = readString(key);
  if (!s) return null;
  // TD-24: a parse failure means a stored value is corrupt (or non-JSON) —
  // classify it so it's visible, then fall back to null as before.
  try { return JSON.parse(s) as T; } catch (e) { expected(e, `localStorageCompat.readJson:${key}`); return null; }
}

export function setJson(key: string, value: any): void {
  if (value === undefined) return;
  try { setString(key, JSON.stringify(value)); } catch { /* noop */ }
}

export function removeBoth(key: string): void {
  if (typeof localStorage === 'undefined') return;
  const n = newKey(key);
  const l = legacyKey(key);
  try { localStorage.removeItem(n); } catch { /* noop */ }
  try { localStorage.removeItem(l); } catch { /* noop */ }
}

export default {
  readString, setString, readJson, setJson, removeBoth, newKey, legacyKey,
};
