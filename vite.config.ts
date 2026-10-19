import { analyticsSnippet } from './api/_consent.js';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

// Single source of truth for the app version shown in-app (Help & Guide):
// read package.json at build time and inline it as the global __APP_VERSION__.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// v10.49.0 (marketing #42) — a Vercel PREVIEW build (every feature branch) must never touch
// production data. The committed .env.production points at production, and Vite would use it.
// So: with the Preview environment's own VITE_SUPABASE_* set in Vercel (the vyact-test project),
// previews use those; without them, the preview runs local-only (no database at all).
// Shell env outranks .env files in Vite, so an empty value here disables cloud mode.
// v10.57.0 — and VITE_LOCAL_ONLY=1, or lib/supabase.ts's production fallback refilled the empty
// values and every preview ran against production (verified with a local VERCEL_ENV=preview build).
// W8d (audit OPS-05): FAIL CLOSED — a preview also goes local-only when the URL it was given IS
// production's (a VITE_SUPABASE_URL scoped to "All Environments" in Vercel skipped this guard). Only a
// non-production project (vyact-test) may back a preview; scripts/assert-preview-isolated.mjs fails a
// preview build whose bundle still names the production project.
const PROD_SUPABASE_REF = 'dmxqkvploojokffuhxnz';
if (process.env.VERCEL_ENV === 'preview'
    && (!process.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL.includes(PROD_SUPABASE_REF))) {
  process.env.VITE_SUPABASE_URL = '';
  process.env.VITE_SUPABASE_ANON_KEY = '';
  process.env.VITE_LOCAL_ONLY = '1';
}
// v10.57.0 (B20) — the guest demo (demo.vyact.app): its own Vercel project builds the same app with
// VYACT_DEMO=1, i.e. local-only on the first-run demo household, no account, no database. A separate
// origin keeps its browser storage apart from vyact.app, so nothing from the demo can reach a real
// account (the anon → cloud first-sign-in import reads only its own origin's storage).
if (process.env.VYACT_DEMO === '1') {
  process.env.VITE_SUPABASE_URL = '';
  process.env.VITE_SUPABASE_ANON_KEY = '';
  process.env.VITE_LOCAL_ONLY = '1';
  process.env.VITE_DEMO = '1';
}

