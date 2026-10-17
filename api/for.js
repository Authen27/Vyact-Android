// Vyact — use-case landing pages: /for/couples, /for/families (v10.51.0, marketing #7).
//
// The keyword research found "budget app for couples" and "family budget app (multiple users)" live
// in every market, with no single household brand owning the results — and the landing page alone
// can't rank for both. Each page answers the query first (a 40–60-word quick answer), teaches the
// thing people search for alongside it ("how to budget as a couple", "split bills by income"), shows
// what Vyact does for that household, and ends with one call to action. Server-rendered in the app's
// theme (api/_page.js). Every product claim here is one already verified for the landing page
// (src/content/landingCopy.ts) — keep it that way.

import { BASE, esc, page, signUpUrl } from './_page.js';
import { demoRedirect } from './_demo.js';
import { seoFor } from './_seo.js';

const LESSON = (slug, fallback) => ({ slug, title: (seoFor(slug) || {}).title || fallback });

export const AUDIENCES = {
  couples: {
    title: 'Budget App for Couples – Track Expenses Together',   // v10.55.0 #59 keyword map
    description: 'A budget app for couples: one shared budget, separate logins, bills before they’re due, fair splits by income and a debt payoff plan. Free to start.',
    h1: 'The budget app for couples',
    answer: 'A good budget app for couples gives each partner their own login to the same numbers: one shared budget by category, the bills coming up, what each of you spent, and your net worth. Vyact does that, lets you keep personal spending out of the shared totals, and is free to start.',
    sections: [
      ['Three ways couples split money', [
        '**Fully joint** — all income into one pot, all costs out of it. Simplest to track; works best when you agree on spending.',
        '**Proportional to income** — each pays the same share of their income toward joint costs (for example 60/40). Feels fairer when incomes differ.',
        '**Yours, mine and ours** — a joint pot for rent, groceries and goals, plus personal money each that nobody has to justify.',
      ]],
      ['How couples use Vyact', [
        '**One budget, two logins.** Invite your partner; you both log spending into the same household and see the same totals.',
        '**Bills before payday.** Rent, subscriptions and loan payments on one calendar, posted automatically or when you approve them.',
        '**Leave things out of the totals.** Mark a purchase “Exclude from totals” and it stays out of the shared totals and charts. You both still see the entry.',
        '**A monthly money date.** Fifteen minutes: what’s coming up, how last month went, one goal. Vyact has the numbers ready.',
        '**Ask before you spend.** Pip, the built-in assistant, answers “can we afford the weekend away?” from your own budget and balances.',
      ]],
    ],
    faq: [
      ['What is the best way for couples to budget?', 'Agree the structure first — fully joint, proportional to income, or yours-mine-and-ours — then keep one shared budget you both can see and check it together once a month. The method matters less than both of you seeing the same numbers.'],
      ['Should couples split bills 50/50 or by income?', 'When incomes differ, splitting by income usually feels fairer: each partner pays the same percentage of their income toward joint costs. 50/50 works well when incomes are similar.'],
      ['Can we keep separate accounts and still budget together?', 'Yes. Add each account you spend from to the household; the shared budget and totals cover all of them, and personal purchases can be kept out of the shared totals.'],
      ['Is Vyact free for couples?', 'Yes — Vyact is free to start, and both partners can use it with their own login.'],
    ],
    lessons: [LESSON('ev-105-yours-mine-and-ours', 'Yours, mine, and ours'), LESSON('ev-106-the-monthly-money-date', 'The monthly money date'), LESSON('ev-003-the-50-30-20-starting-point', 'The 50-30-20 starting point'), LESSON('ev-021-how-big-is-enough', 'How big is “enough”?')],
    ref: 'for_couples',
  },
  families: {
    title: 'Family Expense Tracker – See Who Spent What',   // v10.55.0 #59 keyword map
    description: 'A family budget app for the whole household: everyone logs in, one shared budget, bills on a calendar, split costs and plan big expenses ahead. Free to start.',
    h1: 'The family budget app everyone can use',
    answer: 'A family budget app should let everyone who shares the household’s money use it — each with their own login and the right access — and show one budget, the bills coming up and where the money went. Vyact does that for families of any size, in your own currency, and is free to start.',
    sections: [
      ['How to budget as a family', [
        '**Start with what’s already committed** — rent or mortgage, school fees, loan payments, subscriptions — before planning anything else.',
        '**Give every category a monthly limit** and check the categories, not just the total.',
        '**Plan the predictable big costs** — festivals, holidays, insurance, school terms — by setting aside a little each month.',
        '**Review together once a month.** A short family money check-in prevents most surprises.',
      ]],
      ['How families use Vyact', [
        '**Everyone in one household.** Invite your partner, older children or parents; choose who can edit and who can only view.',
        '**One budget by category**, with an alert when a category reaches 80%.',
        '**Every bill on a calendar** — rent, fees, subscriptions and salaries — posted automatically or when you approve.',
        '**Split with people outside the home** — grandparents, flatmates, friends on a trip — and settle up; your totals count only your share.',
        '**See the big picture**: this month’s cash flow and your family’s net worth across cash, bank, cards, loans and investments.',
      ]],
    ],
    faq: [
      ['What is the best budget app for families with multiple users?', 'Look for one where every family member can have their own login to the same household, with control over who can edit, one shared budget and a view of upcoming bills. Vyact is built around exactly that, and is free to start.'],
      ['How do I make a family budget?', 'List what’s already committed each month, give the remaining categories limits, set aside monthly for predictable big costs, and review it together once a month.'],
      ['Can children use the family budget app?', 'Yes — invite older children with view-only access so they can see how the household plans, without changing anything.'],
      ['Does it work in my currency?', 'Yes. Your household works in its own currency, chosen when you set up, and every amount is recorded in it.'],
    ],
    lessons: [LESSON('ev-103-the-household-is-the-real-unit', 'The household is the real unit'), LESSON('ev-011-sinking-funds-for-big-bills', 'Sinking funds for big bills'), LESSON('ev-053-festival-and-wedding-seasons', 'Festival and wedding seasons'), LESSON('ev-047-allocate-then-watch', 'Allocate, then watch')],
    ref: 'for_families',
  },

  // v10.55.0 (#60, owner-approved 1 Oct) — from vyact-marketing/16-switching-guide-splitwise.md.
  // Consumer tone, no feature matrix, no knocking the other app.
  'splitwise-users': {
    kicker: 'Splitwise users',
    title: 'A Splitwise Alternative for Couples & Families',
    description: 'Splitwise is great for settling up. When your household wants one budget, shared bills and a picture of where the money goes, here’s how to move to Vyact.',
    h1: 'When settling up isn’t enough: run your household’s money together',
    answer: 'Keep Splitwise for trips and friends. If you share a home — rent, groceries, bills, savings — you probably want more than a running tab of who owes whom. Vyact gives your household one shared budget, the bills that are coming, and cash flow and net worth everyone can see, and you can still split a bill with anyone. Moving takes about fifteen minutes.',
    sections: [
      ['What changes when you move', [
        '**You stop keeping score and start keeping a budget.** Everyone in the household logs spending into the same place, against the account it came from, and you see the month by category.',
        '**Bills stop being surprises.** Rent, subscriptions and loan payments become recurring entries that post themselves or wait for approval, with a calendar of what’s due.',
        '**You can still split.** Share a bill with a friend or flatmate outside your household by email; they see their share and mark it settled. Your totals count only your part.',
        '**You get the big picture.** This month’s cash flow and your net worth — cash, bank, cards, loans and investments — in one view, for the whole household.',
        '**You can ask.** Pip, the built-in assistant, answers “can we afford it?” and “how much is left in the grocery budget?” from your own numbers.',
      ]],
      ['How to move in fifteen minutes', [
        '**1. Settle up in Splitwise first.** Clear open balances, or note what’s still owed.',
        '**2. Create your household in Vyact** and invite the people you share money with. Choose who can edit and who can only view.',
        '**3. Add your accounts** — the bank accounts, cards and cash you actually spend from — with today’s balances.',
        '**4. Add the bills you know are coming** as recurring entries: rent, utilities, subscriptions, loan payments.',
        '**5. Set a first budget** from last month’s real spending by category; adjust after a month.',
        '**6. Carry over what’s still owed** as a split with the person involved, so nothing is lost.',
      ]],
    ],
    faq: [
      ['Is Vyact a Splitwise alternative?', 'For a household, yes: it keeps one shared budget, upcoming bills, cash flow and net worth for everyone you live with, and it can still split a bill with people outside the household. For trips with friends, many people keep using Splitwise too.'],
      ['Can I import my Splitwise history?', 'No. You start from today’s balances, which is usually the cleaner start: settle up in Splitwise, then add your accounts and bills in Vyact.'],
      ['Can I still split costs with friends?', 'Yes. Share a bill with anyone by email; once they join, they see their share and mark it settled, and your own totals count only your part.'],
      ['Is Vyact free?', 'Yes — Vyact is free to start, and everyone you invite gets their own login.'],
    ],
    lessons: [LESSON('ev-105-yours-mine-and-ours', 'Yours, mine, and ours'), LESSON('ev-086-talk-money-with-your-household', 'Talk money with your household'), LESSON('ev-052-recurring-is-your-forecast', 'Recurring is your forecast'), LESSON('ev-104-shared-goals-shared-motivation', 'Shared goals, shared motivation')],
    ref: 'for_splitwise',
  },

  // v10.55.0 (#61, owner-approved 1 Oct). Splits only: a cost you paid that others owe you a share
  // of (or the reverse). Plain cash loans are not a feature — don't claim them.
  'money-owed': {
    kicker: 'Money owed',
    title: 'Track Money You’re Owed: Who Owes You, and How Much',
    description: 'Paid for dinner, a trip or a bill for someone else? Vyact keeps track of who owes you, who you owe, and settles it — while your budget counts only your share.',
    h1: 'Know who owes you, and how much',
    answer: 'When you pay for something shared — a dinner, a trip, a bill — record who owes you their part. Vyact keeps a running total per person of what you’re owed and what you owe, lets you mark a share paid or settle everything at once, and counts only your own share in your budget. It’s free to start.',
    sections: [
      ['How it works', [
        '**Split as you log.** Paid the whole bill? Add who shared it and how much each person owes.',
        '**One total per person.** See what each person owes you and what you owe them, netted into one figure.',
        '**Settle in a tap.** Mark one share paid, or settle everything with a person at once.',
        '**Share it with them.** Send a split by email; once they join, they see their share and can mark it settled themselves.',
        '**Your budget stays honest.** Only your own share counts toward your spending and categories.',
      ]],
      ['Good habits for money owed', [
        '**Record it the same day**, while the amounts are fresh and before anyone forgets.',
        '**Settle up regularly** — after a trip, or once a month — so small amounts don’t pile up into awkward ones.',
        '**Keep it visible to both sides**, so nobody has to remember or ask twice.',
      ]],
    ],
    faq: [
      ['How do I keep track of money people owe me?', 'Record the shared cost when you pay it, note each person’s share, and keep a running total per person. Vyact does this for you, and you can mark shares paid or settle up when the money comes back.'],
      ['Can the other person see what they owe?', 'Yes. Share the split by email; once they join, they see their share and can mark it settled.'],
      ['Does money I’m owed count as my spending?', 'No — only your own share counts toward your budget and categories.'],
      ['Is Vyact free?', 'Yes — Vyact is free to start.'],
    ],
    lessons: [LESSON('ev-086-talk-money-with-your-household', 'Talk money with your household'), LESSON('ev-105-yours-mine-and-ours', 'Yours, mine, and ours'), LESSON('ev-111-log-little-and-often', 'Log little and often'), LESSON('ev-112-reconcile-without-guilt', 'Reconcile without guilt')],
    ref: 'for_money_owed',
  },

  // v10.55.0 (#60, owner-approved 1 Oct) — from vyact-marketing/17-privacy-page.md, served at
  // /private. Leads with what Vyact does; "no bank login" is a supporting line only (owner).
  private: {
    path: '/private',
    kicker: 'Privacy',
    title: 'Private Budget App: Your Household’s Money, Your Rules',
    description: 'In Vyact your household decides what is recorded and who sees it. Everyone you invite works from the same numbers, and your data is never sold.',
    h1: 'Your household’s money, private by design',
    answer: 'In Vyact, your household decides what goes in and who sees it. You add what you choose, invite only the people you share money with, and give each of them the access they need. Nothing has to be connected to your bank to get started, and your data is never sold or used for advertising.',
    sections: [
      ['You stay in control', [
        '**You decide what’s recorded.** Every entry is one you or someone in your household added, in a few seconds from your phone.',
        '**You decide who’s in.** Invite your partner, family or flatmates, and choose who can edit and who can only view.',
        '**Leave things out of the totals.** Mark a purchase “Exclude from totals” and it stays out of the shared totals and charts. Everyone in the household still sees the entry.',
        '**Take it with you.** Download a full backup or a CSV of your transactions any time from Settings.',
      ]],
      ['Nothing to sell', [
        '**Free to start**, and your household’s data is never sold or used for advertising.',
        '**Plain rules.** The privacy policy explains exactly what is stored and why.',
      ]],
    ],
    faq: [
      ['Who can see my household’s data?', 'Only the people you invite, with the access you give them.'],
      ['Can I keep a purchase to myself?', 'Not inside a shared household: everyone in it sees every entry. Mark a purchase “Exclude from totals” to keep it out of the shared totals and charts, or keep personal money in a separate Personal household.'],
      ['Can I get my data out?', 'Yes — a full backup and a CSV export, from Settings.'],
      ['Is my data sold or used for ads?', 'No. Your household’s data is never sold or used for advertising.'],
    ],
    lessons: [LESSON('ev-111-log-little-and-often', 'Log little and often'), LESSON('ev-107-one-person-shouldn-t-hold-it-all', 'One person shouldn’t hold it all'), LESSON('ev-100-nominee-and-will-the-quiet-essentials', 'Nominee and will, the quiet essentials'), LESSON('ev-086-talk-money-with-your-household', 'Talk money with your household')],
    ref: 'for_private',
  },
};

