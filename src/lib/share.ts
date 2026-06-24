// Vyact — social sharing + public-link helpers (Insights Hub v9.5.5).
//
// Evergreen lessons are public, indexable content (served server-side at
// /learn/<slug> with OG + JSON-LD, see api/learn.js), so they get real shareable
// URLs. Personal "For You" insights are PRIVATE financial data — they never get a
// public page; their share promotes the app with a generic, number-free message.

/** Canonical public origin for shareable links (CI-deployed prod). */
export const PUBLIC_BASE = 'https://vyact-twentyx.vercel.app';

/** Public, server-rendered landing for one evergreen lesson. */
export function evergreenUrl(slug: string): string {
  return `${PUBLIC_BASE}/learn/${slug}`;
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/** Native share sheet when available, else copy the link to the clipboard. */
export async function shareLink(opts: { title: string; text: string; url: string }): Promise<ShareResult> {
  const { title, text, url } = opts;
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav?.share) {
    try { await nav.share({ title, text, url }); return 'shared'; }
    catch (e) { if ((e as Error)?.name === 'AbortError') return 'cancelled'; /* fall through to copy */ }
  }
  try { await nav?.clipboard?.writeText(`${text} ${url}`); return 'copied'; }
  catch { return 'failed'; }
}

/** Share a public evergreen lesson (real URL + OG card promoting Vyact). */
export function shareEvergreen(slug: string, title: string): Promise<ShareResult> {
  return shareLink({
    title: `${title} · Vyact`,
    text: `${title} — a quick money idea from Vyact.`,
    url: evergreenUrl(slug),
  });
}

/** Share for a PRIVATE personal insight: promote the app, never the user's data. */
export function shareApp(): Promise<ShareResult> {
  return shareLink({
    title: 'Vyact — family finance, made legible',
    text: 'I track spending, budgets, debt and net worth with Vyact.',
    url: PUBLIC_BASE,
  });
}

/** Upsert a JSON-LD <script> in <head> for the currently-open card (client-side
 *  SEO signal; the authoritative structured data lives on the server pages). */
export function setJsonLd(id: string, data: unknown | null): void {
  if (typeof document === 'undefined') return;
  const elId = `ld-${id}`;
  const existing = document.getElementById(elId);
  if (data == null) { existing?.remove(); return; }
  const el = existing ?? Object.assign(document.createElement('script'), { id: elId, type: 'application/ld+json' });
  el.textContent = JSON.stringify(data);
  if (!existing) document.head.appendChild(el);
}
