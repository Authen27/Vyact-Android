import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
// Single source of truth for the app version shown in-app (Help & Guide):
// read package.json at build time and inline it as the global __APP_VERSION__.
var pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
export default defineConfig({
    plugins: [
        react(),
        {
            // Emit dist/version.json so the running app can detect when a newer
            // build has been deployed (UpdateBanner polls it). Build-only; the dev
            // server won't serve it, and the banner degrades to a no-op there.
            name: 'vyact-version-json',
            generateBundle: function () {
                this.emitFile({
                    type: 'asset',
                    fileName: 'version.json',
                    source: JSON.stringify({ version: pkg.version }),
                });
            },
        },
        VitePWA({
            registerType: 'autoUpdate',
            injectRegister: false, // we register manually via src/lib/pwa.ts to wire update + install UX
            includeAssets: ['favicon.svg'],
            manifest: {
                id: '/',
                name: 'Vyact — Family Finance OS',
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
                    { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
                ],
                shortcuts: [
                    { name: 'Add transaction', short_name: 'Add', url: '/transactions?add=1', description: 'Quick add a new transaction' },
                    { name: 'Dashboard', short_name: 'Home', url: '/', description: 'Open the dashboard' },
                    { name: 'Reports', short_name: 'Reports', url: '/reports', description: 'Open reports' },
                ],
            },
            workbox: {
                globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
                cleanupOutdatedCaches: true,
                clientsClaim: true,
                skipWaiting: false, // we surface an update prompt via UpdateBanner instead of auto-reloading
                navigateFallback: '/index.html',
                navigateFallbackDenylist: [/^\/api\//, /^\/auth\//, /version\.json$/],
                runtimeCaching: [
                    {
                        urlPattern: function (_a) {
                            var url = _a.url;
                            return url.origin === 'https://fonts.googleapis.com';
                        },
                        handler: 'StaleWhileRevalidate',
                        options: { cacheName: 'google-fonts-stylesheets' },
                    },
                    {
                        urlPattern: function (_a) {
                            var url = _a.url;
                            return url.origin === 'https://fonts.gstatic.com';
                        },
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
                        urlPattern: function (_a) {
                            var url = _a.url;
                            return /supabase\.co\/rest\/v1\//.test(url.href);
                        },
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'supabase-api',
                            networkTimeoutSeconds: 4,
                            expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 },
                            cacheableResponse: { statuses: [0, 200] },
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
    build: { outDir: 'dist', sourcemap: true, target: 'esnext' },
});
