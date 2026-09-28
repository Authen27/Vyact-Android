// TD-14 — IndexedDB-backed promise key/value store.
//
// Why a tiny in-repo helper instead of `idb-keyval`?
//   - Zero new runtime dependency on a sync-critical path.
//   - ~120 LOC, focused on exactly the surface our adapter uses
//     (get / set / remove / keys, JSON values, single DB + single store).
//   - Easy to mock in vitest without jsdom needing fake-indexeddb.
//
// Fallback semantics (in priority order):
//   1. IndexedDB when `indexedDB` is defined (browser, Worker, modern
//      Node with --experimental-indexeddb). Storage quota here is
//      ~50% of free disk on Chrome/Edge, ~10% of total disk on
//      Firefox — orders of magnitude larger than the ~5 MB
//      localStorage ceiling we are trying to escape.
//   2. localStorage when IDB is unavailable (SSR, unit-test jsdom
//      without IDB shim). Same swallow-on-quota behaviour as before
//      this module existed, BUT we now emit a storage event so the
//      UI can surface it (see storageEvents.ts).
//   3. In-memory Map when neither is available (Node test runs).
//      Per-process and ephemeral — fine for unit tests.
//
// Migration from localStorage: `get` falls back to `localStorage` when
// IDB has no value for the key, and copies the localStorage value
// into IDB on the fly. This is a one-way move — subsequent writes go
// to IDB only. Users who downgrade will see the cloud queue re-hydrate
// the cache on next refresh; no data loss.

import ls from './localStorageCompat';
import { emitStorageEvent, isQuotaError } from './storageEvents';
import { expected, unexpected } from './faults';

const DB_NAME    = 'vyact';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;
const memoryFallback = new Map<string, string>();

function hasIDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  if (!hasIDB()) return Promise.reject(new Error('IndexedDB unavailable'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  // Reset the promise on a transient open failure so the next call retries.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error);
  }));
}

export async function kvGet<T = unknown>(key: string): Promise<T | null> {
  if (hasIDB()) {
    try {
      const v = await withStore<unknown>('readonly', s => s.get(key));
      if (v !== undefined && v !== null) return v as T;
    } catch { /* fall through to localStorage / memory */ }
  }
  // One-time migration read-through: pull from localStorage and seed IDB.
  const legacy = ls.readString(key);
  if (legacy !== null) {
    try { const parsed = JSON.parse(legacy) as T;
      // best-effort migrate; don't await failures
      void kvSet(key, parsed).catch(() => { /* noop */ });
      return parsed;
    } catch { /* fall through */ }
  }
  if (memoryFallback.has(key)) {
    try { return JSON.parse(memoryFallback.get(key)!) as T; } catch (e) { expected(e, `kvStore.kvGet:memory:${key}`); return null; }
  }
  return null;
}

export async function kvSet<T = unknown>(key: string, value: T): Promise<void> {
  if (hasIDB()) {
    try {
      await withStore<IDBValidKey>('readwrite', s => s.put(value as unknown as IDBValidKey, key));
      // After a successful IDB write, drop the legacy localStorage copy
      // so the data lives in exactly one place. Safe to fail silently.
      try { ls.removeBoth(key); } catch { /* noop */ }
      return;
    } catch (err) {
      if (isQuotaError(err)) emitStorageEvent({ kind: 'quota-exceeded', key, error: err });
      else expected(err, 'kvStore.kvSet:idb'); // recoverable — retries via localStorage below
      // Fall through to localStorage as a last-ditch retry path.
    }
  }
  // localStorage fallback (or IDB-failed retry).
  try {
    const json = JSON.stringify(value);
    ls.setString(key, json);
  } catch (err) {
    if (isQuotaError(err)) emitStorageEvent({ kind: 'quota-exceeded', key, error: err });
    // TD-24: a NON-quota failure here means the write reached neither IndexedDB
    // nor localStorage — only the ephemeral memory map below, which is lost on
    // reload. Quota is already surfaced as a toast; anything else is a genuine
    // unexpected persistence fault.
    else unexpected(err, 'kvStore.kvSet:persist-failed');
    // Memory fallback as the absolute last resort — ephemeral but
    // preserves the in-tab session.
    try { memoryFallback.set(key, JSON.stringify(value)); } catch (e) { expected(e, 'kvStore.kvSet:memory'); }
  }
}

