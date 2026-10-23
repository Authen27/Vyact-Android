// Crash reports for the Android app: Firebase Crashlytics, OFF until the person turns it on (rule R6 in
// ANDROID-BUILD-RULES.md).
//
// A crash report carries the technical error, the phone model, the Android and app versions and a random
// install ID, and goes to Google. In a finance app that is the person's choice, so:
//
//   • the manifest sets firebase_crashlytics_collection_enabled=false: with no choice made, nothing is sent;
//   • Settings > About > "Crash reports" is the one switch (src/components/settings/CrashReportsCard.tsx),
//     which calls the CrashReporting plugin copied in here.
//
// Crashlytics needs Firebase's config, so this runs only in a build that has it (the same secret as
// push, GOOGLE_SERVICES_JSON_BASE64, which setup-native-push.mjs has already turned into
// android/app/google-services.json). Without that file: no SDK, no plugin source, nothing to reference.
// The Gradle plugin is what uploads R8's mapping file so release crashes read as real class names.
//
// Run after setup-native-push.mjs and before patch-build-gradle.mjs (repo root):
//   node scripts/setup-crashlytics.mjs
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ID = 'com.google.firebase.crashlytics';
export const COLLECTION_KEY = 'firebase_crashlytics_collection_enabled';
const CONFIG = 'android/app/google-services.json';
const MANIFEST = 'android/app/src/main/AndroidManifest.xml';
const APP_GRADLE = 'android/app/build.gradle';
const ROOT_GRADLE = 'android/build.gradle';
const SOURCES = 'native/crashlytics/android';

/** What to do: skip without Firebase's config, otherwise configure. */
export function plan({ configExists }) {
  return configExists ? { configure: true } : { skip: true };
}

/** The manifest with Crashlytics collection switched OFF inside <application>. Idempotent; refuses a manifest that turns it on. */
export function withCollectionOff(xml) {
  const existing = xml.match(new RegExp(`${COLLECTION_KEY}"\\s+android:value="([^"]*)"`));
  if (existing) {
    if (existing[1] !== 'false') throw new Error(`the manifest sets ${COLLECTION_KEY}="${existing[1]}": crash reports must be off until the person turns them on (R6)`);
    return xml;
  }
  const at = xml.lastIndexOf('</application>');
  if (at < 0) throw new Error('AndroidManifest.xml has no </application>');
  return `${xml.slice(0, at)}        <meta-data android:name="${COLLECTION_KEY}" android:value="false" />\n    ${xml.slice(at)}`;
}

/** The root build.gradle with the Crashlytics Gradle plugin on the classpath, next to Google Services'. Idempotent. */
export function withCrashlyticsClasspath(gradle, version) {
  const line = /^([ \t]*)classpath\s+['"]com\.google\.gms:google-services:[^'"]*['"][ \t]*$/m;
  if (/firebase-crashlytics-gradle:/.test(gradle)) {
    return gradle.replace(/(firebase-crashlytics-gradle:)[0-9][^'"\s]*/, `$1${version}`);
  }
  const m = gradle.match(line);
  if (!m) throw new Error('android/build.gradle has no com.google.gms:google-services classpath line to put the Crashlytics plugin beside');
  return gradle.replace(line, `${m[0]}\n${m[1]}classpath 'com.google.firebase:firebase-crashlytics-gradle:${version}'`);
}

/** The app build.gradle with the Crashlytics plugin applied AFTER Google Services' and the SDK added. Idempotent. */
export function withCrashlyticsApp(gradle, sdkVersion) {
  if (gradle.includes(`'${PLUGIN_ID}'`)) return gradle;
  if (!gradle.includes("apply plugin: 'com.google.gms.google-services'")) {
    throw new Error('android/app/build.gradle does not apply the Google Services plugin: Crashlytics must be applied after it');
  }
  return `${gradle.replace(/\s*$/, '\n')}
// Crash reports (scripts/setup-crashlytics.mjs, rule R6): the plugin uploads R8's mapping file; collection is off
// in the manifest until the person turns it on.
apply plugin: '${PLUGIN_ID}'
dependencies {
    implementation 'com.google.firebase:firebase-crashlytics:${sdkVersion}'
}
`;
}

function main() {
  const p = plan({ configExists: existsSync(CONFIG) });
  if (p.skip) {
    console.log('::notice title=Crash reports not built in::No android/app/google-services.json (no GOOGLE_SERVICES_JSON_BASE64 secret), so no Crashlytics. The app has no crash-report switch in this build.');
    return;
  }
  const toolchain = JSON.parse(readFileSync('android-toolchain.json', 'utf8'));
  if (!toolchain.crashlytics || !toolchain.crashlyticsSdk) {
    console.error('::error title=Crash reports::android-toolchain.json has no "crashlytics" (Gradle plugin) and "crashlyticsSdk" versions.');
    process.exit(1);
  }
  if (!existsSync(SOURCES)) {
    console.error(`::error title=Crash reports::${SOURCES} is missing: the CrashReporting plugin source was not committed.`);
    process.exit(1);
  }
  try {
    cpSync(SOURCES, 'android', { recursive: true });
    writeFileSync(ROOT_GRADLE, withCrashlyticsClasspath(readFileSync(ROOT_GRADLE, 'utf8'), toolchain.crashlytics));
    writeFileSync(APP_GRADLE, withCrashlyticsApp(readFileSync(APP_GRADLE, 'utf8'), toolchain.crashlyticsSdk));
    writeFileSync(MANIFEST, withCollectionOff(readFileSync(MANIFEST, 'utf8')));
  } catch (e) {
    console.error(`::error title=Crash reports::${e.message}`);
    process.exit(1);
  }
  console.log(`Crash reports built in (collection off until the person turns it on): Gradle plugin ${toolchain.crashlytics}, SDK ${toolchain.crashlyticsSdk}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
