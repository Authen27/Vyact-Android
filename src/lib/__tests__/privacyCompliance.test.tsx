// T4B-001..010 — v10.125.0 (Track T4b; audit XC-PRV-03, XC-PRV-08, XC-PRV-09, XC-PRV-10, XC-PRV-11, FE-PLT-04;
// owner decisions 19 Oct 2026). Privacy made true and asked for:
// • GA4 asks first on the web and is on in the Android app (its permissions); one script everywhere;
// • the server records the version at sign-up, and anyone on an older version is asked again;
// • 18 or older; the processors named with where they are; DPDP rights, grievance and breach;
// • "Download my data" holds exactly the owner's list; Pip through OpenRouter asks for providers that keep no
//   data; CSP violations are reported somewhere.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sbMock = vi.hoisted(() => ({ signUp: vi.fn() }));
vi.mock('../supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../supabase')>()),
  sb: () => ({ auth: { signUp: sbMock.signUp } }),
}));

import { analyticsSnippet, CONSENT_KEY } from '../../../api/_consent.js';
import cspReport, { linesOf } from '../../../api/csp-report.js';
import { analyticsState, setAnalyticsAllowed } from '../analyticsConsent';
import { signUp } from '../auth';
import { POLICY_CHANGES, POLICY_VERSION } from '../policyVersion';
import { buildBackup } from '../backup';
import PolicyUpdateSheet from '../../components/auth/PolicyUpdateSheet';
import { chatCompletion, isOpenRouterEndpoint, type ModelConfigRow } from '../../../../supabase/functions/_shared/agent/router';

const ROOT = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

// ── A small stand-in for the browser the consent script runs in ─────────────────────────────────────
type El = { id?: string; className?: string; style: Record<string, string>; children: El[]; parentNode?: El | null;
  textContent?: string; listeners: Record<string, () => void>; setAttribute: (k: string, v: string) => void;
  appendChild: (c: El) => El; removeChild: (c: El) => void; addEventListener: (t: string, f: () => void) => void; src?: string };
function makeEl(): El {
  const el: El = { style: {}, children: [], listeners: {}, setAttribute() {},
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter(x => x !== c); c.parentNode = null; },
    addEventListener(t, f) { el.listeners[t] = f; } };
  return el;
}
function boot({ host = 'vyact.app', stored = null as string | null, native = false, pathname = '/dashboard', search = '' } = {}) {
  const store = new Map<string, string>(stored ? [[CONSENT_KEY, stored]] : []);
  const loaded: string[] = [];
  const cookieSets: string[] = [];
  const body = makeEl();
  const doc = {
    readyState: 'complete', body,
    head: { appendChild: (s: El) => { loaded.push(String(s.src)); return s; } },
    createElement: () => makeEl(), createTextNode: (t: string) => ({ ...makeEl(), textContent: t }),
    addEventListener() {},
    get cookie() { return '_ga=GA1.1.1; _ga_E3XKWZP850=GS1.1; theme=warm'; },
    set cookie(v: string) { cookieSets.push(v); },
  };
  const win: Record<string, unknown> = {
    matchMedia: () => ({ matches: false }), requestIdleCallback: (fn: () => void) => fn(), addEventListener() {},
    ...(native ? { Capacitor: { isNativePlatform: () => true } } : {}),
  };
  const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  const code = analyticsSnippet().replace(/<\/?script>/g, '');
  new Function('window', 'location', 'document', 'localStorage', code)(
    win, { hostname: host, pathname, search, origin: `https://${host}` }, doc, ls);
  const layer = () => (win.dataLayer as IArguments[]).map(a => Array.from(a));
  const banner = () => body.children.find(c => c.id === 'vy-analytics-consent');
  return { win, loaded, layer, banner, store, cookieSets, track: (n: string) => (win.vyTrack as (n: string) => void)(n) };
}

