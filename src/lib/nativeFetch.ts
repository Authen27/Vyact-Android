// Vyact (Android app) — send the Pip / Ask Vyact gateway request from native code, not the WebView.
//
// WHY. The Android app's page origin is https://localhost (Capacitor, androidScheme: https). The
// `ask-vyact` Edge Function pins CORS to an explicit allowlist (default: https://vyact.app only —
// a paid, user-authenticated endpoint must never answer `*`). The browser therefore sends a
// preflight with `Origin: https://localhost`, gets a 403 and no Access-Control-Allow-Origin, blocks
// the call, and Pip shows "I can't reach the assistant". On vyact.app the same request is allowed,
// which is why Pip works there and nowhere else. (Probed against the live project: OPTIONS from
// https://localhost -> 403, from https://vyact.app -> 204; every other function answers `*`.)
//
// WHAT. A request made by native code is not a browser cross-origin request: it carries no Origin
// header, which the gateway treats as "not a browser" and accepts — it still requires the user's
// bearer token, exactly as before. So requests to the allowlisted functions below go through
// Capacitor's native HTTP client; everything else keeps using the WebView's own fetch. No server
// change, nothing widened: the allowlist stays as the owner set it.
//
// WHEN. This module must run BEFORE the Supabase client is created: supabase-js keeps a reference to
// the global `fetch` it finds at creation time, so patching later would change nothing. main.tsx
// imports it ahead of ./App for that reason. It therefore must not import ./native (which imports
// ./supabase); it reads the project URL from the build environment itself.

import { Capacitor, CapacitorHttp } from '@capacitor/core';

/** Functions whose CORS allowlist excludes the app's origin. Add a name here if another one is pinned. */
export const NATIVE_FUNCTIONS: readonly string[] = ['ask-vyact'];

const BASE = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '').replace(/\/+$/, '');

export function wantsNative(url: string, base: string = BASE): boolean {
  const prefix = `${base}/functions/v1/`;
  if (!base || !url.startsWith(prefix)) return false;
  const name = url.slice(prefix.length).split(/[/?#]/)[0];
  return NATIVE_FUNCTIONS.includes(name);
}

const abortError = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException('The operation was aborted', 'AbortError');

export async function nativeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const signal = init?.signal ?? req.signal;

  // Listen for Stop / New chat / the 30 s deadline from the very start — before the awaits below —
  // or an abort that lands while the body is still being read would never be noticed and the call
  // would hang. The native request itself cannot be cancelled mid-flight; an abort just stops waiting.
  let stopListening = (): void => {};
  const aborted = new Promise<never>((_, reject) => {
    const fire = () => reject(abortError(signal));
    if (signal.aborted) { fire(); return; }
    signal.addEventListener('abort', fire, { once: true });
    stopListening = () => signal.removeEventListener('abort', fire);
  });

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => { headers[key] = value; });
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const body = hasBody ? await req.text() : undefined;
    if (signal.aborted) throw abortError(signal);
    const r = await CapacitorHttp.request({
      url: req.url,
      method: req.method,
      headers,
      ...(body !== undefined ? { data: body } : {}),
      responseType: 'text',
      connectTimeout: 15_000,
      readTimeout: 60_000, // the app's own deadline for one Pip answer is 30 s and aborts first
    });
    const noBody = r.status === 204 || r.status === 205 || r.status === 304;
    const text = typeof r.data === 'string' ? r.data : r.data == null ? '' : JSON.stringify(r.data);
    const outHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.headers ?? {})) outHeaders[k] = String(v);
    return new Response(noBody ? null : text, { status: r.status, headers: outHeaders });
  };

  try {
    return await Promise.race([send(), aborted]);
  } finally {
    stopListening();
  }
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

export function installNativeFetch(win: Window & typeof globalThis = window): void {
  const webFetch = win.fetch.bind(win);
  win.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    wantsNative(urlOf(input)) ? nativeFetch(input, init) : webFetch(input, init)) as typeof fetch;
}

if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) installNativeFetch();
