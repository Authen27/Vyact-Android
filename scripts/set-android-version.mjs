// Sets android/app/build.gradle versionCode + versionName for a release build.
// versionName is the Android app's OWN version line (android-version.json),
// decoupled from the React app's 9.x — falls back to package.json if absent.
// versionCode is passed in (must strictly increase on every Play upload — CI
// passes the run number).
// Usage: node scripts/set-android-version.mjs <versionCode>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const versionCode = process.argv[2] || '1';
const versionName = existsSync('android-version.json')
  ? JSON.parse(readFileSync('android-version.json', 'utf8')).versionName
  : JSON.parse(readFileSync('package.json', 'utf8')).version;
const path = 'android/app/build.gradle';

let g = readFileSync(path, 'utf8');
g = g.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
g = g.replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);
writeFileSync(path, g);
console.log(`set versionCode=${versionCode} versionName=${versionName}`);
