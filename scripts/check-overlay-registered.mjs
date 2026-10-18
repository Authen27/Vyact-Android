// CI guard for the Android overlay (see scripts/overlay-manifest.json). The sync script's plain
// upstream copy overwrites any shared file silently, so an Android edit that is not registered —
// or a registered file whose edit has been wiped — would ship as a visual/runtime regression, not a
// build error. This turns each of those into a red check.
//
//   1. every 'merged' file exists, still carries an ANDROID-OVERLAY marker, and has no conflict markers
//   2. no file outside 'merged'/'additive' carries ANDROID-OVERLAY or imports @capacitor / lib/native
//   3. every 'additive' path exists AND is tracked by git (an unanchored `android/` in .gitignore once
//      made git silently skip native/android/**)
//   4. .gitignore anchors /android/ and /ios/; no stray vite.config.js / vite.config.d.ts at the root
//      (Vite resolves .js before .ts, so a stale emit silently replaces vite.config.ts)
//
// Usage (repo root):  node scripts/check-overlay-registered.mjs     Exit 0 = ok, 1 = problems.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(readFileSync('scripts/overlay-manifest.json', 'utf8'));
const { merged, additive } = manifest;
const problems = [];

const isAdditive = (f) => additive.some(a => (a.endsWith('/') ? f.startsWith(a) : f === a));
const isRegistered = (f) => merged.includes(f) || isAdditive(f);
const read = (f) => readFileSync(f, 'utf8');
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' });

// 1) merged files
for (const f of merged) {
  if (!existsSync(f)) { problems.push(`merged file is missing: ${f}`); continue; }
  const text = read(f);
  if (!text.includes('ANDROID-OVERLAY')) {
    problems.push(`${f} has no ANDROID-OVERLAY marker — its Android edit was wiped (a sync overwrote it), or the marker comment was dropped`);
  }
  if (/^(<{7} |>{7} |={7}$)/m.test(text)) problems.push(`${f} contains merge-conflict markers`);
}

// 2) unregistered native hooks
const tracked = git('ls-files').split('\n').filter(Boolean);
const scan = tracked.filter(f => (f === 'index.html' || f.startsWith('src/')) && /\.(tsx?|css|html)$/.test(f) && existsSync(f));
for (const f of scan) {
  if (isRegistered(f)) continue;
  const text = read(f);
  if (text.includes('ANDROID-OVERLAY')) problems.push(`${f} carries an ANDROID-OVERLAY edit but is not in overlay-manifest.json 'merged' — the next sync would wipe it`);
  else if (/from\s+['"]@capacitor\//.test(text) || /from\s+['"](\.\.?\/)+(lib\/)?(native|widgets)['"]/.test(text)) {
    problems.push(`${f} imports a native (Capacitor) module but is not registered in overlay-manifest.json`);
  }
}

// 3) additive paths exist and are tracked
const hasFiles = (p) => {
  if (!statSync(p).isDirectory()) return true;
  return readdirSync(p).some(n => hasFiles(join(p, n)));
};
for (const a of additive) {
  const p = a.endsWith('/') ? a.slice(0, -1) : a;
  if (!existsSync(p)) { problems.push(`additive path is missing: ${a}`); continue; }
  if (!hasFiles(p)) { problems.push(`additive directory is empty: ${a}`); continue; }
  if (!tracked.some(f => (a.endsWith('/') ? f.startsWith(a) : f === a))) {
    problems.push(`additive path is not tracked by git: ${a} (ignored by .gitignore, or never added)`);
  }
}

// 4) .gitignore + stray build config
const giLines = read('.gitignore').split(/\r?\n/).map(l => l.trim());
for (const bare of ['android/', 'ios/', '**/android/', '**/ios/', 'android', 'ios']) {
  if (giLines.includes(bare)) problems.push(`.gitignore has an unanchored '${bare}' — it also ignores native/android/. Use '/${bare.replace(/^\*\*\//, '')}'`);
}
for (const f of ['vite.config.js', 'vite.config.d.ts']) {
  if (existsSync(f)) problems.push(`${f} exists at the repo root — Vite would load it instead of vite.config.ts. Delete it.`);
}

// 6) Permanent release rules (ANDROID-BUILD-RULES.md): the text that enforces them must still be there.
{
  const patch = existsSync('scripts/patch-build-gradle.mjs') ? read('scripts/patch-build-gradle.mjs') : '';
  for (const needle of ['proguard-android-optimize.txt', 'shrinkResources true', 'android.r8.optimizedResourceShrinking', 'android-toolchain.json']) {
    if (!patch.includes(needle)) problems.push(`scripts/patch-build-gradle.mjs no longer contains "${needle}" — a permanent release rule (ANDROID-BUILD-RULES.md) was dropped.`);
  }
  const pro = existsSync('native/android/app/proguard-rules.pro') ? read('native/android/app/proguard-rules.pro') : '';
  if (!/^\s*-repackageclasses\b/m.test(pro)) problems.push("native/android/app/proguard-rules.pro has no -repackageclasses — rule R4 (ANDROID-BUILD-RULES.md).");
  if (/^\s*-(dontoptimize|dontshrink|dontobfuscate)\b/m.test(pro)) problems.push('native/android/app/proguard-rules.pro turns R8 shrinking/optimisation/obfuscation off — rule R1.');
  const releaseWf = '.github/workflows/android-release.yml';
  const wf = existsSync(releaseWf) ? read(releaseWf) : '';
  for (const needle of ['scripts/patch-build-gradle.mjs', 'scripts/verify-android-r8.mjs']) {
    if (!wf.includes(needle)) problems.push(`android-release.yml no longer runs ${needle} — a permanent release rule is no longer applied/proven.`);
  }
  const tc = existsSync('android-toolchain.json') ? JSON.parse(read('android-toolchain.json')) : null;
  if (!tc) problems.push('android-toolchain.json is missing (rule R5).');
  else if (Number(String(tc.agp).split('.')[0]) < 9 && !tc.blocked) {
    problems.push(`android-toolchain.json has AGP ${tc.agp}; rule R5 needs 9.0+ — or a written "blocked" reason in that file.`);
  }
}

if (problems.length) {
  console.error(`overlay check FAILED (${problems.length}):\n` + problems.map(p => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(`overlay check ok: ${merged.length} merged files carry their marker, ${additive.length} additive paths are tracked.`);