describe('analytics is asked for first on the web, and on in the Android app (XC-PRV-03)', () => {
  it('T4B-001 · vyact.app, not chosen: consent defaults to denied, the banner asks, nothing loads; Allow starts GA with a redacted address', () => {
    const b = boot({ pathname: '/invite/3f9a-secret', search: '?email=a%40b.com&utm_source=mail' });
    expect(b.layer()[0]).toEqual(['consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]);
    expect(b.loaded).toEqual([]);
    expect(b.banner()).toBeTruthy();
    b.track('learn_card_view');
    expect(b.layer().some(e => e[0] === 'event')).toBe(false);          // nothing queued before consent

    // Allow (the banner's primary button).
    const allow = b.banner()!.children[1].children[1];
    allow.listeners.click();
    expect(b.store.get(CONSENT_KEY)).toBe('granted');
    expect(b.banner()).toBeUndefined();
    expect(b.loaded).toEqual(['https://www.googletagmanager.com/gtag/js?id=G-E3XKWZP850']);
    expect(b.layer()).toContainEqual(['consent', 'update', { analytics_storage: 'granted' }]);
    expect(b.layer().find(e => e[0] === 'config')).toEqual(['config', 'G-E3XKWZP850', { page_location: 'https://vyact.app/invite/:token?utm_source=mail' }]);
    b.track('learn_card_view');
    expect(b.layer().filter(e => e[0] === 'event')).toHaveLength(1);
    // Ads storage, ads data and ad personalisation are never granted.
    expect(JSON.stringify(b.layer())).not.toMatch(/"ad_(storage|user_data|personalization)":"granted"/);
  });

  it('T4B-002 · "No thanks" (or turning it off later) stops sending and clears Google\'s cookies; the choice is kept', () => {
    const b = boot({ stored: 'granted' });
    expect(b.banner()).toBeUndefined();
    expect(b.loaded).toHaveLength(1);                                   // chosen before: starts at once, no banner
    (b.win.__vyAnalytics as { decline: () => void }).decline();
    expect(b.win.__vyGaOn).toBe(false);
    expect(b.layer()).toContainEqual(['consent', 'update', { analytics_storage: 'denied' }]);
    expect(b.cookieSets.filter(c => /^_ga/.test(c)).map(c => c.split('=')[0])).toEqual(['_ga', '_ga', '_ga_E3XKWZP850', '_ga_E3XKWZP850']);
    expect(b.cookieSets.every(c => /Max-Age=0/.test(c))).toBe(true);
    expect(b.store.get(CONSENT_KEY)).toBe('denied');
    b.track('x');
    expect(b.layer().some(e => e[0] === 'event')).toBe(false);

    const again = boot({ stored: 'denied' });
    expect(again.banner()).toBeUndefined();
    expect(again.loaded).toEqual([]);
  });

  it('T4B-003 · the Android app counts without a banner (its permissions); previews and stage count nothing; the app reads the state', () => {
    const app = boot({ host: 'localhost', native: true });
    expect(app.banner()).toBeUndefined();
    expect(app.loaded).toHaveLength(1);
    const api = app.win.__vyAnalytics as { choice: () => string; allow: () => void; decline: () => void; native: boolean };
    expect(api.choice()).toBe('granted');
    api.decline();                                                      // the app's permission, not a web choice
    expect(app.win.__vyGaOn).toBe(true);

    for (const host of ['localhost', 'stage.vyact.app', 'vyact-git-main-authen27.vercel.app']) {
      const b = boot({ host });
      expect(b.banner(), host).toBeUndefined();
      expect(b.layer(), host).toEqual([]);
    }

    const g = globalThis as unknown as { window?: Record<string, unknown> };
    g.window = app.win;
    try { expect(analyticsState()).toBe('app'); }
    finally { delete g.window; }
    const web = boot({ stored: null });
    g.window = web.win;
    try {
      expect(analyticsState()).toBe('ask');
      setAnalyticsAllowed(true);
      expect(analyticsState()).toBe('on');
      setAnalyticsAllowed(false);
      expect(analyticsState()).toBe('off');
    } finally { delete g.window; }
    expect(analyticsState()).toBe('unavailable');                      // tests, previews, local builds
    expect(read('react/src/lib/analytics.ts')).toMatch(/__vyGaOn === true/);
  });
});

describe('consent is recorded with the account, and asked again on change (XC-PRV-09)', () => {
  beforeEach(() => { sbMock.signUp.mockReset(); sbMock.signUp.mockResolvedValue({ data: { user: null, session: null }, error: null }); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('T4B-004 · sign-up sends the policy version it showed, for the server to record (T4a)', async () => {
    await signUp({ email: 'a@example.com', password: 'longenough', displayName: 'Asha' });
    expect(sbMock.signUp.mock.calls[0][0].options.data).toMatchObject({ display_name: 'Asha', policy_version: POLICY_VERSION });
    expect(POLICY_VERSION).toBe('2026-10-19');
  });

  it('T4B-005 · the sheet says what changed and asks to accept (18 or older); AuthGate asks only when the record is older, never over the legal pages', () => {
    const html = renderToStaticMarkup(<MemoryRouter><PolicyUpdateSheet onAccept={async () => {}} onSignOut={() => {}} /></MemoryRouter>);
    expect(html).toContain('We&#x27;ve updated our policies');
    for (const c of POLICY_CHANGES) expect(html).toContain(c.slice(0, 30).replace(/'/g, '&#x27;').replace(/"/g, '&quot;'));
    expect(html).toContain('Accept and continue');
    expect(html).toContain('Sign out');
    expect(html).toContain('By accepting you confirm you are 18 or older.');
    expect(POLICY_CHANGES.length).toBeGreaterThan(0);
    const gate = read('react/src/components/auth/AuthGate.tsx');
    expect(gate).toMatch(/select\('privacy_version'\)/);
    expect(gate).toMatch(/privacy_version !== POLICY_VERSION\) setNeedsConsent\(true\)/);
    expect(gate).toMatch(/onLegalPage = \/\^\\\/\(privacy\|terms\|cookies\)\\b\//);
  });
});

describe('the pages say what is true (XC-PRV-10, XC-PRV-11, XC-PRV-03)', () => {
  it('T4B-006 · Privacy names the processors and where, the DPDP rights, grievance and breach, and 18+; the old untrue lines are gone', () => {
    const privacy = read('react/src/pages/Privacy.tsx');
    for (const s of ['Amazon Web Services', 'Sydney, Australia', 'OpenRouter', 'do not keep or train', 'Google Analytics',
      'Digital Personal Data Protection Act', 'Grievance Officer', 'Data Protection Board of India', 'nominate another person',
      '72 hours', '18 or older', 'The names of your accounts and assets', 'Speed Insights']) expect(privacy, s).toContain(s);
    for (const s of ['Exactly two things', 'under 16', '"child" member profile']) expect(privacy, s).not.toContain(s);
    const cookies = read('react/src/pages/Cookies.tsx');
    expect(cookies).not.toContain('We only enable these integrations you explicitly opt into');
    expect(cookies).toContain('_ga');
    expect(cookies).toMatch(/Settings → Usage analytics/);
    const terms = read('react/src/pages/Terms.tsx');
    expect(terms).toContain('You must be 18 or older to create an account.');
    expect(terms).not.toMatch(/16 years|child-profile/);
    expect(read('react/src/pages/auth/SignUp.tsx')).toContain('I am 18 or older and agree to the');
    expect(read('react/src/components/auth/GoogleButton.tsx')).toContain('you confirm you are 18 or older');
    expect(read('SECURITY.md')).toMatch(/## If personal data is breached \(runbook\)[\s\S]*72 hours/);
    expect(read('SECURITY.md')).not.toMatch(/finflow/i);
  });
});

describe('"Download my data" holds exactly the owner\'s list (XC-PRV-08)', () => {
  it('T4B-007 · household, transactions, splits, debts, accounts, net worth and recurring schedules; no budgets, goals or profile', () => {
    const b = buildBackup({
      household: { name: 'Home', type: 'family', baseCurrency: 'INR' },
      members: [{ id: 'm1', name: 'Asha', role: 'self', appRole: 'owner' } as never, { id: 'm2', name: 'Ravi', role: 'spouse' } as never],
      transactions: [{ id: 't' } as never], sharedSplitsOwned: [{ id: 's1' } as never], sharedSplitsWithMe: [{ id: 's2' } as never],
      debts: [{ id: 'd' } as never], accounts: [{ id: 'a' } as never], assets: [{ id: 'x' } as never],
      netWorthSnapshots: [{ month: '2026-09' } as never], recurringSchedules: [{ id: 'r' } as never],
    }, '2026-10-19', '10.125.0');
    expect(Object.keys(b)).toEqual(['version', 'appVersion', 'exported', 'household', 'transactions', 'splits', 'debts', 'accounts', 'netWorth', 'recurringSchedules']);
    expect(b.household).toEqual({ name: 'Home', type: 'family', currency: 'INR', members: [{ name: 'Asha', role: 'owner' }, { name: 'Ravi', role: 'spouse' }] });
    expect(b.splits).toEqual({ sharedByYou: [{ id: 's1' }], sharedWithYou: [{ id: 's2' }] });
    expect(b.netWorth).toEqual({ assets: [{ id: 'x' }], monthlyHistory: [{ month: '2026-09' }] });
    expect(JSON.stringify(b)).not.toMatch(/"(budgets|budgetAllocations|goals|profile)"/);
  });
});

describe('Pip through OpenRouter asks for providers that keep no data (XC-PRV-10)', () => {
  it('T4B-009 · every OpenRouter request carries data_collection: deny; other endpoints do not, and a config row cannot change it', async () => {
    const sent: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const row = (base_url: string, extra?: Record<string, unknown>) => ({
      id: 'c', seam: 'assistant', provider: 'openrouter', model: 'meta-llama/llama-3.1-8b-instruct', base_url,
      key_env_var: 'OPENROUTER_API_KEY', params: extra ? { extra } : null, enabled: true, priority: 0,
    }) as ModelConfigRow;
    const readEnv = () => 'test-key';
    const msgs = [{ role: 'user' as const, content: 'hi' }];

    expect((await chatCompletion(msgs, { config: row('https://openrouter.ai/api/v1'), readEnv, fetchImpl })).ok).toBe(true);
    await chatCompletion(msgs, { config: row('https://openrouter.ai/api/v1', { provider: { data_collection: 'allow' } }), readEnv, fetchImpl });
    await chatCompletion(msgs, { config: row('https://models.example.com/v1'), readEnv, fetchImpl });
    expect(sent.map(b => b.provider)).toEqual([{ data_collection: 'deny' }, { data_collection: 'deny' }, undefined]);
    expect(isOpenRouterEndpoint('https://eu.openrouter.ai/api/v1/chat/completions')).toBe(true);
    expect(isOpenRouterEndpoint('https://openrouter.ai.evil.example/v1')).toBe(false);
    expect(isOpenRouterEndpoint('not a url')).toBe(false);
  });
});

describe('CSP violations are reported somewhere (FE-PLT-04)', () => {
  it('T4B-008 · both report formats log the directive, the blocked host and the page path only; the policy stays report-only', async () => {
    expect(linesOf({ 'csp-report': { 'effective-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js?token=abc', 'document-uri': 'https://vyact.app/invite/secret?email=a%40b.com#frag' } }))
      .toEqual([{ fn: 'csp-report', directive: 'script-src-elem', blocked: 'evil.example', page: '/invite/secret' }]);
    expect(linesOf([{ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'data', documentURL: 'https://vyact.app/' } },
      { type: 'deprecation', body: {} }])).toEqual([{ fn: 'csp-report', directive: 'img-src', blocked: 'data', page: '/' }]);
    expect(linesOf({ 'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'inline', 'document-uri': 'x' } })[0])
      .toMatchObject({ directive: 'script-src', blocked: 'inline', page: 'unknown' });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = { statusCode: 0, setHeader() {}, end() {} };
    await cspReport({ method: 'POST', body: JSON.stringify({ 'csp-report': { 'effective-directive': 'connect-src', 'blocked-uri': 'https://x.example', 'document-uri': 'https://vyact.app/a' } }) }, res);
    expect(res.statusCode).toBe(204);
    expect(log).toHaveBeenCalledWith('{"fn":"csp-report","directive":"connect-src","blocked":"x.example","page":"/a"}');
    const oversize = JSON.stringify({ 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'data', 'document-uri': 'https://vyact.app/', 'script-sample': 'x'.repeat(20_000) } });
    await cspReport({ method: 'POST', body: oversize }, res);              // over 16 KB: dropped unread
    expect(log).toHaveBeenCalledTimes(1);
    await cspReport({ method: 'GET' }, res);
    expect(res.statusCode).toBe(405);
    log.mockRestore();

    const vercel = JSON.parse(read('react/vercel.json')) as { headers: { headers: { key: string; value: string }[] }[] };
    const all = vercel.headers.flatMap(h => h.headers);
    expect(all.find(h => h.key === 'Content-Security-Policy-Report-Only')?.value).toMatch(/; report-uri \/api\/csp-report; report-to csp$/);
    expect(all.find(h => h.key === 'Reporting-Endpoints')?.value).toBe('csp="/api/csp-report"');
    expect(all.some(h => h.key === 'Content-Security-Policy')).toBe(false);   // enforced only after a clean week
  });
});
