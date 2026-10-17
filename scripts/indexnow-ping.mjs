// IndexNow ping (v10.55.0, master to-do #57) — tells Bing (and through it Copilot and DuckDuckGo,
// plus Yandex, Seznam and Naver) which public URLs changed, so they are re-crawled within hours
// instead of weeks. Google does not use IndexNow; it reads the sitemap.
//
// The key is PUBLIC by design: IndexNow verifies ownership by fetching /<key>.txt from the site
// (react/public/<key>.txt). Run it by hand after a release that changes public pages:
//
//   node scripts/indexnow-ping.mjs                 # every URL in the live sitemap
//   node scripts/indexnow-ping.mjs /private /for/money-owed   # just these paths
//
// 200 or 202 = accepted. 403 = the key file isn't live yet (deploy first). 422 = a URL isn't on vyact.app.

const HOST = 'vyact.app';
const KEY = '1ad202c3ca28f7e2c7245752d1f27eba';
const BASE = `https://${HOST}`;

async function sitemapUrls() {
  const xml = await (await fetch(`${BASE}/sitemap.xml`)).text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
}

const paths = process.argv.slice(2);
const urlList = paths.length ? paths.map(p => (p.startsWith('http') ? p : `${BASE}${p.startsWith('/') ? '' : '/'}${p}`)) : await sitemapUrls();
if (!urlList.length) { console.error('No URLs to submit.'); process.exit(1); }

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `${BASE}/${KEY}.txt`, urlList: urlList.slice(0, 10000) }),
});
console.log(`IndexNow: ${res.status} ${res.statusText} — ${urlList.length} URL(s)`);
if (res.status !== 200 && res.status !== 202) process.exit(1);
