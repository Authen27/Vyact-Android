// Enables R8 (code shrinking + obfuscation) + resource shrinking for the
// RELEASE build only — never debug, which stays fast/unminified for the
// smoke-test and screenshot pipelines that iterate on it constantly.
//
// android/app/build.gradle is regenerated fresh each CI build from Capacitor's
// template (not committed), so this patches it in place after `cap sync`
// rather than maintaining a hand-copied build.gradle that would drift stale
// as Capacitor/plugin versions bump.
//
// Capacitor's default template already sets `minifyEnabled false` and wires
// `proguardFiles getDefaultProguardFile(...), 'proguard-rules.pro'` in the
// release block — this just flips the flag and adds shrinkResources.

import { readFileSync, writeFileSync } from 'node:fs';

const path = 'android/app/build.gradle';
let g = readFileSync(path, 'utf8');

if (/release\s*\{[^}]*minifyEnabled\s+true/.test(g)) {
  console.log('R8 already enabled in the release block — skipping.');
  process.exit(0);
}

const releaseBlockRe = /(release\s*\{)([\s\S]*?)(\n\s*\})/;
const m = g.match(releaseBlockRe);
if (!m) {
  console.error(`Could not find a "release { ... }" block in ${path} — aborting so this fails loudly instead of silently no-op'ing.`);
  process.exit(1);
}

let body = m[2];
body = /minifyEnabled\s+false/.test(body)
  ? body.replace(/minifyEnabled\s+false/, 'minifyEnabled true')
  : body + '\n            minifyEnabled true';

if (!/shrinkResources/.test(body)) {
  body += '\n            shrinkResources true';
}
if (!/proguard-rules\.pro/.test(body)) {
  body += "\n            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'";
}

g = g.replace(releaseBlockRe, `$1${body}$3`);
writeFileSync(path, g);
console.log('R8 enabled for the release build: minifyEnabled true, shrinkResources true.');
