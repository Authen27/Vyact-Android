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
//   5. the Play bundle can never contain SMS: no SMS source under native/android/ (only native/sms/ is
//      copied, and only by patch-android-sms.mjs), no RECEIVE_SMS in the always-run patch scripts, and
//      android-release.yml (the Play AAB) neither takes sms_enabled nor runs the SMS patch
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

// 5) Play safety: SMS exists only in the opt-in sideload build.
const walkFiles = (dir) => readdirSync(dir).flatMap(n => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walkFiles(p) : [p];
});
for (const p of walkFiles('native/android')) {
  if (/sms/i.test(p.split(/[\\/]/).pop())) problems.push(`${p} is SMS code under native/android/ — it would ship in every build, Play included. Keep it in native/sms/.`);
  else {
    // MainActivity looks the optional plugin up BY NAME (that string is the only allowed reference).
    const banned = /MainActivity\.java$/.test(p) ? /RECEIVE_SMS|READ_SMS/ : /RECEIVE_SMS|READ_SMS|SmsBridge/;
    if (banned.test(read(p))) problems.push(`${p} mentions an SMS permission/plugin — only native/sms/ and scripts/patch-android-sms.mjs may.`);
  }
}
for (const p of ['scripts/patch-android-manifest.mjs', 'scripts/inject-android-native.mjs', 'scripts/patch-build-gradle.mjs']) {
  if (existsSync(p) && /RECEIVE_SMS|READ_SMS|READ_CALL_LOG|patch-android-sms/.test(read(p))) problems.push(`${p} runs in every build but mentions SMS — it must not.`);
}
const playWorkflow = '.github/workflows/android-release.yml';
if (existsSync(playWorkflow) && /sms_enabled|patch-android-sms|RECEIVE_SMS/.test(read(playWorkflow))) {
  problems.push('android-release.yml (the Play bundle) references the SMS build — Play must never get it until the Permissions Declaration is approved.');
}

if (problems.length) {
  console.error(`overlay check FAILED (${problems.length}):\n` + problems.map(p => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(`overlay check ok: ${merged.length} merged files carry their marker, ${additive.length} additive paths are tracked.`);
