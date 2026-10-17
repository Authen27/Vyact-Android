// Vyact — assembles dist/landing.html from the built index.html (v10.50.0).
//
// Pure string transform, unit-tested (publicPages.test.ts). Takes the app shell Vite built
// (same CSS, same JS, same GA gating) and gives it the landing page's own head — title,
// description, canonical, social tags, SoftwareApplication + FAQPage + Organization JSON-LD —
// and the pre-rendered markup inside #root. Every anchor it edits must exist: a changed
// index.html fails the build here instead of shipping a page without its SEO head.

import { organization, orgRef, APP_ID, BASE } from '../api/_brand.js';

export { BASE };

const safeJsonLd = o => JSON.stringify(o).replace(/</g, '\\u003c');
const attr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const text = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function landingJsonLd(copy) {
  // v10.56.0 (B3) — one Organization entity (@id), shared with Learn and /about (api/_brand.js).
  const org = organization(copy.STANDARD_DESCRIPTION);
  return [
    {
      '@context': 'https://schema.org', '@type': 'SoftwareApplication', '@id': APP_ID,
      name: 'Vyact', alternateName: 'Vyact app', url: `${BASE}/`, image: `${BASE}/og-vyact.png`, description: copy.STANDARD_DESCRIPTION,
      applicationCategory: 'FinanceApplication', operatingSystem: 'Web',   // v10.55.0 (#62): only what ships today; add Android when it does
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      publisher: orgRef,
    },
    {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: copy.FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
    org,
  ];
}

// Apply a returning visitor's saved theme before first paint (the app's own key), so a
// Mist user does not see Nocturne flash. Mirrors syncSlice.applyTheme.
const THEME_BOOT = `<script>(function(){try{var t=localStorage.getItem('vt_theme')||localStorage.getItem('ff_theme');if(!t)return;t=t.replace(/"/g,'');var r=document.documentElement;if(t==='system'){var d=matchMedia('(prefers-color-scheme: dark)').matches;r.classList.toggle('dark',d);r.dataset.theme=d?'dark':'warm';}else{r.classList.toggle('dark',t==='dark');r.dataset.theme=t;}}catch(e){}})();</script>`;

// v10.54.0 — the app bundle waits on "/" (PageSpeed mobile 69, 2 Oct 2026: ~211 KB of
// unused JavaScript, and Lighthouse scored the pre-rendered H1 as if it waited for it).
// The page is complete HTML (links are real <a href>s), so the app only adds the CTA's
// signed-in label, the feedback widget and the service worker. It boots on the first
// scroll / tap / key / wheel, or right after load when a saved session exists (so a
// signed-in visitor still gets "Go to Dashboard"). Until it is up, this script records
// CTA clicks itself; once the app is up (window.__vyLandingLive) the app's own onClick
// does, so nothing is counted twice.
const appBoot = src => `<script>(function(){var src=${JSON.stringify(src)},done=false,evs=['scroll','wheel','touchstart','pointerdown','keydown'];
function boot(){if(done)return;done=true;evs.forEach(function(e){removeEventListener(e,boot,true)});var s=document.createElement('script');s.type='module';s.crossOrigin='';s.src=src;document.head.appendChild(s);}
evs.forEach(function(e){addEventListener(e,boot,{capture:true,passive:true})});
try{for(var i=0;i<localStorage.length;i++){if(/^sb-.+-auth-token$/.test(localStorage.key(i)||'')){if(document.readyState==='complete')boot();else addEventListener('load',boot,{once:true});break;}}}catch(e){}
addEventListener('click',function(e){if(window.__vyLandingLive)return;var a=e.target&&e.target.closest&&e.target.closest('[data-cta]');if(!a||!window.gtag)return;
var p='web';try{if(matchMedia('(display-mode: standalone)').matches||navigator.standalone)p='pwa';}catch(x){}
window.gtag('event','landing_cta_click',{placement:a.getAttribute('data-cta'),page:'/',platform:p,transport_type:'beacon'});},true);})();</script>`;

function must(html, re, what) {
  if (!re.test(html)) throw new Error(`landing.html: index.html is missing ${what}`);
  return html;
}

export function landingHtml(indexHtml, markup, copy) {
  let h = indexHtml;
  // W7b (audit FE-PUB-10): a function replacement, so "$&", "$1" or "$'" in copy or markup (a price, a
  // "$" in a lesson title) is inserted as written, not expanded as a replacement pattern.
  const sub = (re, what, to) => { must(h, re, what); h = h.replace(re, () => to); };
  sub(/<title>[\s\S]*?<\/title>/, '<title>', `<title>${text(copy.SITE_TITLE)}</title>`);
  sub(/<meta name="description" content="[^"]*" \/>/, 'meta description', `<meta name="description" content="${attr(copy.SITE_DESCRIPTION)}" />`);
  sub(/<meta property="og:title" content="[^"]*" \/>/, 'og:title', `<meta property="og:title" content="${attr(copy.SITE_TITLE)}" />\n    <meta property="og:url" content="${BASE}/" />\n    <meta property="og:type" content="website" />`);
  sub(/<meta property="og:description" content="[^"]*" \/>/, 'og:description', `<meta property="og:description" content="${attr(copy.SITE_DESCRIPTION)}" />`);
  sub(/<meta name="twitter:title" content="[^"]*" \/>/, 'twitter:title', `<meta name="twitter:title" content="${attr(copy.SITE_TITLE)}" />`);
  sub(/<meta name="twitter:description" content="[^"]*" \/>/, 'twitter:description', `<meta name="twitter:description" content="${attr(copy.SITE_DESCRIPTION)}" />`);
  sub(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, 'the JSON-LD block',
    landingJsonLd(copy).map(o => `<script type="application/ld+json">${safeJsonLd(o)}</script>`).join('\n    ')
    + `\n    <link rel="canonical" href="${BASE}/" />`);
  sub(/<head>/, '<head>', `<head>\n    ${THEME_BOOT}`);
  sub(/<div id="root"><\/div>/, 'an empty #root', `<div id="root">${markup}</div>`);
  // The app bundle is not fetched during load (see appBoot): drop the entry script and
  // its modulepreloads, and boot it on interaction instead.
  const entry = /<script type="module"[^>]*\ssrc="(\/assets\/[^"]+\.js)"[^>]*><\/script>/.exec(h);
  if (!entry) throw new Error('landing.html: index.html is missing the app entry script');
  h = h.replace(entry[0], () => appBoot(entry[1])).replace(/\s*<link rel="modulepreload"[^>]*>/g, '');
  return h;
}

/** The built stylesheet's path in index.html (copied to /site.css for the Learn pages). */
export function builtCssHref(indexHtml) {
  const m = /<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"/.exec(indexHtml);
  if (!m) throw new Error('landing.html: no built stylesheet link in index.html');
  return m[1];
}
