// Vyact — public Supabase config for the server-rendered pages (/learn, /sitemap.xml).
//
// v10.49.0 (#0) — /learn returned "Learn is temporarily unavailable" and the sitemap
// listed no lessons from ~9 Sep, for two reasons:
//   1. these functions read VITE_SUPABASE_* from the Vercel runtime env, which is empty
//      by design: CI builds the app from the committed react/.env.production instead
//      (see deploy.yml). With no key, /learn answered 500 and the sitemap fell back to
//      a single URL;
//   2. the key there is a *publishable* key (sb_publishable_…). It is not a JWT, so it
//      must go in `apikey` only; sent as `Authorization: Bearer` too, PostgREST rejects
//      it with 401.
// So: the runtime env when set, else the committed .env.production (bundled with the
// functions via vercel.json `includeFiles`). One source of truth; no key in code.
// Underscore file: Vercel does not expose it as an endpoint.
import { readFileSync } from 'node:fs';

function fromEnvFile() {
  try {
    const text = readFileSync(new URL('../.env.production', import.meta.url), 'utf8');
    const out = {};
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

let cached;
export function publicConfig() {
  if (cached) return cached;
  const file = fromEnvFile();
  cached = {
    url: process.env.VITE_SUPABASE_URL || file.VITE_SUPABASE_URL || 'https://dmxqkvploojokffuhxnz.supabase.co',
    key: process.env.VITE_SUPABASE_ANON_KEY || file.VITE_SUPABASE_ANON_KEY || '',
  };
  return cached;
}

/** W7b (audit FE-PUB-03): how long a page waits for the database before answering "try again". A slow
 *  upstream used to hold the function until Vercel's own limit, then fail without the 503 page. */
export const READ_TIMEOUT_MS = 4000;

/** Read published content with the public key (RLS: anon sees published rows only). */
export async function readContent(query, fetchImpl = fetch) {
  const { url, key } = publicConfig();
  if (!key) throw new Error('no_public_key');
  const r = await fetchImpl(`${url}/rest/v1/content_items?${query}`, {
    headers: { apikey: key }, signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return r.json();
}

/** Test hook: forget the cached config. */
export function _resetConfig() { cached = undefined; }
