// Pip on Android: the ask-vyact request goes through native HTTP (no Origin header) because the
// gateway's CORS allowlist excludes https://localhost. These cover the routing and the Response
// the native result is turned into — supabase-js reads status, headers and body from it.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const request = vi.fn();
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  CapacitorHttp: { request: (o: unknown) => request(o) },
}));

import { wantsNative, nativeFetch, installNativeFetch } from '../nativeFetch';

const BASE = 'https://abc.supabase.co';
const GATEWAY = `${BASE}/functions/v1/ask-vyact`;

// braces matter: a function returned from beforeEach is run as teardown (it would call the mock)
beforeEach(() => { request.mockReset(); });

describe('wantsNative', () => {
  it('routes only the allowlisted functions', () => {
    expect(wantsNative(GATEWAY, BASE)).toBe(true);
    expect(wantsNative(`${GATEWAY}?x=1`, BASE)).toBe(true);
    expect(wantsNative(`${BASE}/functions/v1/send-split-email`, BASE)).toBe(false);
    expect(wantsNative(`${BASE}/rest/v1/transactions`, BASE)).toBe(false);
    expect(wantsNative('https://elsewhere.example/functions/v1/ask-vyact', BASE)).toBe(false);
    expect(wantsNative(`${BASE}/functions/v1/ask-vyact-relay-status`, BASE)).toBe(false);
  });
  it('routes nothing when no project is configured', () => {
    expect(wantsNative(GATEWAY, '')).toBe(false);
  });
});

describe('nativeFetch', () => {
  const init = (extra: RequestInit = {}): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t', apikey: 'k' },
    body: JSON.stringify({ op: 'classify' }),
    ...extra,
  });

  it('sends the request natively and returns a normal Response', async () => {
    request.mockResolvedValue({ status: 200, headers: { 'content-type': 'application/json' }, data: '{"ok":true,"text":"hi"}', url: GATEWAY });
    const res = await nativeFetch(GATEWAY, init());
    expect(request).toHaveBeenCalledTimes(1);
    const sent = request.mock.calls[0][0];
    expect(sent).toMatchObject({ url: GATEWAY, method: 'POST', data: '{"op":"classify"}', responseType: 'text' });
    expect(sent.headers).toMatchObject({ authorization: 'Bearer t', apikey: 'k', 'content-type': 'application/json' });
    expect(sent.headers.origin).toBeUndefined(); // the whole point: no Origin for the gateway to refuse
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ ok: true, text: 'hi' });
  });

  it('keeps an error status readable (supabase-js reads the body of a 401)', async () => {
    request.mockResolvedValue({ status: 401, headers: { 'Content-Type': 'application/json' }, data: { ok: false, error: 'unauthorized' }, url: GATEWAY });
    const res = await nativeFetch(GATEWAY, init());
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'unauthorized' }); // an object body is re-serialised
  });

  it('turns 204 into a body-less Response (a Response with a body and status 204 throws)', async () => {
    request.mockResolvedValue({ status: 204, headers: {}, data: '', url: GATEWAY });
    const res = await nativeFetch(GATEWAY, init());
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it('rejects when native HTTP fails, so supabase-js reports a real network error', async () => {
    request.mockRejectedValue(new Error('Unable to resolve host'));
    await expect(nativeFetch(GATEWAY, init())).rejects.toThrow('Unable to resolve host');
  });

  it('honours Stop / the deadline: an aborted signal rejects without waiting for the network', async () => {
    request.mockReturnValue(new Promise(() => { /* never answers */ }));
    const c = new AbortController();
    const p = nativeFetch(GATEWAY, init({ signal: c.signal }));
    await Promise.resolve();
    c.abort(new DOMException('Stopped', 'AbortError'));
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });

    const already = new AbortController();
    already.abort();
    request.mockClear();
    await expect(nativeFetch(GATEWAY, init({ signal: already.signal }))).rejects.toBeDefined();
    expect(request).not.toHaveBeenCalled();
  });
});

describe('installNativeFetch', () => {
  it('sends the gateway natively and leaves every other request to the WebView', async () => {
    const webFetch = vi.fn().mockResolvedValue(new Response('web'));
    const fake = { fetch: webFetch } as unknown as Window & typeof globalThis;
    vi.stubEnv('VITE_SUPABASE_URL', BASE);
    installNativeFetch(fake);
    request.mockResolvedValue({ status: 200, headers: {}, data: 'native', url: GATEWAY });

    await fake.fetch(`${BASE}/rest/v1/accounts`);
    expect(webFetch).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });
});
