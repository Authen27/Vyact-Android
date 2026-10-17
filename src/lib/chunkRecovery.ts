// W6 (audit FE-UIS-12) — recover from a stale code chunk once, never in a loop.
//
// After a deploy, a tab still running the old build asks for a hashed chunk that no longer
// exists. React caches the rejected lazy import, so "Try Again" showed "Something broke" forever
// until the user reloaded by hand. One reload fetches the new build; a second failure within a
// minute is a real error and is left to the error screen.

const KEY = 'vy_chunk_reload_at';
const WINDOW_MS = 60_000;

/** A failed dynamic import or chunk preload, in the wording of each browser and of Vite. */
export function isChunkLoadError(err: unknown): boolean {
  const e = err as { name?: unknown; message?: unknown } | null;
  if (!e) return false;
  if (e.name === 'ChunkLoadError') return true;
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading chunk [\w-]+ failed/i
    .test(String(e.message ?? ''));
}

/**
 * True when this tab may reload to recover (and records that it did). False when it already
 * reloaded in the last minute, or when the record cannot be kept, which is when a reload could loop.
 */
export function shouldReloadForChunk(storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined, now: number): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(KEY) ?? 0);
    if (last && now - last < WINDOW_MS) return false;
    storage.setItem(KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** The session store, or null where it is unavailable (private mode, blocked storage). */
export function sessionStore(): Storage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}
