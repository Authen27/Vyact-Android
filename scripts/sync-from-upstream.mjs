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
// The overlay is declared in scripts/overlay-manifest.json ('merged' = shared files with an
// Android edit, 'additive' = fork-only files). After the copy, any tracked file that is neither
// upstream nor additive is reported as an ORPHAN (a file upstream deleted that the plain copy
// leaves behind — e.g. a stale vite.config.js that shadowed vite.config.ts). Pass
// --delete-orphans to git rm them.
//
// Usage (from repo root):  node scripts/sync-from-upstream.mjs <upstreamReactDir> <seedRef> [--delete-orphans]
// Exit 0 = clean, 1 = merge conflicts to resolve or orphans reported, 2 = bad args.

import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const deleteOrphans = process.argv.includes('--delete-orphans');
const [upstreamReact, seedRef] = args;
if (!upstreamReact || !seedRef) {
  console.error('usage: node scripts/sync-from-upstream.mjs <upstreamReactDir> <seedRef> [--delete-orphans]');
  process.exit(2);
}

const BASE_DIR = '.upstream-base';

// Shared files carrying inline Android edits — these need a real 3-way merge. The list lives in
// scripts/overlay-manifest.json. IMPORTANT: any file with a hand-applied Android patch (safe-area
// insets, native hooks, etc.) MUST be listed there, or the next sync's plain upstream copy
// silently overwrites the patch with no error (bit us once already — MobileHeader/TopBar/SubNav's
// safe-area fixes were wiped by the 10.18.1 sync). scripts/check-overlay-registered.mjs enforces it.
const MANIFEST = JSON.parse(readFileSync('scripts/overlay-manifest.json', 'utf8'));
const MERGED = MANIFEST.merged;
const ADDITIVE = MANIFEST.additive;

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
//    Matched as whole LINES and ANCHORED: a bare 'android/' also ignores native/android/ (the
//    overlay), and a substring test let 'android/' satisfy '/android/' once already.
let gi = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf8') : '';
const giLines = new Set(gi.split(/\r?\n/).map(l => l.trim()));
for (const line of ['/android/', '/ios/', '/assets/', '/node_modules/', '/dist/', '*.tsbuildinfo']) if (!giLines.has(line)) gi += (gi.endsWith('\n') ? '' : '\n') + line + '\n';
writeFileSync('.gitignore', gi);

// 5) Record what we synced to (baseline for drift check).
const ver = JSON.parse(readFileSync('package.json', 'utf8')).version;
writeFileSync('.upstream-sync.json', JSON.stringify({ upstream: 'Authen27/Vyact', reactVersion: ver, syncedAt: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');

// 6) Orphans: tracked files that are neither upstream nor declared additive.
const upstreamFiles = new Set();
const walk = (dir, rel = '') => {
  for (const name of readdirSync(join(dir, rel))) {
    if (['node_modules', '.git', 'dist'].includes(name)) continue;
    const r = rel ? rel + '/' + name : name;
    if (statSync(join(dir, r)).isDirectory()) walk(dir, r); else upstreamFiles.add(r);
  }
};
walk(upstreamReact);
const isAdditive = (f) => ADDITIVE.some(a => (a.endsWith('/') ? f.startsWith(a) : f === a));
const orphans = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  .filter(f => existsSync(f) && !upstreamFiles.has(f) && !isAdditive(f));
if (deleteOrphans && orphans.length) execFileSync('git', ['rm', '-q', '-f', '--', ...orphans], { stdio: 'inherit' });

// 7) Report.
console.log(`\n== SYNC REPORT (upstream react ${ver}) ==`);
console.log(`merged cleanly (${report.merged.length}): ${report.merged.join(', ') || '-'}`);
console.log(`upstream-unchanged (${report.unchanged.length}): ${report.unchanged.join(', ') || '-'}`);
console.log(`CONFLICTS (${report.conflicts.length}): ${report.conflicts.join(', ') || 'none'}`);
console.log(`ORPHANS (${orphans.length})${deleteOrphans ? ' - deleted' : ' - re-run with --delete-orphans, or add to overlay-manifest.json "additive"'}: ${orphans.join(', ') || 'none'}`);
process.exit(report.conflicts.length || (orphans.length && !deleteOrphans) ? 1 : 0);
