// Vyact (Android) — JS side of the native CrashReporting plugin (rule R6, ANDROID-BUILD-RULES.md).
//
// Crash reports (Firebase Crashlytics) are OFF until the person turns them on in Settings. The plugin exists only
// in a build that carries Firebase's config (MainActivity registers it by name if present), so on the web and in
// any other build every call here is a no-op and the Settings card never renders. A report holds the technical
// error, the phone model, the Android and app versions and a random install ID: never a transaction, an amount,
// a name or anything typed into the app. Nothing here may add such data (no custom keys, logs or user id).
import { Capacitor, registerPlugin } from '@capacitor/core';

interface CrashReportingPlugin {
  setEnabled(opts: { enabled: boolean }): Promise<void>;
}

const CrashReporting = registerPlugin<CrashReportingPlugin>('CrashReporting');

/** The person's choice, kept in this WebView so the switch in Settings and the native side can agree. */
const KEY = 'vt_crash_reports';

/** This build can send crash reports (Android app with Firebase's config). False on the web and elsewhere. */
export function crashReportsAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('CrashReporting');
}

/** Whether the person has turned crash reports on. Off unless they said so. */
export function crashReportsOn(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** Turn crash reports on or off. Returns whether the switch took effect (false when this build has none). */
export async function setCrashReports(enabled: boolean): Promise<boolean> {
  if (!crashReportsAvailable()) return false;
  try { await CrashReporting.setEnabled({ enabled }); } catch { return false; }
  try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch { /* fault-ok: storage blocked; the native side still has the choice */ }
  return true;
}

/** At app start: hand the saved choice (off, if none) to the native side, so the two never disagree. */
export async function applyCrashReportsChoice(): Promise<void> {
  if (!crashReportsAvailable()) return;
  try { await CrashReporting.setEnabled({ enabled: crashReportsOn() }); } catch { /* fault-ok: the manifest default is off */ }
}
