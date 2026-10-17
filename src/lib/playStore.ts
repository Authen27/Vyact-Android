// Vyact — Google Play hooks (v10.49.0, marketing #30/#31). Inert while
// FEATURES.playStore.live is false.
import { FEATURES } from '../config/features';
import { platform } from './analytics';

/** The listing, tagged so installs from the web banner show up in Play Console as such. */
export function playStoreUrl(source: string): string {
  const { packageId } = FEATURES.playStore;
  return `https://play.google.com/store/apps/details?id=${packageId}&referrer=${encodeURIComponent(`utm_source=${source}&utm_medium=web`)}`;
}

/** #31 — an Android BROWSER (not the app, not an installed PWA) should get the store listing. */
export function shouldOfferPlayStore(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return FEATURES.playStore.live && /Android/i.test(ua) && platform() === 'web';
}

const ASKED_KEY = 'vy_play_review_asked';

/**
 * #30 — ask for a Play review once, when the household reaches its Nth entry, inside the
 * Android app only. Play decides whether to actually show the sheet (it rate-limits);
 * without the Capacitor in-app-review plugin this does nothing.
 */
export async function maybeAskForReview(entryCount: number): Promise<boolean> {
  try {
    const { live, reviewAfterEntries } = FEATURES.playStore;
    if (!live || entryCount !== reviewAfterEntries || platform() !== 'android-app') return false;
    if (localStorage.getItem(ASKED_KEY)) return false;
    const plugin = (window as unknown as { Capacitor?: { Plugins?: { InAppReview?: { requestReview: () => Promise<void> } } } })
      .Capacitor?.Plugins?.InAppReview;
    if (!plugin) return false;
    localStorage.setItem(ASKED_KEY, new Date().toISOString());
    await plugin.requestReview();
    return true;
  } catch {
    return false;   // a review prompt must never interrupt logging
  }
}
