// Vyact — public positioning copy (v10.50.0).
//
// ONE source for the landing page (pages/LandingView.tsx), its build-time pre-render
// (scripts/prerender-landing.mjs → dist/landing.html) and the page's FAQPage JSON-LD, so
// the visible FAQ and the structured data can never disagree.
//
// Positioning (owner, 2026-09-29): Vyact is the money app a household runs TOGETHER, for
// any household, anywhere. Lead with what it does and who it is for. Do not lead with what
// it is not (no bank linking, no SMS, India-only) — those are not the product.
//
// Every claim here must be TRUE of the live app for a new sign-up. WhatsApp logging is not
// advertised until number linking is open to everyone (Meta business verification).

// v10.51.0 — the title and description lead with the phrases people search for in every market
// (keyword sheet, marketing #7): family budget app, budget app for couples, shared/household budget.
// v10.55.0 (#59) — the keyword map gives "/" the family cluster; couples moved to /for/couples.
export const SITE_TITLE = 'Vyact – Family Budget App & Shared Expense Tracker';

export const SITE_DESCRIPTION =
  'A shared budget app for couples and families: one household budget, bills before they’re due, split costs, ' +
  'debt payoff and net worth. Free to start.';

/** The one standard description (llms.txt, JSON-LD, store listings, directories — #22). */
export const STANDARD_DESCRIPTION =
  'Vyact is the family budget app a household runs together. Everyone logs spending in seconds, shares budgets and bills, ' +
  'splits costs and plans debt payoff, and sees the same cash flow and net worth. Pip, the built-in assistant, answers ' +
  'questions like “can we afford it?” from the household’s own numbers. Free to start, in your own currency, with a ' +
  'free library of plain-English money lessons.';

export const HERO = {
  // v10.56.0 (B3) — names the brand and its category above the brand line, for people, crawlers
  // and AI tools reading the page top-down (the H1 stays the brand line, owner decision).
  kicker: 'Vyact · the family budget app for couples and households',
  title: 'Your household deserves to understand its money.',
  lede:
    'Vyact brings your household’s spending, budgets, bills, debts and net worth into one shared picture — so everyone ' +
    'knows where the money went, what’s coming next, and what you can afford.',
  fine: 'Free to start · Share it with your household · Works on phone and desktop',
};

export const PAINS: [string, string][] = [
  ['Money is tracked in too many places.',
    'Salary in one account. Spending across cards and apps. Investments somewhere else. Debt in your head. No single picture of what’s actually happening.'],
  ['The month ends and you’re not sure where it went.',
    'You earned well. You didn’t splurge. And yet the balance doesn’t reflect it. The leak is somewhere; you just can’t see it.'],
  ['Knowing your net worth shouldn’t require a spreadsheet.',
    'Assets, loans, cards, investments — the one number that tells you whether you’re ahead should be a tap away, not a Sunday afternoon calculation.'],
];

export const PILLARS: [string, string][] = [
  ['Track', 'Log every expense, income, transfer and investment against the account it moved, in a few taps. Your balances stay real, always.'],
  ['Understand', 'Reports and a personal Insights feed turn your own numbers into plain English: what changed, what’s on track, and what needs a look.'],
  ['Plan', 'Set monthly and annual budgets by category, schedule recurring bills, and see what’s already committed before the month starts.'],
  ['Build', 'Watch your net worth grow as you pay down debt and add to savings and investments — recorded month by month.'],
];

export const PIP = {
  title: 'Ask Pip before you spend.',
  body:
    'Can we afford a weekend away? Is the grocery budget on track? What did we spend on eating out last month? Pip answers ' +
    'from your household’s own budgets and balances, with the actual figures, and tells you plainly when something is tight.',
  examples: ['Can we afford a new phone this month?', 'How much is left in the food budget?', 'What did we spend on travel last month?'],
  caption: 'Example questions — Pip answers from your own household once you start recording.',
};

export const INSIGHTS = {
  title: 'Your money, explained back to you.',
  body:
    'Vyact’s Insights feed is built from your own numbers — not generic tips, not sponsored content. When dining out runs well ' +
    'above your usual, Vyact notices. When you stay under budget three months running, Vyact says so. The feedback a good ' +
    'advisor would give you, from your actual numbers.',
  examples: ['Dining out is 40% higher than last month.', 'You’re on track for your savings goal this month.', 'Subscriptions ran 18% over budget.'],
  caption: 'Example household, not your data.',
};

/** Who it is for — the use cases (bottom of the page). */
export const USE_CASES: [string, string][] = [
  ['Couples running one home', 'One budget, one set of bills, one honest picture — and nobody keeping the whole thing in their head.'],
  ['Families with growing costs', 'School fees, activities, festivals and holidays planned ahead, so the big months stop being surprises.'],
  ['Flatmates and shared bills', 'Split rent, groceries and utilities with anyone — even people outside your household — and settle up without spreadsheets.'],
  ['Paying off debt faster', 'Loans and cards side by side, a payoff order you choose, and the months an extra payment saves.'],
  ['Saving for something big', 'A trip, a wedding, a home deposit: budget for it, track it, and ask Pip whether this month can take it.'],
  ['Wherever you live', 'Your household works in its own currency, on phone and desktop, with everyone seeing the same numbers.'],
];

