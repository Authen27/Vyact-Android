// CI check that Pip's gateway call really leaves the app from native code (src/lib/nativeFetch.ts).
//
// Runs against the booted emulator with the debug APK running. A debug build exposes the WebView over
// the Chrome DevTools Protocol; this attaches to it and evaluates, INSIDE the app's page, the exact
// kind of request Pip makes — POST https://<project>/functions/v1/ask-vyact with the project's anon
// key as the bearer (public, committed in .env.production; it is not a user session, so the gateway
// answers 401 "unauthorized" before any model call, any data access or any cost).
//
//   fetch  -> must come back as an HTTP 401 whose JSON body is the gateway's own ("unauthorized").
//             Only code running on the server can produce that, which proves the request got past the
//             browser's CORS check — i.e. it went out without an Origin header, natively.
//   XHR    -> the same request on the WebView's own network stack. Informational: while the gateway's
//             allowlist excludes https://localhost this is blocked ("network error"), which is the
//             exact failure Pip showed ("I can't reach the assistant").
//
// Node 22 (global fetch + WebSocket). Exit 1 if the native path does not work.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' });
const fail = (msg) => { console.error(`PIP-PROBE FAIL: ${msg}`); process.exit(1); };

const env = Object.fromEntries(
  readFileSync('.env.production', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; }),
);
const SUPABASE_URL = (env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY ?? '';
if (!SUPABASE_URL || !ANON_KEY) fail('.env.production has no VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');

// 1 — find the WebView's DevTools socket and forward it
const sockets = [...adb('shell', 'cat', '/proc/net/unix').matchAll(/@(webview_devtools_remote_\d+)/g)].map(m => m[1]);
if (!sockets.length) fail('no WebView DevTools socket — is the debug app running?');
adb('forward', 'tcp:9222', `localabstract:${sockets[sockets.length - 1]}`);

// 2 — pick the app's page
const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = pages.find(p => p.type === 'page' && String(p.url).startsWith('https://localhost'));
if (!page) fail(`no app page among: ${pages.map(p => p.url).join(', ')}`);

// 3 — evaluate the probe inside it
const expression = `(async () => {
  const url = ${JSON.stringify(SUPABASE_URL + '/functions/v1/ask-vyact')};
  const headers = { 'content-type': 'application/json', apikey: ${JSON.stringify(ANON_KEY)}, authorization: 'Bearer ' + ${JSON.stringify(ANON_KEY)} };
  const body = JSON.stringify({ seam: 'assistant', surface: 'chat', op: 'classify', input: 'probe' });
  const out = {};
  try { const r = await fetch(url, { method: 'POST', headers, body }); out.fetch = { status: r.status, body: (await r.text()).slice(0, 300) }; }
  catch (e) { out.fetch = { error: String(e) }; }
  out.xhr = await new Promise(res => {
    const x = new XMLHttpRequest(); x.open('POST', url);
    for (const k in headers) x.setRequestHeader(k, headers[k]);
    x.onload = () => res({ status: x.status }); x.onerror = () => res({ error: 'network error (blocked)' });
    x.send(body);
  });
  return JSON.stringify(out);
})()`;

const value = await new Promise((resolve, reject) => {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const timer = setTimeout(() => { ws.close(); reject(new Error('DevTools call timed out')); }, 60_000);
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== 1) return;
    clearTimeout(timer); ws.close();
    if (m.error || m.result?.exceptionDetails) reject(new Error(JSON.stringify(m.error ?? m.result.exceptionDetails)));
    else resolve(m.result.result.value);
  };
  ws.onerror = () => { clearTimeout(timer); reject(new Error('DevTools websocket error')); };
}).catch(e => fail(String(e.message ?? e)));

const out = JSON.parse(value);
console.log('PIP-PROBE native fetch :', JSON.stringify(out.fetch));
console.log('PIP-PROBE WebView XHR  :', JSON.stringify(out.xhr), '(informational)');

if (out.fetch?.error) fail(`the native request failed: ${out.fetch.error}`);
if (out.fetch?.status !== 401 || !/"error"\s*:\s*"unauthorized"/.test(out.fetch.body ?? '')) {
  fail(`expected the gateway's own 401 "unauthorized", got ${JSON.stringify(out.fetch)}`);
}
console.log('PIP-PROBE PASS: the gateway answered a request sent from native code (no Origin, no CORS block).');
