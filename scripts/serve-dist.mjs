// Serve react/dist the way production does, for Lighthouse runs (v10.53.0, #66).
//   "/"            → dist/landing.html   (Vercel's middleware.js rewrite)
//   a real file    → that file           (assets, icons, site.css …)
//   anything else  → dist/index.html     (the app shell)
// gzip for text, long cache for hashed assets. Usage: node scripts/serve-dist.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.argv[2] || 4180);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  let full = path.join(DIST, pathname === '/' ? 'landing.html' : decodeURIComponent(pathname));
  if (!full.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) full = path.join(DIST, 'index.html');
  const body = fs.readFileSync(full);
  const type = TYPES[path.extname(full)] || 'application/octet-stream';
  const gzip = /gzip/.test(req.headers['accept-encoding'] || '') && /text|javascript|json|svg/.test(type);
  const hashed = full.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    'content-type': type,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...(gzip ? { 'content-encoding': 'gzip' } : {}),
  });
  res.end(gzip ? zlib.gzipSync(body) : body);
}).listen(PORT, () => console.log(`serving ${DIST} on http://localhost:${PORT} ("/" → landing.html)`));
