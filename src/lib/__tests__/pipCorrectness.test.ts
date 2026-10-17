// W5 (v10.78.0; owner decision D29, P1–P4) — Pip's figures belong to the question asked.
//
// Audit 2026-10-04: FE-PIP-01 (an annual budget measured against one month), FE-PIP-04 (a
// negative fact sent without its minus), FE-PIP-05 (a stated period replaced by "this month"),
// FE-PIP-02 (a price the model knew, used as if the user had said it). Every figure in each case
// was real and passed the invented-figure guard; what was wrong was which question it answered.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve, runAssistant, LlmBackend, type AssistantContext } from '../askVyactBackend';
import { statedAmounts, amountIsStated } from '../askVyactParser';
import { buildSafeSummary } from '../aiSummary';
import type { ModelCall } from '../askVyactLlm';
import type { IntentResult } from '../askVyactIntents';
import type { Account, Budget, BudgetAllocation, Debt, Profile, Transaction } from '../../types';

const profile = { baseCurrency: 'INR', household: 'family', language: 'en' } as unknown as Profile;
const rates = { INR: 1 };
let n = 0;
const txn = (date: string, category: string, amount: number, type: Transaction['type'] = 'expense'): Transaction =>
  ({ id: `t${++n}`, type, amount, currency: 'INR', date, description: '', category, accountId: 'bank' } as Transaction);

function ctxFor(opts: {
  transactions?: Transaction[]; budgets?: Budget[]; allocations?: BudgetAllocation[];
  bank?: number; card?: number; debts?: Debt[];
} = {}): AssistantContext {
  const transactions = opts.transactions ?? [];
  const budgets = opts.budgets ?? [];
  const allocations = opts.allocations ?? [];
  const debts = opts.debts ?? [];
  const accounts = [
    { id: 'bank', name: 'HDFC Bank', kind: 'bank', currency: 'INR', openingBalance: opts.bank ?? 500_000 },
    { id: 'card', name: 'Axis card', kind: 'credit_card', currency: 'INR', openingBalance: -(opts.card ?? 0), creditLimit: 100_000 },
  ] as unknown as Account[];
  const summary = buildSafeSummary(transactions, budgets, [], debts, [], profile, rates, accounts, allocations);
  return {
    summary, transactions, budgets, budgetAllocations: allocations, goals: [], debts, assets: [],
    accounts, profile, rates, baseCurrency: 'INR',
  };
}
const ask = (id: string, entities: Record<string, unknown>): IntentResult =>
  ({ id: id as IntentResult['id'], bucket: id.split('.')[0] as IntentResult['bucket'], confidence: 0.9,
    entities: { text: 'test question', ...entities } });
const factsOf = (r: ReturnType<typeof resolve>) => (r.facts ?? {}) as Record<string, unknown>;

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-07T06:00:00Z')); });
afterEach(() => vi.useRealTimers());

