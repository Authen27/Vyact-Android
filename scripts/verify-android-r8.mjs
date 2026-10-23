// Proves, from the BUILD'S OWN OUTPUT, that the permanent release rules (ANDROID-BUILD-RULES.md) took
// effect — not just that a script ran. Runs in android-release.yml right after bundleRelease and fails
// the build if any rule is missing, so a Play bundle can't ship without them.
//
//   R1  R8 ran in full mode with optimisation: mapping.txt exists; the merged R8 configuration has no
//       `-dontoptimize`; android.enableR8.fullMode is not turned off.
//   R2  shrinkResources true in app/build.gradle (and R8 wrote its resource-shrinking report)
//   R3  android.r8.optimizedResourceShrinking=true
//   R4  -repackageclasses is in the merged R8 configuration
//   R5  the AGP / Gradle in android-toolchain.json are the ones that built it
//   R6  (only in a build that has Firebase's config) Crashlytics is in at the pinned versions and its
//       collection is OFF by default in the manifest, with the Settings switch's native half present
//
// Usage (repo root, after the Gradle build):  node scripts/verify-android-r8.mjs

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const toolchain = JSON.parse(readFileSync('android-toolchain.json', 'utf8'));
const problems = [];
const ok = [];
const check = (cond, pass, fail) => (cond ? ok.push(pass) : problems.push(fail));
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

// the build's own R8 outputs
const mapDir = 'android/app/build/outputs/mapping/release';
const mapping = join(mapDir, 'mapping.txt');
check(existsSync(mapping), 'R1 mapping.txt written (R8 ran)', `R1 ${mapping} missing — R8 did not run on the release build`);

const config = read(join(mapDir, 'configuration.txt'));
if (config == null) {
  problems.push(`R1/R4 ${join(mapDir, 'configuration.txt')} missing — cannot read the merged R8 configuration`);
} else {
  check(!/^\s*-dontoptimize\b/m.test(config), 'R1 no -dontoptimize in the merged R8 configuration', 'R1 -dontoptimize is in the merged R8 configuration — R8 is not optimising (proguard-android.txt instead of -optimize?)');
  check(/^\s*-repackageclasses\b/m.test(config), 'R4 -repackageclasses is in the merged R8 configuration', 'R4 -repackageclasses is missing from the merged R8 configuration (native/android/app/proguard-rules.pro)');
}

// the generated project's settings
const app = read('android/app/build.gradle') ?? '';
const rel = (app.match(/release\s*\{([\s\S]*?)\n\s*\}/) ?? [])[1] ?? '';
check(/minifyEnabled\s+true/.test(rel), 'R1 minifyEnabled true', 'R1 release block does not have minifyEnabled true');
check(/proguard-android-optimize\.txt/.test(rel) && !/proguard-android\.txt/.test(rel), 'R1 proguard-android-optimize.txt', 'R1 release block does not use proguard-android-optimize.txt');
check(/shrinkResources\s+true/.test(rel), 'R2 shrinkResources true', 'R2 release block does not have shrinkResources true');

const props = read('android/gradle.properties') ?? '';
check(/^android\.r8\.optimizedResourceShrinking=true$/m.test(props), 'R3 android.r8.optimizedResourceShrinking=true', 'R3 android.r8.optimizedResourceShrinking=true is missing from gradle.properties');
check(!/^android\.enableR8\.fullMode=false$/m.test(props), 'R1 R8 full mode not disabled', 'R1 android.enableR8.fullMode=false is set');

const rootGradle = read('android/build.gradle') ?? '';
if (toolchain.googleServices && /com\.google\.gms:google-services:/.test(rootGradle)) {
  const gs = (rootGradle.match(/com\.google\.gms:google-services:([0-9][^'"\s]*)/) ?? [])[1];
  check(gs === toolchain.googleServices, `R5 Google Services plugin ${gs}`, `R5 Google Services plugin is ${gs}, android-toolchain.json says ${toolchain.googleServices}`);
}
const agp = (rootGradle.match(/com\.android\.tools\.build:gradle:([0-9][^'"\s]*)/) ?? [])[1];
check(agp === toolchain.agp, `R5 AGP ${agp}`, `R5 AGP is ${agp}, android-toolchain.json says ${toolchain.agp}`);
const wrapper = read('android/gradle/wrapper/gradle-wrapper.properties') ?? '';
const gradle = (wrapper.match(/gradle-([0-9.]+)-(?:all|bin)\.zip/) ?? [])[1];
check(gradle === toolchain.gradle, `R5 Gradle ${gradle}`, `R5 Gradle is ${gradle}, android-toolchain.json says ${toolchain.gradle}`);

// R6 — crash reports: a build that carries Firebase's config has Crashlytics in, pinned, and OFF by default.
// (A build without the config has none of it, by design: scripts/setup-crashlytics.mjs skips.)
if (existsSync('android/app/google-services.json')) {
  const crashPlugin = (rootGradle.match(/firebase-crashlytics-gradle:([0-9][^'"\s]*)/) ?? [])[1];
  check(crashPlugin === toolchain.crashlytics, `R6 Crashlytics Gradle plugin ${crashPlugin}`, `R6 Crashlytics Gradle plugin is ${crashPlugin ?? 'missing'}, android-toolchain.json says ${toolchain.crashlytics}`);
  check(/apply plugin: 'com\.google\.firebase\.crashlytics'/.test(app), 'R6 Crashlytics plugin applied', "R6 android/app/build.gradle does not apply 'com.google.firebase.crashlytics'");
  check(new RegExp(`firebase-crashlytics:${toolchain.crashlyticsSdk.replace(/\./g, '\\.')}`).test(app), `R6 Crashlytics SDK ${toolchain.crashlyticsSdk}`, `R6 the Crashlytics SDK in android/app/build.gradle is not the ${toolchain.crashlyticsSdk} android-toolchain.json pins`);
  const manifest = read('android/app/src/main/AndroidManifest.xml') ?? '';
  check(/firebase_crashlytics_collection_enabled"\s+android:value="false"/.test(manifest), 'R6 crash-report collection is OFF by default (manifest)', 'R6 the manifest does not set firebase_crashlytics_collection_enabled to false — reports would be sent without the person choosing');
  check(existsSync('android/app/src/main/java/com/vyact/app/CrashReportingBridgePlugin.java'), 'R6 the Settings switch (CrashReporting plugin) is in the project', 'R6 CrashReportingBridgePlugin.java is missing from the project: the switch in Settings could not turn reports on');
}

for (const line of ok) console.log(`  ok   ${line}`);
if (problems.length) {
  for (const line of problems) console.error(`  FAIL ${line}`);
  console.error(`\nverify-android-r8: ${problems.length} rule(s) not met — see ANDROID-BUILD-RULES.md`);
  process.exit(1);
}
console.log(`\nverify-android-r8: all permanent release rules met (AGP ${agp}, Gradle ${gradle}).`);
