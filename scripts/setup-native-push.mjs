// Lock-screen notifications for the Android app: Firebase Cloud Messaging (upstream Vyact v10.127.0, T4d).
//
// The web app (upstream react/, lib/nativePush.ts) registers the phone's FCM token with Vyact through the
// Capacitor push plugin, and the server pushes it the alerts. That plugin needs Firebase's config in the APK
// (android/app/google-services.json): without it, PushNotifications.register() can crash the app (Firebase
// is never initialised). So the plugin and the config ship TOGETHER, or not at all:
//
//   • GOOGLE_SERVICES_JSON_BASE64 set  → the workflow installs @capacitor/push-notifications before `cap sync`;
//     this script (after cap sync + inject) writes google-services.json, checks it is for com.vyact.app, and
//     names the default channel, icon and colour for Firebase's notifications in the manifest.
//   • not set                           → no plugin, no config. The app says lock-screen notifications aren't
//     available yet (upstream pushBlocker() 'native_app') and keeps its local notifications while open.
//   • a plugin without the config       → FAIL, before a build that could crash ships.
//
// The config is never printed. Usage (repo root, after `npx cap sync android` and inject-android-native.mjs):
//   GOOGLE_SERVICES_JSON_BASE64=… node scripts/setup-native-push.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const APP_ID = 'com.vyact.app';
export const CHANNEL_ID = 'vyact_alerts';   // the channel the app creates and the server's messages name
const PLUGIN_DIR = 'node_modules/@capacitor/push-notifications';
const CONFIG = 'android/app/google-services.json';
const MANIFEST = 'android/app/src/main/AndroidManifest.xml';
const APP_GRADLE = 'android/app/build.gradle';
const ROOT_GRADLE = 'android/build.gradle';

/** The decoded config, or why it can't be used. Checks it is Firebase's file for this app. */
export function readConfig(base64) {
  let text;
  try { text = Buffer.from(String(base64).trim(), 'base64').toString('utf8'); } catch { return { error: 'not base64' }; }
  let json;
  try { json = JSON.parse(text); } catch { return { error: 'not JSON after base64-decoding (encode the file with base64 -w0)' }; }
  if (!json?.project_info?.project_id) return { error: 'not a google-services.json (no project_info.project_id)' };
  const packages = (json.client ?? []).map((c) => c?.client_info?.android_client_info?.package_name).filter(Boolean);
  if (!packages.includes(APP_ID)) return { error: `it has no Android app ${APP_ID} (found: ${packages.join(', ') || 'none'})` };
  return { text, projectId: json.project_info.project_id };
}

const META = [
  `<meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="${CHANNEL_ID}" />`,
  '<meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_vyact" />',
  '<meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@color/vyact_coral" />',
];

/** The manifest with Firebase's notification defaults inside <application>. Idempotent. */
export function withNotificationDefaults(xml) {
  if (xml.includes('default_notification_channel_id')) return xml;
  const at = xml.lastIndexOf('</application>');
  if (at < 0) throw new Error('AndroidManifest.xml has no </application>');
  return `${xml.slice(0, at)}        ${META.join('\n        ')}\n    ${xml.slice(at)}`;
}

/** What to do, from the secret and the installed plugin: 'skip', 'configure', or a failure. */
export function plan({ secret, pluginInstalled }) {
  if (!secret) {
    return pluginInstalled
      ? { fail: 'the push plugin is installed but GOOGLE_SERVICES_JSON_BASE64 is not set: the app could crash on register(). Install the plugin only with the secret.' }
      : { skip: true };
  }
  if (!pluginInstalled) return { fail: 'GOOGLE_SERVICES_JSON_BASE64 is set but @capacitor/push-notifications is not installed (install it before `cap sync`).' };
  const config = readConfig(secret);
  if (config.error) return { fail: `GOOGLE_SERVICES_JSON_BASE64 can't be used: ${config.error}.` };
  return { configure: config };
}

function main() {
  const p = plan({ secret: process.env.GOOGLE_SERVICES_JSON_BASE64 ?? '', pluginInstalled: existsSync(PLUGIN_DIR) });
  if (p.fail) { console.error(`::error title=Lock-screen notifications::${p.fail}`); process.exit(1); }
  if (p.skip) {
    console.log('::notice title=Lock-screen notifications not built in::No GOOGLE_SERVICES_JSON_BASE64 secret, so no push plugin. The app says lock-screen notifications are not available yet. See PLAY-STORE.md, section 0b.');
    return;
  }
  // Capacitor's template applies the Google Services plugin when the file exists; fail if it ever stops.
  if (!readFileSync(APP_GRADLE, 'utf8').includes("apply plugin: 'com.google.gms.google-services'")
      || !readFileSync(ROOT_GRADLE, 'utf8').includes('com.google.gms:google-services')) {
    console.error('::error title=Lock-screen notifications::The generated Gradle files no longer apply the Google Services plugin: update this script.');
    process.exit(1);
  }
  writeFileSync(CONFIG, p.configure.text);
  writeFileSync(MANIFEST, withNotificationDefaults(readFileSync(MANIFEST, 'utf8')));
  console.log(`Lock-screen notifications built in: Firebase project ${p.configure.projectId}, channel ${CHANNEL_ID}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
