// Vyact — native (Capacitor) shell integration.
//
// Web builds import this too; every effect is guarded by isNative(), so in a
// normal browser this module is a no-op. Keeps native concerns in ONE place.

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from './supabase';

export const isNative = (): boolean => Capacitor.isNativePlatform();

// Custom-scheme deep link the OAuth flow returns to. This must be:
//   • allow-listed in Supabase → Auth → URL Configuration → Redirect URLs
//   • registered as an intent-filter in AndroidManifest
//     (done at build time by scripts/patch-android-manifest.mjs)
export const OAUTH_CALLBACK_URL = 'vyact://auth-callback';

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
}
