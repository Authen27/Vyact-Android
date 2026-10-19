// W8d (v10.84.0) — public site, platform and docs from the 2026-10-04 audit (owner plan W8, batch d).
// Each case is named after its finding. Config is pinned by reading the files the platform reads.
import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as mw from '../../../middleware.js';
import { demoRedirect } from '../../../api/_demo.js';
import robots from '../../../api/robots.js';
import { isCloudBuild } from '../../../scripts/cloudMode.mjs';
import { findProdRef } from '../../../scripts/assert-preview-isolated.mjs';
import { entryScript, ENTRY_BUDGET_KB } from '../../../scripts/assert-bundle-budget.mjs';

const repo = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8').replace(/\r\n/g, '\n');
const res = () => ({ status: vi.fn().mockReturnThis(), send: vi.fn(), setHeader: vi.fn(), redirect: vi.fn() });

describe('W8d · site, platform and docs', () => {
  it('W8d-PUB06-001 · made-up deep paths reach the middleware and get a real 404 (FE-PUB-06)', () => {
    const re = new RegExp(`^${mw.config.matcher[0]}$`);
    // Real routes and static files are still skipped (vercel.json serves them).
    for (const p of ['/learn', '/learn/', '/learn/ev-001-x', '/learn/topic/saving', '/for/couples', '/sitemap.xml', '/robots.txt',
      '/assets/index-1.js', '/site.css', '/help/pulse.webp', '/whatsapp/01-bill-reminder.jpg', '/.well-known/assetlinks.json']) {
      expect(re.test(p), p).toBe(false);
    }
    // These used to fall through to the app shell (200); now they reach routeFor.
    for (const p of ['/learn/a/b', '/learn/topic/x/y', '/for/a/b', '/wp-login.php']) {
      expect(re.test(p), p).toBe(true);
      expect(mw.routeFor(p), p).toBe('not-found');
    }
  });

  it('W8d-PUB05-001 · the demo build sends public pages to vyact.app and is not crawlable (FE-PUB-05)', async () => {
    const r = res();
    expect(demoRedirect(r, '/learn/x', { VYACT_DEMO: '1' })).toBe(true);
    expect(r.redirect).toHaveBeenCalledWith(302, 'https://vyact.app/learn/x');
    expect(r.setHeader).toHaveBeenCalledWith('X-Robots-Tag', 'noindex');
    expect(demoRedirect(res(), '/learn/x', {})).toBe(false);
    for (const f of ['learn', 'for', 'about', 'sitemap', 'llms', 'v']) expect(read(`react/api/${f}.js`), f).toMatch(/demoRedirect\(res, /);
    vi.stubEnv('VYACT_DEMO', '1');
    try {
      const rr = res();
      await robots({}, rr);
      expect(rr.send).toHaveBeenCalledWith('User-agent: *\nDisallow: /\n');
    } finally { vi.unstubAllEnvs(); }
  });

  it('W8d-PLT04-001 · vyact.app sends a Content-Security-Policy in Report-Only mode (FE-PLT-04)', () => {
    const vercel = JSON.parse(read('react/vercel.json'));
    const all = vercel.headers.find((h: { source: string }) => h.source === '/(.*)').headers as { key: string; value: string }[];
    const csp = all.find(h => h.key === 'Content-Security-Policy-Report-Only')?.value ?? '';
    for (const d of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", 'https://dmxqkvploojokffuhxnz.supabase.co',
      'https://www.googletagmanager.com', 'https://www.youtube-nocookie.com', "base-uri 'self'"]) {
      expect(csp, d).toContain(d);
    }
    expect(all.some(h => h.key === 'Content-Security-Policy')).toBe(false);   // report-only first, enforce later
  });

  it('W8d-PUB07-002 · the deploy skip exits only 0 or 1, so an unknown last-deployed commit builds (FE-PUB-07 fix)', () => {
    const cmd = JSON.parse(read('react/vercel.json')).ignoreCommand as string;
    expect(JSON.parse(read('admin/vercel.json')).ignoreCommand).toBe(cmd);
    const run = (sha: string) => spawnSync('sh', ['-c', cmd], { cwd: repo, env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: sha }, encoding: 'utf8' }).status;
    if (spawnSync('sh', ['-c', 'exit 0']).status !== 0) return;   // no POSIX shell on this machine
    expect(run('')).toBe(1);
    expect(run('378c16ac8456ed043b5954a125809fef4ecd3db3')).toBe(1);   // not in the clone: was git's 128 → a Vercel Error
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    expect(run(head)).toBe(0);
  });

  it('W8d-OPS13-001 · npm ci, Node 22 everywhere, main runs never cancelled (OPS-13)', () => {
    for (const app of ['react', 'admin']) {
      expect(JSON.parse(read(`${app}/vercel.json`)).installCommand, app).toBe('npm ci');
      expect(JSON.parse(read(`${app}/package.json`)).engines, app).toEqual({ node: '22.x' });
    }
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/node-version: '20'/);
    for (const f of ['ci.yml', 'lighthouse.yml', 'secret-scan.yml']) {
      expect(read(`.github/workflows/${f}`), f).toMatch(/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
    }
  });

  it('W8d-OPS07-001 · every workflow runs with a read-only token (OPS-07)', () => {
    for (const f of ['ci.yml', 'deploy.yml', 'deploy-test-functions.yml', 'lighthouse.yml', 'secret-scan.yml']) {
      expect(read(`.github/workflows/${f}`), f).toMatch(/^permissions:\n\s+contents: read$/m);
    }
  });

  it('W8d-OPS05-001 · a preview never uses production; the build gate proves it (OPS-05)', () => {
    const prod = { VITE_SUPABASE_URL: 'https://dmxqkvploojokffuhxnz.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' };
    // Production's URL injected into a preview ("All Environments") used to keep cloud mode on.
    expect(isCloudBuild({ mode: 'production', env: prod, processEnv: { VERCEL_ENV: 'preview', VITE_SUPABASE_URL: prod.VITE_SUPABASE_URL } })).toBe(false);
    expect(isCloudBuild({ mode: 'production', env: prod, processEnv: { VERCEL_ENV: 'preview', VITE_SUPABASE_URL: 'https://testref.supabase.co' } })).toBe(true);
    expect(read('react/vite.config.ts')).toMatch(/process\.env\.VITE_SUPABASE_URL\.includes\(PROD_SUPABASE_REF\)/);
    const dist = mkdtempSync(join(tmpdir(), 'w8d-dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'assets', 'a.js'), 'const u="https://other.supabase.co"');
    expect(findProdRef(dist)).toEqual([]);
    writeFileSync(join(dist, 'assets', 'b.js'), 'const u="https://dmxqkvploojokffuhxnz.supabase.co"');
    expect(findProdRef(dist)).toEqual([join('assets', 'b.js')]);
    expect(JSON.parse(read('react/package.json')).scripts.postbuild).toMatch(/node scripts\/assert-preview-isolated\.mjs/);
  });

  it('W8d-GATE05-001 · runtime advisories of high and above fail CI; moderate ones are triaged (GATE-05)', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/\(cd react && npm audit --omit=dev --audit-level=high\)\n\s+\(cd admin && npm audit --omit=dev --audit-level=high\)/);
    const triage = read('docs/SECURITY_AUDIT_TRIAGE.md');
    expect(triage).toMatch(/GHSA-wrjc-x8rr-h8h6/);
    expect(triage).toMatch(/safeNext/);
    expect(read('react/package-lock.json')).toMatch(/"node_modules\/react-router-dom": \{\s*"version": "6\.30\.6"/);
  });

  it('W8d-GATE06-001 · eager vendors are split from the entry, which stays under its budget (GATE-06)', () => {
    const vc = read('react/vite.config.ts');
    for (const g of ["name: 'supabase'", "name: 'motion'", "name: 'vendor-core'"]) expect(vc, g).toContain(g);
    expect(vc).not.toMatch(/test: \/node_modules\/\s*\}/);           // no catch-all vendor group (it would make lazy chunks eager)
    expect(entryScript('<script type="module" crossorigin src="/assets/index-Abc.js"></script>')).toBe('/assets/index-Abc.js');
    expect(entryScript('<html></html>')).toBeNull();
    expect(ENTRY_BUDGET_KB).toBe(350);
    expect(JSON.parse(read('react/package.json')).scripts.postbuild).toMatch(/node scripts\/assert-bundle-budget\.mjs$/);
  });

  it('W8d-OPS09-001 · the runbooks describe the live pipeline (OPS-09, DB-OPS-14, DB-OPS-12)', () => {
    for (const f of ['DEPLOY.md', 'OPERATIONS.md']) {
      const doc = read(f);
      expect(doc, f).not.toMatch(/vyact-twentyx\.vercel\.app|vyact-admin\.vercel\.app/);
      expect(doc, f).not.toMatch(/best-effort/i);
    }
    expect(read('OPERATIONS.md')).not.toMatch(/^\s+--no-privileges/m);
    expect(read('db/MIGRATIONS.md')).toMatch(/Production migrations are applied by CI, from the merge/);
    expect(read('scripts/db-migrations-check.mjs')).toMatch(/not auto-applied\|do not apply/);
  });

  it('W8d-PRV14-001 · no personal emails or phone numbers in tracked docs; screenshots are not tracked (XC-PRV-14)', () => {
    // T4b (v10.125.0): ANY address outside the placeholder and Vyact domains fails, not only webmail ones (a
    // work address sat in the changelog and a migration comment, and so in db/schema.sql).
    const OK_DOMAIN = /^(example\.(com|org|net)|vyact\.(app|test))$/;
    const docs = ['react/CHANGELOG.md', 'admin/CHANGELOG.md', 'docs/HANDOFF.md', 'docs/WHATSAPP_TEMPLATES.md', 'whatsapp-closure-runbook.md',
      'db/schema.sql', ...readdirSync(resolve(repo, 'supabase/migrations')).map(m => `supabase/migrations/${m}`)];
    for (const f of docs) {
      const doc = read(f);
      const foreign = [...doc.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[a-z]{2,})/g)].map(m => m[1].toLowerCase()).filter(d => !OK_DOMAIN.test(d));
      expect(foreign, f).toEqual([]);
      expect(doc, f).not.toMatch(/\+91[ -]?[6-9][0-9]{4}[ -]?[0-9]{5}/);
    }
    expect(read('.gitignore')).toMatch(/^Userback\/$/m);
    expect(read('.gitignore')).toMatch(/^home\.html$/m);   // a saved page of the app, with real figures
    expect(existsSync(resolve(repo, '.gitignore'))).toBe(true);
  });
});
