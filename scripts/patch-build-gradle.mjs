// Applies the permanent Android RELEASE-build rules (ANDROID-BUILD-RULES.md) to the generated android/
// project. Release only: debug stays fast and unminified for the smoke-test / screenshot pipelines.
//
//   R1  R8 full mode, with the OPTIMIZING default rules (proguard-android-optimize.txt). Capacitor's
//       template ships proguard-android.txt, whose `-dontoptimize` switches optimisation OFF — R8 would
//       only shrink and rename, and "full mode" would be a label.
//   R2  Resource shrinking                      (shrinkResources true)
//   R3  Optimised resource shrinking            (android.r8.optimizedResourceShrinking=true)
//   R4  Repackage classes                       (-repackageclasses '' in native/android/app/proguard-rules.pro;
//                                                checked by verify-android-r8.mjs and check-overlay-registered.mjs)
//   R5  Current toolchain: the AGP + Gradle in android-toolchain.json (Play asks for AGP 9.0+)
//
// android/ is regenerated from Capacitor's template on every CI build (not committed), so this patches it
// in place after `cap sync` + inject-android-native.mjs. Idempotent, and it fails loudly on a surprise
// instead of silently doing nothing. scripts/verify-android-r8.mjs then proves the result after the build.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const toolchain = JSON.parse(readFileSync('android-toolchain.json', 'utf8'));
const die = (msg) => { console.error(`patch-build-gradle: ${msg}`); process.exit(1); };
const read = (p) => { if (!existsSync(p)) die(`${p} not found — run cap add/sync first.`); return readFileSync(p, 'utf8'); };

// ── R1 + R2: android/app/build.gradle, release block ─────────────────────────────────────────
{
  const path = 'android/app/build.gradle';
  let g = read(path);
  const re = /(release\s*\{)([\s\S]*?)(\n\s*\})/;
  const m = g.match(re);
  if (!m) die(`no "release { ... }" block in ${path}`);

  let body = m[2];
  body = /minifyEnabled\s+(true|false)/.test(body)
    ? body.replace(/minifyEnabled\s+(true|false)/, 'minifyEnabled true')
    : body + '\n            minifyEnabled true';
  body = /shrinkResources\s+(true|false)/.test(body)
    ? body.replace(/shrinkResources\s+(true|false)/, 'shrinkResources true')
    : body + '\n            shrinkResources true';
  if (/proguardFiles/.test(body)) {
    // proguard-android.txt carries -dontoptimize; only the -optimize variant lets R8 optimise.
    body = body.replace(/proguard-android\.txt/g, 'proguard-android-optimize.txt');
  } else {
    body += "\n            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'";
  }
  if (!/proguard-rules\.pro/.test(body)) die('the release block does not reference proguard-rules.pro');

  g = g.replace(re, `$1${body}$3`);
  writeFileSync(path, g);
  console.log('R1/R2: release block -> minifyEnabled true, shrinkResources true, proguard-android-optimize.txt');
}

// ── R3 (+ AGP 9 compatibility): android/gradle.properties ────────────────────────────────────
{
  const path = 'android/gradle.properties';
  let p = read(path).replace(/\r\n/g, '\n');
  const set = (key, value) => {
    const re = new RegExp(`^${key.replace(/\./g, '\\.')}=.*$`, 'm');
    p = re.test(p) ? p.replace(re, `${key}=${value}`) : p.replace(/\n*$/, '\n') + `${key}=${value}\n`;
  };
  set('android.r8.optimizedResourceShrinking', 'true');

  // AGP 9 turned on built-in Kotlin and the new DSL by default. Capacitor's generated modules and its
  // plugins still apply kotlin-android and use the legacy DSL (`minifyEnabled`), so keep both on the
  // legacy path until Capacitor moves — these options are honoured through AGP 9.x.
  if (Number(toolchain.agp.split('.')[0]) >= 9) {
    set('android.builtInKotlin', 'false');
    set('android.newDsl', 'false');
  }
  writeFileSync(path, p);
  console.log('R3: gradle.properties -> android.r8.optimizedResourceShrinking=true');
}

// ── R5: AGP + Gradle ─────────────────────────────────────────────────────────────────────────
{
  const root = 'android/build.gradle';
  let g = read(root);
  if (!/com\.android\.tools\.build:gradle:[0-9][^'"\s]*/.test(g)) die(`no AGP classpath line in ${root}`);
  g = g.replace(/(com\.android\.tools\.build:gradle:)[0-9][^'"\s]*/, `$1${toolchain.agp}`);
  // The Google Services plugin (Firebase push, scripts/setup-native-push.mjs) is a build plugin on the
  // same classpath, so it has to be a release that supports this AGP.
  if (toolchain.googleServices && /com\.google\.gms:google-services:/.test(g)) {
    g = g.replace(/(com\.google\.gms:google-services:)[0-9][^'"\s]*/, `$1${toolchain.googleServices}`);
  }
  writeFileSync(root, g);

  const wrapper = 'android/gradle/wrapper/gradle-wrapper.properties';
  let w = read(wrapper);
  if (!/distributionUrl=.*gradle-[0-9.]+-(all|bin)\.zip/.test(w)) die(`no distributionUrl in ${wrapper}`);
  w = w.replace(/(distributionUrl=.*gradle-)[0-9.]+(-(?:all|bin)\.zip)/, `$1${toolchain.gradle}$2`);
  writeFileSync(wrapper, w);
  console.log(`R5: AGP ${toolchain.agp}, Gradle ${toolchain.gradle}`);
}
