// W7b (v10.81.0) — public site and build config from the 2026-10-04 audit (batch C). Each case is named
// after its finding. Config is pinned by reading the files the platform reads.
import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findSourceMapLeaks } from '../../../scripts/assert-no-sourcemaps.mjs';
import { readContent, READ_TIMEOUT_MS } from '../../../api/_supabase.js';
import learnHandler from '../../../api/learn.js';
import { isCloudBuild } from '../../../scripts/cloudMode.mjs';
import { landingHtml } from '../../../scripts/landingHtml.mjs';

const repo = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8');

describe('W7b · public site and build config', () => {
  it('W7b-PUB07-001 · the deploy skip compares with the last deployed commit, and builds when unsure (FE-PUB-07, OPS-13)', () => {
    for (const f of ['react/vercel.json', 'admin/vercel.json']) {
      const cmd = JSON.parse(read(f)).ignoreCommand as string;
      // A push ending in a docs-only commit used to skip the code commits before it (HEAD^..HEAD only).
      expect(cmd, f).not.toMatch(/HEAD\^/);
      // W8d: exit 0 (skip) or exit 1 (build) ONLY — any other code is a Vercel deployment Error. The W7b form
      // returned git's 128 when the last deployed commit was outside the shallow clone (W8d-PUB07-002).
      expect(cmd, f).toMatch(/^if \[ -n "\$VERCEL_GIT_PREVIOUS_SHA" \] && git cat-file -e "\$VERCEL_GIT_PREVIOUS_SHA\^\{commit\}" 2>\/dev\/null && git diff --quiet "\$VERCEL_GIT_PREVIOUS_SHA" HEAD -- \. /);
      expect(cmd, f).toMatch(/; then exit 0; else exit 1; fi$/);
      expect(cmd, f).toContain(`':!*.md' ':!**/*.md' ':!docs'`);
    }
  });

  it('W7b-GATE03-001 · production builds publish no source maps, and the build gate catches one (GATE-03)', () => {
    expect(read('react/vite.config.ts')).toMatch(/outDir: 'dist', sourcemap: false,/);
    expect(JSON.parse(read('react/package.json')).scripts.postbuild).toMatch(/node scripts\/assert-no-sourcemaps\.mjs/);
    const dist = mkdtempSync(join(tmpdir(), 'w7b-dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'assets', 'index-a1.js'), 'console.log(1);\n');
    writeFileSync(join(dist, 'assets', 'index-a1.css'), 'body{}\n');
    expect(findSourceMapLeaks(dist)).toEqual([]);
    writeFileSync(join(dist, 'assets', 'app-b2.js'), 'x();\n//# sourceMappingURL=app-b2.js.map\n');
    writeFileSync(join(dist, 'assets', 'app-b2.js.map'), '{}');
    expect(findSourceMapLeaks(dist).sort()).toEqual([
      join('assets', 'app-b2.js') + ' (sourceMappingURL)',
      join('assets', 'app-b2.js.map') + ' (map file)',
    ].sort());
  });

  it('W7b-PUB03-001 · the Learn read times out, and an empty library is a 503 that is not cached (FE-PUB-03)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    await readContent('select=slug', fetchImpl);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(READ_TIMEOUT_MS).toBe(4000);
    // A read cut off by the timeout rejects (TimeoutError), and the handler answers its 503 page.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError')));
    const slow = { status: vi.fn().mockReturnThis(), send: vi.fn(), setHeader: vi.fn() };
    await learnHandler({ query: {} }, slow);
    expect(slow.status).toHaveBeenCalledWith(503);
    // Empty library: 503 + no-store, never the day-long cache.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), setHeader: vi.fn() };
    await learnHandler({ query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.setHeader).not.toHaveBeenCalledWith('Cache-Control', expect.stringContaining('s-maxage'));
    vi.unstubAllGlobals();
  });

  it('W7b-PUB10-001 · the landing pre-render decides cloud mode with the runtime rule (FE-PUB-10)', () => {
    const prod = { VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' };
    // vyact.app production: the committed .env.production → cloud CTAs.
    expect(isCloudBuild({ mode: 'production', env: prod, processEnv: {} })).toBe(true);
    // A Vercel preview without its own VITE_SUPABASE_URL runs local-only (vite.config.ts) — it used to
    // pre-render cloud CTAs from .env.production.
    expect(isCloudBuild({ mode: 'production', env: prod, processEnv: { VERCEL_ENV: 'preview' } })).toBe(false);
    expect(isCloudBuild({ mode: 'production', env: prod, processEnv: { VERCEL_ENV: 'preview', VITE_SUPABASE_URL: 'https://t.supabase.co' } })).toBe(true);
    // demo.vyact.app (VYACT_DEMO=1) and VITE_LOCAL_ONLY=1 are local-only.
    expect(isCloudBuild({ mode: 'production', env: prod, processEnv: { VYACT_DEMO: '1' } })).toBe(false);
    expect(isCloudBuild({ mode: 'production', env: { ...prod, VITE_LOCAL_ONLY: '1' }, processEnv: {} })).toBe(false);
    // No env URL: a production build still runs cloud on lib/supabase.ts's fallback; a test build does not.
    expect(isCloudBuild({ mode: 'production', env: {}, processEnv: {} })).toBe(true);
    expect(isCloudBuild({ mode: 'test', env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' }, processEnv: {} })).toBe(false);
    // The rule's inputs are the ones the runtime and vite.config.ts actually use.
    expect(read('react/src/lib/supabase.ts')).toMatch(/USE_FALLBACK = import\.meta\.env\.PROD && import\.meta\.env\.MODE !== 'test' && import\.meta\.env\.VITE_LOCAL_ONLY !== '1'/);
    const vc = read('react/vite.config.ts');
    // W8d (OPS-05): the guard now also fails closed on production's URL.
    expect(vc).toMatch(/process\.env\.VERCEL_ENV === 'preview'\s*&& \(!process\.env\.VITE_SUPABASE_URL \|\|/);
    expect(vc).toMatch(/if \(process\.env\.VYACT_DEMO === '1'\)/);
    expect(read('react/scripts/prerender-landing.mjs')).toMatch(/const cloudMode = isCloudBuild\(\{ mode, env, processEnv: process\.env \}\);/);
    expect(read('react/playwright.config.ts')).toMatch(/VITE_BUILD_MODE: 'test'/);
  });

  it('W7b-PUB10-002 · landing copy and markup with "$" patterns are inserted as written (FE-PUB-10)', async () => {
    const index = '<html><head><title>x</title><meta name="description" content="d" /><meta property="og:title" content="t" />'
      + '<meta property="og:description" content="d" /><meta name="twitter:title" content="t" /><meta name="twitter:description" content="d" />'
      + '<script type="application/ld+json">{}</script></head><body><div id="root"></div>'
      + '<script type="module" crossorigin src="/assets/index-abc.js"></script></body></html>';
    const copy = { ...(await import('../../content/landingCopy')), SITE_TITLE: 'Save $& more', SITE_DESCRIPTION: "Budget $1 and $' too" };
    const html = landingHtml(index, '<p>Price: $5 · $&amp; · $`</p>', copy);
    expect(html).toContain('<p>Price: $5 · $&amp; · $`</p>');
    expect(html).toContain('Save $&amp; more');
    expect(html).not.toContain('<title>x</title>');
  });

  it('W7b-PLT11-001 · no stale root vercel.json, self-dependency, @supabase/ssr or Next.js scaffold (FE-PLT-11)', () => {
    // Every Vercel project (vyact, vyact-demo, vyact-admin) builds from react/ or admin/; the root file was
    // read by none and described an older routing.
    expect(existsSync(resolve(repo, 'vercel.json'))).toBe(false);
    const pkg = JSON.parse(read('react/package.json'));
    expect(pkg.dependencies).not.toHaveProperty('vyact-react');
    expect(pkg.dependencies).not.toHaveProperty('@supabase/ssr');
    expect(read('react/package-lock.json')).not.toMatch(/"node_modules\/@supabase\/ssr"|"node_modules\/vyact-react"/);
    for (const f of ['react/page.tsx', 'react/utils/supabase/server.ts', 'react/utils/supabase/client.ts', 'react/utils/supabase/middleware.ts']) {
      expect(existsSync(resolve(repo, f)), f).toBe(false);
    }
  });
});