/** Public path of a use-case page (/private is the one not under /for/). */
export const audiencePath = key => (AUDIENCES[key] && AUDIENCES[key].path) || `/for/${key}`;

/** The links between use-case pages, in one order (each page links every other one). */
const LINK_LABEL = { couples: 'For couples', families: 'For families', 'splitwise-users': 'Coming from Splitwise', 'money-owed': 'Money owed', private: 'Private by design' };

const inline = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

export function audiencePage(key) {
  const a = AUDIENCES[key];
  const url = `${BASE}${audiencePath(key)}`;
  const cta = signUpUrl(a.ref, '/dashboard');
  // v10.55.0 — every use-case page links all the others (was couples ↔ families only).
  const others = Object.keys(AUDIENCES).filter(k => k !== key)
    .map(k => `<a href="${BASE}${audiencePath(k)}">${esc(LINK_LABEL[k] || k)}</a>`).join(' · ');
  const jsonld = [
    {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: a.faq.map(([q, ans]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: ans } })),
    },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Vyact', item: `${BASE}/` },
        { '@type': 'ListItem', position: 2, name: a.h1, item: url },
      ],
    },
  ];
  const body = `<main>
<div class="kicker"><a href="${BASE}/">Vyact</a> · ${a.kicker ? esc(a.kicker) : `For ${esc(key)}`}</div>
<h1>${esc(a.h1)}</h1>
<section class="answer" aria-label="Quick answer"><div class="kicker">Quick answer</div><p>${esc(a.answer)}</p></section>
<p><a class="cta" href="${esc(cta)}" data-cta="hero">Set up your household — free →</a></p>
${a.sections.map(([h, items]) => `<h2>${esc(h)}</h2><div class="grid two">${items.map(i => `<div class="item"><div class="d" style="font-size:.95rem;color:hsl(var(--ink-mid))">${inline(i)}</div></div>`).join('')}</div>`).join('\n')}
<h2>Questions</h2>
${a.faq.map(([q, ans]) => `<details class="item" style="margin-bottom:10px"><summary class="t" style="cursor:pointer">${esc(q)}</summary><p class="d">${esc(ans)}</p></details>`).join('')}
<h2>Read next</h2>
<div class="grid two">${a.lessons.map(l => `<a class="item" href="${BASE}/learn/${esc(l.slug)}"><div class="t">${esc(l.title)}</div></a>`).join('')}</div>
<div class="try"><p>Set up your household in two minutes — free to start.</p><a class="cta" href="${esc(cta)}" data-cta="try">Open Vyact →</a></div>
<p>${others} · <a href="${BASE}/learn">Free money lessons</a> · <a href="${BASE}/">Home</a></p>
</main>`;
  return page({
    title: a.title, description: a.description, canonical: url, jsonld, body,
    sticky: { text: 'One budget for the whole household', label: 'Get started', href: signUpUrl(`${a.ref}_sticky`, '/dashboard') },
  });
}

export default function handler(req, res) {
  const key = String((req.query || {}).audience || '').toLowerCase();
  if (demoRedirect(res, key === 'private' ? '/private' : `/for/${encodeURIComponent(key)}`)) return;   // W8d (FE-PUB-05)
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!AUDIENCES[key]) {
    res.status(404).send(page({
      title: 'Page not found · Vyact', description: 'This page could not be found.', canonical: `${BASE}/`, jsonld: [], robots: 'noindex',
      body: `<main><h1>Page not found</h1><p><a href="${BASE}/">Go to Vyact →</a></p></main>`,
    }));
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800');
  res.status(200).send(audiencePage(key));
}
