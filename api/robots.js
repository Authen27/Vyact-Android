// Vyact — robots.txt (v9.5.5). Allows crawling and advertises the sitemap so the
// public Learn microsite is discoverable by search engines and AI crawlers.
const BASE = 'https://vyact-twentyx.vercel.app';

export default async function handler(req, res) {
  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${BASE}/sitemap.xml`,
    '',
  ].join('\n');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(200).send(body);
}
