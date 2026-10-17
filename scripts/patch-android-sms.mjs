// Adds bank-message detection to the generated android/ project — the SIDELOAD build only.
//
// Google Play allows RECEIVE_SMS only for apps approved under its "SMS-based money management"
// exception (a review-gated Permissions Declaration). Until that is approved, nothing about SMS may be
// in a Play bundle, so this is a separate, explicit step that android-apk.yml runs when you dispatch
// it with sms_enabled=true — and android-release.yml (the Play AAB) does not have it at all. The
// sources live outside native/android/ so inject-android-native.mjs never copies them either.
//
//   • copies native/sms/android/** (receiver, plugin, parser, icon) into android/
//   • declares RECEIVE_SMS and registers the two receivers in the merged manifest
//
// Run AFTER `cap sync` and inject-android-native.mjs. Idempotent; fails loudly on a surprise manifest.

import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const MANIFEST = 'android/app/src/main/AndroidManifest.xml';
if (!existsSync(MANIFEST)) { console.error(`${MANIFEST} not found — run cap add/sync first.`); process.exit(1); }

cpSync('native/sms/android', 'android', { recursive: true });
console.log('Copied SMS sources into android/.');

let xml = readFileSync(MANIFEST, 'utf8');
if (xml.includes('android.permission.RECEIVE_SMS')) {
  console.log('Manifest already declares RECEIVE_SMS — nothing to do.');
  process.exit(0);
}

const perm = `    <uses-permission android:name="android.permission.RECEIVE_SMS" />
    <!-- Not every phone or tablet has a telephony stack; do not hide the app from those that lack it. -->
    <uses-feature android:name="android.hardware.telephony" android:required="false" />
`;
const receivers = `
        <!-- Bank-message detection (sideload build only). BROADCAST_SMS restricts senders to the system. -->
        <receiver android:name=".SmsReceiver" android:exported="true" android:permission="android.permission.BROADCAST_SMS">
            <intent-filter>
                <action android:name="android.provider.Telephony.SMS_RECEIVED" />
            </intent-filter>
        </receiver>
        <receiver android:name=".SmsActionReceiver" android:exported="false" />
`;

if (!xml.includes('<application') || !xml.includes('</application>')) {
  console.error('Unexpected manifest shape (no <application> element) — aborting.');
  process.exit(1);
}
xml = xml.replace('<application', perm + '\n    <application');
xml = xml.replace('</application>', receivers + '    </application>');
writeFileSync(MANIFEST, xml);
console.log('Declared RECEIVE_SMS and registered SmsReceiver + SmsActionReceiver.');