/** Everything it does — the feature list (bottom of the page). */
export const FEATURES: [string, string][] = [
  ['Log in seconds', 'Add an expense, income, transfer or investment from your phone in a few taps.'],
  ['Shared budgets with alerts', 'One budget for the whole household, split by category, with an alert when a category reaches 80%.'],
  ['Bills that don’t slip', 'Recurring bills post themselves or wait for your approval, with a calendar of what’s due.'],
  ['Split with anyone', 'Share a bill with people inside or outside your household, see who owes what, and settle up.'],
  ['A debt payoff plan', 'Avalanche or snowball, the interest inside every EMI, and what an extra payment does to your end date.'],
  ['Cash flow and net worth', 'This month’s cash flow and your net worth across cash, bank, cards, loans and investments.'],
  ['Pip, your money assistant', 'Ask about your money in plain English and get answers from your own figures.'],
  ['Everyone on the same page', 'Invite your partner and family, choose who can edit or just view, and keep personal spending out of the shared totals.'],
];

/** v10.57.0 (B18) — "Learn money in 60 seconds": three Shorts from youtube.com/@askvyact, each
 *  with its lesson. Thumbnails only (lazy, no YouTube player on the page), so the landing stays fast. */
export const SHORTS: { id: string; slug: string; title: string }[] = [
  { id: 'DzgUnupPTf8', slug: 'ev-003-the-50-30-20-starting-point', title: 'What is the 50/30/20 rule?' },
  { id: 'DMv1S-9y8Fs', slug: 'ev-021-how-big-is-enough', title: 'How big should your emergency fund be?' },
  { id: '0_b0iSIgZEM', slug: 'ev-027-avalanche-vs-snowball', title: 'Debt avalanche or snowball?' },
];
export const YOUTUBE_CHANNEL = 'https://www.youtube.com/@askvyact';

/** v10.57.0 (B20) — the guest demo: the app on a demo household, no account, nothing saved to one. */
export const DEMO_URL = 'https://demo.vyact.app/dashboard';

/** Featured lessons (bottom of the page) — globally relevant picks from the live library. */
export const LESSONS: { slug: string; title: string; topic: string }[] = [
  { slug: 'ev-002-pay-yourself-first', title: 'Pay yourself first', topic: 'Saving' },
  { slug: 'ev-003-the-50-30-20-starting-point', title: 'The 50-30-20 starting point', topic: 'Saving' },
  { slug: 'ev-019-what-an-emergency-fund-really-is', title: 'What an emergency fund really is', topic: 'Saving' },
  { slug: 'ev-027-avalanche-vs-snowball', title: 'Avalanche vs snowball', topic: 'Debt' },
  { slug: 'ev-041-a-budget-is-a-plan-not-a-punishment', title: 'A budget is a plan, not a punishment', topic: 'Budgeting' },
  { slug: 'ev-073-cash-flow-vs-net-worth', title: 'Cash flow vs net worth', topic: 'Net Worth' },
  { slug: 'ev-106-the-monthly-money-date', title: 'The monthly money date', topic: 'Household' },
  { slug: 'ev-055-compounding-the-eighth-wonder', title: 'Compounding, the eighth wonder', topic: 'Investing' },
];

export const FAQ: [string, string][] = [
  ['What is Vyact?', STANDARD_DESCRIPTION],
  ['Who is Vyact for?',
    'Any household that shares money: couples, families, flatmates, or anyone managing money alone who wants the full picture. Everyone you invite works from the same budgets, bills and totals.'],
  ['Is Vyact free?', 'Yes — Vyact is free to start and needs no credit card. The money lessons are free to read without an account.'],
  ['Can my partner and family use it together?',
    'Yes. Invite them to your household and choose who can edit and who can only view. Everyone sees the same entries, budgets and totals, and an entry marked “Exclude from totals” stays visible but is left out of the shared totals.'],
  ['Can I split a bill with someone outside my household?',
    'Yes. Share a bill by email with friends or flatmates. Once they join Vyact they see their share and can mark it settled, and your own totals only ever count your part.'],
  ['What can I ask Pip?',
    'Ask things like “can we afford a weekend away?”, “how much is left in the grocery budget?” or “what did we spend on travel last month?”. Pip answers from your household’s own figures, not guesses.'],
  ['Which currency does Vyact use?', 'Your household’s own. Choose it when you set up; every amount in the household is recorded and shown in that one currency.'],
  ['Does it work on my phone?', 'Yes. Vyact runs in any modern browser and can be added to your home screen on Android and iPhone, where it opens like an app and can send bill and budget alerts.'],
  ['Who can see my household’s data?', 'Only the people you invite to your household, with the access you give them. Your data is never sold or used for advertising, and the privacy policy explains exactly what is stored and why.'],
];
