// Vyact — Vercel Routing Middleware (v10.49.0; v10.50.0 serves the restored landing; v10.56.0 404s).
//
// "/" is served from dist/landing.html: the app's own landing page (the Aurora brand page),
// pre-rendered at build time by scripts/prerender-landing.mjs, so crawlers, social scrapers
// and AI tools get the full page as HTML and visitors see it before the app script loads.
// A vercel.json rewrite cannot do this: "/" already matches the static index.html, and
// static files win over rewrites. Middleware runs before the filesystem.
//
// v10.56.0 (master to-do B3) — unknown paths get a real 404. Before, any made-up URL ("/about",
// a typo, an old link) answered 200 with the app shell and the generic title, so search engines and
// AI tools could index a thin duplicate "Vyact" page per URL. Now only the app's own routes reach
// the app shell; every other path (outside the public pages vercel.json serves) is a noindex 404.
// APP_SEGMENTS must list every top-level route the app has — publicPages.test.ts (PUB-020) checks
// it against App.tsx and lib/formRoutes.ts so a new route can't be 404'd by accident.
//
// The installed app is unaffected: its service worker answers navigations from the app shell.

/** First path segments the single-page app serves (App.tsx routes, form routes, auth, legal). */
export const APP_SEGMENTS = new Set([
  'dashboard', 'transactions', 'budgets', 'recurring', 'debts', 'accounts', 'networth', 'reports',
  'insights', 'splits', 'households', 'settings', 'help', 'chat', 'planner', 'onboarding',
  'auth', 'invite', 'privacy', 'terms', 'cookies',
]);
// W6 (audit FE-UIS-12): `/__e2e_error` (a page that always throws, for Lane A's 'test'-mode build)
// is not routed in production, so it is a real 404 here.

/** Public pages served by vercel.json rewrites (api/*) — let them through. */
export const PUBLIC_PATHS = new Set(['/about', '/private', '/sitemap.xml', '/robots.txt', '/llms.txt', '/llms-full.txt']);

// Skip api, assets, icons, .well-known, the REAL Learn and /for routes (one segment each, as vercel.json
// rewrites them) and real static files. W8d (audit FE-PUB-06): it used to skip every learn/ and for/ path
// and anything with a dot, so "/learn/a/b", "/for/x/y" or "/wp-login.php" fell through to the app shell
// and answered 200 — a soft 404 a crawler could index. Those now reach routeFor and get the 404 page.
export const config = {
  matcher: ['/((?!api/|assets/|icons/|\\.well-known/|learn/?$|learn/topic/[^/]+$|learn/[^/]+$|for/[^/]+$|.*\\.(?:js|mjs|css|html|png|jpe?g|webp|gif|svg|ico|txt|xml|json|webmanifest|woff2?|ttf|map|pdf|mp4|webm)$).*)'],
};

/** What the middleware decides for a path: 'landing' | 'next' | 'not-found'. */
export function routeFor(pathname) {
  if (pathname === '/' || pathname === '') return 'landing';
  if (PUBLIC_PATHS.has(pathname)) return 'next';
  const seg = pathname.split('/')[1] || '';
  if (seg === 'v') return 'next';   // v10.57.0 — video short links (/v/<n>, api/v.js)
  return APP_SEGMENTS.has(seg) ? 'next' : 'not-found';
}

const NOT_FOUND = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · Vyact</title><meta name="robots" content="noindex"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#0F181B;color:#E6EFEC;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px}a{color:#E26D5C}</style></head>
<body><main><h1 style="font-weight:600">Page not found</h1><p>Vyact is the family budget app for couples and households.</p>
<p><a href="/">Go to the home page</a> · <a href="/learn">Free money lessons</a> · <a href="/auth/sign-in">Sign in</a></p></main></body></html>`;

/** v10.57.0 (B20) — the guest demo. Its "/" opens the demo household, not the landing page.
 *  v10.57.1 — any host of the demo project (VYACT_DEMO=1, e.g. vyact-demo.vercel.app), not only
 *  demo.vyact.app, so no address of the demo serves a second copy of the landing page. */
export function isDemoHost(hostname, env = typeof process !== 'undefined' ? process.env : {}) {
  return hostname === 'demo.vyact.app' || env.VYACT_DEMO === '1';
}

export default function middleware(request) {
  const url = new URL(request.url);
  if (isDemoHost(url.hostname) && (url.pathname === '/' || url.pathname === '')) {
    return Response.redirect(new URL(`/dashboard${url.search}`, url.origin).toString(), 302);
  }
  const route = routeFor(url.pathname);
  if (route === 'landing') {
    // Keep ?ref= and other query parameters: the page's script reads them like any app route.
    const target = new URL(`/landing.html${url.search}`, url.origin);
    return new Response(null, { headers: { 'x-middleware-rewrite': target.toString() } });
  }
  if (route === 'next') return new Response(null, { headers: { 'x-middleware-next': '1' } });
  return new Response(NOT_FOUND, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex', 'cache-control': 'public, max-age=300' },
  });
}