// ── P1 · an annual budget is not judged on one month ──────────────────────────
describe('P1 — annual budgets point to Budgets (FE-PIP-01)', () => {
  const YEAR: Budget = { id: 'yr', limit: 60_000, currency: 'INR', scope: 'annual', periodYear: 2026,
    periodStart: '2026-01-01', periodEnd: '2026-12-31' } as Budget;
  const OCT: Budget = { id: 'oct', limit: 5_000, currency: 'INR', scope: 'month', periodYear: 2026, periodMonth: 10,
    periodStart: '2026-10-01', periodEnd: '2026-10-31' } as Budget;
  const travelSoFar = [txn('2026-03-10', 'travel', 30_000), txn('2026-08-10', 'travel', 28_000)];

  it('W5-D29-001 · annual Travel 60,000 with 58,000 spent: no monthly verdict, the money free decides, Budgets is named', () => {
    const ctx = ctxFor({ transactions: travelSoFar, budgets: [YEAR], allocations: [{ id: 'a', budgetId: 'yr', category: 'travel', amount: 60_000 }] });
    // The summary measures the annual line over its own year: 58,000 of 60,000, not 0% of October.
    expect(ctx.summary.budgets).toEqual([{ category: 'travel', limit: 60_000, spentPct: 96.67, annual: true }]);

    const afford = resolve(ask('forecast.affordability', { amount: 20_000, category: 'travel', text: 'can i afford a 20000 flight' }), ctx);
    const f = factsOf(afford);
    expect(f.budget_this_month).toBe('annual Travel budget — see Budgets for what is left this year');
    expect(f).not.toHaveProperty('budget_left_this_month');
    expect(f.verdict).toBe('fits');                                   // not "fits the Travel budget this month"
    expect(f.verdict_rests_on).toBe('the money free after card dues');

    const lookup = resolve(ask('interpret.lookup', { category: 'travel', text: 'how much on travel this month' }), ctx);
    expect(lookup.outcome).toBe('ok');                                // not vs_budget
    expect(factsOf(lookup).budget).toBe('annual Travel budget — see Budgets for what is left this year');
    expect(factsOf(lookup).share_of_budget).toBe('not measured against an annual budget');

    const budgets = factsOf(resolve(ask('interpret.budgets', {}), ctx));
    expect(budgets.annual_budgets).toEqual(['annual Travel budget — see Budgets for what is left this year']);
    expect(budgets.budgets_most_used_first).toEqual([]);               // never "on track" or "within pace"
  });

  it('W5-D29-002 · a month line still decides when there is one (the 27 Sep rule is unchanged)', () => {
    const ctx = ctxFor({ transactions: travelSoFar, budgets: [YEAR, OCT], allocations: [
      { id: 'a', budgetId: 'yr', category: 'travel', amount: 60_000 },
      { id: 'b', budgetId: 'oct', category: 'travel', amount: 5_000 },
    ] });
    const afford = resolve(ask('forecast.affordability', { amount: 20_000, category: 'travel', text: 'can i afford a 20000 flight' }), ctx);
    expect(afford.outcome).toBe('over_budget');
    expect(factsOf(afford).budget_this_month).toBe('₹5,000');
    expect(ctx.summary.budgets.map(b => [b.category, b.annual ?? false])).toEqual([['travel', true], ['travel', false]]);
  });
});

// ── P2 · a figure below zero keeps its minus ──────────────────────────────────
describe('P2 — signs (FE-PIP-04)', () => {
  it('W5-D29-003 · a negative net worth reaches the model with its minus, and the legacy vars are not sent', async () => {
    const mortgage = { id: 'm', type: 'mortgage', name: 'Home', principal: 2_545_000, currentBalance: 2_545_000,
      interestRate: 8.75, currency: 'INR', minimumPayment: 22_000, direction: 'owed_by_me' } as Debt;
    const ctx = ctxFor({ bank: 1_800_000, debts: [mortgage] });
    expect(ctx.summary.netWorth.netWorth).toBe(-745_000);
    expect(factsOf(resolve(ask('interpret.status', { text: "what's my net worth" }), ctx)).net_worth)
      .toBe('−₹7,45,000 (you owe more than you own)');

    const sent: string[] = [];
    const call: ModelCall = async ({ op, user }) => {
      if (op === 'classify') return JSON.stringify({ id: 'interpret.status', entities: {}, confidence: 0.9 });
      sent.push(user);
      return 'Your net worth is −₹7,45,000: you owe more than you own.';
    };
    const turn = await runAssistant("what's my net worth", ctx, new LlmBackend(call), 0);
    expect(turn.intentId).toBe('interpret.status');
    const payload = JSON.parse(sent[0]) as { data: object; facts: Record<string, unknown> };
    expect(payload.data).toEqual({});                                  // no unsigned headline beside the facts
    expect(payload.facts.net_worth).toBe('−₹7,45,000 (you owe more than you own)');
  });

  it('W5-D29-004 · below the floor, a "cushion" the facts never gave is refused (it only lived in the unsigned vars)', async () => {
    // Bank 90,000 less three rents of 17,000 = 39,000; the card owes 25,000, so 14,000 is free. The
    // floor is 51,000 (three months of rent): 37,000 BELOW it, and a ₹500 tea leaves −37,500.
    const ctx = ctxFor({ bank: 90_000, card: 25_000, transactions: [
      txn('2026-07-05', 'rent_mortgage', 17_000), txn('2026-08-05', 'rent_mortgage', 17_000), txn('2026-09-05', 'rent_mortgage', 17_000),
    ] });
    const r = resolve(ask('forecast.affordability', { amount: 500, category: 'food_dining', text: 'can i afford 500 for tea' }), ctx);
    expect(r.outcome).toBe('fits');
    expect(factsOf(r).headroom_against_floor).toBe('₹37,000 below');
    expect(r.vars.cushion).toBe('₹37,500 below');
    const call: ModelCall = async ({ op }) => op === 'classify'
      ? JSON.stringify({ id: 'forecast.affordability', entities: { amount: 500, category: 'food_dining' }, confidence: 0.9 })
      : "Yes — you'd still have a ₹37,500 cushion.";
    const turn = await runAssistant('can i afford 500 for tea', ctx, new LlmBackend(call), 0);
    expect(turn.intentId).toBe('unavailable');                         // discarded, never shown
  });
});

