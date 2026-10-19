// Vyact — lock-screen notifications in the Android app, through Firebase Cloud Messaging (v10.127.0, T4d).
//
// The Play Store app is this web app inside an Android WebView, which has no Web Push. When its APK carries
// the Capacitor push plugin (@capacitor/push-notifications, installed by the Vyact-Android build), this module
// registers the phone's FCM token with Vyact (`register_native_push`), and the server's web-push dispatcher
// sends the phone the same alerts, under the same rules, as a browser. Owner decisions, 19 Oct 2026:
//   • ON BY DEFAULT in the app: it asks Android's notification permission once and registers itself. The
//     person can turn it off in Settings (a choice kept on the phone; signing out is not that choice);
//   • the server is the only source on a registered phone: the app's own local notifications stop
//     (deviceHasServerPush, read by the Android fork's notification code);
//   • a tap opens the app on the alert's page (`data.url`).
// The plugin is reached through `window.Capacitor.Plugins`, as playStore.ts reaches InAppReview, so the web
// build needs no Capacitor package. Without the plugin (an older APK) nothing here runs, and Settings says so.
import { sb } from './supabase';
import { isNativeApp } from './pwa';
import type { NotificationPrefs } from '../types';
import { expected } from './faults';

const TOKEN_KEY = 'vyact_fcm_token';
const CHOICE_KEY = 'vyact_native_push';          // 'off' once the person turned it off on this phone
const ASKED_KEY = 'vyact_native_push_asked';     // the one automatic permission request was made
export const ANDROID_CHANNEL_ID = 'vyact_alerts'; // the channel the server's messages name (_shared/fcm.ts)
const REGISTER_TIMEOUT_MS = 15_000;

type Permission = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';
interface ListenerHandle { remove: () => Promise<void> }
/** The parts of @capacitor/push-notifications this module uses. */
export interface PushPlugin {
  checkPermissions: () => Promise<{ receive: Permission }>;
  requestPermissions: () => Promise<{ receive: Permission }>;
  register: () => Promise<void>;
  unregister?: () => Promise<void>;
  createChannel?: (c: { id: string; name: string; description?: string; importance?: number }) => Promise<void>;
  addListener: (event: string, fn: (data: never) => void) => Promise<ListenerHandle> | ListenerHandle;
}

/** The push plugin, when this is the Android app and its APK has it. */
export function pushPlugin(): PushPlugin | null {
  if (!isNativeApp()) return null;
  const plugins = (window as unknown as { Capacitor?: { Plugins?: { PushNotifications?: PushPlugin } } }).Capacitor?.Plugins;
  const p = plugins?.PushNotifications;
  return p && typeof p.register === 'function' && typeof p.addListener === 'function' ? p : null;
}

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); }
  catch { /* fault-ok: device storage unavailable; the phone registers again at its next start */ }
};

/** The person has not turned notifications off on this phone (the default is on). */
export function nativePushWanted(): boolean { return read(CHOICE_KEY) !== 'off'; }
/** This phone's token is registered with Vyact and wanted: the server pushes here, so the app stays quiet. */
export function nativeHasServerPush(): boolean { return !!read(TOKEN_KEY) && nativePushWanted(); }
export function nativeToken(): string | null { return read(TOKEN_KEY); }

function prefsForServer(prefs: NotificationPrefs) {
  return {
    master: prefs.master, perType: prefs.perType, quietStart: prefs.quietStart, quietEnd: prefs.quietEnd,
    lockScreenDetails: prefs.lockScreenDetails !== false,
  };
}

/** The phone's current FCM token: register() answers through the 'registration' event. */
function obtainToken(p: PushPlugin): Promise<string> {
  return new Promise((resolve, reject) => {
    let done = false;
    const handles: (Promise<ListenerHandle> | ListenerHandle)[] = [];
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const h of handles) void Promise.resolve(h).then((x) => x.remove()).catch(() => undefined);
      fn();
    };
    handles.push(p.addListener('registration', ((t: { value?: string }) =>
      finish(() => (t?.value ? resolve(t.value) : reject(new Error('registration_empty'))))) as (d: never) => void));
    handles.push(p.addListener('registrationError', ((e: { error?: string }) =>
      finish(() => reject(new Error(e?.error ?? 'registration_failed')))) as (d: never) => void));
    const timer = setTimeout(() => finish(() => reject(new Error('registration_timeout'))), REGISTER_TIMEOUT_MS);
    p.register().catch((e: unknown) => finish(() => reject(e instanceof Error ? e : new Error(String(e)))));
  });
}

/** Opens the app on a tapped alert's page: an in-app path only, through the router's own history. */
export function openInApp(url: unknown): boolean {
  if (typeof url !== 'string' || !/^\/(?![/\\])/.test(url)) return false;
  const idx = ((window.history.state as { idx?: number } | null)?.idx ?? 0) + 1;
  window.history.pushState({ usr: null, key: `push${idx}`, idx }, '', url);
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  return true;
}

