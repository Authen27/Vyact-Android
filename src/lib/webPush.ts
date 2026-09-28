// Vyact — Web Push on this device (v10.48.0, TD-22).
//
// Subscribes this browser/installed app with the push service and registers the
// subscription with Vyact, so the `web-push` Edge Function can reach the lock screen
// when the app is closed. The server decides WHAT to push (lib/notifications.ts rules,
// run server-side); this module only manages the device.
//
// iPhone/iPad: Safari delivers web push only to an app added to the Home Screen
// (iOS 16.4+). Android Chrome, desktop Chrome/Edge/Firefox and macOS Safari work in
// the browser too.
import { sb } from './supabase';
import { isIos, isStandalone } from './pwa';
import type { NotificationPrefs } from '../types';

const ENDPOINT_KEY = 'vyact_push_endpoint';

export type RefusalReason = 'unsupported' | 'ios_not_installed' | 'denied' | 'update_needed' | 'push_service' | 'server';
export type EnableResult = { ok: true } | { ok: false; reason: RefusalReason; detail?: string };

/** Brave exposes `navigator.brave`; it can block the Google push service Chromium uses. */
export function isBrave(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as Navigator & { brave?: unknown }).brave;
}

/** What to tell the person, in Settings and in the bell alike. */
export function pushRefusalMessage(reason: RefusalReason, detail?: string): string {
  switch (reason) {
    case 'ios_not_installed':
      return 'On iPhone, add Vyact to your Home Screen first (Share → Add to Home Screen), open it from there, then turn this on.';
    case 'unsupported':
      return "This browser can't receive push notifications.";
    case 'denied':
      return "Notifications are blocked for Vyact. Allow them in your phone's (or browser's) site settings, then turn this on again.";
    case 'update_needed':
      return 'Vyact needs to update before it can receive notifications. Reload, then turn this on again.';
    case 'push_service':
      // v10.48.1 — the browser refused to create a push subscription. Chromium browsers
      // deliver through Google's push service; Brave can have that switched off.
      return isBrave()
        ? `Brave couldn't set up push on this phone${detail ? ` (${detail})` : ''}. Brave can block Google's push service, which web notifications use. If Brave's settings offer "Use Google services for push messaging", turn it on and try again; otherwise open vyact.app in Chrome and turn this on there.`
        : `This browser couldn't set up push${detail ? ` (${detail})` : ''}. Please try again, or use Chrome.`;
    case 'server':
      return `This device couldn't be registered with Vyact${detail ? ` (${detail})` : ''}. Please try again in a moment.`;
  }
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Why push cannot work here, before asking for anything. */
export function pushBlocker(): 'ios_not_installed' | 'unsupported' | null {
  if (typeof window === 'undefined') return 'unsupported';
  if (isIos() && !isStandalone()) return 'ios_not_installed';
  return pushSupported() ? null : 'unsupported';
}

/** True once this device is registered with the server: the server pushes, so the open app doesn't pop up a second copy. */
export function deviceHasServerPush(): boolean {
  try { return !!localStorage.getItem(ENDPOINT_KEY) && typeof Notification !== 'undefined' && Notification.permission === 'granted'; }
  catch { return false; }
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(p + '='.repeat((4 - (p.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // No registration at all (dev server, or a first visit still installing): don't hang on .ready.
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) return null;
  return navigator.serviceWorker.ready;
}

/** Does the ACTIVE service worker have the push handler? An old one would drop every push. */
async function workerHandlesPush(reg: ServiceWorkerRegistration): Promise<boolean> {
  const worker = reg.active;
  if (!worker) return false;
  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 1500);
    channel.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data?.type === 'VYACT_PUSH_PONG'); };
    worker.postMessage({ type: 'VYACT_PUSH_PING' }, [channel.port2]);
  });
}

async function serverKey(): Promise<string> {
  const { data, error } = await sb().functions.invoke('web-push', { body: { mode: 'key' } });
  if (error || !data?.publicKey) throw new Error('push_key_unavailable');
  return data.publicKey as string;
}

function prefsForServer(prefs: NotificationPrefs) {
  return { master: prefs.master, perType: prefs.perType, quietStart: prefs.quietStart, quietEnd: prefs.quietEnd };
}

