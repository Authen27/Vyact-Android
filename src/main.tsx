import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import Userback from '@userback/widget';
import { SpeedInsights } from '@vercel/speed-insights/react';
import App from './App';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { registerPwa } from './lib/pwa';
import './index.css';

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

// Feedback widget — best-effort, must NEVER block or break app boot. In the
// Capacitor WebView the origin is https://localhost, which Userback can reject
// ("Invalid server response"); the previous top-level `await Userback(...)` then
// halted module evaluation and left the app a blank screen. Fire-and-forget.
Userback('A-7Q0Mz7gfB3ECVu6ZsOIUew97E').catch((e) => {
  console.warn('Userback init failed (non-fatal):', e);
});

// PWA: register the service worker and capture install lifecycle events.
// No-op in dev unless devOptions.enabled is flipped in vite.config.
void registerPwa();
