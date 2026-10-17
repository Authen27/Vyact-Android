// Vyact — native (Capacitor) shell integration.
//
// Web builds import this too; every effect is guarded by isNative(), so in a
// normal browser this module is a no-op. Keeps native concerns in ONE place.

import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { LocalNotifications } from '@capacitor/local-notifications';
import { supabase, APP_URL } from './supabase';

export const isNative = (): boolean => Capacitor.isNativePlatform();

// Origin to build links that OTHER people open (household invites). In the native app
// window.location.origin is https://localhost — an address only this phone resolves — so a link
// built from it is dead on arrival. Native uses the public app URL instead.
export const shareOrigin = (): string =>
  (isNative() && APP_URL ? APP_URL.replace(/\/+$/, '') : window.location.origin);

// Custom-scheme deep link the OAuth flow returns to. This must be:
//   • allow-listed in Supabase → Auth → URL Configuration → Redirect URLs
//   • registered as an intent-filter in AndroidManifest
//     (done at build time by scripts/patch-android-manifest.mjs)
export const OAUTH_CALLBACK_URL = 'vyact://auth-callback';

// Notification type → the in-app route to open when the user taps it.
// Aurora v10.1's 13-type model (notifications-spec.md) — see NOTIF_META in
// lib/notifications.ts for the authoritative type list.
const ROUTE_BY_NOTIF_TYPE: Record<string, string> = {
  recurring_due_confirm: '/recurring',
  recurring_reminder: '/recurring',
  recurring_posted: '/recurring',
  budget_threshold: '/budgets',
  income_landed: '/transactions',
  insight_fresh: '/insights',
  trend_alert: '/insights',
  debt_payment_due: '/debts',
  stale_balance: '/accounts',
  invite_received: '/households',
  invite_pending: '/households',
  member_activity: '/households',
  sync_conflict: '/dashboard',
  milestone: '/dashboard',
  split_settled: '/splits',
  split_closed: '/splits',
  split_received: '/splits',
};

// LocalNotifications ids must be numeric — derive a stable 31-bit int from the
// notification's string id so re-firing the same alert updates, not duplicates.
function numericId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 2147483647) || 1;
}

// A tap that cold-starts the app fires before React mounts; buffer the route /
// action so the NativeNavBridge can pick it up on first render.
let pendingNavRoute: string | null = null;
export function consumePendingNav(): string | null {
  const r = pendingNavRoute;
  pendingNavRoute = null;
  return r;
}

let pendingAction: string | null = null;
export function consumePendingAction(): string | null {
  const a = pendingAction;
  pendingAction = null;
  return a;
}

// A tap on a detected-bank-message notification (vyact://sms/<id>, SMS sideload build) that cold-starts
// the app fires before React mounts; SmsPromptBridge picks the id up on its first render.
let pendingSmsId: string | null = null;
export function consumePendingSms(): string | null {
  const id = pendingSmsId;
  pendingSmsId = null;
  return id;
}

// The app's files ship inside the APK, so a service worker adds nothing here — and a worker left
// registered by an OLDER build (0.2–0.4 registered one) keeps answering from its own precache after
// an update, so the first launches of a new version would show the previous UI. main.tsx no longer
// registers one; this removes any that exists, and reloads once if this very page came from it.
async function dropServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    if (!regs.length) return;
    const controlled = !!navigator.serviceWorker.controller;
    await Promise.all(regs.map(r => r.unregister().catch(() => false)));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k).catch(() => false)));
    }
    if (controlled && sessionStorage.getItem('vy_sw_dropped') !== '1') {
      sessionStorage.setItem('vy_sw_dropped', '1');
      window.location.reload();
    }
  } catch { /* best effort — the app works either way */ }
}

