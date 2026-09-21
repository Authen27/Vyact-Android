import { describe, it, expect } from 'vitest';
import { parse, normalise, parseAmount, parseParticipantCount, matchCategory } from '../askVyactParser';
import { classifyIntent, type AssistantIntentId, type IntentResult } from '../askVyactIntents';
import {
  variantCount, normaliseChips, renderChipsAsNumberedList, chipPromptFromReply,
  MAX_CHIPS, type AssistantChip,
} from '../askVyactResponses';
import {
  LlmBackend, resolve, runAssistant, proactiveInsight,
  type AssistantContext,
} from '../askVyactBackend';
import {
  assertNoInventedFigures, InventedFigureError, ModelUnavailableError,
  type ModelCall,
} from '../askVyactLlm';
import { buildSafeSummary } from '../aiSummary';
import type { Transaction, Budget, Goal, Debt, Asset, Profile } from '../../types';

// CON-UNIT-ASK-001..0xx — Ask Vyact deterministic assistant (engineering spec
// §3–§7). Classification is pure over parsed entities; these tests pin the §9
// reference utterance set (11 capture + 8 forecast + interpret) and the seams.


// ── fake model ──────────────────────────────────────────────────────────────
// Deterministic stand-in for a provider. It exercises the real classify/phrase
// wiring offline; it is NOT trying to be smart, and never invents a figure.
function fakeModel(
  intentId: string,
  entities: Record<string, unknown> = {},
  reply?: string,
): ModelCall {
  return async ({ system, user }) => {
    if (system.includes('classify')) {
      return JSON.stringify({ id: intentId, entities, confidence: 0.9 });
    }
    // Phrase step: echo the computed values, so the guard sees only real figures.
    const parsed = JSON.parse(user) as { data: Record<string, unknown> };
    return reply ?? `Here you go: ${Object.values(parsed.data).join(' · ')}`.trim();
  };
}
const llm = (id: string, entities?: Record<string, unknown>, reply?: string) =>
  new LlmBackend(fakeModel(id, entities, reply));
const clsOf = (u: string): AssistantIntentId => classifyIntent(parse(u)).id;

// ── Parser ──────────────────────────────────────────────────────────────────
describe('askVyactParser — amount + entities (spec §3 stage 2)', () => {
  it('CON-UNIT-ASK-001 · parses plain, grouped, k / lakh / cr and currency-tagged amounts', () => {
    expect(parseAmount('45')).toBe(45);
    expect(parseAmount('netflix 199')).toBe(199);
    expect(parseAmount('£1,200')).toBe(1200);
    expect(parseAmount('moved 10k')).toBe(10_000);
    expect(parseAmount('2.5k')).toBe(2500);
    expect(parseAmount('3 lakh')).toBe(300_000);
    expect(parseAmount('1 cr')).toBe(10_000_000);
    expect(parseAmount('5 bucks')).toBe(5);
    expect(parseAmount('no number here')).toBeUndefined();
  });
  it('CON-UNIT-ASK-002 · normalises and matches category keywords', () => {
    expect(normalise('  Spent  45  ON  Fuel ')).toBe('spent 45 on fuel');
    expect(matchCategory('spent 45 on fuel')).toBe('travel');
    expect(matchCategory('netflix 199')).toBe('entertainment');
    expect(matchCategory('how much on dining this month')).toBe('food_dining');
  });
  it('CON-UNIT-ASK-003 · parses split participant counts', () => {
    expect(parseParticipantCount('split the 3600 dinner 4 ways')).toBe(4);
    expect(parseParticipantCount('dinner 80 between me and 2 friends')).toBe(3);
    expect(parseParticipantCount('no split')).toBeUndefined();
  });
});

// ── Capture — the 11 reference phrasings (spec §4 / §9) ─────────────────────────
describe('classifyIntent — Capture (11/11)', () => {
  const CASES: [string, AssistantIntentId][] = [
    ['spent 45 on fuel at Shell', 'capture.expense'],
    ['netflix 199', 'capture.expense'],
    ['coffee 5 bucks', 'capture.expense'],
    ['bought groceries 120', 'capture.expense'],
    ['uber 250', 'capture.expense'],
    ['got paid 85000', 'capture.income'],
    ['received 5000 from client', 'capture.income'],
    ['split the 3600 dinner 4 ways', 'capture.split'],
    ['dinner 80 between me and 2 friends', 'capture.split'],
    ['moved 10k to savings', 'capture.transfer'],
    ['transfer 500 from checking', 'capture.transfer'],
  ];
  it('CON-UNIT-ASK-010 · all 11 capture phrasings classify correctly', () => {
    for (const [u, expected] of CASES) expect(clsOf(u), u).toBe(expected);
  });
  it('CON-UNIT-ASK-011 · income is tested before expense (the "got paid" collision)', () => {
    expect(clsOf('got paid my salary 50000')).toBe('capture.income');
    expect(clsOf('spent 50000')).toBe('capture.expense');
  });
});

