// Injects the committed native widget sources (native/android/) into the
// Capacitor-generated android/ project, and registers the widget receivers +
// config activity in the merged manifest. Runs in CI after `cap sync` (android/
// is regenerated each build, so this re-applies every time). Idempotent.

import { cpSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const PKG_DIR = 'android/app/src/main/java/com/vyact/consumer';
const MANIFEST = 'android/app/src/main/AndroidManifest.xml';

// 1) Remove the generated Kotlin MainActivity so our Java one takes over.
if (existsSync(PKG_DIR)) {
  for (const f of readdirSync(PKG_DIR)) {
    if (f === 'MainActivity.kt') rmSync(`${PKG_DIR}/${f}`);
  }
}

// 2) Copy our native source tree over the generated project (merges dirs,
//    overwrites MainActivity, adds providers + res/layout/xml/drawable).
cpSync('native/android', 'android', { recursive: true });
console.log('Injected native widget sources.');

// 3) Register the widget receivers + config activity before </application>.
let xml = readFileSync(MANIFEST, 'utf8');
if (!xml.includes('ExpenseWidgetProvider')) {
  const block = `
        <receiver android:name=".ExpenseWidgetProvider" android:exported="false">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE" /></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_expense_info" />
        </receiver>
        <receiver android:name=".BudgetWidgetProvider" android:exported="false">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE" /></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_budget_info" />
        </receiver>
        <activity android:name=".BudgetWidgetConfigActivity" android:exported="false">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_CONFIGURE" /></intent-filter>
        </activity>
`;
  xml = xml.replace('</application>', block + '    </application>');
  writeFileSync(MANIFEST, xml);
  console.log('Registered widget receivers in AndroidManifest.');
} else {
  console.log('Widget receivers already present — skipping manifest edit.');
}