let listening = false;
/** Once per app start: a tap on a notification (also the one that cold-started the app) opens its page. */
function listenForTaps(p: PushPlugin): void {
  if (listening) return;
  listening = true;
  void Promise.resolve(p.addListener('pushNotificationActionPerformed', ((a: { notification?: { data?: Record<string, unknown> } }) => {
    openInApp(a?.notification?.data?.url);
  }) as (d: never) => void)).catch((e: unknown) => expected(e, 'nativePush.listen'));
}

async function createChannel(p: PushPlugin): Promise<void> {
  try {
    await p.createChannel?.({
      id: ANDROID_CHANNEL_ID, name: 'Alerts',
      description: 'Bills due, budgets at 80%, loan payments and balances to check', importance: 4,
    });
  } catch (e) { expected(e, 'nativePush.channel'); }
}

async function registerWithVyact(p: PushPlugin, householdId: string, prefs: NotificationPrefs): Promise<void> {
  await createChannel(p);
  const token = await obtainToken(p);
  const previous = read(TOKEN_KEY);
  const { error } = await sb().rpc('register_native_push', {
    p_token: token, p_household_id: householdId,
    p_user_agent: navigator.userAgent, p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    p_prefs: prefsForServer(prefs),
  });
  if (error) throw new Error(error.message);
  write(TOKEN_KEY, token);
  // FCM can rotate a phone's token; the old row goes now rather than at its first UNREGISTERED.
  if (previous && previous !== token) {
    const { error: e } = await sb().rpc('unregister_native_push', { p_token: previous });
    if (e) expected(e, 'nativePush.dropOldToken');
  }
}

export type NativeEnableResult = { ok: true } | { ok: false; reason: 'denied' | 'server'; detail?: string };

/** Turn it on from a tap (Settings): asks for the permission if needed, then registers. */
export async function enableNativePush(p: PushPlugin, householdId: string, prefs: NotificationPrefs): Promise<NativeEnableResult> {
  listenForTaps(p);
  let perm = (await p.checkPermissions()).receive;
  if (perm !== 'granted') perm = (await p.requestPermissions()).receive;
  write(ASKED_KEY, '1');
  if (perm !== 'granted') return { ok: false, reason: 'denied' };
  write(CHOICE_KEY, null);
  try {
    await registerWithVyact(p, householdId, prefs);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'server', detail: (e as Error)?.message };
  }
}

/**
 * At every start and household switch: keep the phone registered (household, zone, switches, a rotated token).
 * On by default: the first time, it asks Android's permission once; after that it never prompts. Nothing when
 * the person turned it off here.
 */
export async function syncNativePush(p: PushPlugin, householdId: string, prefs: NotificationPrefs): Promise<void> {
  listenForTaps(p);
  if (!nativePushWanted()) return;
  try {
    let perm = (await p.checkPermissions()).receive;
    if (perm !== 'granted' && !read(ASKED_KEY)) {
      write(ASKED_KEY, '1');
      perm = (await p.requestPermissions()).receive;
    }
    if (perm !== 'granted') return;
    await registerWithVyact(p, householdId, prefs);
  } catch (e) { expected(e, 'nativePush.sync'); }
}

/**
 * Stop this phone. `byChoice`: the person switched it off in Settings, so it stays off here. A sign-out is
 * not a choice: the next person (or the same one) signing in gets the default again.
 */
export async function disableNativePush(p: PushPlugin, { byChoice = false } = {}): Promise<void> {
  if (byChoice) write(CHOICE_KEY, 'off');
  const token = read(TOKEN_KEY);
  write(TOKEN_KEY, null);
  try {
    if (token) {
      const { error } = await sb().rpc('unregister_native_push', { p_token: token });
      if (error) expected(error, 'nativePush.unregister');
    }
    await p.unregister?.();
  } catch (e) { expected(e, 'nativePush.unregister'); }
}

/** A passive sign-out (the session is gone): drop the token on the phone; the server retires the row. */
export async function forgetNativePush(p: PushPlugin): Promise<void> {
  write(TOKEN_KEY, null);
  try { await p.unregister?.(); } catch { /* fault-ok: an unregistered token is retired by the server at its first UNREGISTERED */ }
}

export async function nativePushStatus(): Promise<{ registered: boolean; active?: boolean; last_status?: number | null; last_success_at?: string | null }> {
  const token = read(TOKEN_KEY);
  if (!token) return { registered: false };
  try {
    const { data } = await sb().rpc('native_push_status', { p_token: token });
    return (data ?? { registered: false }) as { registered: boolean };
  } catch {
    return { registered: false };
  }
}

/** Tests only: forget the per-start tap listener. */
export function resetNativePushForTests(): void { listening = false; }
