// Vyact — where a person lands after signing in or up (v10.49.0, marketing #20).
//
// Landing and Learn links send new users to the feature they were reading about
// (`/auth/sign-up?ref=…&next=/budgets`). Email sign-up navigates there directly;
// Google sign-up leaves the site for the consent screen and comes back to
// /auth/verified, so `next` is remembered across that redirect.
//
// `next` is only ever an in-app PATH: anything else (another origin, "//host",
// "javascript:") is dropped, so a crafted link can't bounce someone off the site.

const KEY = 'vy_post_auth_next';

// W0 (audit 2026-10-04, FE-PLT-01) — hardened. "/\t/evil.com" passed the old regex, and
// URL parsers strip tabs and newlines, which turns it into "//evil.com" (another host).
// So: no control characters or backslashes anywhere, then resolve against a placeholder
// origin and require the result to stay on it; the normalised path is what is returned
// (so "/a/../auth/x" is seen as the auth loop it is).
const PLACEHOLDER_ORIGIN = 'https://vyact.invalid';
const unsafeChar = (s: string) => [...s].some(ch => {
  const c = ch.charCodeAt(0);
  return c < 0x20 || c === 0x7f || ch === '\\';
});

export function safeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (unsafeChar(v)) return null;
  if (!/^\/(?!\/)/.test(v)) return null;
  let url: URL;
  try { url = new URL(v, PLACEHOLDER_ORIGIN); } catch { return null; }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;
  if (/^\/auth(\/|$)/.test(url.pathname)) return null;          // never loop back into auth
  return `${url.pathname}${url.search}${url.hash}`.slice(0, 200);
}

export function rememberNext(value: string | null | undefined): void {
  const next = safeNext(value);
  try {
    if (next) sessionStorage.setItem(KEY, next);
  } catch { /* private mode: the default landing still works */ }
}

/** A pending household invite wins; then the remembered or given `next`; else the dashboard. */
export function postAuthPath(next?: string | null): string {
  let pendingInvite: string | null = null;
  let stored: string | null = null;
  try {
    pendingInvite = sessionStorage.getItem('pending_invite_token');
    stored = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch { /* ignore */ }
  if (pendingInvite) return `/invite/${encodeURIComponent(pendingInvite)}`;
  return safeNext(next) ?? safeNext(stored) ?? '/dashboard';
}
