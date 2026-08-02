import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import Userback from '@userback/widget';
import { SpeedInsights } from '@vercel/speed-insights/react';
import App from './App';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { registerPwa } from './lib/pwa';
import { initNativeShell } from './lib/native';
import './index.css';

// Wire native (Capacitor) integration before first paint: adds the html.is-native
// class for safe-area CSS and registers the OAuth deep-link callback. No-op on web.
initNativeShell();

// Feedback widget is best-effort and must NEVER block the app: a top-level
// await here meant any Userback failure (adblocker, corporate proxy,
// unauthorized domain, vendor outage) left users on a permanently blank
// screen because createRoot().render() was never reached.
void Userback('A-7Q0Mz7gfB3ECVu6ZsOIUew97E').catch(() => { /* widget unavailable — app works without it */ });

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
void registerPwa();
