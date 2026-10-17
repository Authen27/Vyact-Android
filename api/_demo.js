// W8d (audit FE-PUB-05) — the guest demo's other addresses must not serve the public site. vercel.json's
// redirects match only the host demo.vyact.app, so vyact-demo.vercel.app still answered /learn, /for,
// /about, the sitemap and llms.txt itself: an indexable second copy of the site, reading the production
// database. The demo project builds with VYACT_DEMO=1 (also set at runtime, like the middleware's
// isDemoHost), so every public page sends its visitor to vyact.app instead, uncached and noindex.
// Underscore file: Vercel does not expose it as an endpoint.

export const PUBLIC_BASE = 'https://vyact.app';

export function isDemoBuild(env = typeof process !== 'undefined' ? process.env : {}) {
  return env.VYACT_DEMO === '1';
}

/** On the demo: redirect to the same page on vyact.app and return true (the handler stops). */
export function demoRedirect(res, publicPath, env) {
  if (!isDemoBuild(env)) return false;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.redirect(302, `${PUBLIC_BASE}${publicPath.startsWith('/') ? publicPath : `/${publicPath}`}`);
  return true;
}
