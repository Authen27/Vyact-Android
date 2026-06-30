// Sync upstream Authen27/Vyact (react/) into this Android fork, preserving the
// Android overlay. Strategy:
//   • Everything NOT in the overlay -> take upstream (brings new files + changes).
//   • Additive overlay files (native shell, widgets, scripts, native/, assets,
//     capacitor config, the workflow) don't exist upstream, so they survive the copy.
//   • The handful of SHARED files edited inline -> 3-way merge.
//
// The merge BASE advances each sync: the pristine upstream version of every
// merged file is kept in .upstream-base/ and refreshed after a successful sync,
// so the next sync merges incrementally (no growing spurious conflicts). The
// very first run falls back to the seed commit as base.
//
// All three sides are normalised to LF before compare/merge so Windows CRLF
// checkouts don't masquerade as conflicts.
//
// Usage (from repo root):  node scripts/sync-from-upstream.mjs <upstreamReactDir> <seedRef>
// Exit 0 = clean, 1 = merge conflicts to resolve, 2 = bad args.

import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const upstreamReact = process.argv[2];
const seedRef = process.argv[3];
if (!upstreamReact || !seedRef) {
  console.error('usage: node scripts/sync-from-upstream.mjs <upstreamReactDir> <seedRef>');
  process.exit(2);
}

const BASE_DIR = '.upstream-base';

// Shared files carrying inline Android edits — these need a real 3-way merge.
const MERGED = [
  'index.html',
  'src/main.tsx',
  'src/lib/auth.ts',
  'src/components/layout/FloatingTools.tsx',
  'src/components/layout/Layout.tsx',
  'src/components/layout/MobileBar.tsx',
  'src/components/layout/Sidebar.tsx',
  'src/pages/Reports.tsx',
  'src/pages/Transactions.tsx',
  'src/store/slices/notifySlice.ts',
];

const norm = (s) => (s == null ? null : s.replace(/\r\n/g, '\n'));
const show = (ref, file) => {
  try { return execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8' }); }
  catch { return null; }
};
const writeFile = (p, c) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };

// 1) Snapshot OUR current versions of the merged files before the copy clobbers them.
const ours = {};
for (const f of MERGED) ours[f] = existsSync(f) ? norm(readFileSync(f, 'utf8')) : null;

// 2) Copy each top-level upstream entry into the repo root (overwrites shared +
//    adds new; overlay-only files/dirs aren't in upstream so they're left intact).
for (const entry of readdirSync(upstreamReact)) {
  cpSync(join(upstreamReact, entry), entry, { recursive: true, force: true });
}

// 3) 3-way merge each shared edited file; refresh its .upstream-base afterwards.
const tmp = mkdtempSync(join(tmpdir(), 'vsync-'));
const report = { merged: [], unchanged: [], conflicts: [] };
for (const f of MERGED) {
  const mine = ours[f];
  if (mine == null) continue;
  const basePath = join(BASE_DIR, f);
  const base = norm(existsSync(basePath) ? readFileSync(basePath, 'utf8') : show(seedRef, f));
  const theirs = norm(existsSync(f) ? readFileSync(f, 'utf8') : null);
  if (base == null || theirs == null) { writeFileSync(f, mine); report.merged.push(`${f} (kept ours)`); }
  else if (base === theirs || mine === theirs) { writeFileSync(f, mine); report.unchanged.push(f); }
  else {
    const bF = join(tmp, 'base'), oF = join(tmp, 'ours'), tF = join(tmp, 'theirs');
    writeFileSync(bF, base); writeFileSync(oF, mine); writeFileSync(tF, theirs);
    let out, conflicted = false;
    try {
      out = execFileSync('git', ['merge-file', '-p', '--diff3', '-L', 'ANDROID', '-L', 'UPSTREAM-BASE', '-L', 'UPSTREAM', oF, bF, tF], { encoding: 'utf8' });
    } catch (e) { out = (e.stdout || '').toString(); conflicted = true; }
    writeFileSync(f, out);
    (conflicted ? report.conflicts : report.merged).push(f);
  }
  // Advance the base: record the pristine upstream version for next time.
  if (theirs != null) writeFile(basePath, theirs);
}

// 4) Re-assert the Android .gitignore entries (upstream's react/.gitignore overwrote ours).
let gi = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf8') : '';
for (const line of ['android/', 'ios/', '/assets/']) if (!gi.includes(line)) gi += (gi.endsWith('\n') ? '' : '\n') + line + '\n';
writeFileSync('.gitignore', gi);

// 5) Record what we synced to (baseline for drift check).
const ver = JSON.parse(readFileSync('package.json', 'utf8')).version;
writeFileSync('.upstream-sync.json', JSON.stringify({ upstream: 'Authen27/Vyact', reactVersion: ver, syncedAt: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');

// 6) Report.
console.log(`\n== SYNC REPORT (upstream react ${ver}) ==`);
console.log(`merged cleanly (${report.merged.length}): ${report.merged.join(', ') || '-'}`);
console.log(`upstream-unchanged (${report.unchanged.length}): ${report.unchanged.join(', ') || '-'}`);
console.log(`CONFLICTS (${report.conflicts.length}): ${report.conflicts.join(', ') || 'none'}`);
process.exit(report.conflicts.length ? 1 : 0);
