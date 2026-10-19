import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import Userback from '@userback/widget';
import { SpeedInsights } from '@vercel/speed-insights/react';
import App from './App';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { registerPwa, forceReloadForUpdate } from './lib/pwa';
import { shouldReloadForChunk, sessionStore } from './lib/chunkRecovery';
import './index.css';

// W6 (audit FE-UIS-12) — a tab on an older build that cannot load a chunk reloads ONCE to get the
// new one (Vite fires this before the import rejects). A second failure within a minute is shown.
window.addEventListener('vite:preloadError', (event) => {
  if (!shouldReloadForChunk(sessionStore(), Date.now())) return;
  event.preventDefault();
  void forceReloadForUpdate();
});

// Feedback widget is best-effort and must NEVER block the app: a top-level
// await here meant any Userback failure (adblocker, corporate proxy,
// unauthorized domain, vendor outage) left users on a permanently blank
// screen because createRoot().render() was never reached.
//
// v10.52.0 — on the public landing page ("/") the service worker registration
// waits until the page has loaded and gone idle (it competed with the hero for a
// throttled phone's bandwidth; PageSpeed mobile, 1 Oct 2026), and the widget waits
// for the first interaction (v10.52.1, below). Everywhere else both start
// immediately, as before.
const onLanding = window.location.pathname === '/';
function afterPaint(run: () => void) {
  if (!onLanding) { run(); return; }
  const idle = () => { if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 4000 }); else setTimeout(run, 2000); };
  if (document.readyState === 'complete') idle(); else window.addEventListener('load', idle, { once: true });
}
const startUserback = () => { void Userback('A-7Q0Mz7gfB3ECVu6ZsOIUew97E').catch(() => { /* fault-ok: the feedback widget is optional; the app works without it */ }); };

// v10.52.1 (owner) — on the landing page the feedback widget waits for the
// visitor's first interaction (tap, click, key, wheel). A visitor who only reads
// the page never needs it, and PageSpeed (which never interacts) measured its
// ~400 ms of script as a ~140 ms long task after load (1 Oct 2026). Any way into
// the app from "/" is itself an interaction, so the widget is ready there.
function onFirstInteraction(run: () => void) {
  const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
  const fire = () => { events.forEach(e => window.removeEventListener(e, fire, true)); run(); };
  events.forEach(e => window.addEventListener(e, fire, { capture: true, once: true, passive: true }));
}
if (onLanding) onFirstInteraction(startUserback); else startUserback();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
        <SpeedInsights />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);

// PWA: register the service worker and capture install lifecycle events.
// No-op in dev unless devOptions.enabled is flipped in vite.config.
afterPaint(() => { void registerPwa(); });
