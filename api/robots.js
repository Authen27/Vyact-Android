// Vyact — robots.txt (v9.5.5; v10.51.0 names the AI crawlers and fences off the app).
//
// The public site — "/", /for/*, /learn/*, /privacy, /terms, /cookies, /llms.txt — is open to
// every crawler, and the AI search and assistant crawlers are named explicitly and welcomed (GEO:
// being quotable by ChatGPT, Claude, Perplexity, Gemini, Copilot and Apple is the goal). The signed-in
// app screens are client-side shells with no public content, and /api is plumbing, so crawlers are
// kept out of them to spend their budget on real pages. A crawler that matches a named group IGNORES
// the "*" group, so the named crawlers share ONE group with "*" (several User-agent lines, one set
// of rules) rather than getting groups of their own.

import { isDemoBuild } from './_demo.js';

const BASE = 'https://vyact.app';

/** App-only paths: SPA shells with nothing public to index. */
export const PRIVATE_PATHS = [
  '/api/', '/auth/', '/landing.html',
  '/dashboard', '/transactions', '/budgets', '/recurring', '/debts', '/accounts', '/networth',
  '/reports', '/insights', '/splits', '/households', '/settings', '/help', '/chat', '/onboarding',
];

/** AI search / assistant / training crawlers, welcomed by name. */
export const AI_CRAWLERS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',              // OpenAI
  'ClaudeBot', 'Claude-SearchBot', 'Claude-User',          // Anthropic
  'PerplexityBot', 'Perplexity-User',                      // Perplexity
  'Google-Extended', 'Applebot', 'Applebot-Extended',      // Gemini, Apple Intelligence / Siri
  'Bingbot', 'DuckAssistBot', 'CCBot', 'Meta-ExternalAgent', 'MistralAI-User',
];

export function robotsTxt() {
  // ONE group with every user-agent line (RFC 9309 §2.1): each named crawler gets exactly the
  // same rules as "*", with no copies to drift apart.
  return [
    '# Vyact — the family budget app a household runs together. Public: /, /about, /for/*, /private, /learn/*, /llms.txt.',
    '# AI assistants and search engines are welcome to read and cite the public pages.',
    '',
    'User-agent: *',
    ...AI_CRAWLERS.map(a => `User-agent: ${a}`),
    'Allow: /',
    ...PRIVATE_PATHS.map(p => `Disallow: ${p}`),
    '',
    `Sitemap: ${BASE}/sitemap.xml`,
    '',
  ].join('\n');
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  // W8d (audit FE-PUB-05): the guest demo is not a site to crawl — every path is disallowed there.
  if (isDemoBuild()) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send('User-agent: *\nDisallow: /\n');
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(200).send(robotsTxt());
}
