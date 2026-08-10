// Parses a `uiautomator dump` XML file and prints tap-center coordinates for
// UI automation, working around a real constraint discovered while building
// this: this Chromium WebView's accessibility dump does NOT expose aria-label
// or placeholder as text/content-desc/hint for EMPTY input fields (only
// non-empty values, or elements with visible text/labels, show up) — so an
// empty amount/description/name field can't be found by matching its own
// label text. `--after` works around that by finding a node's position in
// document order and returning the next node with genuinely different
// bounds (skips zero-size/duplicate wrapper nodes) — in practice, the input
// that immediately follows its own on-screen label.
//
// Usage:
//   node ui-find.mjs <dump.xml> "<needle>" [--index N]   find node by text/content-desc/hint/resource-id
//   node ui-find.mjs <dump.xml> --after "<needle>"       tap-center of the next distinct element after needle
//   node ui-find.mjs <dump.xml> --list                   diagnostic: print every text/content-desc/hint on screen

import { readFileSync } from 'node:fs';

const [, , dumpPath, ...rest] = process.argv;
if (!dumpPath) {
  console.error('usage: node ui-find.mjs <dump.xml> "<needle>" [--index N] | --after "<needle>" | --list');
  process.exit(2);
}

const xml = readFileSync(dumpPath, 'utf8');
const nodeRe = /<node\b[^>]*>/g;
const attrRe = /(\w[\w:-]*)="([^"]*)"/g;

function parseAllNodes() {
  const out = [];
  let m;
  nodeRe.lastIndex = 0;
  while ((m = nodeRe.exec(xml))) {
    const tag = m[0];
    const attrs = {};
    let a;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(tag))) attrs[a[1]] = a[2];
    out.push(attrs);
  }
  return out;
}

function boundsOf(attrs) {
  const bm = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attrs.bounds || '');
  if (!bm) return null;
  const [, x1, y1, x2, y2] = bm.map(Number);
  return { x1, y1, x2, y2, cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
}

function matchesNeedle(attrs, needle) {
  const hay = [attrs.text, attrs['content-desc'], attrs['hint'], attrs['resource-id']]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(needle);
}

const all = parseAllNodes();

if (rest[0] === '--list') {
  const seen = new Set();
  for (const attrs of all) {
    const label = [attrs.text, attrs['content-desc'], attrs['hint']].filter(Boolean).join(' | ');
    if (label && !seen.has(label)) { seen.add(label); console.log(label); }
  }
  process.exit(0);
}

if (rest[0] === '--after') {
  const needle = (rest[1] || '').toLowerCase();
  if (!needle) { console.error('--after requires a needle string'); process.exit(2); }
  const skipFlag = rest.indexOf('--skip');
  let skip = skipFlag !== -1 ? parseInt(rest[skipFlag + 1], 10) : 0; // how many distinct nodes to pass over
  const idx = all.findIndex(a => matchesNeedle(a, needle));
  if (idx === -1) { console.error(`no match for "${rest[1]}" (--after)`); process.exit(1); }
  const anchorBounds = boundsOf(all[idx]);
  let lastBounds = anchorBounds;
  for (let i = idx + 1; i < all.length; i++) {
    const b = boundsOf(all[i]);
    if (!b) continue;
    if (b.x2 - b.x1 <= 0 || b.y2 - b.y1 <= 0) continue; // zero-size node
    if (lastBounds && b.cx === lastBounds.cx && b.cy === lastBounds.cy) continue; // same node/wrapper
    if (skip > 0) { skip--; lastBounds = b; continue; }
    console.log(`${b.cx} ${b.cy}`);
    process.exit(0);
  }
  console.error(`found "${rest[1]}" but no distinct node after it (+skip)`);
  process.exit(1);
}

// Default: find-by-text mode.
const needleRaw = rest[0];
if (!needleRaw) { console.error('usage: node ui-find.mjs <dump.xml> "<needle>" [--index N] | --after "<needle>" | --list'); process.exit(2); }
const idxFlag = rest.indexOf('--index');
const wantIndex = idxFlag !== -1 ? parseInt(rest[idxFlag + 1], 10) : 0;
const needle = needleRaw.toLowerCase();

const matches = all.filter(a => matchesNeedle(a, needle));
if (matches.length <= wantIndex) {
  console.error(`no match (found ${matches.length}) for "${needleRaw}"`);
  process.exit(1);
}
const b = boundsOf(matches[wantIndex]);
if (!b) { console.error(`matched node has no usable bounds: ${matches[wantIndex].bounds}`); process.exit(1); }
console.log(`${b.cx} ${b.cy}`);