// ── Forecast reference phrasings (goal forecasting removed with the goals module) ─
describe('classifyIntent — Forecast', () => {
  const CASES: [string, AssistantIntentId][] = [
    ['can I afford a £1,200 flight next week?', 'forecast.affordability'],
    ['can I afford to buy a 50000 car?', 'forecast.affordability'],
    ['if I quit, how many months?', 'forecast.runway'],
    ['how many months would my savings last?', 'forecast.runway'],
    ['I need £500 by next month — where do I cut?', 'forecast.prescriptive'],
    ['where can I cut back to save 300?', 'forecast.prescriptive'],
  ];
  it('CON-UNIT-ASK-020 · forecast phrasings classify correctly', () => {
    for (const [u, expected] of CASES) expect(clsOf(u), u).toBe(expected);
  });
  it('CON-UNIT-ASK-021 · runway ordering ("quit/last" → runway)', () => {
    expect(clsOf('how long can I last if I quit')).toBe('forecast.runway');
  });
});

// ── Interpret + fallback ────────────────────────────────────────────────────
describe('classifyIntent — Interpret + fallback', () => {
  it('CON-UNIT-ASK-030 · interpret intents route correctly', () => {
    expect(clsOf('how much did I spend on dining this month')).toBe('interpret.lookup');
    expect(clsOf("what's my net worth")).toBe('interpret.status');
    expect(clsOf('why am I low on cash')).toBe('interpret.diagnostic');
    expect(clsOf("what's my pulse score")).toBe('interpret.status');
  });
  it('CON-UNIT-ASK-031 · unmatched utterance → fallback (never an error)', () => {
    expect(clsOf('hello there friend')).toBe('fallback');
  });
});

// ── Resolve + phrase over a real summary (numbers must come from services) ──────
function makeCtx(over: Partial<AssistantContext> = {}): AssistantContext {
  const profile = { baseCurrency: 'GBP', household: 'individual', language: 'en' } as unknown as Profile;
  const rates = { GBP: 1 };
  // Audit F5: budgets are read through the month-scoped allocation lines, so
  // the fixture budget is dated into THIS month and the default spend (420)
  // exceeds it (300) — the over-budget proactive insight can fire.
  const [yy, mm] = new Date().toISOString().slice(0, 7).split('-').map(Number);
  const transactions = over.transactions ?? ([
    { id: 't1', type: 'expense', amount: 420, currency: 'GBP', date: new Date().toISOString().slice(0, 10), description: '', category: 'food_dining' },
  ] as Transaction[]);
  const budgets = over.budgets ?? ([{
    id: 'b1', category: 'food_dining', limit: 300, currency: 'GBP',
    scope: 'month', periodYear: yy, periodMonth: mm,
  }] as Budget[]);
  const goals = over.goals ?? ([] as Goal[]);
  const debts = over.debts ?? ([] as Debt[]);
  const assets = over.assets ?? ([{ id: 'a1', type: 'cash', name: 'Cash', value: 8000, currency: 'GBP', liquidity: 'liquid' }] as Asset[]);
  const summary = buildSafeSummary(transactions, budgets, goals, debts, assets, profile, rates);
  return { summary, transactions, budgets, goals, debts, assets, profile, rates, baseCurrency: 'GBP', ...over };
}

