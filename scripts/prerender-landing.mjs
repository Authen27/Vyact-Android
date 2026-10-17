// Vyact — build step: pre-render the landing page and publish the site stylesheet (v10.50.0).
//
// Runs after `vite build` as npm's "postbuild" (NOT chained onto "build": Playwright runs
// `npm run build -- --mode test`, and npm appends those args to the LAST command in a chain):
//   1. SSR-builds src/prerender/landing.tsx (a tiny, store-free entry) and renders it.
//   2. Writes dist/landing.html — the built app shell with the landing page's own SEO head
//      and the pre-rendered markup. middleware.js serves it at "/", so a crawler or a first
//      visit gets the full page as HTML; the app script then takes over as usual.
//   3. Copies the hashed app stylesheet to dist/site.css, a stable URL the server-rendered
//      Learn pages (api/_page.js) link, so /learn wears exactly the app's theme.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { landingHtml, builtCssHref } from './landingHtml.mjs';
import { isCloudBuild } from './cloudMode.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const out = path.join(root, 'node_modules', '.vyact-prerender');
const mode = process.env.VITE_BUILD_MODE || 'production';

await build({
  configFile: false,
  root,
  mode,
  logLevel: 'warn',
  plugins: [react()],
  build: {
    ssr: 'src/prerender/landing.tsx',
    outDir: out,
    emptyOutDir: true,
    rollupOptions: { output: { format: 'es', entryFileNames: 'landing.mjs' } },
  },
});

const { renderLanding, copy } = await import(pathToFileURL(path.join(out, 'landing.mjs')).href);
const env = loadEnv(mode, root, 'VITE_');
// W7b (FE-PUB-10): the runtime's own rule, not "the env file has a URL" (previews and the demo are local-only).
const cloudMode = isCloudBuild({ mode, env, processEnv: process.env });

const indexHtml = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
fs.writeFileSync(path.join(dist, 'landing.html'), landingHtml(indexHtml, renderLanding(cloudMode), copy));
fs.copyFileSync(path.join(dist, builtCssHref(indexHtml)), path.join(dist, 'site.css'));
console.log(`prerender: dist/landing.html (${cloudMode ? 'cloud' : 'local-only'} CTAs) + dist/site.css`);
