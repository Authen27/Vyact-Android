// Vyact — shared kit for the server-rendered Learn pages (/learn, /learn/topic/*,
// /learn/<slug>). v10.49.0; re-themed v10.50.0.
//
// Crawlers, social scrapers and AI tools don't run the SPA's JavaScript, so Learn is
// rendered here as plain HTML — but it wears the APP'S theme: the app's own stylesheet
// (published at the stable /site.css by scripts/prerender-landing.mjs), its fonts, and the
// landing page's header and footer (pages/LandingView.tsx), so /, /learn and the app read
// as one brand. Only a small Learn-specific block is inline, written against the app's
// tokens (triplets through hsl(), complete values through var() — CLAUDE.md's rule).
// Analytics load async and ONLY on vyact.app (#3/#4).
// Underscore file: Vercel does not expose it as an endpoint.

export const BASE = 'https://vyact.app';
export const OG_IMAGE = `${BASE}/og-vyact.png`;
export const GA_ID = 'G-E3XKWZP850';

export const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Audit S4 — HTML-safe JSON for <script type="application/ld+json">: `</script>` inside a
// JSON string would otherwise close the tag. `<` as < keeps JSON.parse identical.
export const safeJsonLd = o => JSON.stringify(o).replace(/</g, '\\u003c');

// W0 (audit 2026-10-04, ADM-01) — a CMS value placed INSIDE an inline <script> needs the
// same guard: plain JSON.stringify left `</script>` intact, so a lesson slug or category
// containing it ended the page script and ran whatever followed on vyact.app.
export const safeJs = v => JSON.stringify(v).replace(/</g, '\\u003c').split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');

/** W0 (FE-PUB-02) — only an absolute http(s) URL is ever put in an href or a citation.
 *  `esc()` made "javascript:…" HTML-safe but still clickable, and a malformed URL threw
 *  inside `new URL(…).hostname` and failed the whole page. */
