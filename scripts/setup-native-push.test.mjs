// scripts/setup-native-push.mjs — the push plugin and Firebase's config ship together, or not at all.
// Run: node --test scripts/setup-native-push.test.mjs   (the Android workflows run it before the build)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, readConfig, withNotificationDefaults, APP_ID } from './setup-native-push.mjs';

const config = (pkg = APP_ID) => Buffer.from(JSON.stringify({
  project_info: { project_number: '1', project_id: 'vyact-app' },
  client: [{ client_info: { android_client_info: { package_name: pkg } }, api_key: [{ current_key: 'AIza-test' }] }],
})).toString('base64');

test('no secret and no plugin: built without push; a plugin without the secret fails the build', () => {
  assert.deepEqual(plan({ secret: '', pluginInstalled: false }), { skip: true });
  assert.match(plan({ secret: '', pluginInstalled: true }).fail, /could crash on register/);
  assert.match(plan({ secret: config(), pluginInstalled: false }).fail, /not installed/);
});

test('the secret must be Firebase\'s file for com.vyact.app', () => {
  const ok = plan({ secret: config(), pluginInstalled: true });
  assert.equal(ok.configure.projectId, 'vyact-app');
  assert.equal(JSON.parse(ok.configure.text).project_info.project_id, 'vyact-app');
  assert.match(plan({ secret: config('com.vyact.consumer'), pluginInstalled: true }).fail, /no Android app com\.vyact\.app \(found: com\.vyact\.consumer\)/);
  assert.match(readConfig('not-base64-json!').error, /not JSON/);
  assert.match(readConfig(Buffer.from('{"a":1}').toString('base64')).error, /no project_info/);
});

test('the manifest names the channel, icon and colour once', () => {
  const xml = '<manifest>\n    <application>\n        <activity android:name=".MainActivity"></activity>\n    </application>\n</manifest>\n';
  const once = withNotificationDefaults(xml);
  assert.match(once, /default_notification_channel_id" android:value="vyact_alerts"/);
  assert.match(once, /default_notification_icon" android:resource="@drawable\/ic_stat_vyact"/);
  assert.match(once, /default_notification_color" android:resource="@color\/vyact_coral"/);
  assert.ok(once.indexOf('default_notification_icon') < once.indexOf('</application>'));
  assert.equal(withNotificationDefaults(once), once);
  assert.throws(() => withNotificationDefaults('<manifest/>'), /no <\/application>/);
});