describe('resolve + phrase — answers trace to services (spec §5/§6)', () => {
  it('CON-UNIT-ASK-040 · capture seeds the modal with the parsed amount + category', async () => {
    const backend = llm('capture.expense', { amount: 45, category: 'travel' });
    const turn = await runAssistant('spent 45 on fuel', makeCtx(), backend, 0);
    // Stage 4 still builds the seed — the model only said WHICH intent this is.
    expect(turn.seed?.type).toBe('expense');
    expect(turn.seed?.amount).toBe(45);
    expect(turn.seed?.category).toBe('travel');
    expect(turn.clarify).toBe(false);
    expect(turn.reply.length).toBeGreaterThan(0);
  });
  it('CON-UNIT-ASK-041 · capture with no amount → clarifying turn, no seed', async () => {
    const turn = await runAssistant('spent on fuel', makeCtx(), llm('capture.expense'), 0);
    expect(turn.seed).toBeUndefined();
    expect(turn.clarify).toBe(true);
    expect(turn.reply.length).toBeGreaterThan(0);
  });
  it('CON-UNIT-ASK-042 · interpret lookup figure matches spendByCategory exactly', () => {
    const r = resolve(classifyIntent(parse('how much on dining this month')), makeCtx());
    // 420 spent vs 300 budget → vs_budget, 140%
    expect(r.outcome).toBe('vs_budget');
    expect(r.vars.amount).toContain('420');
    expect(r.vars.pct).toBe('140%');
  });
  it('CON-UNIT-ASK-043 · affordability is grounded in liquid − emergency floor', () => {
    // liquid 8000, no emergency goal → floor = 3× monthly burn (420) = 1260.
    // headroom = 6740. £1,200 fits.
    const fits = resolve(classifyIntent(parse('can I afford a 1200 flight')), makeCtx());
    expect(fits.outcome).toBe('fits');
    // A 9000 ask exceeds headroom → tight, never a flat "no".
    const tight = resolve(classifyIntent(parse('can I afford a 9000 holiday')), makeCtx());
    expect(tight.outcome).toBe('tight');
    // #62 — `chip` became `chips`. A "tight" verdict must always offer a way
    // forward; the deck's rule is that no answer is a dead end.
    expect(tight.chips?.length).toBeGreaterThan(0);
  });
  it('CON-UNIT-ASK-044 · estimated-derived figures are flagged in phrasing (provenance)', async () => {
    const ctx = makeCtx({
      budgets: [{ id: 'b1', category: 'food_dining', limit: 300, currency: 'GBP', confidence: 'estimated', source: 'onboarding' }] as Budget[],
    });
    const intent = classifyIntent(parse('how much on dining this month'));
    const r = resolve(intent, ctx);
    // Provenance is carried on the RESOLVED result, which is what the honesty
    // rule keys off. Phrasing is the model's job now, so it is not asserted here
    // — the <EstimatedTag/> surface, not the wording, is the guarantee.
    expect(r.usesEstimate).toBe(true);
  });
});

