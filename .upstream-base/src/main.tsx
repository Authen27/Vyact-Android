import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import Userback from '@userback/widget';
import { SpeedInsights } from '@vercel/speed-insights/react';
import App from './App';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { registerPwa } from './lib/pwa';
import './index.css';

const userback = await Userback('A-7Q0Mz7gfB3ECVu6ZsOIUew97E');
void userback;

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
