// Parses a `uiautomator dump` XML file and prints the center coordinates of
// the first node whose text/content-desc/hint CONTAINS the given needle
// (case-insensitive). Used to drive UI automation against real element
// positions instead of guessed pixel coordinates, which is fragile against
// any layout change.
//
// Usage: node scripts/ui-find.mjs <dump.xml> "<needle>" [--index N]
// Prints "X Y" (tap-center) on success, exits 1 with no output on failure.

import { readFileSync } from 'node:fs';

const [, , dumpPath, needleRaw, ...rest] = process.argv;
if (!dumpPath) {
  console.error('usage: node ui-find.mjs <dump.xml> "<needle>" [--index N]');
  console.error('       node ui-find.mjs <dump.xml> --list   (diagnostic: print every text/content-desc/hint on screen)');
  process.exit(2);
}

if (needleRaw === '--list') {
  const xml = readFileSync(dumpPath, 'utf8');
  const nodeRe2 = /<node\b[^>]*>/g;
  const attrRe2 = /(\w[\w:-]*)="([^"]*)"/g;
  let mm;
  const seen = new Set();
  while ((mm = nodeRe2.exec(xml))) {
    const tag = mm[0];
    const attrs = {};
    let aa;
    attrRe2.lastIndex = 0;
    while ((aa = attrRe2.exec(tag))) attrs[aa[1]] = aa[2];
    const label = [attrs.text, attrs['content-desc'], attrs['hint']].filter(Boolean).join(' | ');
    if (label && !seen.has(label)) { seen.add(label); console.log(label); }
  }
  process.exit(0);
}

if (!needleRaw) {
  console.error('usage: node ui-find.mjs <dump.xml> "<needle>" [--index N]');
  process.exit(2);
}
const idxFlag = rest.indexOf('--index');
const wantIndex = idxFlag !== -1 ? parseInt(rest[idxFlag + 1], 10) : 0;

const xml = readFileSync(dumpPath, 'utf8');
const needle = needleRaw.toLowerCase();

// Every UI node is a single self-contained tag: <node ... /> or <node ...>.
const nodeRe = /<node\b[^>]*>/g;
const attrRe = /(\w[\w:-]*)="([^"]*)"/g;

const matches = [];
let m;
while ((m = nodeRe.exec(xml))) {
  const tag = m[0];
  const attrs = {};
  let a;
  attrRe.lastIndex = 0;
  while ((a = attrRe.exec(tag))) attrs[a[1]] = a[2];
  const hay = [attrs.text, attrs['content-desc'], attrs['hint'], attrs['resource-id']]
    .filter(Boolean).join(' ').toLowerCase();
  if (hay.includes(needle)) matches.push(attrs);
}

if (matches.length <= wantIndex) {
  console.error(`no match (found ${matches.length}) for "${needleRaw}"`);
  process.exit(1);
}

const b = matches[wantIndex].bounds; // "[x1,y1][x2,y2]"
const bm = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(b || '');
if (!bm) { console.error(`matched node has no usable bounds: ${b}`); process.exit(1); }
const [, x1, y1, x2, y2] = bm.map(Number);
console.log(`${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`);
