// Vyact — /about, "What is Vyact?" (v10.56.0, master to-do B3 / CMO #79).
//
// The page search engines and AI assistants can quote when someone asks what Vyact is. It states
// the facts plainly, says which Vyact this is (another product — an open-source local AI
// workspace — shares the name, and AI summaries have mixed the two up), and carries the one
// Organization entity every other page references by @id (api/_brand.js). Every fact must stay true
// of the live product; the only alias is "Vyact app" (owner rule).

import { BASE, esc, page, signUpUrl } from './_page.js';
import { demoRedirect } from './_demo.js';
import { organization, ORG_ID, APP_ID, DISAMBIGUATION } from './_brand.js';
import { DESCRIPTION } from './llms.js';

export const FACTS = [
  ['What it is', 'A family budget app: a shared money app for couples and households.'],
  ['What it does', 'Shared budgets, bills on a calendar, split costs, debt payoff, cash flow and net worth, and Pip — an assistant that answers questions from your own numbers.'],
  ['Who it is for', 'Any household that shares money: couples, families, flatmates, or anyone managing money alone.'],
  ['Where it works', 'In any modern browser on phone or desktop; it can be added to the home screen and opens like an app.'],
  ['Price', 'Free to start, no credit card.'],
  ['Currency', 'Your household’s own currency.'],
  ['Website', 'vyact.app'],
  ['Contact', 'support@vyact.app'],
];

export const FAQ = [
  ['What is Vyact?', DESCRIPTION],
  ['Is Vyact the open-source AI workspace called Vyact?', 'No. Vyact at vyact.app is a family budget app for couples and households. The open-source local AI workspace that shares the name is a separate, unrelated project.'],
  ['Is Vyact free?', 'Yes — Vyact is free to start and needs no credit card. The money lessons are free to read without an account.'],
  // Owner, 2 Oct 2026: name the maker as an engineer from IIT.
  ['Who makes Vyact?', 'Vyact is built by an engineer from IIT (Indian Institute of Technology) and run independently. You can reach the team at support@vyact.app.'],
  ['Is my household’s data sold?', 'No. Your household’s data is never sold or used for advertising. Only the people you invite can see it.'],
];

export function aboutPage() {
  const url = `${BASE}/about`;
  const cta = signUpUrl('about', '/dashboard');
  const jsonld = [
    organization(DESCRIPTION),
    {
      '@context': 'https://schema.org', '@type': 'AboutPage', url, name: 'What is Vyact?',
      description: DISAMBIGUATION, mainEntity: { '@id': ORG_ID }, about: { '@id': APP_ID },
    },
    {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
  ];
  const body = `<main>
<div class="kicker"><a href="${BASE}/">Vyact</a> · About</div>
<h1>What is Vyact?</h1>
<section class="answer" aria-label="Quick answer"><div class="kicker">Quick answer</div><p>${esc(DESCRIPTION)}</p></section>
<p>${esc(DISAMBIGUATION)}</p>
<h2>Vyact at a glance</h2>
<dl class="grid two">${FACTS.map(([k, v]) => `<div class="item"><dt class="t">${esc(k)}</dt><dd class="d" style="margin:4px 0 0">${esc(v)}</dd></div>`).join('')}</dl>
<h2>Questions</h2>
${FAQ.map(([q, a]) => `<details class="item" style="margin-bottom:10px"><summary class="t" style="cursor:pointer">${esc(q)}</summary><p class="d">${esc(a)}</p></details>`).join('')}
<div class="try"><p>Set up your household in two minutes — free to start.</p><a class="cta" href="${esc(cta)}" data-cta="try">Open Vyact →</a></div>
<p><a href="${BASE}/for/couples">For couples</a> · <a href="${BASE}/for/families">For families</a> · <a href="${BASE}/private">Private by design</a> · <a href="${BASE}/learn">Free money lessons</a></p>
</main>`;
  return page({
    title: 'What is Vyact? The Family Budget App for Households',
    description: 'Vyact is a family budget app for couples and households: shared budgets, bills, split costs, debt payoff and net worth. Free to start. Not related to the open-source AI workspace of the same name.',
    canonical: url, jsonld, body,
    sticky: { text: 'The family budget app', label: 'Get started', href: signUpUrl('about_sticky', '/dashboard') },
  });
}

export default function handler(req, res) {
  if (demoRedirect(res, '/about')) return;   // W8d (FE-PUB-05)
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800');
  res.status(200).send(aboutPage());
}
