// Vyact — sitemap.xml (v9.5.5; v10.49.0 adds the home page and the topic hubs).
// Lists the public pages search engines and AI crawlers should find: the landing page, the
// use-case pages (v10.51.0), the Learn library, one hub per topic, and every published lesson.
import { BASE, topicSlug } from './_page.js';
import { readContent } from './_supabase.js';
import { demoRedirect } from './_demo.js';

export function sitemapXml(cards, today = new Date().toISOString().slice(0, 10)) {
  const url = (loc, lastmod, priority, changefreq = 'monthly') =>
    `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
  const newest = cards.reduce((m, c) => ((c.updated_at || '') > m ? c.updated_at : m), '').slice(0, 10) || today;
  const topics = {};
  for (const c of cards) {
    const t = topicSlug(c.category);
    if (!t) continue;
    const d = (c.updated_at || today).slice(0, 10);
    if (!topics[t] || d > topics[t]) topics[t] = d;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` + [
    url(`${BASE}/`, newest, '1.0', 'weekly'),
    url(`${BASE}/about`, today, '0.8', 'monthly'),
    url(`${BASE}/for/couples`, today, '0.9', 'monthly'),
    url(`${BASE}/for/families`, today, '0.9', 'monthly'),
    url(`${BASE}/for/splitwise-users`, today, '0.8', 'monthly'),
    url(`${BASE}/for/money-owed`, today, '0.8', 'monthly'),
    url(`${BASE}/private`, today, '0.8', 'monthly'),
    url(`${BASE}/learn`, newest, '0.9', 'weekly'),
    ...Object.entries(topics).sort().map(([t, d]) => url(`${BASE}/learn/topic/${t}`, d, '0.8')),
    ...cards.map(c => url(`${BASE}/learn/${encodeURIComponent(c.slug)}`, (c.updated_at || today).slice(0, 10), '0.7')),
  ].join('\n') + '\n</urlset>';
}

export default async function handler(req, res) {
  if (demoRedirect(res, '/sitemap.xml')) return;   // W8d (FE-PUB-05)
  let cards = [];
  try {
    cards = await readContent('select=slug,category,updated_at&format=eq.card&status=eq.published&order=updated_at.desc&limit=2000');
  } catch (e) {
    console.error('[sitemap]', e && e.message);   // fall through to the static pages only
  }
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  // A sitemap missing its lessons must not be cached for a day.
  res.setHeader('Cache-Control', cards.length ? 'public, max-age=3600, s-maxage=86400' : 'no-store');
  res.status(200).send(sitemapXml(cards));
}
