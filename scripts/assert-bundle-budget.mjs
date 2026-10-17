// W8d (audit GATE-06) — build gate: the app's ENTRY chunk (the script index.html loads) stays under its
// budget. It was 615 KB before the vendor split (vite.config.ts codeSplitting) and ~277 KB after; the budget
// leaves room for normal growth while catching a library slipping back into the entry.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENTRY_BUDGET_KB = 350;

/** The entry script index.html loads, e.g. "/assets/index-abc.js", or null. */
export function entryScript(indexHtml) {
  return /<script type="module"[^>]*\ssrc="(\/assets\/[^"]+\.js)"/.exec(indexHtml)?.[1] ?? null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  const entry = entryScript(readFileSync(join(dist, 'index.html'), 'utf8'));
  if (!entry) { console.error('✗ index.html has no entry script (GATE-06)'); process.exit(1); }
  const kb = Math.round(statSync(join(dist, entry)).size / 1024);
  if (kb > ENTRY_BUDGET_KB) {
    console.error(`✗ Entry chunk ${entry} is ${kb} KB, over the ${ENTRY_BUDGET_KB} KB budget (GATE-06).`);
    process.exit(1);
  }
  console.log(`✓ Entry chunk ${kb} KB (budget ${ENTRY_BUDGET_KB} KB)`);
}
