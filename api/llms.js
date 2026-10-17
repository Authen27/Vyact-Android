// Vyact — /llms.txt and /llms-full.txt (#25, v10.49.0; v10.51.0 for AEO/GEO).
//
// Plain-text guides for AI assistants and answer engines (llmstxt.org). llms.txt: what Vyact is
// (the one standard description, #22), key facts an assistant can quote, who it is for, what it
// does, the use-case pages, and where the Learn library and its hubs are — with the lessons that
// answer common questions directly. llms-full.txt: every published lesson with its URL and a
// one-line answer, so an assistant can cite the right page without crawling 116 of them.
// Generated from the live library, so it never lists a page that does not exist.
import { BASE, topicSlug } from './_page.js';
import { readContent } from './_supabase.js';
import { demoRedirect } from './_demo.js';
import { seoFor } from './_seo.js';
import { firstSentence } from './learn.js';

// The ONE standard description (#22 — site, Play Store, LinkedIn, directories). A copy of
// STANDARD_DESCRIPTION in src/content/landingCopy.ts (this Node function cannot import the
// app's TypeScript); CON-UNIT-PUB-013 fails if the two drift. Keep it true: WhatsApp logging
// joins it when number linking is open to everyone.
export const DESCRIPTION = 'Vyact is the family budget app a household runs together. Everyone logs spending in seconds, shares budgets and bills, splits costs and plans debt payoff, and sees the same cash flow and net worth. Pip, the built-in assistant, answers questions like “can we afford it?” from the household’s own numbers. Free to start, in your own currency, with a free library of plain-English money lessons.';

// Facts an assistant can state about Vyact. Each must stay true of the live app (landingCopy.ts).
const FACTS = [
  'Category: household budgeting and money-management app (personal finance).',
  'For: couples, families, flatmates — any household that shares money — and individuals who want the full picture.',
  'Price: free to start; no credit card needed.',
  'Platforms: web at vyact.app; installable on Android and iPhone from the browser (opens like an app, with bill and budget alerts).',
  'Currency: one currency per household, chosen at setup; every amount is recorded and shown in it.',
  'Shared by design: members invited to a household each have their own login and a role (edit or view-only); a personal entry can be kept out of the shared totals.',
  'Assistant: Pip answers questions about the household’s money (e.g. “can we afford a weekend away?”) from its own budgets and balances.',
  'Data: only people invited to a household can see its numbers; data is never sold or used for advertising (see /privacy).',
];

const FEATURES = [
  'Log an expense, income, transfer or investment in a few taps.',
  'One shared budget by category, with an alert when a category reaches 80%.',
  'Recurring bills on a calendar, posted automatically or on approval.',
  'Split a bill with anyone, inside or outside the household, and settle up.',
  'Debt payoff plan: avalanche or snowball, the interest inside each loan payment (EMI), and what an extra payment saves.',
  'Cash flow for the month and net worth across cash, bank, cards, loans and investments, recorded month by month.',
  'Reports and a personal Insights feed built from the household’s own numbers.',
];

export function llmsTxt(cards) {
  const counts = {};
  for (const c of cards) counts[c.category] = (counts[c.category] || 0) + 1;
  const topics = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  // Lessons with a search-shaped question and a quick answer (#21) — the ones worth quoting first.
  const answered = cards.filter(c => c.slug && seoFor(c.slug))
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map(c => `- [${seoFor(c.slug).title}](${BASE}/learn/${c.slug})`);
  return [
    '# Vyact',
    '',
    `> ${DESCRIPTION}`,
    '',
    '## Key facts',
    '',
    ...FACTS.map(f => `- ${f}`),
    '',
    '## What Vyact does',
    '',
    ...FEATURES.map(f => `- ${f}`),
    '',
    '## Pages',
    '',
    `- [What is Vyact?](${BASE}/about): the facts, and which Vyact this is (not the open-source AI workspace of the same name)`,
    `- [Home](${BASE}/): what Vyact does and who it is for`,
    `- [Budget app for couples](${BASE}/for/couples): how couples budget and split money, and how Vyact helps`,
    `- [Family budget app](${BASE}/for/families): how families budget together with multiple users`,
    `- [Coming from Splitwise](${BASE}/for/splitwise-users): moving a household from settling up to one shared budget`,
    `- [Money owed](${BASE}/for/money-owed): keeping track of who owes you, and settling up`,
    `- [Private by design](${BASE}/private): what the household controls, and how its data is handled`,
    `- [Privacy](${BASE}/privacy): how data is handled`,
    '',
    '## Learn (free, no sign-up)',
    '',
    `- [All lessons](${BASE}/learn): ${cards.length} short, plain-English money lessons`,
    ...topics.map(t => `- [${t}](${BASE}/learn/topic/${topicSlug(t)}): ${counts[t]} lessons`),
    '',
    ...(answered.length ? ['## Start here: lessons that answer common questions', '', ...answered, ''] : []),
    '## Optional',
    '',
    `- [Every lesson with a one-line answer](${BASE}/llms-full.txt)`,
    '',
  ].join('\n');
}

/** Every lesson, grouped by topic: title, URL and a one-line answer (the #21 answer, else its first sentence). */
export function llmsFullTxt(cards) {
  const byTopic = {};
  for (const c of cards) (byTopic[c.category] ||= []).push(c);
  const topics = Object.keys(byTopic).sort((a, b) => byTopic[b].length - byTopic[a].length || a.localeCompare(b));
  return [
    '# Vyact Learn — every lesson',
    '',
    `> ${DESCRIPTION}`,
    '',
    `${cards.length} short, plain-English money lessons, free to read at ${BASE}/learn. Each line: title, URL, and the lesson's answer.`,
    '',
    ...topics.flatMap(t => [
      `## ${t}`,
      '',
      ...byTopic[t].sort((a, b) => a.title.localeCompare(b.title)).map(c => {
        const seo = seoFor(c.slug);
        return `- [${seo ? seo.title : c.title}](${BASE}/learn/${c.slug}): ${seo ? seo.answer : firstSentence(c.body_md)}`;
      }),
      '',
    ]),
  ].join('\n');
}

export default async function handler(req, res) {
  const full = String((req.query || {}).full || '') === '1';
  if (demoRedirect(res, full ? '/llms-full.txt' : '/llms.txt')) return;   // W8d (FE-PUB-05)
  let cards = [];
  try {
    cards = await readContent(`select=slug,title,category${full ? ',body_md' : ''}&format=eq.card&status=eq.published&limit=2000`);
  } catch (e) { console.error('[llms]', e && e.message); }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', cards.length ? 'public, max-age=3600, s-maxage=86400' : 'no-store');
  res.status(200).send(full ? llmsFullTxt(cards) : llmsTxt(cards));
}