async function register(sub: PushSubscription, householdId: string, prefs: NotificationPrefs): Promise<void> {
  const json = sub.toJSON();
  const { error } = await sb().rpc('register_push_subscription', {
    p_endpoint: sub.endpoint, p_p256dh: json.keys?.p256dh, p_auth: json.keys?.auth, p_household_id: householdId,
    p_user_agent: navigator.userAgent, p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    p_prefs: prefsForServer(prefs),
  });
  if (error) throw error;
  try { localStorage.setItem(ENDPOINT_KEY, sub.endpoint); } catch { /* status only */ }
}

async function subscribe(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  const key = await serverKey();
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    // A subscription made for a different server key cannot be pushed to by us.
    const raw = existing.options?.applicationServerKey;
    const same = raw && btoa(String.fromCharCode(...new Uint8Array(raw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === key;
    if (same) return existing;
    await existing.unsubscribe().catch(() => false);
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) });
}

/**
 * Turn push on for this device. Call it straight from the tap: iOS only shows the
 * permission prompt from a user gesture, so the prompt is the first thing awaited.
 */
export async function enablePush(householdId: string, prefs: NotificationPrefs): Promise<EnableResult> {
  const blocker = pushBlocker();
  if (blocker) return { ok: false, reason: blocker };
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };
  const reg = await registration();
  if (!reg) return { ok: false, reason: 'unsupported', detail: 'no service worker' };
  if (!(await workerHandlesPush(reg))) return { ok: false, reason: 'update_needed' };
  let sub: PushSubscription;
  try {
    sub = await subscribe(reg);
  } catch (e) {
    const err = e as Error;
    // Our key endpoint failing is ours; anything else is the browser's push service refusing.
    if (err?.message === 'push_key_unavailable') return { ok: false, reason: 'server', detail: err.message };
    return { ok: false, reason: 'push_service', detail: [err?.name, err?.message].filter(Boolean).join(': ') };
  }
  try {
    await register(sub, householdId, prefs);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'server', detail: (e as Error)?.message };
  }
}

/**
 * Keep the server's copy right: the active household, the switches and quiet hours, and
 * a subscription the browser replaced or a reload wiped. Silent; needs permission
 * already granted (never prompts).
 */
export async function syncPush(householdId: string, prefs: NotificationPrefs): Promise<void> {
  if (!prefs.webPushEnabled || pushBlocker() || Notification.permission !== 'granted') return;
  try {
    const reg = await registration();
    if (!reg || !(await workerHandlesPush(reg))) return;
    await register(await subscribe(reg), householdId, prefs);
  } catch { /* retried on the next load; nothing the person needs to act on */ }
}

/** Turn push off for this device (switch off, or signing out): server first, then the browser. */
export async function disablePush(): Promise<void> {
  let endpoint: string | null = null;
  try { endpoint = localStorage.getItem(ENDPOINT_KEY); localStorage.removeItem(ENDPOINT_KEY); } catch { /* ignore */ }
  try {
    const reg = await registration();
    const sub = await reg?.pushManager.getSubscription();
    endpoint = sub?.endpoint ?? endpoint;
    if (endpoint) await sb().rpc('unregister_push_subscription', { p_endpoint: endpoint });
    await sub?.unsubscribe();
  } catch { /* best effort: a dead endpoint is retired by the server on its first 410 */ }
}

export interface TestResult { device: string; status: number; accepted: boolean; gone: boolean }

/** Ask the server to push a test to this device; returns what the push service answered. */
export async function sendTestPush(): Promise<{ ok: true; results: TestResult[] } | { ok: false; error: string }> {
  let endpoint: string | undefined;
  try { endpoint = localStorage.getItem(ENDPOINT_KEY) ?? undefined; } catch { endpoint = undefined; }
  const { data, error } = await sb().functions.invoke('web-push', { body: { mode: 'test', endpoint } });
  if (error) {
    let code = 'failed';
    try { code = (await (error as { context?: Response }).context?.json())?.error ?? code; } catch { /* keep generic */ }
    return { ok: false, error: code };
  }
  return { ok: true, results: (data?.results ?? []) as TestResult[] };
}

export interface DeviceStatus { registered: boolean; active?: boolean; last_status?: number | null; last_success_at?: string | null }

export async function devicePushStatus(): Promise<DeviceStatus> {
  try {
    const reg = await registration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return { registered: false };
    const { data } = await sb().rpc('push_subscription_status', { p_endpoint: sub.endpoint });
    return (data ?? { registered: false }) as DeviceStatus;
  } catch {
    return { registered: false };
  }
}
