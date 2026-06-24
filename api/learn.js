// Vyact — public, server-rendered Learn microsite (Insights Hub v9.5.5).
//
// Social scrapers and AI crawlers don't run the SPA's JS, so the shareable +
// indexable surface for the evergreen library is rendered HERE, server-side:
//   /learn            → the library index (SEO hub, ItemList JSON-LD)
//   /learn/<slug>      → one lesson with OG/Twitter meta + Article JSON-LD
// Content is public educational material (no user data). Reads published
// format='card' rows from Supabase via the public anon key (RLS allows it).

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://dmxqkvploojokffuhxnz.supabase.co';
const ANON = process.env.VITE_SUPABASE_ANON_KEY || '';
const BASE = 'https://vyact-twentyx.vercel.app';
const APP = `${BASE}/insights`;
const OG_IMAGE = `${BASE}/og-vyact.png`;

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function sb(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/content_items?${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return r.json();
}

const SEL = 'select=slug,title,category,body_md,tags,reading_seconds';
const metaDesc = body => {
  const t = String(body || '').replace(/\s+/g, ' ').trim();
  return t.length > 155 ? t.slice(0, 152).trimEnd() + '…' : t;
};

function shell({ title, description, canonical, jsonld, body, ogType = 'website' }) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" href="/favicon.svg">
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
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<style>
:root{--coral:#E26D5C;--ink:#2A2522;--mid:#6B6259;--dim:#9A9087;--cream:#F5EFE6;--bone:#FBF7EE;--line:#E7DFD2}
*{box-sizing:border-box}body{margin:0;font-family:Inter,Segoe UI,system-ui,sans-serif;color:var(--ink);background:var(--cream);line-height:1.6}
.bar{height:6px;background:var(--coral)}
header,main,footer{max-width:720px;margin:0 auto;padding:0 22px}
header{display:flex;align-items:center;gap:10px;padding-top:22px}
.logo{width:30px;height:30px}.brand{font-family:Georgia,serif;font-style:italic;font-size:1.5rem;font-weight:600}
.brand a{color:var(--ink);text-decoration:none}
.cat{font:600 .62rem/1 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
h1{font-family:Georgia,serif;font-style:italic;font-size:2.1rem;line-height:1.15;margin:.4rem 0 .2rem}
.meta{color:var(--dim);font-size:.85rem;margin-bottom:1.4rem}
.card{background:var(--bone);border:1px solid var(--line);border-radius:16px;padding:24px 26px}
.card p{font-size:1.02rem;margin:0 0 1rem}
.tags{margin:1.2rem 0 0;display:flex;flex-wrap:wrap;gap:6px}
.tag{font:.7rem ui-monospace,monospace;color:var(--mid);background:#fff;border:1px solid var(--line);border-radius:999px;padding:3px 9px}
.cta{display:inline-block;margin:22px 0;background:var(--coral);color:#fff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:10px}
.grid{display:grid;gap:10px;margin:10px 0 30px}
.item{display:block;background:var(--bone);border:1px solid var(--line);border-radius:12px;padding:14px 16px;text-decoration:none;color:var(--ink)}
.item:hover{border-color:var(--coral)}.item .t{font-weight:600}.item .c{font:600 .58rem/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}
footer{color:var(--dim);font-size:.8rem;padding:30px 22px 50px}
a{color:var(--coral)}
</style></head>
<body><div class="bar"></div>
<header>
<svg class="logo" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="p" cx="50%" cy="40%" r="60%"><stop offset="0%" stop-color="#F4B6A8"/><stop offset="100%" stop-color="#E26D5C"/></radialGradient></defs><circle cx="18" cy="18" r="15" fill="url(#p)" stroke="#2A2522" stroke-width="1.2"/><ellipse cx="13" cy="16" rx="1.4" ry="1.8" fill="#2A2522"/><ellipse cx="23" cy="16" rx="1.4" ry="1.8" fill="#2A2522"/><path d="M14 22 Q 18 25, 22 22" stroke="#2A2522" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>
<div class="brand"><a href="${APP}">Vyact</a></div>
</header>
${body}
<footer>© Vyact — family finance, made legible. Educational content; not individual financial advice.</footer>
</body></html>`;
}

function lessonPage(c) {
  const url = `${BASE}/learn/${c.slug}`;
  const description = metaDesc(c.body_md);
  const paragraphs = String(c.body_md || '').split(/\n\n+/).map(p => `<p>${esc(p)}</p>`).join('');
  const tags = (c.tags || []).map(t => `<span class="tag">#${esc(t)}</span>`).join('');
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': ['Article', 'LearningResource'],
    headline: c.title,
    description,
    articleSection: c.category,
    keywords: (c.tags || []).join(', '),
    inLanguage: 'en',
    isAccessibleForFree: true,
    learningResourceType: 'concept explainer',
    educationalLevel: 'beginner',
    timeRequired: `PT${c.reading_seconds || 30}S`,
    author: { '@type': 'Organization', name: 'Vyact', url: BASE },
    publisher: { '@type': 'Organization', name: 'Vyact', url: BASE, logo: { '@type': 'ImageObject', url: OG_IMAGE } },
    mainEntityOfPage: url,
    articleBody: c.body_md,
    about: { '@type': 'Thing', name: c.category + ' — personal finance' },
  };
  const breadcrumb = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Learn', item: `${BASE}/learn` },
      { '@type': 'ListItem', position: 2, name: c.category, item: `${BASE}/learn?category=${encodeURIComponent(c.category)}` },
      { '@type': 'ListItem', position: 3, name: c.title, item: url },
    ],
  };
  const body = `<main>
<div class="cat">${esc(c.category)}</div>
<h1>${esc(c.title)}</h1>
<div class="meta">${c.reading_seconds >= 60 ? Math.round(c.reading_seconds / 60) + ' min' : (c.reading_seconds || 30) + 's'} read · by Vyact</div>
<article class="card">${paragraphs}${tags ? `<div class="tags">${tags}</div>` : ''}</article>
<a class="cta" href="${APP}">Track your money with Vyact →</a>
<p><a href="${BASE}/learn">← All lessons</a></p>
</main>`;
  return shell({ title: `${c.title} · Vyact Learn`, description, canonical: url, jsonld: [jsonld, breadcrumb], body, ogType: 'article' });
}

function indexPage(cards) {
  const url = `${BASE}/learn`;
  const byCat = {};
  for (const c of cards) (byCat[c.category] ||= []).push(c);
  const sections = Object.entries(byCat).map(([cat, list]) => `
<h2 style="font-family:Georgia,serif;font-style:italic;margin:26px 0 8px">${esc(cat)}</h2>
<div class="grid">${list.map(c => `<a class="item" href="${BASE}/learn/${esc(c.slug)}"><span class="c">${esc(c.category)}</span><div class="t">${esc(c.title)}</div></a>`).join('')}</div>`).join('');
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: 'Vyact Learn — money lessons in plain English',
    description: 'A free library of short personal-finance lessons: saving, budgeting, debt, EMIs, SIPs, investing, net worth and money mindset — for Indian households.',
    url,
    publisher: { '@type': 'Organization', name: 'Vyact', url: BASE, logo: { '@type': 'ImageObject', url: OG_IMAGE } },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: cards.length,
      itemListElement: cards.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: `${BASE}/learn/${c.slug}`, name: c.title })),
    },
  };
  const body = `<main>
<h1>Vyact Learn</h1>
<div class="meta">${cards.length} free money lessons — saving, debt, budgeting, investing & net worth, in plain English.</div>
<a class="cta" href="${APP}">Open Vyact →</a>
${sections}
</main>`;
  return shell({ title: 'Vyact Learn — free personal-finance lessons', description: 'Free, plain-English personal-finance lessons for Indian households: saving, budgeting, debt, EMIs, SIPs, investing and net worth.', canonical: url, jsonld, body });
}

export default async function handler(req, res) {
  try {
    const slug = (req.query && req.query.slug ? String(req.query.slug) : '').trim();
    if (!ANON) { res.status(500).send('Learn is temporarily unavailable.'); return; }
    if (slug) {
      const rows = await sb(`${SEL}&format=eq.card&status=eq.published&slug=eq.${encodeURIComponent(slug)}&limit=1`);
      if (!rows.length) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(404).send(shell({ title: 'Lesson not found · Vyact', description: 'This lesson could not be found.', canonical: `${BASE}/learn`, jsonld: {}, body: '<main><h1>Not found</h1><p><a href="' + BASE + '/learn">Browse all lessons →</a></p></main>' }));
        return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800');
      res.status(200).send(lessonPage(rows[0]));
      return;
    }
    const cards = await sb(`select=slug,title,category&format=eq.card&status=eq.published&order=category.asc,title.asc&limit=500`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800');
    res.status(200).send(indexPage(cards));
  } catch (e) {
    res.status(500).send('Learn is temporarily unavailable.');
  }
}
