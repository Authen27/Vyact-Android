// Ask Vyact — LIVE model smoke test (architecture P3).
//
// The first REAL question: a real model, the real classify → resolve → phrase
// chain, and the real anti-hallucination guard. Everything else in the suite
// uses a fake model; this is the one that proves the wiring against an actual
// provider.
//
// OFF BY DEFAULT, TWICE OVER. It is `skipIf(!KEY)` guarded AND excluded in
// `vitest.config.ts`, so CI, other developers and the normal `vitest run` are
// never slowed down and never spend a cent. It reads the key from process.env
// and never logs it.
//
// RUN IT THROUGH `test:live`. Because the base config excludes this file,
// pointing plain `vitest run` at this path returns "No test files found".
// `vitest.live.config.ts` inherits the base config and clears that exclusion;
// the `test:live` script uses it. (An earlier version of this comment documented
// the plain command, which fails.)
//
//   HOW TO RUN (PowerShell):
//     $env:OPENROUTER_API_KEY = "sk-or-..."
//     $env:VYACT_LIVE_MODEL   = "nvidia/nemotron-3-super-120b-a12b:free"   # optional
//     npm --prefix react run test:live
//   Where npm is blocked, the equivalent from `react/`:
//     node ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
//
// Set VYACT_LIVE_MODEL to whichever `ai_model_configs` row is enabled, so the
// harness measures the model production actually uses. Default is sonnet-5.
//
// COST. The two smoke tests are ~1,700 in / 340 out tokens. The scenario matrix
// below adds 14 scenarios × 2 calls each. On a `:free` model that is USD 0.00;
// on claude-sonnet-5 budget roughly USD 0.05 for a full run — check which model
// is enabled before running if cost matters.
import { describe, it, expect } from 'vitest';
import { LlmBackend, runAssistant, type AssistantContext } from '../askVyactBackend';
import type { ModelCall } from '../askVyactLlm';
import { buildSafeSummary } from '../aiSummary';
import type { Transaction, Budget, Goal, Debt, Asset, Profile } from '../../types';

const KEY = process.env.OPENROUTER_API_KEY ?? '';
const MODEL = process.env.VYACT_LIVE_MODEL ?? 'anthropic/claude-sonnet-5';

/**
 * A real OpenRouter call. Deliberately mirrors what the deployed `ask-vyact`
 * gateway sends. This does not validate deployed gateway authentication,
 * quota, consent, configuration or metering.
 */
const liveModel: ModelCall = async ({ system, user, json, maxTokens }) => {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens ?? 600,
      temperature: 0.2,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('empty model reply');
  return text;
};

function makeCtx(): AssistantContext {
  const profile = { baseCurrency: 'GBP', household: 'individual', language: 'en' } as unknown as Profile;
  const rates = { GBP: 1 };
  const transactions = [
    { id: 't1', type: 'expense', amount: 420, currency: 'GBP',
      date: new Date().toISOString().slice(0, 10), description: '', category: 'food_dining' },
  ] as Transaction[];
  const budgets = [{ id: 'b1', category: 'food_dining', limit: 300, currency: 'GBP' }] as Budget[];
  const goals: Goal[] = [];
  const debts: Debt[] = [];
  const assets = [{ id: 'a1', type: 'cash', name: 'Cash', value: 8000,
    currency: 'GBP', liquidity: 'liquid' }] as Asset[];
  const summary = buildSafeSummary(transactions, budgets, goals, debts, assets, profile, rates);
  return { summary, transactions, budgets, goals, debts, assets, profile, rates, baseCurrency: 'GBP' };
}

