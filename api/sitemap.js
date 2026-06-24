// Vyact — sitemap.xml for the public Learn microsite (v9.5.5).
// Lists the Learn index + every published evergreen lesson so search engines and
// AI crawlers can discover and rank the content on finance keywords/longtail.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://dmxqkvploojokffuhxnz.supabase.co';
const ANON = process.env.VITE_SUPABASE_ANON_KEY || '';
const BASE = 'https://vyact-twentyx.vercel.app';

export default async function handler(req, res) {
  let cards = [];
  try {
    if (ANON) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/content_items?select=slug,updated_at&format=eq.card&status=eq.published&order=updated_at.desc&limit=2000`, {
        headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
      });
      if (r.ok) cards = await r.json();
    }
  } catch { /* fall through to a minimal sitemap */ }

  const today = new Date().toISOString().slice(0, 10);
  const url = (loc, lastmod, priority) =>
    `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>${priority}</priority></url>`;
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    url(`${BASE}/learn`, today, '0.8') + '\n' +
    cards.map(c => url(`${BASE}/learn/${encodeURIComponent(c.slug)}`, (c.updated_at || today).slice(0, 10), '0.7')).join('\n') +
    `\n</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  res.status(200).send(body);
}