// ── P3 · the period asked about ───────────────────────────────────────────────
describe('P3 — stated periods (FE-PIP-05)', () => {
  // October 2026 is under way (Wed 7th). September had a Shopping spike over Jun–Aug.
  const history = [
    ...['2026-06', '2026-07', '2026-08'].flatMap(m => [txn(`${m}-05`, 'rent_mortgage', 16_000), txn(`${m}-12`, 'shopping', 2_000)]),
    txn('2026-09-05', 'rent_mortgage', 16_000), txn('2026-09-12', 'shopping', 9_000),
    txn('2026-10-01', 'rent_mortgage', 17_000), txn('2026-10-06', 'food_dining', 500),
  ];

  it('W5-D29-005 · "where did my money go last month" answers for September, against the months BEFORE it', () => {
    const r = resolve(ask('interpret.diagnostic', { period: 'last month' }), ctxFor({ transactions: history }));
    const f = factsOf(r);
    expect(r.outcome).toBe('found');
    expect(f.period).toBe('last month');
    // 9,000 against a usual of 2,000 (Jun–Aug). Letting October in made the usual 1,333.
    expect(f.biggest_rise).toEqual({ category: 'Shopping', spent: '₹9,000', usual_month: '₹2,000', above_usual: '350%' });
    expect(JSON.stringify(f.every_category_in_period)).not.toContain('Food & Dining');   // October's, not September's
  });

  it('W5-D29-006 · a window shorter than a month is answered over its dates; one that cannot be placed asks, with no figures', () => {
    const ctx = ctxFor({ transactions: history });
    const week = resolve(ask('interpret.diagnostic', { period: 'this week' }), ctx);
    expect(factsOf(week)).toMatchObject({ period: 'this week', total_spent: '₹500' });
    for (const id of ['interpret.diagnostic', 'forecast.prescriptive']) {
      const r = resolve(ask(id, { period: 'the last 60 days' }), ctx);
      expect(r.outcome).toBe('needs_period');
      expect(JSON.stringify(r.facts)).not.toMatch(/₹/);
    }
  });

  it('W5-D29-007 · advice for a named past month reads that month', () => {
    const f = factsOf(resolve(ask('forecast.prescriptive', { period: 'last month' }), ctxFor({ transactions: history })));
    expect(f.categories_period).toBe('last month');
    expect(f.easiest_trim).toBe('Shopping');
    expect(f.easiest_trim_figure).toBe('₹7,000');
  });

  it('W5-D29-008 · affordability, budgets and the position are about NOW: another month asks; today and this month answer', () => {
    const ctx = ctxFor({ transactions: history });
    const elsewhere: [string, Record<string, unknown>][] = [
      ['forecast.affordability', { amount: 5_000, period: 'December', text: 'can i afford 5000 in december' }],
      ['interpret.budgets', { period: 'August' }],
      ['interpret.status', { period: 'last month' }],
    ];
    for (const [id, entities] of elsewhere) {
      const r = resolve(ask(id, entities), ctx);
      expect(r.outcome, id).toBe('needs_period');
      expect(factsOf(r).can_answer_for, id).toBeTruthy();
      expect(JSON.stringify(r.facts), id).not.toMatch(/₹/);
    }
    for (const period of ['this month', 'today', 'this week']) {
      expect(resolve(ask('forecast.affordability', { amount: 5_000, period, text: 'can i afford 5000' }), ctx).outcome).toBe('fits');
      expect(resolve(ask('interpret.status', { period }), ctx).outcome).toBe('ok');
    }
  });
});