describe.skipIf(!KEY)(`Ask Vyact live · ${MODEL}`, () => {
  it('answers a spending question with the COMPUTED figure, not an invented one', async () => {
    const backend = new LlmBackend(liveModel);
    const turn = await runAssistant('how much did I spend on dining this month?', makeCtx(), backend, 0);


    console.log(`\n  Q: how much did I spend on dining this month?\n  A: ${turn.reply}\n  intent: ${turn.intentId}\n`);

    // The model must NOT have fallen through to an unavailable/fallback turn.
    expect(turn.intentId).not.toBe('unavailable');
    expect(turn.intentId).toBe('interpret.lookup');

    // 420 is what resolve() computed from the fixture. If the reply carries a
    // figure, it has already survived assertNoInventedFigures — an invented one
    // would have produced an 'unavailable' turn instead.
    expect(turn.reply).toContain('420');
    expect(turn.reply.length).toBeGreaterThan(10);
  }, 60_000);

  it('routes a capture utterance to a seeded draft, not a lecture', async () => {
    const backend = new LlmBackend(liveModel);
    const turn = await runAssistant('spent 45 on fuel', makeCtx(), backend, 0);


    console.log(`\n  Q: spent 45 on fuel\n  A: ${turn.reply}\n  intent: ${turn.intentId}  seed: ${JSON.stringify(turn.seed)}\n`);

    expect(turn.intentId).toBe('capture.expense');
    // Stage 4 still builds the seed — the model only chose the intent.
    expect(turn.seed?.type).toBe('expense');
    expect(turn.seed?.amount).toBe(45);
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO MATRIX — every Ask Vyact query that actually reaches the model.
//
// WHY THIS EXISTS, given askVyact.test.ts already has 60+ cases: that suite pins
// classification, the invented-figure guard and chips against a FAKE model. It
// proves the wiring, never the model. This block is the one thing it cannot be:
// the real classify → resolve → phrase chain against a live provider, producing
// one row of evidence per scenario.
//
// SCOPE. Only the 10 `ask` intents in askVyactIntents.ts reach the model. The 7
// capture intents fire `open-modal` and never call it — there is no LLM response
// to validate for those. Free-text capture utterances DO route through classify,
// so they are covered separately.
//
// WHAT FAILS THE RUN, deliberately narrow:
//   · any scenario that cannot reach the provider (config/transport — not the
//     model's fault, and the exact failure that went unnoticed for two days), and
//   · a majority mis-bucketing, which means the model is unusable for this app.
// Exact intent-id accuracy is RECORDED, not asserted: it is the thing being
// measured. A brittle per-id assertion would just make a weaker model look broken
// instead of telling you how well it performs.
const SCENARIOS: { id: string; prompt: string; expect: string }[] = [
  // ── Inquire (6) ──
  { id: 'spend-month',    prompt: 'How much did I spend this month?',                     expect: 'interpret' },
  { id: 'health',         prompt: 'How am I doing financially?',                          expect: 'interpret' },
  { id: 'net-worth',      prompt: "What's my net worth?",                                 expect: 'interpret' },
  { id: 'budgets-risk',   prompt: 'Which budgets are at risk?',                           expect: 'interpret' },
  { id: 'top-categories', prompt: 'What are my top spending categories this month?',      expect: 'interpret' },
  { id: 'upcoming-bills', prompt: 'What are my upcoming bills?',                          expect: 'interpret' },
  // ── Plan (4) ──
  { id: 'emergency',      prompt: 'How long would my money last without income?',         expect: 'forecast'  },
  { id: 'debts',          prompt: 'Tell me about my debts and the best payoff strategy.', expect: 'interpret' },
  { id: 'affordability',  prompt: 'Can I afford a 1200 purchase?',                        expect: 'forecast'  },
  { id: 'cut-back',       prompt: 'Where can I cut back on spending?',                    expect: 'forecast'  },
  // ── Free-text capture (4) — the only capture path that reaches the model ──
  { id: 'cap-expense',    prompt: 'spent 45 on fuel',                                     expect: 'capture'   },
  { id: 'cap-income',     prompt: 'received 5000 salary today',                           expect: 'capture'   },
  { id: 'cap-transfer',   prompt: 'transferred 200 from my bank to cash',                 expect: 'capture'   },
  { id: 'cap-investment', prompt: 'invested 500 in my index fund',                        expect: 'capture'   },
];

/** Richer than makeCtx(): debts, bills and multi-category spend, so intents like
 *  interpret.debts / interpret.bills resolve against real data instead of an
 *  empty state that would validate nothing. makeCtx() is left untouched so the
 *  two smoke tests above keep their exact fixtures. */
function makeRichCtx(): AssistantContext {
  const today = new Date().toISOString().slice(0, 10);
  const profile = { baseCurrency: 'GBP', household: 'family', language: 'en' } as unknown as Profile;
  const rates = { GBP: 1 };
  const transactions = [
    { id: 't1', type: 'expense', amount: 420, currency: 'GBP', date: today, description: '', category: 'food_dining' },
    { id: 't2', type: 'expense', amount: 180, currency: 'GBP', date: today, description: '', category: 'groceries' },
    { id: 't3', type: 'expense', amount: 95,  currency: 'GBP', date: today, description: '', category: 'travel' },
    { id: 't4', type: 'expense', amount: 260, currency: 'GBP', date: today, description: '', category: 'utilities' },
    { id: 't5', type: 'income',  amount: 3200, currency: 'GBP', date: today, description: '', category: 'salary' },
  ] as Transaction[];
  const budgets = [
    { id: 'b1', category: 'food_dining', limit: 300, currency: 'GBP' },
    { id: 'b2', category: 'groceries',   limit: 400, currency: 'GBP' },
  ] as Budget[];
  const debts = [
    { id: 'd1', type: 'card', name: 'Credit Card', principal: 3000, currentBalance: 2400,
      interestRate: 22.9, minimumPayment: 120, currency: 'GBP' },
    { id: 'd2', type: 'loan', name: 'Car Loan', principal: 12000, currentBalance: 8600,
      interestRate: 6.4, minimumPayment: 250, currency: 'GBP' },
  ] as Debt[];
  const assets = [
    { id: 'a1', type: 'cash', name: 'Cash', value: 8000, currency: 'GBP', liquidity: 'liquid' },
    { id: 'a2', type: 'investment', name: 'Index Fund', value: 15000, currency: 'GBP', liquidity: 'illiquid' },
  ] as Asset[];
  const goals: Goal[] = [];
  const summary = buildSafeSummary(transactions, budgets, goals, debts, assets, profile, rates);
  return { summary, transactions, budgets, goals, debts, assets, profile, rates, baseCurrency: 'GBP' };
}

describe.skipIf(!KEY)(`Ask Vyact live · scenario matrix · ${MODEL}`, () => {
  it('answers every model-reaching intent, and reports outcome per scenario', async () => {
    const backend = new LlmBackend(liveModel);
    const rows: Record<string, string>[] = [];
    let unreachable = 0;
    let bucketHits = 0;
    let guardRejects = 0;

    for (const s of SCENARIOS) {
      let turn;
      try {
        turn = await runAssistant(s.prompt, makeRichCtx(), backend, 0);
      } catch (e) {
        rows.push({ scenario: s.id, expected: s.expect, got: 'THREW', ok: '✗',
          reply: String((e as Error)?.message ?? e).slice(0, 60) });
        unreachable++;
        continue;
      }

      // 'unavailable' has three causes; only unverified_figures is the model's
      // own doing. The other two are infrastructure and must fail the run.
      const isUnavailable = turn.intentId === 'unavailable';
      const isGuard = isUnavailable && /couldn't verify the numbers/i.test(turn.reply);
      if (isUnavailable && !isGuard) unreachable++;
      if (isGuard) guardRejects++;

      const hit = turn.bucket === s.expect;
      if (hit) bucketHits++;

      rows.push({
        scenario: s.id,
        expected: s.expect,
        got: `${turn.bucket}/${turn.intentId}`,
        ok: hit ? '✓' : isGuard ? '⚠guard' : '✗',
        reply: turn.reply.replace(/\s+/g, ' ').slice(0, 70),
      });

      // Be gentle with free-tier rate limits (each turn is already 2 calls).
      await new Promise(r => setTimeout(r, 1200));
    }

    console.log(`\n  ── Ask Vyact scenario matrix · ${MODEL} ──`);
    for (const r of rows) {
      console.log(`  ${r.ok.padEnd(7)} ${r.scenario.padEnd(15)} ${r.expected.padEnd(10)} -> ${(r.got ?? '').padEnd(28)} ${r.reply}`);
    }
    console.log(`\n  bucket match: ${bucketHits}/${SCENARIOS.length} · guard rejections: ${guardRejects} · unreachable: ${unreachable}\n`);

    // Infrastructure must be sound — this is the TD-43 gap that let a silent
    // two-day outage through.
    expect(unreachable, 'scenarios that could not reach the provider').toBe(0);
    // And the model must be usable for this app at all.
    expect(bucketHits, 'scenarios routed to the right bucket').toBeGreaterThan(SCENARIOS.length / 2);
  }, 600_000);
});
