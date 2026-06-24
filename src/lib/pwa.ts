// Vyact v7.4.0 — PWA registration + install lifecycle
//
// Three responsibilities, kept here so the UI components stay thin:
//   1. Register the service worker (production only) and dispatch a custom
//      `vyact:sw-update` event when a fresh build is waiting to activate.
//      InstallBanner / UpdateBanner can subscribe and offer the user a
//      one-tap "Reload to update" action.
//   2. Capture the `beforeinstallprompt` event for Android / desktop Chrome
//      / Edge so we can show our own install affordance later, and emit a
//      `vyact:installable` event so React can react.
//   3. Detect iOS Safari (which doesn't fire beforeinstallprompt) and
//      surface an "Add to Home Screen" hint — same event channel.
//
// Nothing here imports React; the UI layer talks to this via window events.

import type { Workbox } from 'workbox-window';

let wb: Workbox | undefined;
let deferredPrompt: BeforeInstallPromptEvent | undefined;

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari uses navigator.standalone; everyone else uses the display-mode media query.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

export function isIos(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  // iPadOS 13+ reports as MacIntel; only the touch-point count gives it away.
  const iPadOs =
    window.navigator.platform === 'MacIntel' &&
    (window.navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOs;
}

// True only for genuine Safari on iOS — the one browser engine that can
// Add-to-Home-Screen. iOS Chrome (CriOS), Firefox (FxiOS), Edge (EdgiOS),
// and in-app browsers (FBAN/FBAV/Instagram/Line/etc.) all wrap WebKit but
// cannot install PWAs on iOS.
export function isIosSafari(): boolean {
  if (!isIos()) return false;
  const ua = window.navigator.userAgent;
  if (/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo/.test(ua)) return false;
  if (/FBAN|FBAV|Instagram|Line|MicroMessenger|Twitter|LinkedInApp/.test(ua)) return false;
  return /Safari/.test(ua);
}

export function canPrompt(): boolean {
  return deferredPrompt !== undefined;
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable';
  await deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  deferredPrompt = undefined;
  window.dispatchEvent(new CustomEvent('vyact:install-resolved', { detail: choice.outcome }));
  return choice.outcome;
}

export async function applyUpdate(): Promise<void> {
  if (!wb) return;
  // Tell the waiting SW to take over, then reload once it's controlling.
  wb.addEventListener('controlling', () => window.location.reload());
  await wb.messageSkipWaiting();
}

/**
 * v7.4.5 — One-click "Refresh to update" path.
 *
 * The previous flow called `window.location.reload()` whenever only
 * `version.json` had drifted. That's a no-op when a service worker is
 * still serving the *old* precached HTML/JS — the user clicks, sees the
 * same build, the banner reappears, repeat. Reports said it took 4–5
 * tries. This helper guarantees a single click works:
 *
 *   1. Ask the SW registration for an update (pulls a new `sw.js` if one
 *      shipped). If a `waiting` worker appears, message it `SKIP_WAITING`
 *      and reload on `controlling`.
 *   2. Otherwise (no SW update available, e.g. the build only changed
 *      `version.json`), unregister every registration and purge the
 *      Cache Storage so the next request goes to the network. Then
 *      hard-reload.
 *
 * Either branch ends with a single page navigation — the user sees the
 * new version after one click.
 */
export async function forceReloadForUpdate(): Promise<void> {
  // Workbox path — preferred, gives us the proper SW lifecycle.
  if (wb && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      // Force the registration to recheck the network for sw.js.
      await reg?.update().catch(() => undefined);
      if (reg?.waiting) {
        wb.addEventListener('controlling', () => window.location.reload());
        await wb.messageSkipWaiting();
        return;
      }
    } catch {
      /* fall through to the nuclear path */
    }
  }
  // No waiting worker — the precache is just stale. Wipe SW + caches and
  // hard-reload. This is the only way to be sure the next paint is the
  // new build.
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister().catch(() => false)));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k).catch(() => false)));
    }
  } catch {
    /* best-effort — fall through to the reload either way */
  }
  // Cache-busting query param defeats any HTTP / memory cache for the doc.
  const url = new URL(window.location.href);
  url.searchParams.set('_v', Date.now().toString(36));
  window.location.replace(url.toString());
}

export async function registerPwa(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  // Only register the production-built SW; dev SW is opt-in via vite.config.
  if (import.meta.env.DEV) return;

  // Capture install prompt eagerly — fires before our React tree mounts on
  // some browsers, so we listen at the module level.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event('vyact:installable'));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = undefined;
    window.dispatchEvent(new Event('vyact:installed'));
  });

  try {
    const { Workbox } = await import('workbox-window');
    wb = new Workbox('/sw.js', { scope: '/' });
    wb.addEventListener('waiting', () => {
      window.dispatchEvent(new Event('vyact:sw-update'));
    });
    await wb.register();
  } catch (err) {
    // Service worker registration failures must never break the app shell.
    console.warn('[pwa] SW registration failed', err);
  }
}