// ── P4 · the amount is the user's ──────────────────────────────────────────────
describe('P4 — stated amounts (FE-PIP-02)', () => {
  it('W5-D29-009 · statedAmounts reads every amount with its scale, and skips identifiers', () => {
    expect(statedAmounts('2.5k and 1.2 lakh, call 9848022113')).toEqual([2500, 120000]);
    expect(statedAmounts('₹1,20,000 or 1 cr')).toEqual([120000, 10_000_000]);
    expect(amountIsStated('can i afford a 1.2 lakh bike', 120000)).toBe(true);
    expect(amountIsStated('can i afford a new iphone', 79900)).toBe(false);
    expect(amountIsStated('can i afford 1,200', '1,200')).toBe(false);               // a string is not an amount
    expect(amountIsStated('spent 0 today', 0)).toBe(false);
  });

  it('W5-D29-010 · a price the model knew is not used: affordability and capture ask how much; advice drops the target', () => {
    const ctx = ctxFor();
    const iphone = resolve(ask('forecast.affordability', { amount: 79_900, text: 'can i afford a new iphone' }), ctx);
    expect(iphone.outcome).toBe('missing_amount');
    expect(JSON.stringify(iphone)).not.toContain('79');
    expect(resolve(ask('forecast.affordability', { amount: '1,200', text: 'can i afford 1,200' }), ctx).outcome).toBe('missing_amount');
    expect(resolve(ask('forecast.affordability', { amount: 120_000, text: 'can i afford a 1.2 lakh bike' }), ctx).outcome).toBe('fits');
    const coffee = resolve(ask('capture.expense', { amount: 150, text: 'spent on coffee' }), ctx);
    expect(coffee.outcome).toBe('missing_amount');
    expect(coffee.seed).toBeUndefined();
    expect(factsOf(resolve(ask('forecast.prescriptive', { amount: 5_000, text: 'how do i save more' }), ctx)).savings_goal).toBe('not specified');
    // The identifier check covers a forecast too, not only capture.
    const phone = resolve(ask('forecast.affordability', { amount: 9_848_022_113, text: 'can i afford it, call 9848022113' }), ctx);
    expect(phone.outcome).toBe('missing_amount');
  });

  it('W5-D29-011 · a split’s number of people is checked: 2 to 20', () => {
    const ctx = ctxFor();
    const ways = (participantCount: unknown) =>
      resolve(ask('capture.split', { amount: 1_200, participantCount, text: 'split 1200 dinner' }), ctx).seed?.split?.participants?.length;
    expect(ways(1e9)).toBe(20);
    expect(ways(0)).toBe(2);
    expect(ways('lots')).toBe(2);
    expect(ways(4)).toBe(4);
  });
});
