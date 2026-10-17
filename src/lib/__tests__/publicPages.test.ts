// v10.49.0 — the public, server-rendered pages (marketing #0, #3/#4, #10, #11, #12, #14, #20, #25).
//
// Pinned: the functions find the public key without any Vercel env (the committed
// .env.production), and send it as `apikey` only; the lesson page carries Article +
// Breadcrumb (+ VideoObject for a video card), 3–5 related lessons, a try-it link into
// the matching feature with ?ref= and ?next=; hubs exist per topic; the sitemap lists
// home, library, hubs and lessons; llms.txt lists the live hubs; GA is gated to vyact.app;
// CMS text can never become markup.
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler, { lessonPage, topicPage, indexPage, renderBody, relatedLessons, firstSentence } from '../../../api/learn.js';
import { sitemapXml } from '../../../api/sitemap.js';
import { llmsTxt, DESCRIPTION } from '../../../api/llms.js';
import { analyticsSnippet, topicSlug, youtubeId, featureFor, signUpUrl } from '../../../api/_page.js';
import { publicConfig, readContent, _resetConfig } from '../../../api/_supabase.js';

const card = (over: Record<string, unknown> = {}) => ({
  slug: 'ev-001-the-500-a-day-idea', title: 'The ₹500-a-day idea', category: 'Saving',
  body_md: 'Small daily amounts add up. ₹500 a day is ₹15,000 a month.\n\n- Start small\n- Automate it\n\nKeep going.',
  tags: ['saving', 'habits'], reading_seconds: 75, video_url: null, updated_at: '2026-07-06T10:00:00Z', published_at: '2026-07-01T10:00:00Z',
  ...over,
});
const ALL = [
  card(),
  card({ slug: 'ev-002-pay-yourself-first', title: 'Pay yourself first', tags: ['saving', 'automation'] }),
  card({ slug: 'ev-010-emergency-fund', title: 'The emergency fund', tags: ['habits', 'safety'] }),
  card({ slug: 'ev-020-emi-basics', title: 'What an EMI really costs', category: 'Debt', tags: ['debt', 'emi'] }),
  card({ slug: 'ev-030-net-worth', title: 'Your net worth, simply', category: 'Net Worth', tags: ['net worth', 'habits'] }),
];
const jsonLdOf = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); _resetConfig(); });

describe('#0 — the public key, without any Vercel env', () => {
  it('CON-UNIT-PUB-001 · reads the committed .env.production and sends the key as apikey ONLY (a publishable key as Bearer is a 401)', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    _resetConfig();
    const cfg = publicConfig();
    expect(cfg.url).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
    expect(cfg.key.length).toBeGreaterThan(20);
    const fetchImpl = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    await readContent('select=slug', fetchImpl);
    const [, init] = fetchImpl.mock.calls[0];
    expect(Object.keys(init.headers)).toEqual(['apikey']);
    // The runtime env still wins when set.
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'from-env');
    _resetConfig();
    expect(publicConfig().key).toBe('from-env');
  });

  it('CON-UNIT-PUB-002 · a failed read is a 503 page (retry later), never a bare 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('denied', { status: 401 })));
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), setHeader: vi.fn() };
    await handler({ query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '300');
    expect(res.send.mock.calls[0][0]).toContain('noindex');
  });
});

describe('lesson pages (#11, #12, #20)', () => {
  it('CON-UNIT-PUB-003 · Article + Breadcrumb through the topic hub; related lessons by shared tags and topic; try-it link to the feature with ref + next', () => {
    const html = lessonPage(ALL[0], ALL);
    const ld = jsonLdOf(html);
    expect(ld[0]['@type']).toEqual(['Article', 'LearningResource']);
    expect(ld[0].headline).toBe('How much should you save a day? Think small and daily');   // v10.55.0: every lesson has a search title
    expect(ld[1].itemListElement[1].item).toBe('https://vyact.app/learn/topic/saving');
    expect(ld.map(o => o['@type'])).toEqual([['Article', 'LearningResource'], 'BreadcrumbList', 'FAQPage']);   // quick answer → FAQPage; no video → no VideoObject
    const related = relatedLessons(ALL[0], ALL);
    expect(related.map(c => c.slug)).toEqual(['ev-002-pay-yourself-first', 'ev-010-emergency-fund', 'ev-030-net-worth']);
    for (const r of related) expect(html).toContain(`/learn/${r.slug}`);
    expect(html).toContain('href="/auth/sign-up?ref=learn_ev-001-the-500-a-day-idea&amp;next=%2Freports"');
    expect(html).toContain('See your savings rate in Vyact');
    expect(html).toContain('<link rel="canonical" href="https://vyact.app/learn/ev-001-the-500-a-day-idea">');
    expect(html).toContain('class="sticky"');                  // slim mobile CTA (#19)
    expect(html).toContain("vyTrack('learn_card_view'");
  });

  it('CON-UNIT-PUB-004 · a YouTube Shorts card gets VideoObject (thumbnail, embed, upload date) and a click-to-play facade, not an iframe on load', () => {
    const html = lessonPage(card({ video_url: 'https://youtube.com/shorts/08k9NNVWsKw', video_updated_at: '2026-07-06T00:00:00Z' }), ALL);
    const video = jsonLdOf(html).find(o => o['@type'] === 'VideoObject');
    expect(video).toMatchObject({
      thumbnailUrl: ['https://i.ytimg.com/vi/08k9NNVWsKw/hqdefault.jpg'],
      embedUrl: 'https://www.youtube.com/embed/08k9NNVWsKw', uploadDate: '2026-07-06T00:00:00Z',
    });
    expect(html).toContain('data-yt="08k9NNVWsKw"');
    expect(html.replace(/<script>[\s\S]*?<\/script>/g, '')).not.toMatch(/<iframe/);   // only the click handler builds one
    expect(youtubeId('https://www.youtube.com/watch?v=abc123XYZ')).toBe('abc123XYZ');
    expect(youtubeId('https://example.com/x')).toBeNull();
  });

  it('CON-UNIT-PUB-005 · CMS text never becomes markup: body, title and tags are escaped; lists and bold render', () => {
    expect(renderBody('Hi <script>alert(1)</script>\n\n- **one**\n- two')).toBe('<p>Hi &lt;script&gt;alert(1)&lt;/script&gt;</p><ul><li><strong>one</strong></li><li>two</li></ul>');
    const html = lessonPage(card({ title: 'X </title><script>bad()</script>', tags: ['<b>t</b>'] }), []);
    expect(html).not.toContain('<script>bad()');
    expect(html).not.toContain('<b>t</b>');
    expect(firstSentence('Small daily amounts add up. More text here.')).toBe('Small daily amounts add up.');
  });

  it('CON-UNIT-PUB-005b · W0 (ADM-01, FE-PUB-02): CMS slug/category cannot end the page script; only http(s) sources link', () => {
    const hostile = 'x</script><script>stolen(localStorage)</script>';
    const html = lessonPage(card({ slug: `budgets-${hostile}`, category: hostile }), []);
    expect(html).not.toContain('<script>stolen(');
    expect(html).toContain('\\u003c/script>');                 // encoded inside the page script

    for (const source_url of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'not a url', 'ftp://example.com/x']) {
      const page = lessonPage(card({ source_url, source_name: 'RBI' }), []);   // must not throw
      expect(page, source_url).not.toContain('class="source"');
      expect(page, source_url).not.toMatch(/"citation"/);
    }
    const ok = lessonPage(card({ source_url: 'https://rbi.org.in/x', source_name: 'RBI' }), []);
    expect(ok).toContain('<a href="https://rbi.org.in/x" rel="nofollow noopener">RBI</a>');
  });
});

