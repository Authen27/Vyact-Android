// Vyact — where vyact.app's Content-Security-Policy violation reports go (v10.125.0, T4b; audit FE-PLT-04;
// owner, 19 Oct 2026: "collect reports, then enforce").
//
// The policy has been report-only since W8d, with nowhere to report to, so whether it could be enforced
// was unknowable. Browsers now POST each violation here (vercel.json: `report-uri /api/csp-report` and the
// Reporting API's `report-to csp`). One log line per violation, in Vercel's function logs:
//   {"fn":"csp-report","directive":"script-src-elem","blocked":"evil.example","page":"/transactions"}
// Only the directive, the blocked HOST (or 'inline' / 'eval' / 'data' …) and the page PATH: never a query
// string, a fragment, a sample of page text or anything from the person's data. After about a week of
// normal use with nothing unexpected, the header becomes Content-Security-Policy (enforced).

const MAX_BYTES = 16 * 1024;

/** The host of a blocked URL, or the keyword a browser uses for non-URL sources. Never the path or query. */
export function blockedOf(uri) {
  const s = String(uri || '');
  if (!s) return 'unknown';
  if (/^(inline|eval|wasm-eval|trusted-types-policy|trusted-types-sink)$/i.test(s)) return s.toLowerCase();
  try {
    const u = new URL(s);
    if (u.protocol === 'data:' || u.protocol === 'blob:') return u.protocol.slice(0, -1);
    return u.host || u.protocol.slice(0, -1);
  } catch { return s.split(/[/?#]/)[0].slice(0, 60) || 'unknown'; }
}

/** The page's path only (no query, no fragment). */
export function pageOf(uri) {
  try { return new URL(String(uri || '')).pathname.slice(0, 200); } catch { return 'unknown'; }
}

/** Both report formats (report-uri's {"csp-report": …} and the Reporting API's [{type, body}]) → lines. */
export function linesOf(payload) {
  const list = Array.isArray(payload) ? payload : [payload];
  const out = [];
  for (const item of list.slice(0, 20)) {
    const r = item && (item['csp-report'] || (item.type === 'csp-violation' ? item.body : null));
    if (!r || typeof r !== 'object') continue;
    out.push({
      fn: 'csp-report',
      directive: String(r['effective-directive'] || r.effectiveDirective || r['violated-directive'] || 'unknown').split(' ')[0].slice(0, 40),
      blocked: blockedOf(r['blocked-uri'] || r.blockedURL),
      page: pageOf(r['document-uri'] || r.documentURL),
    });
  }
  return out;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let text = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!text && typeof req.on === 'function') {
    text = await new Promise((resolve) => {
      let data = '';
      setTimeout(() => resolve(''), 3000);   // a stream already read never ends; a report is not worth waiting for
      req.on('data', (c) => { data += c; if (data.length > MAX_BYTES) { data = ''; resolve(''); } });
      req.on('end', () => resolve(data));
      req.on('error', () => resolve(''));
    });
  }
  if (!text || text.length > MAX_BYTES) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'POST'); res.end(); return; }
  const payload = await readBody(req);
  for (const line of payload ? linesOf(payload) : []) console.log(JSON.stringify(line));
  res.statusCode = 204;
  res.end();
}
