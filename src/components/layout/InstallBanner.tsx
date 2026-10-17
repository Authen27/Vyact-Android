// Vyact v7.4.0 — InstallBanner
//
// Tiny, dismissible banner that surfaces:
//   • on Android / desktop Chrome / Edge once the browser fires
//     `beforeinstallprompt` — clicking "Install" calls promptInstall().
//
// v7.4.5 — iOS users (Safari and other browsers) no longer see this banner.
// Safari's "Add to Home Screen" requires a manual share-sheet step that the
// user can't trigger from our UI, and other iOS browsers can't install at
// all. Showing them a tip every session was net-annoying, so we suppress
// the banner for any iOS device. iOS users who want the PWA can still use
// the browser's own share menu.
//
// Hidden when:
//   • already running standalone (display-mode: standalone or
//     navigator.standalone), so installed users never see it.
//   • the user dismissed it this session (sessionStorage) OR more than
//     three times overall (localStorage counter) — keeps the nag low.
//   • the device is iOS (any browser).

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { canPrompt, isIos, isStandalone, promptInstall } from '../../lib/pwa';
import { shouldOfferPlayStore, playStoreUrl } from '../../lib/playStore';

const SESSION_KEY = 'vt_install_banner_dismissed_session';
const COUNT_KEY = 'vt_install_banner_dismiss_count';
const MAX_DISMISSALS = 3;

export default function InstallBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (isIos()) return; // v7.4.5 — never nag iOS.
    if (sessionStorage.getItem(SESSION_KEY) === '1') return;
    const count = Number(localStorage.getItem(COUNT_KEY) || '0');
    if (count >= MAX_DISMISSALS) return;

    const onInstallable = () => setShow(true);
    const onInstalled = () => setShow(false);
    window.addEventListener('vyact:installable', onInstallable);
    window.addEventListener('vyact:installed', onInstalled);

    if (canPrompt() || shouldOfferPlayStore()) setShow(true);

    return () => {
      window.removeEventListener('vyact:installable', onInstallable);
      window.removeEventListener('vyact:installed', onInstalled);
    };
  }, []);

  if (!show) return null;

  function dismiss() {
    sessionStorage.setItem(SESSION_KEY, '1');
    const count = Number(localStorage.getItem(COUNT_KEY) || '0') + 1;
    localStorage.setItem(COUNT_KEY, String(count));
    setShow(false);
  }

  async function install() {
    // v10.49.0 (#31) — once the Play listing is live, Android browsers get the store.
    if (shouldOfferPlayStore()) {
      window.location.href = playStoreUrl('pwa_banner');
      return;
    }
    const outcome = await promptInstall();
    if (outcome === 'accepted' || outcome === 'unavailable') setShow(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Install Vyact"
      className="fixed bottom-above-tabbar left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-[60] bg-bg2 border border-line rounded-xl shadow-2 p-3.5 flex items-start gap-3 animate-[modalIn_180ms_ease-out]"
    >
      <div className="flex-shrink-0 w-9 h-9 rounded-md bg-coral/15 text-coral flex items-center justify-center">
        <Download size={18} strokeWidth={1.8} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-ink text-[0.92rem] mb-0.5">{shouldOfferPlayStore() ? 'Get the Vyact app' : 'Install Vyact'}</div>
        <div className="text-[0.78rem] text-ink-mid leading-snug">
          {shouldOfferPlayStore()
            ? 'Install Vyact from Google Play for the full app experience.'
            : 'Add Vyact to your home screen for full-screen, offline-friendly access.'}
        </div>
        <button
          onClick={install}
          className="btn-primary mt-2 text-[0.72rem] py-1.5 px-3"
        >
          {shouldOfferPlayStore() ? 'Get it on Google Play' : 'Install'}
        </button>
      </div>
      <button
        onClick={dismiss}
        className="row-action flex-shrink-0"
        aria-label="Dismiss install banner"
        title="Dismiss"
      >
        <X size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}