describe('library, hubs, sitemap, llms.txt (#10, #25)', () => {
  it('CON-UNIT-PUB-006 · the library links every topic hub; a hub lists its lessons with CollectionPage + ItemList', () => {
    const idx = indexPage(ALL);
    for (const t of ['saving', 'debt', 'net-worth']) expect(idx).toContain(`https://vyact.app/learn/topic/${t}`);
    expect(topicSlug('Using Vyact')).toBe('using-vyact');
    const hub = topicPage('Saving', ALL.filter(c => c.category === 'Saving'), ['Debt', 'Net Worth', 'Saving']);
    const ld = jsonLdOf(hub);
    expect(ld[0]['@type']).toBe('CollectionPage');
    expect(ld[0].mainEntity.numberOfItems).toBe(3);
    expect(hub).toContain('<h1>Saving: free money lessons</h1>');
    expect(hub.match(/<h1>/g)).toHaveLength(1);
  });

  it('CON-UNIT-PUB-007 · the sitemap lists home, the use-case pages, library, one hub per topic and every lesson', () => {
    const xml = sitemapXml(ALL, '2026-09-29');
    for (const loc of ['https://vyact.app/', 'https://vyact.app/about', 'https://vyact.app/for/couples', 'https://vyact.app/for/families', 'https://vyact.app/for/splitwise-users', 'https://vyact.app/for/money-owed', 'https://vyact.app/private', 'https://vyact.app/learn', 'https://vyact.app/learn/topic/saving', 'https://vyact.app/learn/topic/net-worth', 'https://vyact.app/learn/ev-020-emi-basics']) {
      expect(xml).toContain(`<loc>${loc}</loc>`);
    }
    expect(xml.match(/<url>/g)).toHaveLength(8 + 3 + ALL.length);
    // With no lessons readable, the static pages are still listed (v10.55.0: + 3 use-case pages).
    expect(sitemapXml([], '2026-09-29').match(/<url>/g)).toHaveLength(8);   // v10.56.0: + /about
  });

  it('CON-UNIT-PUB-008 · llms.txt: the one standard description and the live hubs', () => {
    const txt = llmsTxt(ALL);
    expect(txt.startsWith('# Vyact\n\n> ' + DESCRIPTION)).toBe(true);
    expect(txt).toContain('(https://vyact.app/learn/topic/saving): 3 lessons');
    expect(txt).toContain(`${ALL.length} short, plain-English money lessons`);
  });
});

describe('analytics gating and deep links (#3, #4, #20)', () => {
  it('CON-UNIT-PUB-009 · GA loads only on vyact.app / www.vyact.app; elsewhere events go nowhere', () => {
    const run = (host: string) => {
      const appended: string[] = [];
      // v10.53.0: gtag.js waits for load + idle; this page has loaded and is idle.
      const win: Record<string, unknown> = { matchMedia: () => ({ matches: false }), requestIdleCallback: (fn: () => void) => fn() };
      const doc = { readyState: 'complete', createElement: () => ({}), head: { appendChild: (s: { src: string }) => appended.push(s.src) } };
      const code = analyticsSnippet().replace(/<\/?script>/g, '');
      new Function('window', 'location', 'document', code)(win, { hostname: host }, doc);
      (win.vyTrack as (n: string) => void)('learn_card_view');
      return { appended, layer: (win.dataLayer as unknown[]).length };
    };
    expect(run('vyact.app').appended[0]).toContain('googletagmanager.com/gtag/js?id=G-E3XKWZP850');
    expect(run('www.vyact.app').appended).toHaveLength(1);
    for (const h of ['localhost', 'vyact-git-main-authen27.vercel.app', 'stage.vyact.app', 'admin.vyact.app']) {
      const r = run(h);
      expect(r.appended, h).toHaveLength(0);
      expect(r.layer, h).toBe(0);
    }
  });

  it('CON-UNIT-PUB-010 · every Learn topic maps to a real app route; sign-up links carry ref and next', () => {
    const APP_ROUTES = ['/dashboard', '/budgets', '/debts', '/reports', '/networth', '/households', '/insights'];
    for (const t of ['Budgeting', 'Debt', 'Saving', 'Investing', 'Net Worth', 'Household', 'India', 'Mindset', 'Using Vyact', 'Unknown']) {
      expect(APP_ROUTES, t).toContain(featureFor(t).next);
    }
    expect(signUpUrl('learn_x', '/budgets')).toBe('/auth/sign-up?ref=learn_x&next=%2Fbudgets');
  });
});