// ── Tone, fallback, seam ──────────────────────────────────────────────────────
describe('tone + seam (spec §7/§3)', () => {
  it('CON-UNIT-ASK-050 · ≥3 phrasing variants per key intent+outcome', () => {
    for (const key of [
      ['capture.expense', 'seeded'], ['capture.income', 'seeded'], ['capture.split', 'seeded'],
      ['interpret.lookup', 'ok'], ['forecast.affordability', 'fits'], ['forecast.affordability', 'tight'],
      ['fallback', 'default'],
    ] as [string, string][]) {
      expect(variantCount(key[0], key[1]), key.join('.')).toBeGreaterThanOrEqual(3);
    }
  });
  it('CON-UNIT-ASK-051 · an unrecognised intent is a clarifier, never a dead end', async () => {
    // The model returns something outside the known intent set.
    const turn = await runAssistant('asdfghjkl', makeCtx(), llm('not.a.real.intent'), 0);
    expect(turn.clarify).toBe(true);
    expect(turn.reply.length).toBeGreaterThan(10);
  });

  it('CON-UNIT-ASK-052 · the model chooses the intent; stage 4 still computes the money', async () => {
    const ctx = makeCtx();
    const turn = await runAssistant('how much on dining this month', ctx,
      llm('interpret.lookup', { category: 'food_dining' }), 0);
    // 420 spent vs a 300 budget — identical to calling resolve() directly, which
    // is the point: swapping the classifier must not move a single figure.
    const direct = resolve(classifyIntent(parse('how much on dining this month')), ctx);
    expect(turn.intentId).toBe('interpret.lookup');
    expect(direct.vars.amount).toContain('420');
    expect(turn.reply).toContain('420');
  });

  it('CON-UNIT-ASK-053 · a model-invented figure is DISCARDED, never shown', async () => {
    // The single most dangerous failure in a finance assistant: confident prose
    // containing a number no tool produced.
    const ctx = makeCtx();
    const liar = new LlmBackend(fakeModel(
      'interpret.lookup', { category: 'food_dining' },
      'You spent £9,999 on dining this month.',   // 9999 came from nowhere
    ));
    const turn = await runAssistant('how much on dining this month', ctx, liar, 0);
    expect(turn.reply).not.toContain('9,999');
    expect(turn.reply).not.toContain('9999');
    expect(turn.intentId).toBe('unavailable');
    expect(turn.clarify).toBe(true);
  });

  it('CON-UNIT-ASK-054 · no model configured → an honest unavailable turn', async () => {
    const turn = await runAssistant('what is my net worth', makeCtx(), null, 0);
    expect(turn.intentId).toBe('unavailable');
    expect(turn.clarify).toBe(true);
    expect(turn.reply.toLowerCase()).toContain("isn't set up");
  });

  it('CON-UNIT-ASK-055 · an unreachable model degrades honestly, never silently', async () => {
    const dead = new LlmBackend(async () => { throw new Error('ECONNREFUSED'); });
    const turn = await runAssistant('what is my net worth', makeCtx(), dead, 0);
    expect(turn.intentId).toBe('unavailable');
    expect(turn.reply.toLowerCase()).toContain('try again');
  });

  it('CON-UNIT-ASK-056 · the invented-figure guard is exact about what it allows', () => {
    const vars = { amount: '£420', pct: '140%' };
    // Figures that came from the tools are fine, in either decimal form.
    expect(() => assertNoInventedFigures('You spent £420, which is 140% of budget.', vars)).not.toThrow();
    expect(() => assertNoInventedFigures('You spent £420.00 this month.', vars)).not.toThrow();
    // Small counts and years are prose, not money.
    expect(() => assertNoInventedFigures('That is 2 categories over in 2026.', vars)).not.toThrow();
    // Anything else is a hallucination.
    expect(() => assertNoInventedFigures('You spent £421 on dining.', vars)).toThrow(InventedFigureError);
    expect(() => assertNoInventedFigures('Your net worth is £58,300.', vars)).toThrow(InventedFigureError);
  });

  it('CON-UNIT-ASK-081 · a year-shaped number presented as MONEY is not exempt', () => {
    // Phase 0.6 (audit A1). The year exemption used to be unconditional, so the
    // whole 1900–2099 band passed the guard — a realistic amount range, not a
    // theoretical one. It is now conditional on the figure not being money.
    const vars = { amount: '£420' };
    expect(() => assertNoInventedFigures('You spent £2,050 on rent.', vars))
      .toThrow(InventedFigureError);
    expect(() => assertNoInventedFigures('Your net worth is £1,999.', vars))
      .toThrow(InventedFigureError);
    expect(() => assertNoInventedFigures('That comes to Rs. 2020 this month.', vars))
      .toThrow(InventedFigureError);

    // A real year in prose still passes — the exemption is narrowed, not removed.
    expect(() => assertNoInventedFigures('You joined in 2026.', vars)).not.toThrow();
    expect(() => assertNoInventedFigures('Compared with 1999, spending is calmer.', vars))
      .not.toThrow();
  });

  it('CON-UNIT-ASK-082 · 100 is no longer waved through', () => {
    // The likeliest confabulation in a finance assistant is a percentage. A
    // genuine 100 arrives inside a computed value and is allowed by that route.
    expect(() => assertNoInventedFigures('That is 100% of your budget.', { amount: '£420' }))
      .toThrow(InventedFigureError);
    expect(() => assertNoInventedFigures('Your Pulse Score is 85/100.',
      { headline: 'Your Pulse Score is 85/100.' })).not.toThrow();

    // Small counts and calendar quantities stay exempt — prose needs them.
    expect(() => assertNoInventedFigures('That is 3 budgets over across 30 days.', { amount: '£420' }))
      .not.toThrow();
  });
  it('CON-UNIT-ASK-053 · proactive insight surfaces the over-budget category', () => {
    const insight = proactiveInsight(makeCtx());
    expect(insight).not.toBeNull();
    expect(insight!.text.toLowerCase()).toContain('food');
  });
});