// Pages served by the website (Vercel), not by the app bundle: a plain <a href="/learn"> (the
// sign-in screen has one) would load https://localhost/learn, which the app has no route for.
// Open them on the real site in the in-app browser instead.
const WEB_ONLY_PATH = /^\/(learn|about|for|v)(\/|$)/;
function routeWebOnlyLinksToBrowser(): void {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const u = new URL(a.href, window.location.href);
    if (u.origin !== window.location.origin || !WEB_ONLY_PATH.test(u.pathname)) return;
    e.preventDefault();
    void Browser.open({ url: `${shareOrigin()}${u.pathname}${u.search}` });
  }, true);
}

// The WebView draws edge-to-edge, so the clock / battery icons sit ON the app's own canvas. Their
// colour is the OS's call by default (dark icons in light mode), but the app's theme is its own:
// Nocturne (dark) is the default whatever the phone is set to, which would leave dark icons on a
// dark canvas. Follow the app's theme instead — the "dark" class that setTheme()/index.html set.
// (SystemBarsStyle names the BACKGROUND: Dark = light icons.)
function followThemeWithSystemBars(): void {
  let last: boolean | null = null;
  const apply = () => {
    const dark = document.documentElement.classList.contains('dark');
    if (dark === last) return;
    last = dark;
    void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
  };
  apply();
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

let wired = false;

export function initNativeShell(): void {
  if (!isNative() || wired) return;
  wired = true;

  // Lets CSS scope native-only rules (e.g. safe-area insets) via html.is-native.
  document.documentElement.classList.add('is-native');

  followThemeWithSystemBars();
  void dropServiceWorkers();
  routeWebOnlyLinksToBrowser();

  // Handle every vyact:// deep link: OAuth return, widget "+" add-transaction,
  // and widget tap-to-open-view.
  void App.addListener('appUrlOpen', async ({ url }) => {
    if (!url) return;

    // OAuth sign-in return: exchange the code for a session inside the app's OWN
    // WebView (where the PKCE verifier was stored), so the user is retained in
    // the native app instead of being dropped on the web build.
    if (url.startsWith(OAUTH_CALLBACK_URL)) {
      try {
        const code = new URL(url).searchParams.get('code');
        if (code && supabase) await supabase.auth.exchangeCodeForSession(code);
      } catch (e) {
        console.warn('OAuth callback exchange failed:', e);
      } finally {
        void Browser.close().catch(() => {});
      }
      return;
    }

    // Detected bank message → the pre-filled Add-Transaction form (see SmsPromptBridge).
    const sms = /^vyact:\/\/sms\/([^?#]+)/.exec(url);
    if (sms) {
      pendingSmsId = decodeURIComponent(sms[1]);
      window.dispatchEvent(new CustomEvent('vyact:sms', { detail: pendingSmsId }));
      return;
    }

    // Widget "+" button → open the Add-Transaction modal.
    if (url.startsWith('vyact://action/add-transaction')) {
      pendingAction = 'add-transaction';
      window.dispatchEvent(new CustomEvent('vyact:action', { detail: 'add-transaction' }));
      return;
    }

    // Widget body tap → open a view, e.g. vyact://open/budgets (default dashboard).
    if (url.startsWith('vyact://open')) {
      const path = url.slice('vyact://open'.length);
      const route = path.startsWith('/') ? path : '/dashboard';
      pendingNavRoute = route;
      window.dispatchEvent(new CustomEvent('vyact:navigate', { detail: route }));
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

// `deepLink` is the notification's own in-app target (set by upstream generators, e.g. a Pip nudge
// opens /chat?ask=…). It wins over the per-type default route so a tap lands where the bell's
// row would.
export interface FireNotif { id: string; type: string; title: string; body: string; deepLink?: string; }

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
        extra: {
          route: n.deepLink?.startsWith('/') ? n.deepLink : (ROUTE_BY_NOTIF_TYPE[n.type] ?? '/dashboard'),
          notifId: n.id,
        },
      })),
    });
  } catch (e) {
    console.warn('native notification schedule failed:', e);
  }
}
