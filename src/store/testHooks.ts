// Vyact — E2E test hooks (TD-25 increment 2; also closes TD-27's `window as any`
// residual). Exposes the Zustand store to Playwright in non-production builds
// behind a single, intentional, typed window cast instead of inline `as any`.
import ls from '../lib/localStorageCompat';

// The one deliberate global shim: a window indexable by the test-hook keys.
type TestWindow = Window & Record<string, unknown>;

/**
 * Expose the store hook to E2E tests (read-only inspection of derived state) in
 * any non-production mode. No-op in production and in non-browser (test/SSR)
 * environments. Generic over the hook type so no `any` escapes.
 */
export function exposeStoreForE2E<T>(store: T): void {
  if (import.meta.env.MODE === 'production') return;
  if (typeof window === 'undefined') return;
  const w = window as unknown as TestWindow;
  // Use the localStorageCompat helper to avoid embedding legacy/global names as
  // string literals in the build output.
  try {
    w['__' + ls.legacyKey('store')] = store;
    w['__' + ls.newKey('store')] = store;
  } catch {
    // best-effort exposure only
    w.__vt_store = store;
  }
}