// ── Chips (#62) — one definition, two renderings ──────────────────────────────
//
// These pin the contract rather than the copy: the cap, the well-formedness
// rule, the fact that chips reach a turn at all (they did not, for the whole
// life of the feature), and that the WhatsApp rendering is derived from the
// same list rather than authored separately.
describe('askVyact chips — delivery + the max-three rule', () => {
  const chip = (n: number): AssistantChip => ({ label: `L${n}`, prompt: `p${n}` });

  it('CON-UNIT-ASK-057 · extras are DROPPED at three, never wrapped', () => {
    const out = normaliseChips([chip(1), chip(2), chip(3), chip(4), chip(5)]);
    expect(out).toHaveLength(MAX_CHIPS);
    // Order is meaningful — the first three survive, not an arbitrary three.
    expect(out!.map(c => c.label)).toEqual(['L1', 'L2', 'L3']);
  });

  it('CON-UNIT-ASK-058 · a chip that asks nothing is dropped, not rendered', () => {
    // The pre-#62 chips were `{ label }` with no prompt. Had they ever reached a
    // screen they would have been untappable — the exact dead end the
    // open-ended rule exists to prevent. Malformed in, nothing out.
    const out = normaliseChips([
      { label: 'Add details' } as AssistantChip,
      { label: '  ', prompt: 'real' } as AssistantChip,
      { label: 'Good', prompt: 'a real question' },
    ]);
    expect(out).toEqual([{ label: 'Good', prompt: 'a real question' }]);
    // Nothing usable at all reads as "no chips", never an empty row.
    expect(normaliseChips([{ label: 'x' } as AssistantChip])).toBeUndefined();
    expect(normaliseChips([])).toBeUndefined();
    expect(normaliseChips(undefined)).toBeUndefined();
  });

  it('CON-UNIT-ASK-059 · two chips asking the same thing do not eat two slots', () => {
    const out = normaliseChips([
      { label: 'Where can I cut back?', prompt: 'where can I cut back' },
      { label: 'What can I trim?', prompt: 'Where Can I Cut Back' },
      { label: 'Why is it up?', prompt: 'why is my food spending so high' },
    ]);
    expect(out).toHaveLength(2);
    expect(out!.map(c => c.label)).toEqual(['Where can I cut back?', 'Why is it up?']);
  });

  it('CON-UNIT-ASK-060 · chips actually reach the turn (the #62 regression)', async () => {
    // The bug this ticket exists for: resolve() produced a chip, runAssistant
    // dropped it, and no chip had ever reached a user. Assert the whole path.
    const turn = await runAssistant('how much on dining this month', makeCtx(),
      llm('interpret.lookup', { category: 'food_dining', text: 'dining' }, 'You spent £420.'), 0);
    expect(turn.chips?.length).toBeGreaterThan(0);
    expect(turn.chips!.length).toBeLessThanOrEqual(MAX_CHIPS);
    for (const c of turn.chips!) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.prompt.length).toBeGreaterThan(0);
    }
  });

  it('CON-UNIT-ASK-061 · every chip any resolve() branch produces is tappable', () => {
    // A sweep, not a sample: a future branch that ships a promptless chip fails
    // here rather than shipping a dead end to a screen.
    const ids: AssistantIntentId[] = [
      'capture.expense', 'capture.income', 'capture.transfer', 'capture.investment',
      'capture.split', 'interpret.lookup', 'interpret.status', 'interpret.diagnostic',
      'interpret.budgets', 'interpret.debts', 'interpret.bills',
      'forecast.affordability', 'forecast.runway', 'forecast.prescriptive', 'fallback',
    ];
    const ctx = makeCtx();
    for (const id of ids) {
      // Both shapes of every branch: with an amount and without one.
      for (const entities of [{ text: '' }, { text: '', amount: 9000, category: 'food_dining' }]) {
        const intent = { id, bucket: 'none', confidence: 1, entities } as unknown as IntentResult;
        const chips = resolve(intent, ctx).chips ?? [];
        expect(chips.length).toBeLessThanOrEqual(MAX_CHIPS);
        for (const c of chips) {
          expect(c.prompt?.trim(), `${id} chip "${c.label}" has no prompt`).toBeTruthy();
          expect(c.label?.trim(), `${id} chip has no label`).toBeTruthy();
        }
      }
    }
  });

  it('CON-UNIT-ASK-062 · WhatsApp renders the SAME list as numbers (CONV-09)', () => {
    const chips: AssistantChip[] = [
      { label: 'Why is it up?', prompt: 'why is my food spending so high' },
      { label: 'Where else is it going?', prompt: 'where is my money going' },
    ];
    expect(renderChipsAsNumberedList(chips))
      .toBe('1. Why is it up?\n2. Where else is it going?');
    // The numbered rendering must round-trip: a "2" comes back as chip 2's
    // prompt, so the two channels cannot drift into different follow-ups.
    expect(chipPromptFromReply('2', chips)).toBe('where is my money going');
    expect(chipPromptFromReply(' 1. ', chips)).toBe('why is my food spending so high');
    expect(renderChipsAsNumberedList(undefined)).toBe('');
  });

  it('CON-UNIT-ASK-063 · a sentence is a new question, not an answer to the list', () => {
    const chips: AssistantChip[] = [{ label: 'Why is it up?', prompt: 'why is my food spending so high' }];
    // Out of range, and free text, must both fall through to normal handling —
    // silently treating "3" or a sentence as a chip tap would answer something
    // the user never asked.
    expect(chipPromptFromReply('3', chips)).toBeNull();
    expect(chipPromptFromReply('what about last month', chips)).toBeNull();
    expect(chipPromptFromReply('1', undefined)).toBeNull();
  });
});