// v10.50.0 — "/" is the app's own landing page again (the Aurora brand page, owner decision),
// pre-rendered at build time into dist/landing.html (scripts/prerender-landing.mjs).
const INDEX_FIXTURE = `<!DOCTYPE html><html lang="en"><head>
<meta name="description" content="x" />
<meta property="og:title" content="x" />
<meta property="og:description" content="x" />
<meta name="twitter:title" content="x" />
<meta name="twitter:description" content="x" />
<script type="application/ld+json">{"@type":"Organization"}</script>
<title>Vyact — Family Finance OS</title>
<link rel="stylesheet" crossorigin href="/assets/index-AbC123.css">
</head><body><div id="root"></div><script type="module" src="/assets/index-XyZ.js"></script></body></html>`;

async function renderedLanding(cloudMode = true) {
  const React = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { MemoryRouter } = await import('react-router-dom');
  const { default: LandingView } = await import('../../pages/LandingView');
  return renderToString(React.createElement(MemoryRouter, null, React.createElement(LandingView, { cloudMode, signedIn: false })));
}

describe('the landing page (#9, #12, #19)', () => {
  it('CON-UNIT-PUB-011 · the restored landing: one H1, the SEO sections at the bottom, a FAQPage that matches the visible FAQ, and the landing head', async () => {
    const copy = await import('../../content/landingCopy');
    const { landingHtml } = await import('../../../scripts/landingHtml.mjs');
    const markup = await renderedLanding();
    const html = landingHtml(INDEX_FIXTURE, markup, copy);

    expect(markup.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(markup).toContain('Your household deserves to understand its money.');
    // The v10.49 content sits BELOW the brand sections, in the same theme.
    const at = (s: string) => markup.indexOf(s);
    expect(at('Sound familiar?')).toBeLessThan(at('Made for the way households actually run.'));
    for (const s of ['Everything in one place.', 'Learn money in 60 seconds.', 'Questions, answered.']) expect(at(s)).toBeGreaterThan(at('Your money, explained back to you.'));
    for (const l of copy.LESSONS) expect(markup).toContain(`href="/learn/${l.slug}"`);
    expect(markup).toContain('href="/auth/sign-up?ref=landing_hero"');

    const ld = jsonLdOf(html);
    expect(ld.find(o => o['@type'] === 'SoftwareApplication')).toMatchObject({ applicationCategory: 'FinanceApplication', offers: { price: '0' } });
    const faq = ld.find(o => o['@type'] === 'FAQPage');
    expect(faq.mainEntity.map((q: { name: string }) => q.name)).toEqual(copy.FAQ.map(([q]) => q));
    for (const [q] of copy.FAQ) expect(markup).toContain(`<summary class="text-[0.95rem] font-semibold text-ink cursor-pointer">${q.replace(/'/g, '&#x27;')}</summary>`);
    expect(html).toContain(`<title>${copy.SITE_TITLE.replace(/&/g, '&amp;')}</title>`);
    expect(copy.SITE_TITLE).toMatch(/family budget app/i);                  // #7 — leads with the searched phrase
    expect(copy.SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
    expect(html).toContain('<link rel="canonical" href="https://vyact.app/" />');
    expect(html).toContain(`<div id="root">${markup}</div>`);
    expect(html).toContain("localStorage.getItem('vt_theme')");      // saved theme before first paint

    // Positioning (owner, 2026-09-29): lead with what Vyact does, for any household — not
    // with what it is not, and not India-only. WhatsApp is not advertised yet.
    const words = (markup + JSON.stringify(ld)).toLowerCase();
    for (const banned of ['sms', 'bank link', 'no bank', 'indian household', 'for india', 'whatsapp']) expect(words, banned).not.toContain(banned);
  });

  it('CON-UNIT-PUB-012 · middleware serves "/" from the pre-rendered landing, keeping the query', async () => {
    const mw = await import('../../../middleware.js');
    const res = mw.default(new Request('https://vyact.app/?ref=ig'));
    expect(res.headers.get('x-middleware-rewrite')).toBe('https://vyact.app/landing.html?ref=ig');
  });

  it('CON-UNIT-PUB-021 · one brand entity: /about answers "What is Vyact?", says which Vyact this is, and every page points at the same Organization @id', async () => {
    const { aboutPage, FAQ } = await import('../../../api/about.js');
    const brand = await import('../../../api/_brand.js');
    const html = aboutPage();
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain('<h1>What is Vyact?</h1>');
    expect(html).toContain('<link rel="canonical" href="https://vyact.app/about">');
    expect(html).toContain('not related to the open-source AI workspace');
    const ld = jsonLdOf(html);
    const org = ld.find(o => o['@type'] === 'Organization');
    expect(org['@id']).toBe('https://vyact.app/#organization');
    expect(org.alternateName).toEqual(['Vyact app']);
    expect(org.sameAs).toContain('https://www.youtube.com/channel/UCMYdD2TEFJaCSJnsSBs8T7A');
    expect(ld.find(o => o['@type'] === 'AboutPage').mainEntity).toEqual({ '@id': brand.ORG_ID });
    expect(ld.find(o => o['@type'] === 'FAQPage').mainEntity.map((q: { name: string }) => q.name)).toEqual(FAQ.map(([q]: string[]) => q));
    // The landing page carries the same entity; its app node is published by it.
    const copy = await import('../../content/landingCopy');
    const { landingJsonLd } = await import('../../../scripts/landingHtml.mjs');
    const landing = landingJsonLd(copy);
    expect(landing.find((o: { '@type': string }) => o['@type'] === 'Organization')['@id']).toBe(brand.ORG_ID);
    expect(landing.find((o: { '@type': string }) => o['@type'] === 'SoftwareApplication').publisher['@id']).toBe(brand.ORG_ID);
    expect(copy.STANDARD_DESCRIPTION).toMatch(/^Vyact is the family budget app/);
    // Owner rule: never "Vyact Finance"; the tagline is "Family budget app", not "Family Finance OS".
    const { readFileSync, readdirSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const apiDir = resolve(__dirname, '../../../api');
    const sources = [
      ...readdirSync(apiDir).filter(f => f.endsWith('.js')).map(f => readFileSync(resolve(apiDir, f), 'utf8')),
      readFileSync(resolve(__dirname, '../../../index.html'), 'utf8'),
      readFileSync(resolve(__dirname, '../../pages/LandingView.tsx'), 'utf8'),
      readFileSync(resolve(__dirname, '../../content/landingCopy.ts'), 'utf8'),
    ].join('\n');
    expect(sources).not.toMatch(/Vyact Finance/i);
    expect(sources).not.toMatch(/Family Finance OS/);
  });

  it('CON-UNIT-PUB-022 · footer link rows wrap and the mobile sticky bar never covers the page end', async () => {
    // v10.56.1 — the footer link row grew with each new page and, without flex-wrap, ran to 541px:
    // phones laid every Learn and /for page out 561px wide and zoomed it out (owner report, 2 Oct 2026).
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const html = lessonPage(ALL[0], ALL);
    const footerRow = /<footer[\s\S]*?<div class="([^"]*justify-end mt-3[^"]*)"/.exec(html)?.[1] ?? '';
    expect(footerRow.split(' ')).toContain('flex-wrap');
    expect(html).toMatch(/@media\(max-width:640px\)\{[^}]*\.sticky\{[\s\S]*?\.lx\{padding-bottom:88px\}\}/);
    const landing = readFileSync(resolve(__dirname, '../../pages/LandingView.tsx'), 'utf8');
    expect(landing).toMatch(/className="flex flex-wrap [^"]*justify-end mt-3/);
  });

  it('CON-UNIT-PUB-020 · unknown paths are a noindex 404; every app route, public page and static file still gets through', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const mw = await import('../../../middleware.js');
    // Every top-level route the app declares must reach the app shell (else users get a 404).
    const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
    const forms = readFileSync(resolve(__dirname, '../formRoutes.ts'), 'utf8');
    const declared = new Set([...app.matchAll(/path="\/([^"/*]+)/g), ...forms.matchAll(/'\/([a-z_-]+)\//g)].map(m => m[1]));
    // W6 (FE-UIS-12): the always-throwing Lane A page is routed only outside production builds.
    expect(app).toMatch(/import\.meta\.env\.MODE !== 'production' && E2EErrorTest && <Route path="\/__e2e_error"/);
    expect(app).toMatch(/const E2EErrorTest = import\.meta\.env\.MODE !== 'production'\s*\n\s*\? React\.lazy/);
    declared.delete('__e2e_error');
    expect(mw.routeFor('/__e2e_error')).toBe('not-found');
    expect(declared.size).toBeGreaterThan(15);
    for (const seg of declared) expect(mw.routeFor(`/${seg}`), seg).toBe('next');
    for (const p of ['/onboarding', '/auth/sign-up', '/invite/abc', '/transactions/new', '/about', '/private']) expect(mw.routeFor(p), p).toBe('next');
    // Made-up paths are a real 404 with noindex.
    for (const p of ['/this-page-does-not-exist', '/vyact-finance', '/blog']) expect(mw.routeFor(p), p).toBe('not-found');
    const res = mw.default(new Request('https://vyact.app/this-page-does-not-exist'));
    expect(res.status).toBe(404);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(await res.text()).toContain('<meta name="robots" content="noindex">');
    // The matcher skips static files, api, assets, icons, Learn, /for/* and .well-known.
    const re = new RegExp(`^${mw.config.matcher[0]}$`);
    for (const p of ['/assets/index-1.js', '/favicon.svg', '/landing.html', '/1ad202c3ca28f7e2c7245752d1f27eba.txt', '/api/for', '/learn', '/learn/ev-001-x', '/for/couples', '/.well-known/assetlinks.json', '/icons/a.png']) {
      expect(re.test(p), p).toBe(false);
    }
    for (const p of ['/', '/about', '/dashboard', '/nope']) expect(re.test(p), p).toBe(true);
  });

  it('CON-UNIT-PUB-028 · public pages never write an HSL-triplet token raw (the Aurora rule; the browser drops it silently)', async () => {
    // W6 (audit FE-PUB-11): the current Learn topic pill had border-color:var(--coral).
    const { readFileSync, readdirSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const apiDir = resolve(__dirname, '../../../api');
    const raw = /(?<!hsl\()var\(--(coral|sage|honey|denim|plum|terra|olive|line2?|bg\d?|ink(?:-mid|-dim)?)\)/;
    for (const f of readdirSync(apiDir).filter(x => x.endsWith('.js'))) {
      expect(readFileSync(resolve(apiDir, f), 'utf8'), f).not.toMatch(raw);
    }
    expect(topicPage('Saving', ALL.filter(c => c.category === 'Saving'), ['Debt', 'Net Worth', 'Saving']))
      .toContain('aria-current="page" style="border-color:hsl(var(--coral))"');
  });

  it('CON-UNIT-PUB-027 · every public rewrite is on the service worker denylist, so an installed app never answers it with the app shell', async () => {
    // W6 (audit FE-PUB-04): /v/<n> was rewritten to api/v but missing here, so a returning
    // visitor's worker served index.html and the short link landed on /dashboard.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const root = resolve(__dirname, '../../..');
    const vite = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');
    const block = vite.match(/navigateFallbackDenylist: \[([\s\S]*?)\n\s*\],/)?.[1] ?? '';
    const deny = [...block.matchAll(/\/\^((?:\\\/|[^/\n])+)\//g)].map(m => new RegExp(`^${m[1]}`));
    expect(deny.length).toBeGreaterThan(8);
    const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
    const sources = (vercel.rewrites as { source: string }[]).map(r => r.source).filter(s => !s.includes('(('));
    expect(sources).toContain('/v/:n');
    for (const source of sources) {
      const sample = source.replace(/:[a-z]+\*?/g, '3');
      expect(deny.some(re => re.test(sample)), `${source} (${sample})`).toBe(true);
    }
  });

  it('CON-UNIT-PUB-013 · one standard description everywhere; the build fails loudly on a changed index.html; Learn wears the app stylesheet', async () => {
    const copy = await import('../../content/landingCopy');
    const { landingHtml, builtCssHref } = await import('../../../scripts/landingHtml.mjs');
    expect(DESCRIPTION).toBe(copy.STANDARD_DESCRIPTION);
    expect(builtCssHref(INDEX_FIXTURE)).toBe('/assets/index-AbC123.css');
    expect(() => landingHtml(INDEX_FIXTURE.replace('<div id="root"></div>', '<div id="root">x</div>'), '', copy)).toThrow(/empty #root/);
    expect(() => landingHtml(INDEX_FIXTURE.replace(/<meta name="description"[^>]*>/, ''), '', copy)).toThrow(/meta description/);
    const lesson = lessonPage(ALL[0], ALL);
    expect(lesson).toContain('<link rel="stylesheet" href="/site.css">');
    expect(lesson).toContain('class="btn-primary');                 // the landing header, class for class
    expect(lesson.toLowerCase()).not.toContain('indian households');
  });
});

// v10.51.0 — keyword targeting (marketing #7, #21) and AEO/GEO (robots.txt, llms.txt).
describe('keywords, answers and AI crawlers (#7, #21, #25)', () => {
  it('CON-UNIT-PUB-014 · a mapped lesson leads with its search-shaped question and a 40–60-word quick answer, also as FAQPage', async () => {
    const { LESSON_SEO, seoFor } = await import('../../../api/_seo.js');
    // v10.55.0 (#58) — every one of the 116 lessons has a search-shaped title and quick answer,
    // currency-neutral under the global stance (no ₹ on a public title or answer).
    expect(Object.keys(LESSON_SEO)).toHaveLength(116);
    for (const [k, v] of Object.entries(LESSON_SEO) as [string, { title: string; answer: string }][]) {
      const words = v.answer.split(/\s+/).length;
      expect(words, k).toBeGreaterThanOrEqual(40);
      expect(words, k).toBeLessThanOrEqual(62);
      expect(v.title.length, k).toBeLessThanOrEqual(70);
      expect(v.title + v.answer, k).not.toMatch(/₹/);
    }
    const titles = Object.values(LESSON_SEO).map(v => (v as { title: string }).title.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
    const slug = 'ev-003-the-50-30-20-starting-point';
    const seo = seoFor(slug)!;
    const html = lessonPage(card({ slug, title: 'The 50-30-20 starting point' }), ALL);
    expect(html).toContain(`<h1>${seo.title.replace(/'/g, '&#39;')}</h1>`);
    expect(html).toContain('aria-label="Quick answer"');
    expect(html).toContain('The 50-30-20 starting point · ');           // the editorial title stays visible
    const faq = jsonLdOf(html).find(o => o['@type'] === 'FAQPage');
    expect(faq.mainEntity[0].acceptedAnswer.text).toBe(seo.answer);
    // A lesson with no entry (not ev-NNN) is unchanged.
    expect(lessonPage(card({ slug: 'guest-post-on-saving', title: 'Guest post' }), ALL)).not.toContain('Quick answer');
  });

  it('CON-UNIT-PUB-015 · the use-case pages (couples, families, splitwise-users, money-owed, /private): one H1, a quick answer, a FAQPage that matches the visible FAQ, links to each other; unknown → 404', async () => {
    const { audiencePage, audiencePath, AUDIENCES, default: forHandler } = await import('../../../api/for.js');
    const keys = ['couples', 'families', 'splitwise-users', 'money-owed', 'private'];
    expect(Object.keys(AUDIENCES)).toEqual(keys);
    expect(audiencePath('private')).toBe('/private');
    for (const key of keys) {
      const html = audiencePage(key);
      expect(html.match(/<h1>/g), key).toHaveLength(1);
      expect(html).toContain(`<link rel="canonical" href="https://vyact.app${audiencePath(key)}">`);
      for (const other of keys.filter(k => k !== key)) expect(html, `${key} → ${other}`).toContain(`href="https://vyact.app${audiencePath(other)}"`);
      expect(AUDIENCES[key].title.length, key).toBeLessThanOrEqual(60);
      expect(html).toContain('aria-label="Quick answer"');
      const faq = jsonLdOf(html).find(o => o['@type'] === 'FAQPage');
      expect(faq.mainEntity.map((q: { name: string }) => q.name)).toEqual(AUDIENCES[key].faq.map(([q]: string[]) => q));
      expect(html).toContain(`ref=${AUDIENCES[key].ref}`);
      const words = html.toLowerCase();
      for (const banned of ['sms', 'no bank', 'indian household', 'whatsapp']) expect(words, banned).not.toContain(banned);
    }
    expect(AUDIENCES.couples.title).toMatch(/budget app for couples/i);
    expect(AUDIENCES.families.title).toMatch(/family expense tracker/i);   // v10.55.0 #59 keyword map
    expect(AUDIENCES['splitwise-users'].title).toMatch(/splitwise alternative/i);
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), setHeader: vi.fn() };
    forHandler({ query: { audience: 'pets' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('CON-UNIT-PUB-016 · robots.txt welcomes the AI crawlers by name, repeats the same fences in every group, keeps the public site open', async () => {
    const { robotsTxt, AI_CRAWLERS, PRIVATE_PATHS } = await import('../../../api/robots.js');
    const txt = robotsTxt();
    for (const bot of ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'Bingbot']) expect(txt).toContain(`User-agent: ${bot}`);
    // One group: every user-agent line comes before the first rule, so all share the same rules.
    const lines = txt.split('\n');
    const firstRule = lines.findIndex(l => /^(Allow|Disallow):/.test(l));
    const agents = lines.filter(l => l.startsWith('User-agent:'));
    expect(agents).toHaveLength(1 + AI_CRAWLERS.length);
    expect(lines.findLastIndex(l => l.startsWith('User-agent:'))).toBeLessThan(firstRule);
    for (const p of PRIVATE_PATHS) expect(lines).toContain(`Disallow: ${p}`);
    for (const open of ['/learn', '/for/', '/privacy', '/llms.txt']) expect(PRIVATE_PATHS.some((p: string) => open.startsWith(p))).toBe(false);
    expect(txt).toContain('Sitemap: https://vyact.app/sitemap.xml');
  });

  it('CON-UNIT-PUB-017 · llms.txt carries key facts, the use-case pages and the answered lessons; llms-full.txt lists every lesson with an answer', async () => {
    const { llmsFullTxt } = await import('../../../api/llms.js');
    const cards = [...ALL, card({ slug: 'ev-003-the-50-30-20-starting-point', title: 'The 50-30-20 starting point' }),
      card({ slug: 'guest-post-on-saving', title: 'Guest post' })];
    const txt = llmsTxt(cards);
    expect(txt).toContain('## Key facts');
    expect(txt).toContain('(https://vyact.app/for/couples)');
    expect(txt).toContain('(https://vyact.app/for/families)');
    expect(txt).toContain('[What is the 50/30/20 rule? A simple budget starting point](https://vyact.app/learn/ev-003-the-50-30-20-starting-point)');
    expect(txt).toContain('(https://vyact.app/llms-full.txt)');
    const full = llmsFullTxt(cards);
    for (const c of cards) expect(full).toContain(`(https://vyact.app/learn/${c.slug}): `);
    expect(full).toContain('(https://vyact.app/learn/guest-post-on-saving): Small daily amounts add up.');   // unmapped → first sentence
    expect(full.toLowerCase()).not.toContain('whatsapp');
  });
});

// v10.52.0 — mobile PageSpeed (landing 59; LCP 8.0 s on 1 Oct 2026). Nothing third-party
// may block the first paint: no synchronous external <script src> in <head>, and the
// Google Fonts stylesheet loads as a non-blocking preload. Covers index.html (the
// landing page and the app shell) and the server-rendered Learn pages.
describe('first paint is not blocked by third parties', () => {
  it('CON-UNIT-PUB-019 · landing.html does not fetch the app bundle during load: it boots on interaction (or a saved session) and tracks CTA clicks until then', async () => {
    const { landingHtml } = await import('../../../scripts/landingHtml.mjs');
    const copy = await import('../../content/landingCopy');
    const markup = await renderedLanding();
    const built = INDEX_FIXTURE.replace('<script type="module" src="/assets/index-XyZ.js"></script>',
      '<script type="module" crossorigin src="/assets/index-XyZ.js"></script>\n<link rel="modulepreload" crossorigin href="/assets/react-dom-1.js">');
    const html = landingHtml(built, markup, copy);
    expect(html).not.toMatch(/<script type="module"/);
    expect(html).not.toContain('modulepreload');
    expect(html).toContain('var src="/assets/index-XyZ.js"');
    expect(html).toMatch(/evs=\['scroll','wheel','touchstart','pointerdown','keydown'\]/);
    expect(html).toMatch(/\/\^sb-\.\+-auth-token\$\//);
    expect(html).toContain("'landing_cta_click'");
    expect(html).toContain('if(window.__vyLandingLive)return;');
    // Every CTA the app tracks is marked for the boot script, with the same placement.
    // v10.57.0 — plus the guest demo link and the three Shorts.
    expect([...markup.matchAll(/data-cta="([a-z0-9_]+)"/g)].map(m => m[1])).toEqual(['nav', 'hero', 'demo', 'short_003', 'short_021', 'short_027', 'footer', 'footer_link']);
    expect(() => landingHtml(INDEX_FIXTURE.replace(/<script type="module"[^>]*><\/script>/, ''), markup, copy)).toThrow(/app entry script/);
  });

  it('PUB-018 · index.html and Learn pages keep analytics and fonts off the critical path', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const indexHtml = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');
    const head = indexHtml.slice(0, indexHtml.indexOf('</head>'));
    const syncExternal = [...head.matchAll(/<script\b[^>]*\bsrc="https?:\/\/[^"]+"[^>]*>/g)].map(m => m[0]).filter(tag => !/\b(async|defer)\b/.test(tag));
    expect(syncExternal).toEqual([]);
    expect(head.replace(/<noscript>[\s\S]*?<\/noscript>/g, '')).not.toMatch(/<link[^>]*rel="stylesheet"[^>]*fonts\.googleapis\.com/);
    expect(head).toMatch(/<link\s+rel="preload" as="style"[^>]*fonts\.googleapis\.com/);
    // W0 (audit 2026-10-04, XC-PRV-03) — Contentsquare session replay is removed everywhere.
    expect(head).not.toMatch(/contentsquare\.net/i);
    expect(head).toMatch(/addEventListener\('load'/);
    // W0 (XC-PRV-02) — GA's page_location is redacted: no invite token, no email/token/code.
    expect(head).toMatch(/gtag\('config', 'G-E3XKWZP850', \{ page_location: cleanLocation\(\) \}\)/);
    const cleanSrc = head.match(/function cleanLocation\(\) \{[\s\S]*?\n {8}\}/)?.[0];
    expect(cleanSrc).toBeTruthy();
    const clean = new Function('location', `${cleanSrc}; return cleanLocation();`) as
      (loc: { origin: string; pathname: string; search: string }) => string;
    expect(clean({ origin: 'https://vyact.app', pathname: '/invite/3f9a-secret', search: '?email=a%40b.com&utm_source=mail' }))
      .toBe('https://vyact.app/invite/:token?utm_source=mail');
    expect(clean({ origin: 'https://vyact.app', pathname: '/auth/sign-up', search: '?email=a%40b.com&token=x&code=y&next=%2Fsplits' }))
      .toBe('https://vyact.app/auth/sign-up');
    expect(clean({ origin: 'https://vyact.app', pathname: '/transactions', search: '' })).toBe('https://vyact.app/transactions');

    // v10.52.1 — on "/" the feedback widget waits for the first interaction.
    const mainTsx = readFileSync(resolve(__dirname, '../../main.tsx'), 'utf8');
    expect(mainTsx).toMatch(/if \(onLanding\) onFirstInteraction\(startUserback\); else startUserback\(\);/);
    expect(mainTsx.match(/\bUserback\(/g)?.length).toBe(1);   // one call site: startUserback

    const lesson = lessonPage(ALL[0], ALL);
    const lessonHead = lesson.slice(0, lesson.indexOf('</head>'));
    expect(lessonHead.replace(/<noscript>[\s\S]*?<\/noscript>/g, '')).not.toMatch(/<link[^>]*rel="stylesheet"[^>]*fonts\.googleapis\.com/);
    expect(lessonHead).toMatch(/rel="preload" as="style"[^>]*fonts\.googleapis\.com/);
    // v10.53.0 — gtag.js on Learn / for pages is fetched after load + idle, not during parse.
    expect(lessonHead).toMatch(/window\.requestIdleCallback\(late,\{timeout:3000\}\)/);
    expect(lessonHead).toMatch(/addEventListener\('load',idle/);
  });
});

// v10.57.0 — the YouTube → site → app path (master to-do B17–B20).
describe('video short links, Start here paths, the Shorts strip and the guest demo', () => {
  it('CON-UNIT-PUB-023 · /v/<n> redirects to lesson ev-<n> with YouTube utm tags, and to the library when the number is unknown', async () => {
    const v = await import('../../../api/v.js');
    expect(v.lessonId('3')).toBe('ev-003');
    expect(v.lessonId('27')).toBe('ev-027');
    expect(v.lessonId('106')).toBe('ev-106');
    for (const bad of ['', 'abc', '1234', '3;drop', undefined]) expect(v.lessonId(bad), String(bad)).toBeNull();
    expect(v.target('ev-003', 'ev-003-the-50-30-20-starting-point'))
      .toBe('/learn/ev-003-the-50-30-20-starting-point?utm_source=youtube&utm_medium=video&utm_campaign=ev-003');
    expect(v.target(null, null)).toBe('/learn?utm_source=youtube&utm_medium=video');

    const run = async (n: string | undefined, read: (q: string) => Promise<unknown>) => {
      const res = { headers: {} as Record<string, string>, to: '', code: 0,
        setHeader(k: string, val: string) { this.headers[k] = val; },
        redirect(code: number, to: string) { this.code = code; this.to = to; } };
      await v.default({ query: n === undefined ? {} : { n } }, res, read);
      return res;
    };
    const queries: string[] = [];
    const found = await run('3', async q => { queries.push(q); return [{ slug: 'ev-003-the-50-30-20-starting-point' }]; });
    expect(found.code).toBe(302);
    expect(found.to).toContain('/learn/ev-003-the-50-30-20-starting-point?');
    expect(queries[0]).toBe('select=slug&slug=like.ev-003-*&format=eq.card&status=eq.published&limit=1');
    expect(found.headers['Cache-Control']).toMatch(/s-maxage/);
    const missing = await run('999', async () => []);
    expect(missing.to).toBe('/learn?utm_source=youtube&utm_medium=video');
    expect(missing.headers['Cache-Control']).toBe('no-store');
    const broken = await run('3', async () => { throw new Error('down'); });
    expect(broken.to).toBe('/learn?utm_source=youtube&utm_medium=video');
    let called = false;
    const invalid = await run('x', async () => { called = true; return []; });
    expect(called).toBe(false);                       // nothing user-typed reaches the query
    expect(invalid.to).toBe('/learn?utm_source=youtube&utm_medium=video');

    // Routed: the middleware lets /v/* through and vercel.json rewrites it before the app catch-all.
    const mw = await import('../../../middleware.js');
    expect(mw.routeFor('/v/3')).toBe('next');
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const vercel = JSON.parse(readFileSync(resolve(__dirname, '../../../vercel.json'), 'utf8'));
    const sources = vercel.rewrites.map((r: { source: string }) => r.source);
    expect(sources.indexOf('/v/:n')).toBeGreaterThanOrEqual(0);
    expect(sources.indexOf('/v/:n')).toBeLessThan(sources.length - 1);
  });

  it('CON-UNIT-PUB-024 · Start here: three 5-lesson paths of real lessons; a path lesson names its place and links the next; the index lists the paths with progress', async () => {
    const { START_PATHS, pathFor } = await import('../../../api/learn.js');
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const library = JSON.parse(readFileSync(resolve(__dirname, '../../data/evergreenCards.json'), 'utf8')) as { cards: { id: string }[] };
    const ids = new Set(library.cards.map(c => c.id));
    expect(START_PATHS.map(p => p.id)).toEqual(['couples', 'budgeting', 'debt']);
    for (const p of START_PATHS) {
      expect(p.slugs).toHaveLength(5);
      for (const s of p.slugs) expect(ids.has(s), s).toBe(true);
    }
    expect(pathFor('ev-027-avalanche-vs-snowball')).toMatchObject({ index: 1, next: 'ev-034-avalanche-in-one-line' });
    expect(pathFor('ev-039-clear-the-card-before-it-compounds')?.next).toBeNull();
    expect(pathFor('ev-001-the-500-a-day-idea')).toBeNull();

    const debt = START_PATHS[2].slugs.map((slug, i) => card({ slug, title: `Debt lesson ${i + 1}`, category: 'Debt' }));
    const first = lessonPage(debt[0], debt);
    expect(first).toContain('Start here · Get out of debt · lesson 1 of 5');
    expect(first).toContain(`/learn/${debt[1].slug}"`);
    expect(first).toContain('vy_learn_read');           // this browser remembers what it read
    expect(lessonPage(debt[4], debt)).toContain('You’ve reached the end of this path.');
    expect(lessonPage(ALL[0], ALL)).not.toContain('Start here ·');

    const index = indexPage([...ALL, ...debt]);
    expect(index).toContain('<h2 id="start-here">Start here</h2>');
    expect(index).toContain('data-path="debt"');
    expect(index).not.toContain('data-path="couples"');  // a path with no published lesson is left out
    expect((index.match(/data-slug="/g) || []).length).toBe(5);
    expect(index).toContain('https://www.youtube.com/@askvyact');
  });

  it('CON-UNIT-PUB-025 · the landing "Learn money in 60 seconds" strip: three Shorts, lazy thumbnails, each with its lesson', async () => {
    const copy = await import('../../content/landingCopy');
    const markup = await renderedLanding();
    expect(markup).toContain('Learn money in 60 seconds.');
    const strip = /data-testid="landing-shorts"[\s\S]*?<\/p>/.exec(markup)?.[0] ?? '';
    expect(copy.SHORTS).toHaveLength(3);
    for (const s of copy.SHORTS) {
      expect(strip).toContain(`https://www.youtube.com/shorts/${s.id}`);
      expect(strip).toContain(`/learn/${s.slug}"`);
      expect(strip).toContain(`https://i.ytimg.com/vi/${s.id}/hqdefault.jpg`);
    }
    expect((strip.match(/loading="lazy"/g) || []).length).toBe(3);
    expect(strip).not.toContain('<iframe');               // no YouTube player on the landing page
    expect(strip).toContain('@askvyact');
  });

  it('CON-UNIT-PUB-026 · the guest demo: local-only build, never production data, noindex on its own host, and linked from the landing and lessons', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const root = resolve(__dirname, '../../..');
    // The fallback that put previews on PRODUCTION is off whenever VITE_LOCAL_ONLY=1 …
    const sb = readFileSync(resolve(root, 'src/lib/supabase.ts'), 'utf8');
    expect(sb).toMatch(/USE_FALLBACK = import\.meta\.env\.PROD && import\.meta\.env\.MODE !== 'test' && import\.meta\.env\.VITE_LOCAL_ONLY !== '1'/);
    // … and both the preview build and the demo build set it, with no database.
    const vite = readFileSync(resolve(root, 'vite.config.ts'), 'utf8').replace(/\r\n/g, '\n');
    const preview = /if \(process\.env\.VERCEL_ENV === 'preview'[\s\S]*?\n\}/.exec(vite)?.[0] ?? '';
    const demo = /if \(process\.env\.VYACT_DEMO === '1'\)[\s\S]*?\n\}/.exec(vite)?.[0] ?? '';
    for (const block of [preview, demo]) {
      expect(block).toContain("process.env.VITE_LOCAL_ONLY = '1'");
      expect(block).toContain("process.env.VITE_SUPABASE_URL = ''");
    }
    expect(demo).toContain("process.env.VITE_DEMO = '1'");

    // The demo host opens the demo household, not the landing page; vyact.app is unchanged.
    const mw = await import('../../../middleware.js');
    const r = mw.default(new Request('https://demo.vyact.app/?utm_source=x'));
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://demo.vyact.app/dashboard?utm_source=x');
    expect(mw.default(new Request('https://vyact.app/')).headers.get('x-middleware-rewrite')).toContain('/landing.html');
    // v10.57.1 — every address of the demo project counts (vyact-demo.vercel.app has no host rule).
    expect(mw.isDemoHost('vyact-demo.vercel.app', { VYACT_DEMO: '1' })).toBe(true);
    expect(mw.isDemoHost('vyact.app', {})).toBe(false);
    expect(vite).toMatch(/name: 'vyact-demo-noindex'[\s\S]*?process\.env\.VITE_DEMO === '1'[\s\S]*?<meta name="robots" content="noindex, nofollow">/);

    // Every response on the demo host is noindex, and its public pages go to vyact.app.
    const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
    const onDemo = (x: { has?: { type: string; value: string }[] }) => x.has?.some(h => h.type === 'host' && h.value === 'demo.vyact.app');
    const noindex = vercel.headers.find(onDemo);
    expect(noindex.source).toBe('/(.*)');
    expect(noindex.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
    const redirects = vercel.redirects.filter(onDemo);
    expect(redirects.map((x: { source: string }) => x.source)).toEqual(expect.arrayContaining(['/learn/:path*', '/for/:path*']));
    for (const x of redirects) expect(x.destination).toMatch(/^https:\/\/vyact\.app\//);

    // Entry points: the landing hero (signed-out, production build only) and every lesson.
    const copy = await import('../../content/landingCopy');
    expect(copy.DEMO_URL).toBe('https://demo.vyact.app/dashboard');
    expect(await renderedLanding(true)).toContain(`href="${copy.DEMO_URL}"`);
    expect(await renderedLanding(false)).not.toContain('demo.vyact.app');
    const lesson = lessonPage(ALL[3], ALL);               // a Debt lesson opens the demo on Debts
    expect(lesson).toContain('href="https://demo.vyact.app/debts" data-cta="demo"');

    // In the app: the banner and its sign-up link (ref=demo), and no install prompt on the demo.
    const banner = readFileSync(resolve(root, 'src/components/layout/DemoBanner.tsx'), 'utf8');
    expect(banner).toContain("import.meta.env.VITE_DEMO === '1'");
    expect(banner).toContain('https://vyact.app/auth/sign-up?ref=demo');
    const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');
    expect(app).toContain('{!IS_DEMO && <InstallBanner />}');
    expect(app).toMatch(/if \(IS_DEMO && location\.pathname === '\/'\) return <Navigate to="\/dashboard" replace \/>;/);
  });
});