export async function kvRemove(key: string): Promise<void> {
  if (hasIDB()) {
    try { await withStore<undefined>('readwrite', s => s.delete(key) as IDBRequest<undefined>); }
    catch { /* noop */ }
  }
  try { ls.removeBoth(key); } catch { /* noop */ }
  memoryFallback.delete(key);
}

// ── Cache generation + purge (v10.20.8) ─────────────────────────────────────
//
// The entity cache lives HERE — IndexedDB first, localStorage only as a
// fallback and one-time migration source (kvSet deletes the localStorage copy
// after a successful IDB write). A purge that sweeps only localStorage
// therefore clears nothing on a normal browser. That was the flaw in
// v10.20.7's cacheInvalidation: its unit tests passed because vitest runs in
// node with a localStorage polyfill and NO IndexedDB, so they exercised the
// fallback path and never the real one.

let generation = 0;

/**
 * Monotonic counter, bumped by every purge.
 *
 * A cloud read that was already in flight when the session changed must not be
 * allowed to write its result into the new session's cache. Callers capture
 * this before issuing the request and check it before caching the response.
 */
export function cacheGeneration(): number { return generation; }

/** False once a purge has happened since `gen` was captured. */
export function isCacheGenerationCurrent(gen: number): boolean {
  return gen === generation;
}

/** Every key held in the cache, across whichever backends are in play. */
export async function kvKeys(): Promise<string[]> {
  const keys = new Set<string>();
  if (hasIDB()) {
    try {
      const idbKeys = await withStore<IDBValidKey[]>('readonly', s => s.getAllKeys());
      for (const k of idbKeys) if (typeof k === 'string') keys.add(k);
    } catch { /* fall through to the other backends */ }
  }
  for (const k of memoryFallback.keys()) keys.add(k);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const raw = localStorage.key(i);
      if (!raw) continue;
      // Stored under the `vt_`/`ff_` namespaces; kv keys are the bare suffix.
      if (raw.startsWith('vt_') || raw.startsWith('ff_')) keys.add(raw.slice(3));
    }
  } catch { /* storage unavailable */ }
  return [...keys];
}

/**
 * Remove every cached key matching `shouldRemove`, from ALL backends, and bump
 * the generation so in-flight reads cannot repopulate what was just cleared.
 *
 * Returns the number of keys removed. Awaited by the caller — hydration must
 * not begin until the old session's data is actually gone.
 */
export async function kvPurgeWhere(shouldRemove: (key: string) => boolean): Promise<number> {
  const keys = await kvKeys();
  let removed = 0;
  for (const k of keys) {
    if (!shouldRemove(k)) continue;
    await kvRemove(k);          // clears IDB + both localStorage namespaces + memory
    removed++;
  }
  // Bump AFTER the deletes, so a racing read that captured the old generation
  // is rejected even if it resolves during the purge.
  generation++;
  return removed;
}

/** Test-only: drop all in-memory state so unit tests start clean. */
export function _resetKvForTests(): void {
  memoryFallback.clear();
  dbPromise = null;
  generation = 0;
}

/**
 * Test-only: close the open IndexedDB connection and reset state.
 *
 * `_resetKvForTests` only drops the promise; the underlying connection stays
 * OPEN, so a test that then calls `indexedDB.deleteDatabase('vyact')` blocks
 * forever waiting for it. Await this instead when a test needs a genuinely
 * empty database.
 */
export async function _closeKvForTests(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  memoryFallback.clear();
  generation = 0;
  if (!p) return;
  try { (await p).close(); } catch { /* already closed or never opened */ }
}