export default defineConfig({
  plugins: [
    react(),
    {
      // Emit dist/version.json so the running app can detect when a newer
      // build has been deployed (UpdateBanner polls it). Build-only; the dev
      // server won't serve it, and the banner degrades to a no-op there.
      name: 'vyact-version-json',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version: pkg.version }),
        });
      },
    },
    {
      // v10.125.0 (T4b, XC-PRV-03) — GA4, asked first: the one consent script (api/_consent.js) replaces
      // the placeholder in index.html, so the app, the prerendered landing page and the Learn pages share it.
      name: 'vyact-analytics',
      transformIndexHtml(html) {
        if (!html.includes('<!--vyact:analytics-->')) throw new Error('index.html lost its analytics placeholder');
        return html.replace('<!--vyact:analytics-->', analyticsSnippet());
      },
    },
    {
      // v10.57.1 — the guest demo is never indexed, whichever address serves it (demo.vyact.app also
      // sends X-Robots-Tag; vyact-demo.vercel.app has only this). Production builds are untouched.
      name: 'vyact-demo-noindex',
      transformIndexHtml(html) {
        return process.env.VITE_DEMO === '1'
          ? html.replace('</head>', '  <meta name="robots" content="noindex, nofollow">\n  </head>')
          : html;
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // we register manually via src/lib/pwa.ts to wire update + install UX
      includeAssets: ['favicon.svg'],
      manifest: {
        id: '/',
        name: 'Vyact — Family budget app',
        short_name: 'Vyact',
        description: 'Household finance, planned together. Track spend, budgets, debts, goals, and net worth across the family.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
        orientation: 'portrait',
        background_color: '#FAF7F2',
        theme_color: '#E26D5C',
        lang: 'en',
        dir: 'ltr',
        categories: ['finance', 'productivity', 'lifestyle'],
        prefer_related_applications: false,
        icons: [
          // SVG counts toward Chrome / Edge installability since 2022; PNG
          // 192/512 entries can be added under /public/icons/ later for
          // richer install UI and iOS home-screen tiles.
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          // v10.48.0 — PNGs for the Home Screen tile (iOS ignores SVG) and notification icons.
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // v10.49.0 (#13) — full-bleed with Pip inside the 80% safe zone, for Android's shaped icons.
          { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Add transaction', short_name: 'Add', url: '/transactions?add=1',     description: 'Quick add a new transaction' },
          { name: 'Dashboard',       short_name: 'Home', url: '/',                       description: 'Open the dashboard' },
          { name: 'Reports',         short_name: 'Reports', url: '/reports',             description: 'Open reports' },
        ],
      },
      workbox: {
        // v10.48.0 (TD-22) — the push + notification-click handlers (public/push-sw.js).
        importScripts: ['push-sw.js'],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false, // we surface an update prompt via UpdateBanner instead of auto-reloading
        navigateFallback: '/index.html',
        // v10.49.0 (#14) — server-rendered and crawler files: a returning visitor must get the
        // real page, not the app shell the worker has cached.
        navigateFallbackDenylist: [
          /^\/api\//, /^\/auth\//, /version\.json$/,
          /^\/learn(\/|$)/, /^\/sitemap\.xml$/, /^\/robots\.txt$/, /^\/llms\.txt$/, /^\/\.well-known\//,
          // v10.55.0 — public pages an installed app must not answer with its own shell.
          /^\/for\//, /^\/private$/, /^\/about$/, /^\/llms-full\.txt$/,
          // W6 (audit FE-PUB-04) — the YouTube short links (/v/<n> → api/v). Without this an
          // installed worker answered them with the app shell, which then went to /dashboard.
          /^\/v\//,
        ],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Supabase reads — network-first so users always see latest data
            // when online, but still get a cached fallback when offline.
            //
            // Audit S5 — the SW cache is URL-keyed and NOT auth-aware: two
            // users on one browser share an origin, so a cached REST response
            // could be served to the second user. Never cache an AUTHORISED
            // request. The offline fallback still works for public reads
            // (apikey-only, e.g. /learn content); household data is covered
            // by the app's own outbox+cache layer, not the SW.
            urlPattern: ({ url }) => /supabase\.co\/rest\/v1\//.test(url.href),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
              matchOptions: {
                // An authenticated request never matches a cache entry.
                ignoreSearch: false,
              },
              plugins: [{
                // Workbox plugin hook: only put UNauthenticated responses in
                // the cache. An Authorization/apikey-bearing request (every
                // household-scoped read) is fetched, returned, and never
                // stored — so a second user on this browser cannot be served
                // the first user's cached rows.
                cacheWillUpdate: async ({ request, response }: { request: Request; response: Response }) => {
                  if (request.headers.has('authorization')) return null;
                  return response.status === 200 ? response : null;
                },
              }],
            },
          },
        ],
      },
      devOptions: {
        enabled: false, // dev SW disabled by default to avoid HMR weirdness; flip to true to test offline locally
        type: 'module',
      },
    }),
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // host: '::' binds to dual-stack (both IPv4 0.0.0.0 and IPv6 ::1) so
  // `localhost` resolves regardless of which stack the browser picks.
  // `host: true` would bind IPv4-only and leave ::1 unreachable on Windows.
  server: { port: 5173, host: '::', open: true },
  // W7b (audit GATE-03): no source maps. With `true` every deploy published the private source (87 maps,
  // 8.3 MB); 'hidden' would only drop the reference while still uploading guessable `<chunk>.js.map`
  // files. scripts/assert-no-sourcemaps.mjs (postbuild) fails the build if one comes back.
  build: {
    outDir: 'dist', sourcemap: false, target: 'esnext',
    // W8d (audit GATE-06): the eager vendor libraries get chunks of their own, so the app entry is smaller
    // and a release that changes only app code leaves them cached. Named groups only: a catch-all
    // node_modules group would pull lazily loaded libraries (recharts, the chat) into an eager chunk.
    // scripts/assert-bundle-budget.mjs (postbuild) holds the entry chunk under its budget.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/ },
            { name: 'motion', test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/ },
            { name: 'vendor-core', test: /node_modules[\\/](react-router|react-router-dom|@remix-run|zustand|dinero\.js|@dinero\.js)[\\/]/ },
          ],
        },
      },
    },
  },
});
