// Registers the OAuth deep-link scheme (vyact://) on MainActivity so the
// in-app OAuth flow can return INTO the native app via vyact://auth-callback.
//
// Capacitor regenerates android/ on every CI build, so this runs after
// `cap sync`. Idempotent, and fails loudly if the manifest shape is unexpected
// (a malformed manifest would otherwise fail the Gradle build with a vague error).

import { readFileSync, writeFileSync } from 'node:fs';

const MANIFEST = 'android/app/src/main/AndroidManifest.xml';
const SCHEME = 'vyact';

let xml = readFileSync(MANIFEST, 'utf8');

if (xml.includes(`android:scheme="${SCHEME}"`)) {
  console.log(`AndroidManifest already registers ${SCHEME}:// — nothing to do.`);
  process.exit(0);
}

const intentFilter = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="${SCHEME}" />
            </intent-filter>
`;

// Insert just before MainActivity's closing tag (the first </activity> in a
// Capacitor manifest is MainActivity).
const marker = '</activity>';
const idx = xml.indexOf(marker);
if (idx === -1) {
  console.error(`Could not find ${marker} in ${MANIFEST} — aborting.`);
  process.exit(1);
}

xml = xml.slice(0, idx) + intentFilter + '        ' + xml.slice(idx);
writeFileSync(MANIFEST, xml);
console.log(`Registered ${SCHEME}:// deep-link intent-filter in AndroidManifest.`);