export function httpUrl(u) {
  try {
    const url = new URL(String(u || ''));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

/** "Net Worth" → "net-worth" (topic hub URLs). */
export const topicSlug = cat => String(cat || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * #20 — each lesson points at the part of the app that puts it into practice.
 * `next` is where sign-up lands the new user (SignUp honours ?next=).
 */
export const FEATURE_BY_CATEGORY = {
  Budgeting: { next: '/budgets', label: 'Set a monthly budget in Vyact' },
  Debt: { next: '/debts', label: 'Plan your debt payoff in Vyact' },
  Saving: { next: '/reports', label: 'See your savings rate in Vyact' },
  Investing: { next: '/networth', label: 'Track your investments in Vyact' },
  'Net Worth': { next: '/networth', label: 'See your net worth in Vyact' },
  Household: { next: '/households', label: 'Share money with your household in Vyact' },
  India: { next: '/dashboard', label: 'Track your household’s money with Vyact' },
  Mindset: { next: '/insights', label: 'Get your first money insights in Vyact' },
  'Using Vyact': { next: '/dashboard', label: 'Open Vyact' },
};
export const featureFor = cat => FEATURE_BY_CATEGORY[cat] || { next: '/dashboard', label: 'Start tracking with Vyact' };

/** Sign-up link carrying where the visitor came from (#19 `?ref=`) and where to land. */
export const signUpUrl = (ref, next) =>
  `/auth/sign-up?ref=${encodeURIComponent(ref)}${next ? `&next=${encodeURIComponent(next)}` : ''}`;

/** v10.57.0 (B20) — the guest demo (no account), opened on the screen a lesson is about. */
export const DEMO_ORIGIN = 'https://demo.vyact.app';
export const demoUrl = next => `${DEMO_ORIGIN}${next || '/dashboard'}`;

/** YouTube id from a watch / shorts / youtu.be URL, or null. */
export function youtubeId(url) {
  const m = /(?:youtube\.com\/(?:shorts\/|watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/.exec(String(url || ''));
  return m ? m[1] : null;
}

/**
 * #3/#4 — GA only on the real site. localhost, CI, Vercel previews, stage/dev and the
 * admin app are never counted. `vyTrack(name, params)` queues events either way (a no-op
 * off vyact.app) so page scripts don't need to know. `platform` is on every event (#5).
 * v10.53.0 (#66) — gtag.js itself is fetched after `load` + idle, as on the landing page
 * (index.html), so it never competes with the lesson for the first paint. Events queue in
 * dataLayer until it arrives.
 */
export function analyticsSnippet() {
  return `<script>
(function(){var h=location.hostname;var on=h==='vyact.app'||h==='www.vyact.app';
window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments);};
var plat=(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)?'pwa':'web';
window.vyTrack=function(n,p){if(on){var o=p||{};o.platform=plat;window.gtag('event',n,o);}};
if(!on)return;window.gtag('js',new Date());window.gtag('config','${GA_ID}');
function late(){var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${GA_ID}';document.head.appendChild(s);}
function idle(){if('requestIdleCallback' in window)window.requestIdleCallback(late,{timeout:3000});else window.setTimeout(late,1500);}
if(document.readyState==='complete')idle();else window.addEventListener('load',idle,{once:true});})();
</script>`;
}

// The visitor's saved app theme, applied before first paint (same key as the app; see
// scripts/landingHtml.mjs). Without one, the stylesheet's :root default (Nocturne) applies.
const THEME_BOOT = `<script>(function(){try{var t=localStorage.getItem('vt_theme')||localStorage.getItem('ff_theme');if(!t)return;t=t.replace(/"/g,'');var r=document.documentElement;if(t==='system'){var d=matchMedia('(prefers-color-scheme: dark)').matches;r.classList.toggle('dark',d);r.dataset.theme=d?'dark':'warm';}else{r.classList.toggle('dark',t==='dark');r.dataset.theme=t;}}catch(e){}})();</script>`;

const FONTS = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Inter:wght@400;500;600&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap';

// Learn-only styles. Everything else is the app's own classes from /site.css.
const CSS = `
body{margin:0;background:var(--canvas);color:hsl(var(--ink));font-family:Inter,system-ui,sans-serif;line-height:1.6;-webkit-text-size-adjust:100%}
.lx-body a{color:hsl(var(--coral))}
.lx-body h1{font-family:var(--ff-serif);font-weight:600;letter-spacing:.01em;font-size:clamp(2rem,4.2vw,3rem);line-height:1.1;margin:.6rem 0 .9rem;color:hsl(var(--ink))}
.lx-body h2{font-family:var(--ff-serif);font-weight:600;font-size:clamp(1.35rem,2.4vw,1.75rem);line-height:1.2;margin:2.6rem 0 1rem;color:hsl(var(--ink))}
.lx-body h2 a{color:inherit;text-decoration:none}
.kicker{font:500 .62rem/1.4 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:hsl(var(--coral))}
.kicker a{color:inherit;text-decoration:none}
.lede{font-size:1.08rem;line-height:1.75;color:hsl(var(--ink-mid));max-width:46rem;margin:0 0 1.4rem}
.meta{color:hsl(var(--ink-dim));font-size:.85rem;margin:-.3rem 0 1.4rem}
.card{background:hsl(var(--bg3));border:1px solid hsl(var(--line));border-radius:18px;padding:28px 30px;max-width:46rem}
.card p,.card li{font-size:1.04rem;line-height:1.8;color:hsl(var(--ink-mid))}
.card p{margin:0 0 1rem}.card p:last-child{margin-bottom:0}.card strong{color:hsl(var(--ink))}
.card h2{margin:1.6rem 0 .6rem;font-size:1.25rem}
.tags{margin:1.2rem 0 0;display:flex;flex-wrap:wrap;gap:6px}
.tag{font:.72rem "JetBrains Mono",ui-monospace,monospace;color:hsl(var(--ink-dim));border:1px solid hsl(var(--line));border-radius:999px;padding:3px 10px}
.grid{display:grid;gap:12px;margin:0 0 8px}
@media(min-width:640px){.grid.two{grid-template-columns:1fr 1fr}}
@media(min-width:1024px){.grid.two{grid-template-columns:1fr 1fr 1fr}}
.item{display:block;background:hsl(var(--bg3));border:1px solid hsl(var(--line));border-radius:14px;padding:16px 18px;text-decoration:none;transition:border-color .15s}
.lx-body .item{color:hsl(var(--ink))}
.item:hover{border-color:hsl(var(--coral))}.item .t{font-weight:600;font-size:.98rem;line-height:1.35}.item .d{color:hsl(var(--ink-mid));font-size:.88rem;line-height:1.55;margin-top:4px}
.pill{display:inline-block;margin:0 8px 10px 0;padding:7px 14px;border-radius:999px;background:hsl(var(--bg3));border:1px solid hsl(var(--line));text-decoration:none;font-weight:500;font-size:.9rem}
.lx-body .pill{color:hsl(var(--ink))}.pill:hover,.pill[aria-current]{border-color:hsl(var(--coral))}
.answer{margin:0 0 26px;padding:18px 22px;border-radius:16px;background:hsl(var(--bg3));border:1px solid hsl(var(--line));border-left:4px solid hsl(var(--coral));max-width:46rem}
.answer p{margin:.4rem 0 0;font-size:1.08rem;line-height:1.7;color:hsl(var(--ink))}
.try{margin:28px 0;padding:22px 24px;border-radius:18px;background:color-mix(in srgb,hsl(var(--coral)) 12%,transparent);border:1px solid color-mix(in srgb,hsl(var(--coral)) 35%,transparent);max-width:46rem}
.try p{margin:0 0 12px;color:hsl(var(--ink))}
.try p.demo{margin:14px 0 0;font-size:.9rem;color:hsl(var(--ink-mid))}.try p.demo a{color:hsl(var(--coral));font-weight:600}
.cta{display:inline-block;background:var(--accent);color:var(--accent-ink);text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px;box-shadow:var(--neu-sm)}
.lx-body .cta{color:var(--accent-ink)}.cta:hover{filter:brightness(1.05)}
.source{font-size:.85rem;color:hsl(var(--ink-dim));margin-top:14px}
.video{position:relative;display:block;max-width:300px;aspect-ratio:9/16;margin:0 0 20px;border-radius:18px;overflow:hidden;background:#000;border:1px solid hsl(var(--line))}
.video img{width:100%;height:100%;object-fit:cover;opacity:.85}
.video span{position:absolute;inset:auto 0 0 0;padding:14px;color:#fff;font-weight:600;background:linear-gradient(transparent,rgba(0,0,0,.75))}
.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.lesson{display:grid;gap:28px}
@media(min-width:1024px){.lesson.has-video{grid-template-columns:minmax(0,1fr) 300px;align-items:start}.lesson.has-video .video{order:2;position:sticky;top:24px}}
.sticky{display:none}
@media(max-width:640px){.sticky{display:flex;position:fixed;left:12px;right:12px;bottom:12px;z-index:5;align-items:center;justify-content:space-between;gap:10px;background:var(--elevated);color:hsl(var(--ink));border:1px solid hsl(var(--line));border-radius:16px;padding:10px 12px 10px 16px;box-shadow:var(--neu);font-size:.9rem}
.sticky a{background:var(--accent);color:var(--accent-ink);text-decoration:none;font-weight:600;padding:9px 14px;border-radius:999px;white-space:nowrap}.lx-nav-secondary{display:none}.lx{padding-bottom:88px}}
`;

// The app's pip (components/layout/Brand.tsx), as static SVG. `id` keeps gradients unique.
const pip = (size, id) => `<svg viewBox="0 0 36 36" width="${size}" height="${size}" aria-hidden="true"><defs><radialGradient id="${id}" cx="50%" cy="40%" r="60%"><stop offset="0%" stop-color="#F4B6A8"/><stop offset="100%" stop-color="#E26D5C"/></radialGradient></defs><path d="M18 3 C 27 3, 33 9, 33 18 C 33 27, 27 33, 18 33 C 9 33, 3 27, 3 18 C 3 9, 9 3, 18 3 Z" fill="url(#${id})" stroke="#2A2522" stroke-width="1.2"/><ellipse cx="13" cy="16" rx="1.4" ry="1.8" fill="#2A2522"/><ellipse cx="23" cy="16" rx="1.4" ry="1.8" fill="#2A2522"/><circle cx="9.5" cy="20" r="1.6" fill="#F4B6A8" opacity="0.8"/><circle cx="26.5" cy="20" r="1.6" fill="#F4B6A8" opacity="0.8"/><path d="M14 22 Q 18 25, 22 22" stroke="#2A2522" stroke-width="1.2" fill="none" stroke-linecap="round"/><path d="M18 3 Q 16 -1, 14 1 Q 17 3, 18 3 Z" fill="#85A88A" stroke="#2A2522" stroke-width="0.8"/></svg>`;

// Header and footer: the landing page's (LandingView.tsx), class for class.
const header = ctaHref => `<header class="border-b border-line">
<div class="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between">
<a href="${BASE}/" class="flex items-center gap-2" aria-label="Vyact home" style="text-decoration:none">${pip(30, 'pip-h')}<div><div class="display-italic text-lg text-ink leading-none">Vyact</div><div class="font-mono text-[0.55rem] tracking-[0.14em] uppercase text-coral">Family budget app</div></div></a>
<nav class="flex items-center gap-4" aria-label="Main"><a href="${BASE}/learn" class="text-[0.85rem] font-medium text-ink-mid hover:text-ink" style="text-decoration:none">Learn</a><a href="/auth/sign-in" class="lx-nav-secondary text-[0.85rem] font-medium text-ink-mid hover:text-ink" style="text-decoration:none">Sign in</a><a href="${esc(ctaHref)}" data-cta="nav" class="btn-primary px-5 py-2.5 text-[0.9rem] font-semibold rounded-full" style="text-decoration:none">Open app</a></nav>
</div>
</header>`;

const footer = `<footer class="border-t border-line">
<div class="max-w-5xl mx-auto px-5 py-8 flex flex-wrap justify-between gap-6">
<div><div class="flex items-center gap-2 mb-1.5">${pip(22, 'pip-f')}<div><div class="display-italic text-base text-ink leading-none">Vyact</div><div class="font-mono text-[0.5rem] tracking-[0.14em] uppercase text-coral">Family budget app</div></div></div>
<p class="text-[0.8rem] text-ink-dim">Your household’s money, understood together.</p>
<p class="text-[0.75rem] text-ink-dim mt-2">Lessons are educational, not individual financial advice.</p></div>
<div class="text-right"><a href="${esc(signUpUrl('learn_footer', '/dashboard'))}" data-cta="footer" class="text-[0.85rem] font-medium text-coral hover:underline" style="text-decoration:none">Open Vyact →</a>
<p class="text-[0.8rem] text-ink-dim mt-1">Budgets, bills, splits and net worth — shared with the people you share money with.</p>
<div class="flex flex-wrap gap-x-4 gap-y-2 justify-end mt-3 text-[0.75rem] text-ink-dim"><a href="${BASE}/" class="hover:text-ink" style="color:inherit;text-decoration:none">Home</a><a href="${BASE}/about" class="hover:text-ink" style="color:inherit;text-decoration:none">About</a><a href="${BASE}/learn" class="hover:text-ink" style="color:inherit;text-decoration:none">Learn</a><a href="${BASE}/for/couples" class="hover:text-ink" style="color:inherit;text-decoration:none">For couples</a><a href="${BASE}/for/splitwise-users" class="hover:text-ink" style="color:inherit;text-decoration:none">From Splitwise</a><a href="${BASE}/for/money-owed" class="hover:text-ink" style="color:inherit;text-decoration:none">Money owed</a><a href="${BASE}/private" class="hover:text-ink" style="color:inherit;text-decoration:none">Privacy by design</a><a href="${BASE}/for/families" class="hover:text-ink" style="color:inherit;text-decoration:none">For families</a><a href="/privacy" class="hover:text-ink" style="color:inherit;text-decoration:none">Privacy</a><a href="/terms" class="hover:text-ink" style="color:inherit;text-decoration:none">Terms</a></div></div>
</div>
</footer>`;

/**
 * One page. `sticky` is the slim mobile call to action (#19): { text, href, label }.
 * `script` runs after the body (event wiring).
 */
export function page({ title, description, canonical, jsonld, body, ogType = 'website', sticky, script = '', robots }) {
  const ld = (Array.isArray(jsonld) ? jsonld : [jsonld]).filter(o => o && Object.keys(o).length)
    .map(o => `<script type="application/ld+json">${safeJsonLd(o)}</script>`).join('\n');
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${THEME_BOOT}
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${robots ? `<meta name="robots" content="${esc(robots)}">` : ''}
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="theme-color" content="#0F181B">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="Vyact">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${OG_IMAGE}">
${ld}
${analyticsSnippet()}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="${FONTS}" onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet" href="${FONTS}"></noscript>
<link rel="stylesheet" href="/site.css">
<style>${CSS}</style></head>
<body>
<div class="min-h-[100dvh] lx">
${header(sticky ? sticky.href : signUpUrl('nav'))}
<div class="lx-body max-w-5xl mx-auto px-5 pt-10 pb-16">
${body}
</div>
${footer}
</div>
${sticky ? `<div class="sticky" role="complementary"><span>${esc(sticky.text)}</span><a href="${esc(sticky.href)}" data-cta="sticky">${esc(sticky.label)}</a></div>` : ''}
<script>
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[data-cta]');if(a&&window.vyTrack)vyTrack(location.pathname.indexOf('/learn')===0?'learn_cta_click':'landing_cta_click',{placement:a.getAttribute('data-cta'),page:location.pathname});});
${script}
</script>
</body></html>`;
}
