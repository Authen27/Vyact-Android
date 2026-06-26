// Vyact — native (Capacitor) shell integration.
//
// Web builds import this too; every effect is guarded by isNative(), so in a
// normal browser this module is a no-op. Keeps native concerns in ONE place.

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { LocalNotifications } from '@capacitor/local-notifications';
import { supabase } from './supabase';

export const isNative = (): boolean => Capacitor.isNativePlatform();

// Custom-scheme deep link the OAuth flow returns to. This must be:
//   • allow-listed in Supabase → Auth → URL Configuration → Redirect URLs
//   • registered as an intent-filter in AndroidManifest
//     (done at build time by scripts/patch-android-manifest.mjs)
export const OAUTH_CALLBACK_URL = 'vyact://auth-callback';

// Notification type → the in-app route to open when the user taps it.
const ROUTE_BY_NOTIF_TYPE: Record<string, string> = {
  upcoming_bill: '/recurring',
  missed_payment: '/recurring',
  budget_threshold: '/budgets',
  goal_milestone: '/dashboard',
};

// LocalNotifications ids must be numeric — derive a stable 31-bit int from the
// notification's string id so re-firing the same alert updates, not duplicates.
function numericId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 2147483647) || 1;
}

// A tap that cold-starts the app fires before React mounts; buffer the route so
// the NativeNavBridge can pick it up on first render.
let pendingNavRoute: string | null = null;
export function consumePendingNav(): string | null {
  const r = pendingNavRoute;
  pendingNavRoute = null;
  return r;
}

let wired = false;

export function initNativeShell(): void {
  if (!isNative() || wired) return;
  wired = true;

  // Lets CSS scope native-only rules (e.g. safe-area insets) via html.is-native.
  document.documentElement.classList.add('is-native');

  // Finish an OAuth sign-in that returns via the deep link. The in-app browser
  // lands on vyact://auth-callback?code=…; we exchange that code for a session
  // inside the app's OWN WebView (where the PKCE verifier was stored), so the
  // user is retained in the native app instead of being dropped on the web build.
  void App.addListener('appUrlOpen', async ({ url }) => {
    if (!url || !url.startsWith(OAUTH_CALLBACK_URL)) return;
    try {
      const code = new URL(url).searchParams.get('code');
      if (code && supabase) await supabase.auth.exchangeCodeForSession(code);
    } catch (e) {
      console.warn('OAuth callback exchange failed:', e);
    } finally {
      void Browser.close().catch(() => {});
    }
  });

  // Tap a notification → deep-link to the relevant view. Store/native code can't
  // call React Router directly, so dispatch an event the NativeNavBridge handles.
  void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    const route = action?.notification?.extra?.route;
    if (typeof route === 'string' && route.startsWith('/')) {
      pendingNavRoute = route;
      window.dispatchEvent(new CustomEvent('vyact:navigate', { detail: route }));
    }
  });
}

export interface FireNotif { id: string; type: string; title: string; body: string; }

// Mirror in-app alerts to native local notifications, with tap-to-navigate.
// No-op on web. Best-effort: a permission denial or plugin error never throws
// into the caller — the in-app feed stays the source of truth.
export async function fireNativeNotifications(notifs: FireNotif[]): Promise<void> {
  if (!isNative() || !notifs.length) return;
  try {
    let perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return;
    await LocalNotifications.schedule({
      notifications: notifs.map((n) => ({
        id: numericId(n.id),
        title: n.title,
        body: n.body,
        iconColor: '#E26D5C', // brand coral accent on the status-bar icon
        extra: { route: ROUTE_BY_NOTIF_TYPE[n.type] ?? '/dashboard', notifId: n.id },
      })),
    });
  } catch (e) {
    console.warn('native notification schedule failed:', e);
  }
}
