// node --test scripts/setup-crashlytics.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, withCollectionOff, withCrashlyticsClasspath, withCrashlyticsApp, PLUGIN_ID, COLLECTION_KEY } from './setup-crashlytics.mjs';

const ROOT = `buildscript {
    repositories {
        google()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:9.0.1'
        classpath 'com.google.gms:google-services:4.5.0'

        // NOTE: Do not place your application dependencies here
    }
}
`;

const APP = `apply plugin: 'com.android.application'

dependencies {
    implementation project(':capacitor-android')
}

apply from: 'capacitor.build.gradle'

try {
    def servicesJSON = file('google-services.json')
    if (servicesJSON.text) {
        apply plugin: 'com.google.gms.google-services'
    }
} catch(Exception e) {
    logger.info("google-services.json not found")
}
`;

const MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="Vyact">
        <activity android:name=".MainActivity" />
    </application>
</manifest>
`;

test('no Firebase config: skip (no SDK, no plugin source)', () => {
  assert.deepEqual(plan({ configExists: false }), { skip: true });
  assert.deepEqual(plan({ configExists: true }), { configure: true });
});

test('manifest: collection is switched off, once', () => {
  const out = withCollectionOff(MANIFEST);
  assert.match(out, new RegExp(`${COLLECTION_KEY}" android:value="false"`));
  assert.ok(out.indexOf(COLLECTION_KEY) < out.indexOf('</application>'), 'inside <application>');
  assert.equal(withCollectionOff(out), out, 'idempotent');
});

test('manifest: refuses a manifest that turns collection on, or has no <application>', () => {
  const on = MANIFEST.replace('</application>', `<meta-data android:name="${COLLECTION_KEY}" android:value="true" /></application>`);
  assert.throws(() => withCollectionOff(on), /must be off/);
  assert.throws(() => withCollectionOff('<manifest/>'), /no <\/application>/);
});

test('root gradle: the plugin goes on the classpath beside Google Services, at the pinned version', () => {
  const out = withCrashlyticsClasspath(ROOT, '3.0.8');
  const lines = out.split('\n');
  const gs = lines.findIndex((l) => l.includes('com.google.gms:google-services'));
  assert.match(lines[gs + 1], /^ {8}classpath 'com\.google\.firebase:firebase-crashlytics-gradle:3\.0\.8'$/);
  assert.equal(withCrashlyticsClasspath(out, '3.0.8'), out, 'idempotent');
  assert.match(withCrashlyticsClasspath(out, '3.0.9'), /firebase-crashlytics-gradle:3\.0\.9/, 'a new pin replaces the old one');
  assert.equal((withCrashlyticsClasspath(out, '3.0.9').match(/crashlytics-gradle/g) ?? []).length, 1);
});

test('root gradle: fails when there is no Google Services line to anchor on', () => {
  assert.throws(() => withCrashlyticsClasspath("dependencies { classpath 'x:y:1' }", '3.0.8'), /no com\.google\.gms:google-services classpath/);
});

test('app gradle: plugin applied after Google Services, SDK pinned, idempotent', () => {
  const out = withCrashlyticsApp(APP, '21.0.1');
  assert.ok(out.indexOf(`apply plugin: '${PLUGIN_ID}'`) > out.indexOf("apply plugin: 'com.google.gms.google-services'"));
  assert.match(out, /implementation 'com\.google\.firebase:firebase-crashlytics:21\.0\.1'/);
  assert.equal(withCrashlyticsApp(out, '21.0.1'), out);
});

test('app gradle: fails if Google Services is not applied (Crashlytics would have no config)', () => {
  assert.throws(() => withCrashlyticsApp("apply plugin: 'com.android.application'\n", '21.0.1'), /Google Services/);
});
