// Vyact — Ask Vyact assistant backend (engineering spec §3, §4, §5, §6).
//
// Orchestrates the five-stage deterministic pipeline:
//   [1] normalise → [2] entityExtract → [3] classifyIntent → [4] resolve → [5] phraseResponse
//
// The two SEAMS a future LlmBackend swaps in are stages 3 and 5, expressed as the
// `AssistantBackend` interface. Stages 1, 2, 4 are pure functions over Vyact data
// and are model-agnostic — they are NEVER delegated to a model. In particular
// stage 4 (`resolve`) is the only place money is computed, and it does so purely
// by calling the SAME services that power the dashboard. The assistant phrases;
// services compute.

import type {
  Transaction, Budget, Goal, Debt, Asset, Profile, ExchangeRates, SplitInfo, TxnType, RecurringSchedule,
} from '../types';
import {
  spendByCategory, monthlyData, totalMonthlyDebtPayment,
} from './calculations';
// v10.38 — period/date/account resolution lives in the parser, next to the entity
// shape it reads, and is unit-tested there.
import { resolvePeriod, parseDateEntity, matchAccountId, matchCategory } from './askVyactParser';
import { getCat, NEEDS_WANTS_MAP } from '../constants';
import { fmt } from './format';
import { nowMonthKey, getMonthKey } from './format';
import type { SafeSummary } from './aiSummary';
import type { IntentResult, AssistantBucket } from './askVyactIntents';
import { normaliseChips, type AssistantChip, type ResolveResult } from './askVyactResponses';
import {
  classifyIntentViaModel, phraseViaModel,
  InventedFigureError, ModelUnavailableError, type ModelCall,
} from './askVyactLlm';
import { resolveConfiguredModelCall } from './askVyactModelCall';
import { isAskVyactBucketEnabled, FEATURES } from '../config/features';

// ── Context passed through the pipeline (the same data the dashboard reads) ─────
export interface AssistantContext {
  summary: SafeSummary;
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  debts: Debt[];
  assets: Asset[];
  profile: Profile;
  rates: ExchangeRates;
  baseCurrency: string;
  /** Recurring schedules — for "upcoming bills". Optional; defaults to none. */
  recurring?: RecurringSchedule[];
  /**
   * v10.38 — the household's accounts, for seeding the paying account when a bank
   * message names one. Ids and names only; no balances are read here (money still
   * comes from the summary's canonical projection). Optional: callers that never
   * capture can omit it.
   */
  accounts?: { id: string; name: string; kind?: string }[];
}

// ── The two-method seam (rules now, LLM later) ─────────────────────────────────
// Both methods are ASYNC. The rules implementation resolves immediately (no I/O),
// but the signature must be Promise-shaped so a network-backed LlmBackend can be
// dropped in without touching a single call site. Stages 1/2/4 stay synchronous
// and pure — only the seam awaits.
export interface AssistantBackend {
  id: 'rules' | 'llm';
  classifyIntent(utterance: string, ctx: AssistantContext): Promise<IntentResult>;   // stage 3
  /**
   * `seed` selects the phrasing variant deterministically, so the same question
   * always reads the same way. It is part of the CONTRACT, not an implementation
   * detail of the rules backend: it used to be smuggled through a
   * `backend as RulesBackend` cast at the call site, which meant any backend not
   * declaring a 4th parameter silently dropped it and fell back to `Date.now()`
   * — making replies non-reproducible on that path, with no test to catch it.
   */
  phraseResponse(
    intent: IntentResult,
    result: ResolveResult,
    ctx: AssistantContext,
    seed?: number,
    /** v10.38 — figures the previous turn was allowed to state (guard context). */
    prevAllowed?: readonly string[],
  ): Promise<string>; // stage 5
}

export interface AssistantTurn {
  reply: string;
  bucket: AssistantBucket | 'none';
  intentId: string;
  /** Capture only — seed for the existing TransactionFormModal (openAddTxn). */
  seed?: Partial<Transaction>;
  /**
   * Up to three one-tap follow-ups (#62). Already normalised and capped by
   * `runAssistant` — a renderer may show these verbatim without re-checking.
   * `undefined` means this turn offers none, which is normal.
   */
  chips?: AssistantChip[];
  /** True when the turn is a clarifying chip / fallback rather than an answer. */
  clarify: boolean;
  /**
   * v10.38 — the money-shaped figures this turn was allowed to state. The chat keeps
   * them on the message so the next turn's guard can accept a figure the user quotes
   * back when challenging this answer.
   */
  allowedFigures?: string[];
}

// ── helpers ─────────────────────────────────────────────────────────────────
const cur = (ctx: AssistantContext) => ctx.baseCurrency;
const money = (n: number, ctx: AssistantContext) => fmt(Math.round(n), cur(ctx));

/** The default period when the user names none. */
const CURRENT_PERIOD = { monthKey: nowMonthKey(), label: 'this month', isCurrent: true } as const;

/** Rolling monthly average expense for a category over the last `n` months
 *  (excluding the current month). Pure composition of `spendByCategory`. */
function categoryRollingAvg(ctx: AssistantContext, category: string, n = 3, excludeMonth = nowMonthKey()): number {
  const months = [...new Set(ctx.transactions.map(t => getMonthKey(t.date)))]
    .sort().filter(m => m !== excludeMonth).slice(-n);
  if (!months.length) return 0;
  const sum = months.reduce((s, mk) => s + (spendByCategory(ctx.transactions, mk, cur(ctx), ctx.rates)[category] || 0), 0);
  return sum / months.length;
}

/**
 * v10.38 — a money fact that may be NEGATIVE, stated with its direction in words.
 *
 * `money()` formats through `fmt`, which takes `Math.abs` for display, so
 * `money(-34956)` reads "₹34,956". A fact called `available_above_floor` carrying
 * that string told the model a household was ₹34,956 ABOVE a floor it was
 * ₹34,956 BELOW — a real number, correctly copied, and the opposite of the truth.
 * Any fact that can cross zero goes through here.
 */
const signedMoney = (n: number, ctx: AssistantContext, up = 'above', down = 'below'): string =>
  `${money(Math.abs(n), ctx)} ${n < 0 ? down : up}`;

/**
 * Typical monthly spend and how many months it rests on — THE one baseline.
 * Cover, the emergency floor and every "your usual month" phrase divide by this.
 */
const basisOf = (ctx: AssistantContext) => ctx.summary.spendBasis;

/** How much history the averages rest on, in words the model can repeat. */
function basisLabel(ctx: AssistantContext): string {
  const b = basisOf(ctx);
  if (b.partialMonthOnly) return 'this month only — no completed month of history yet';
  return `${b.monthsConsidered} ${b.monthsConsidered === 1 ? 'completed month' : 'completed months'} of history`;
}

/**
 * Emergency-fund floor: three months of typical ESSENTIAL spending.
 *
 * v10.38 — needs, not everything. A floor built on total spend treats
 * discretionary spending as something you must keep funding through a crisis,
 * which overstates the cushion a household needs and made an affordable purchase
 * read as unaffordable. Both figures reach the model, so the answer can explain
 * which part is flexible.
 */
function emergencyFloor(ctx: AssistantContext): number {
  return basisOf(ctx).averageEssential * 3;
}

/**
 * The household position, shared by `interpret.status` and `forecast.prescriptive`.
 *
 * v10.38 — advice used to see only this month's categories, so "what should I do?"
 * could suggest trimming ₹54 from a household with a 95% savings rate and a
 * ₹25,45,000 mortgage at 8.75%. Advice needs the position, and the position is
 * already computed here.
 */
function positionFacts(ctx: AssistantContext) {
  const s = ctx.summary;
  return {
    net_worth: money(s.netWorth.netWorth, ctx),
    total_assets: money(s.netWorth.totalAssets, ctx),
    total_debt: money(s.netWorth.totalLiabilities, ctx),
    liquid_savings: money(s.netWorth.liquidAssets, ctx),
    months_of_liquid_cover: s.netWorth.liquidityMonths.toFixed(1),
    cover_basis: `typical monthly spending of ${money(basisOf(ctx).averageMonthly, ctx)}, averaged over ${basisLabel(ctx)}`,
    income_this_month: money(s.thisMonth.income, ctx),
    spending_this_month: money(s.thisMonth.expense, ctx),
    savings_rate_this_month: `${Math.round(s.thisMonth.netSavingsRate * 100)}%`,
    pulse_score: s.pulseScore.total == null ? 'not enough data yet' : `${s.pulseScore.total}/100`,
    budgets_over_limit: s.budgets.filter(b => b.spentPct > 100).map(b => getCat(b.category).label),
    largest_categories_this_month: s.thisMonth.topCategories.slice(0, 5)
      .map(t => ({ category: getCat(t.category).label, spent: money(t.amount, ctx) })),
  };
}

/**
 * The sentence shown when a capture pre-fills the form (v10.38, F7).
 *
 * Deterministic on purpose: it states exactly what was understood — amount,
 * category, date, account — and that nothing is recorded until the user saves.
 * A model adds nothing here (there are no facts to explain) and its output could
 * be discarded by the guard, leaving a form open with no explanation at all.
 */
/**
 * Every money-shaped figure this turn was allowed to state (v10.38).
 *
 * Kept on the transcript row so the NEXT turn's guard accepts a figure the user
 * quotes back when they challenge an answer. Same extraction the guard uses, so the
 * two cannot disagree.
 */
function figuresAllowedBy(result: ResolveResult): string[] {
  const source = JSON.stringify({ ...(result.vars ?? {}), facts: result.facts ?? {} });
  return [...new Set(source.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])];
}

function captureAcknowledgement(result: ResolveResult): string {
  const v = result.vars ?? {};
  const bits: string[] = [];
  if (v.amount) bits.push(String(v.amount));
  if (v.category) bits.push(`under ${String(v.category)}`);
  if (v.account) bits.push(`on ${String(v.account)}`);
  if (v.date) bits.push(`dated ${String(v.date)}`);
  const what = bits.length ? bits.join(' ') : 'the details you gave';
  return `I've pre-filled ${what}. Check it over and save it — nothing is recorded until you do.`;
}

/**
 * Debts, highest rate first — shared by `interpret.debts` and advice.
 *
 * SafeSummary debts carry a TYPE, never the user's own name for the debt: that is
 * deliberate egress minimisation, so the label comes from the type.
 */
function debtFacts(ctx: AssistantContext) {
  return [...ctx.summary.debts]
    .sort((a, b) => b.aprPct - a.aprPct)
    .map(d => ({
      debt: getCat(d.type).label || d.type,
      balance: money(d.balance, ctx),
      interest_rate: `${d.aprPct}%`,
      months_remaining: d.monthsRemaining != null ? String(d.monthsRemaining) : 'not set',
    }));
}

/** Does this category lean on onboarding estimates? (provenance, spec §5). */
function categoryUsesEstimate(ctx: AssistantContext, category: string): boolean {
  const b = ctx.budgets.find(x => x.category === category);
  if (b && b.confidence && b.confidence !== 'confirmed') return true;
  return ctx.transactions.some(t => t.category === category && t.confidence && t.confidence !== 'confirmed');
}

/**
 * v10.36 — every category spent in this month, largest first, with its usual
 * (rolling average) and the gap, pre-formatted for the model.
 *
 * Several intents used to compute exactly this and then keep only the single top
 * or worst category, which is why "where can I cut back?" could name just one.
 * Amounts go through `money()` so the model can cite them verbatim and pass
 * assertNoInventedFigures. Category LABELS only — never descriptions or merchant
 * text, which SafeSummary deliberately excludes from egress.
 */
function categoryBreakdown(ctx: AssistantContext, monthKey = nowMonthKey()) {
  const spend = spendByCategory(ctx.transactions, monthKey, cur(ctx), ctx.rates);
  return Object.entries(spend)
    .sort(([, a], [, b]) => b - a)
    .map(([c, amt]) => {
      // "Usual" always excludes the month being reported, so a past month is
      // compared with its neighbours rather than with itself.
      const usual = categoryRollingAvg(ctx, c, 3, monthKey);
      const gap = amt - usual;
      const nw = NEEDS_WANTS_MAP[c];
      return {
        category: getCat(c).label,
        spent: money(amt, ctx),
        usual_month: usual > 0 ? money(usual, ctx) : 'no history yet',
        compared_with_usual: usual > 0
          ? (gap >= 0 ? `${money(gap, ctx)} above` : `${money(-gap, ctx)} below`)
          : 'no history yet',
        kind: nw === 'want' ? 'discretionary' : nw === 'need' ? 'essential' : 'unclassified',
      };
    });
}

// ── Stage 4 — resolve (the ONLY place money is computed) ────────────────────────
export function resolve(intent: IntentResult, ctx: AssistantContext): ResolveResult {
  const e = intent.entities;

  switch (intent.id) {
    // ── Capture ───────────────────────────────────────────────────────────────
    case 'capture.expense':
    case 'capture.income':
    case 'capture.transfer':
    case 'capture.investment': {
      if (e.amount == null) {
        // No chips. The deck answers this case with three amounts drawn from
        // this user's own spend history ("₹200 · ₹500 · ₹1,000") — that needs
        // #70. The old `{ label: 'Add details' }` placeholder asked nothing, so
        // it could only ever have been a dead end had it reached a screen.
        return { kind: 'capture', outcome: 'missing_amount', vars: {} };
      }
      const type: TxnType = intent.id === 'capture.income' ? 'income'
        : intent.id === 'capture.transfer' ? 'transfer'
        : intent.id === 'capture.investment' ? 'investment' : 'expense';
      // v9 §3 — transfer-class rows carry no category ('' → null at the adapter).
      const transferClass = type === 'transfer' || type === 'investment';
      // v10.38 (F6) — a merchant the user or a bank message named is a category
      // signal, and KEYWORD_MAP already knows the common ones (swiggy → food_dining).
      // Without this, a pasted card alert filed every spend under "other", so the
      // user's category totals silently drifted with every SMS they forwarded.
      const category = transferClass ? ''
        : (e.category
          ?? (type === 'expense' ? matchCategory(String(e.merchant ?? '').toLowerCase()) : undefined)
          ?? (type === 'income' ? 'salary' : 'other_expense'));
      // The date and the account the message stated. Both were extracted and then
      // dropped, so a bank paste still made the user retype the date and pick the card.
      const statedDate = parseDateEntity(typeof e.date === 'string' ? e.date : undefined);
      const accountId = matchAccountId(typeof e.account === 'string' ? e.account : undefined, ctx.accounts ?? []);
      const accountName = accountId ? (ctx.accounts ?? []).find(a => a.id === accountId)?.name : undefined;
      const seed: Partial<Transaction> = {
        type, amount: e.amount, category,
        description: e.merchant ? e.merchant.charAt(0).toUpperCase() + e.merchant.slice(1) : '',
        ...(statedDate ? { date: statedDate } : {}),
        ...(accountId ? { accountId } : {}),
      };
      return {
        kind: 'capture', outcome: 'seeded', seed,
        vars: {
          amount: money(e.amount, ctx),
          category: transferClass
            ? (type === 'investment' ? 'investment' : 'transfer')
            : getCat(category).label.toLowerCase(),
          ...(statedDate ? { date: statedDate } : {}),
          ...(accountName ? { account: accountName } : {}),
        },
      };
    }
    case 'capture.split': {
      if (e.amount == null) {
        // No chips. The deck answers this case with three amounts drawn from
        // this user's own spend history ("₹200 · ₹500 · ₹1,000") — that needs
        // #70. The old `{ label: 'Add details' }` placeholder asked nothing, so
        // it could only ever have been a dead end had it reached a screen.
        return { kind: 'capture', outcome: 'missing_amount', vars: {} };
      }
      const ways = e.participantCount ?? 2;
      const share = Math.round((e.amount / ways) * 100) / 100;
      const split: SplitInfo = {
        isSplit: true, totalAmount: e.amount, yourShare: share, paidBy: 'me',
        participants: Array.from({ length: ways }, (_, i) => ({
          name: i === 0 ? 'me' : `Person ${i + 1}`, isYou: i === 0, share, paid: i === 0,
        })),
      };
      const seed: Partial<Transaction> = {
        type: 'expense', amount: e.amount, category: e.category ?? 'food_dining',
        description: e.merchant ? e.merchant.charAt(0).toUpperCase() + e.merchant.slice(1) : 'Split',
        split,
      };
      return {
        kind: 'capture', outcome: 'seeded', seed,
        vars: { amount: money(e.amount, ctx), ways, share: money(share, ctx) },
      };
    }

    // ── Interpret ───────────────────────────────────────────────────────────────
    case 'interpret.lookup': {
      // v10.38 (F1/F5) — the PERIOD the user named is honoured, and a question with
      // no category returns the period TOTAL.
      //
      // 🔴 What this replaced: the month was hard-coded to `nowMonthKey()` and an
      // absent category fell back to the biggest one. So "how much on food in
      // August" answered with THIS month's food figure under an August label, and
      // "how much did I spend this month?" answered for Rent alone with no total.
      // Both are true numbers answering a question nobody asked, and the
      // invented-figure guard cannot see the difference. When a stated period
      // cannot be placed we now say so instead of substituting today.
      const stated = typeof e.period === 'string' ? e.period : undefined;
      const period = resolvePeriod(stated) ?? (stated ? null : CURRENT_PERIOD);
      if (!period) {
        return {
          kind: 'interpret', outcome: 'needs_period',
          facts: { requested_period: String(stated), can_answer_for: 'this month or a named past month' },
          analysis: [`Could not place the period "${stated}"`],
          vars: { period: String(stated) },
        };
      }
      const mk = period.monthKey;
      const spend = spendByCategory(ctx.transactions, mk, cur(ctx), ctx.rates);
      const breakdown = categoryBreakdown(ctx, mk);
      const total = Object.values(spend).reduce((a, b) => a + b, 0);

      // No category named ⇒ the question is about the whole period.
      if (!e.category) {
        return {
          kind: 'interpret', outcome: breakdown.length ? 'period_total' : 'no_activity',
          chips: [
            { label: 'Where is it going?', prompt: 'where is my money going' },
            { label: 'Which budgets are at risk?', prompt: 'which budgets are at risk' },
          ],
          facts: {
            period: period.label,
            total_spent: money(total, ctx),
            categories_in_period: breakdown,
            category_count: String(breakdown.length),
          },
          analysis: [
            `Totalled ${period.label}'s spending across ${breakdown.length} ${breakdown.length === 1 ? 'category' : 'categories'}`,
          ],
          vars: { amount: money(total, ctx), period: period.label },
        };
      }

      const category = e.category;
      const amount = spend[category] || 0;
      const budget = ctx.budgets.find(b => b.category === category);
      const usesEstimate = categoryUsesEstimate(ctx, category);
      // The deck's canonical example of the rule: after a figure, the next
      // question is "why", never "open reports".
      const lookupChips: AssistantChip[] = [
        { label: 'Why is it up?', prompt: `why is my ${getCat(category).label.toLowerCase()} spending so high` },
        { label: 'Where else is it going?', prompt: 'where is my money going' },
      ];
      const label = getCat(category).label;
      const facts = {
        period: period.label,
        asked_about: label,
        spent: money(amount, ctx),
        budget: budget && budget.limit > 0 ? money(budget.limit, ctx) : 'no budget set',
        share_of_budget: budget && budget.limit > 0 ? `${Math.round((amount / budget.limit) * 100)}%` : 'no budget set',
        usual_month: breakdown.find(r => r.category === label)?.usual_month ?? 'no history yet',
        total_spent_in_period: money(total, ctx),
        every_category_in_period: breakdown,
      };
      const analysis = [
        `Totalled ${period.label}'s spending across ${breakdown.length} ${breakdown.length === 1 ? 'category' : 'categories'}`,
        budget && budget.limit > 0 ? `Compared ${label} with its budget` : `Compared ${label} with your usual month`,
      ];
      if (budget && budget.limit > 0) {
        return {
          kind: 'interpret', outcome: 'vs_budget', usesEstimate, chips: lookupChips, facts, analysis,
          vars: {
            amount: money(amount, ctx), category: getCat(category).label.toLowerCase(),
            pct: `${Math.round((amount / budget.limit) * 100)}%`, budget: money(budget.limit, ctx),
          },
        };
      }
      return {
        kind: 'interpret', outcome: 'ok', usesEstimate, chips: lookupChips, facts, analysis,
        vars: { amount: money(amount, ctx), category: getCat(category).label.toLowerCase() },
      };
    }
    // v10.38 (F9) — about the assistant, not the money. Reads NOTHING from the
    // household: no summary, no transactions, no budgets. "What do I call you?"
    // used to route to interpret.status and send the user's net worth, debts and
    // budgets to the model to answer a question about a name.
    case 'meta.assistant':
      return {
        kind: 'interpret', outcome: 'about_me',
        facts: { assistant_name: 'Ask Vyact', ...CAPABILITIES },
        analysis: ['Answered about myself — no household data read'],
        vars: {},
      };
    case 'interpret.status': {
      const s = ctx.summary;
      // One overview serves all three branches: net worth, balances and "how am I
      // doing" are the same question at different zoom levels, and each used to
      // get a single pre-written sentence.
      const facts = positionFacts(ctx);
      const analysis = [
        'Read your net worth, assets and debt',
        "Compared this month's income with your spending",
        `Checked ${s.budgets.length} ${s.budgets.length === 1 ? 'budget' : 'budgets'} and your largest categories`,
      ];
      if (/net ?worth|wealth/.test(e.text)) {
        return { kind: 'interpret', outcome: 'ok', facts, analysis, vars: {
          headline: `Your net worth is ${money(s.netWorth.netWorth, ctx)}.`,
          detail: `That's ${money(s.netWorth.totalAssets, ctx)} in assets minus ${money(s.netWorth.totalLiabilities, ctx)} of debt, with about ${s.netWorth.liquidityMonths.toFixed(1)} months of liquid cover.`,
        } };
      }
      if (/balance/.test(e.text)) {
        return { kind: 'interpret', outcome: 'ok', facts, analysis, vars: {
          headline: `You've got about ${money(s.netWorth.totalAssets, ctx)} across your accounts.`,
          detail: `Roughly ${s.netWorth.liquidityMonths.toFixed(1)} months of expenses in liquid savings.`,
        } };
      }
      const total = s.pulseScore.total ?? 0;
      return { kind: 'interpret', outcome: 'ok', facts, analysis, vars: {
        headline: `Your Pulse Score is ${total}/100.`,
        detail: total >= 80 ? 'Strong — keep doing what you are doing.'
          : total >= 65 ? 'Solid, with a little room to push.'
          : 'There is room to improve — Insights lists your next steps.',
      } };
    }
    case 'interpret.diagnostic': {
      const mk = nowMonthKey();
      const spend = spendByCategory(ctx.transactions, mk, cur(ctx), ctx.rates);
      // Biggest category vs its rolling average — the deterministic "why".
      let worst: { cat: string; now: number; avg: number; delta: number } | null = null;
      for (const [c, amt] of Object.entries(spend)) {
        const avg = categoryRollingAvg(ctx, c);
        const delta = amt - avg;
        if (avg > 0 && delta > 0 && (!worst || delta > worst.delta)) worst = { cat: c, now: amt, avg, delta };
      }
      const breakdown = categoryBreakdown(ctx);
      const compared = `Compared each of ${breakdown.length} ${breakdown.length === 1 ? 'category' : 'categories'} with its usual month`;
      if (worst && worst.delta / Math.max(worst.avg, 1) >= 0.2) {
        const pct = Math.round((worst.delta / worst.avg) * 100);
        // The chips deliberately exclude "Why so high?" — this reply has just
        // said why, and the deck bans a chip that repeats the answer.
        return { kind: 'interpret', outcome: 'found', usesEstimate: categoryUsesEstimate(ctx, worst.cat),
          facts: {
            every_category_this_month: breakdown,
            biggest_rise: {
              category: getCat(worst.cat).label,
              spent: money(worst.now, ctx),
              usual_month: money(worst.avg, ctx),
              above_usual: `${pct}%`,
            },
          },
          analysis: [compared, `${getCat(worst.cat).label} is furthest above its usual`],
          vars: {
            headline: `${getCat(worst.cat).label} is ${pct}% above your usual.`,
            detail: `It's at ${money(worst.now, ctx)} this month vs about ${money(worst.avg, ctx)} normally — that's the main pull on your cash.`,
          }, chips: [
            { label: `See ${getCat(worst.cat).label}`, prompt: `how much on ${worst.cat} this month` },
            { label: 'Where can I cut back?', prompt: 'where can I cut back' },
          ] };
      }
      return { kind: 'interpret', outcome: 'clear',
        facts: { every_category_this_month: breakdown, biggest_rise: 'nothing is well above its usual' },
        analysis: [compared, 'Nothing is running well above its usual'],
        vars: {
          detail: `your spending is tracking close to your normal pattern this month.`,
        }, chips: [
          { label: 'What did I spend most on?', prompt: 'what did I spend the most on this month' },
        ] };
    }
    case 'interpret.budgets': {
      const over = ctx.summary.budgets.filter(b => b.spentPct > 100);
      const near = ctx.summary.budgets.filter(b => b.spentPct > 80 && b.spentPct <= 100);
      const detail = over.length
        ? `${over.length} over: ${over.map(b => getCat(b.category).label).join(', ')}.`
        : near.length
          ? `${near.length} close to the limit: ${near.map(b => getCat(b.category).label).join(', ')}.`
          : ctx.summary.budgets.length ? `all ${ctx.summary.budgets.length} budgets are on track.` : `you have no budgets yet.`;
      // Chips only when there is something to chase — "Budgets look healthy"
      // needs no follow-up, and an offer of one implies a problem there isn't.
      const worstBudget = over[0] ?? near[0];
      const count = ctx.summary.budgets.length;
      return { kind: 'interpret', outcome: 'ok',
        facts: {
          budgets_most_used_first: [...ctx.summary.budgets].sort((a, b) => b.spentPct - a.spentPct).map(b => ({
            category: getCat(b.category).label,
            limit: money(b.limit, ctx),
            used: `${Math.round(b.spentPct)}%`,
            status: b.spentPct > 100 ? 'over budget' : b.spentPct > 80 ? 'close to limit' : 'on track',
          })),
          over_budget: over.map(b => getCat(b.category).label),
          close_to_limit: near.map(b => getCat(b.category).label),
        },
        analysis: [
          `Checked ${count} ${count === 1 ? 'budget' : 'budgets'} against spending`,
          over.length ? `${over.length} over budget` : near.length ? `${near.length} close to the limit` : 'All on track',
        ],
        vars: {
        headline: over.length ? 'Some budgets need attention.' : near.length ? 'A couple of budgets are getting close.' : 'Budgets look healthy.',
        detail,
      }, chips: worstBudget ? [
        { label: `Why is ${getCat(worstBudget.category).label} over?`, prompt: `why is my ${getCat(worstBudget.category).label.toLowerCase()} spending so high` },
        { label: 'Where can I cut back?', prompt: 'where can I cut back' },
      ] : undefined };
    }
    case 'interpret.debts': {
      const d = ctx.summary.debts;
      if (!d.length) return { kind: 'interpret', outcome: 'ok',
        facts: { debts: [], note: 'no debts recorded' }, analysis: ['Checked your debts — none recorded'],
        vars: { headline: "You're debt-free.", detail: 'Nothing to pay down right now.' } };
      // v10.38 (F10) — ONE total. This case used to sum the debts array while
      // `interpret.status` reported the live liabilities from the canonical net-worth
      // projection, so the same session saw ₹25,74,533 and ₹25,73,809.
      const totalDebt = ctx.summary.netWorth.totalLiabilities;
      const top = [...d].sort((a, b) => b.aprPct - a.aprPct)[0];
      const smallest = [...d].sort((a, b) => a.balance - b.balance)[0];
      const debtLabel = (x: { type: string }) => getCat(x.type).label || x.type;
      return { kind: 'interpret', outcome: 'ok',
        facts: {
          total_owed: money(totalDebt, ctx),
          debts_highest_rate_first: debtFacts(ctx),
          avalanche_pays_first: `${debtLabel(top)} (highest interest rate, saves the most interest)`,
          snowball_pays_first: `${debtLabel(smallest)} (smallest balance, quickest to clear)`,
        },
        analysis: [
          `Reviewed ${d.length} ${d.length === 1 ? 'debt' : 'debts'}`,
          'Ranked them by interest rate and by balance',
        ],
        vars: {
          headline: `You owe ${money(totalDebt, ctx)} across ${d.length} debt${d.length === 1 ? '' : 's'}.`,
          detail: `Highest rate: ${getCat(top.type).label || top.type} at ${top.aprPct}% — the avalanche method targets it first.`,
        } };
    }
    case 'interpret.bills': {
      const today = new Date();
      const soon = (ctx.recurring ?? [])
        .map(r => ({ r, due: new Date(r.nextDueDate) }))
        .filter(x => x.due >= new Date(today.getFullYear(), today.getMonth(), today.getDate()))
        .sort((a, b) => a.due.getTime() - b.due.getTime())
        .slice(0, 3);
      if (!soon.length) return { kind: 'interpret', outcome: 'ok',
        facts: { upcoming_soonest_first: [] }, analysis: ['Looked for upcoming bills — none tracked'],
        vars: { headline: 'No upcoming bills tracked.', detail: 'Add a recurring schedule to see what is due.' } };
      const detail = soon.map(x => `${x.r.transactionTemplate.description || getCat(x.r.transactionTemplate.category).label} (${x.r.nextDueDate})`).join(', ');
      return { kind: 'interpret', outcome: 'ok',
        // Facts use the category label, NOT `transactionTemplate.description`: the
        // description is user-authored text that SafeSummary excludes from egress.
        facts: {
          upcoming_soonest_first: soon.map(x => ({
            category: getCat(x.r.transactionTemplate.category).label,
            amount: money(x.r.transactionTemplate.amount, ctx),
            due: x.r.nextDueDate,
            posts: x.r.autoConfirm ? 'automatically' : 'after you approve it',
          })),
        },
        analysis: [`Found the next ${soon.length} upcoming ${soon.length === 1 ? 'bill' : 'bills'}`],
        vars: { headline: `Next up: ${soon.length} bill${soon.length === 1 ? '' : 's'}.`, detail } };
    }

    // ── Forecast (Planner-grounded) ──────────────────────────────────────────────
    case 'forecast.affordability': {
      // No chip: the reply itself asks "how much?", and a chip that repeats the
      // answer is exactly what the deck's rule forbids.
      if (e.amount == null) return { kind: 'forecast', outcome: 'missing_amount', vars: {},
        facts: { needs: 'the purchase amount' }, analysis: ['Need the purchase amount to check affordability'] };
      // v10.38 — ONE liquidity source (the canonical net-worth projection, which
      // includes live account balances) and ONE spend baseline. The old
      // `liquidAssets(ctx.assets)` read the assets array only, so this seam and
      // `interpret.status` reported 1.2 and 68.6 months of cover for the same money.
      const liquid = ctx.summary.netWorth.liquidAssets;
      const basis = basisOf(ctx);
      const floor = emergencyFloor(ctx);
      const headroom = liquid - floor;
      const affordFacts = {
        purchase: money(e.amount, ctx),
        liquid_savings: money(liquid, ctx),
        typical_monthly_spending: money(basis.averageMonthly, ctx),
        typical_essential_monthly: money(basis.averageEssential, ctx),
        typical_discretionary_monthly: money(basis.averageDiscretionary, ctx),
        months_considered: basisLabel(ctx),
        safety_floor: money(floor, ctx),
        safety_floor_basis: `three months of your typical essential spending, averaged over ${basisLabel(ctx)}`,
        // Signed: this crosses zero, and `money()` would print a deficit as a surplus.
        headroom_against_floor: signedMoney(headroom, ctx),
      };
      const affordAnalysis = [
        'Totalled your liquid savings',
        `Averaged your spending over ${basisLabel(ctx)}`,
        'Kept three months of essential spending aside as a safety floor',
        'Compared the purchase with what is left above it',
      ];
      if (headroom >= e.amount) {
        return { kind: 'forecast', outcome: 'fits',
          facts: { ...affordFacts, verdict: 'fits', left_above_floor_after: money(headroom - e.amount, ctx) },
          analysis: affordAnalysis,
          vars: {
          amount: money(e.amount, ctx), headroom: money(headroom, ctx),
          cushion: money(headroom - e.amount, ctx),
        }, chips: [
          { label: 'How long would my savings last?', prompt: 'how long would my savings last' },
        ] };
      }
      // The deck's chip here is "When is it comfortable?" — deliberately NOT
      // shipped: answering it needs payday as a modelled date (#68), and today
      // `payday` is only a trigger keyword. The old chip carried no prompt, so
      // it would have been untappable even had it reached a screen. These two
      // are answerable now.
      return { kind: 'forecast', outcome: 'tight',
        facts: { ...affordFacts, verdict: 'would dip into the safety floor', shortfall: money(e.amount - headroom, ctx) },
        analysis: affordAnalysis,
        vars: {
        amount: money(e.amount, ctx), shortfall: money(e.amount - headroom, ctx),
      }, chips: [
        { label: 'Where can I cut back?', prompt: 'where can I cut back' },
        { label: 'How long would my savings last?', prompt: 'how long would my savings last' },
      ] };
    }
    case 'forecast.runway': {
      // Same single source as affordability and status (v10.38).
      const liquid = ctx.summary.netWorth.liquidAssets;
      const basis = basisOf(ctx);
      const burn = basis.averageMonthly || (totalMonthlyDebtPayment(ctx.debts, cur(ctx), ctx.rates) + 1);
      const months = burn > 0 ? liquid / burn : 0;
      return { kind: 'forecast', outcome: 'ok',
        facts: {
          months_money_would_last: months.toFixed(1),
          liquid_savings: money(liquid, ctx),
          typical_monthly_spending: money(burn, ctx),
          typical_essential_monthly: money(basis.averageEssential, ctx),
          typical_discretionary_monthly: money(basis.averageDiscretionary, ctx),
          months_considered: basisLabel(ctx),
          largest_categories_this_month: categoryBreakdown(ctx).slice(0, 5),
        },
        analysis: [
          'Totalled your liquid savings',
          `Averaged your spending over ${basisLabel(ctx)}`,
          'Measured how many months the savings would cover',
        ],
        vars: { months: months.toFixed(1) }, chips: [
        { label: 'Where can I cut back?', prompt: 'where can I cut back' },
        { label: 'What is driving my spending?', prompt: 'where is my money going' },
      ] };
    }
    case 'forecast.prescriptive': {
      const target = e.amount;
      const mk = nowMonthKey();
      const spend = spendByCategory(ctx.transactions, mk, cur(ctx), ctx.rates);
      // Rank "want" categories by overage vs rolling average — least-painful trims.
      let best: { cat: string; over: number } | null = null;
      // Whether `best.over` is an amount ABOVE usual, or (fallback) the category's
      // whole spend because there is no history yet. The model must not describe a
      // total as an overage, so the facts say which one it is.
      let basis: 'above_usual' | 'total_spent' = 'above_usual';
      for (const [c, amt] of Object.entries(spend)) {
        if (NEEDS_WANTS_MAP[c] !== 'want') continue;
        const over = amt - categoryRollingAvg(ctx, c);
        if (over > 0 && (!best || over > best.over)) best = { cat: c, over };
      }
      if (!best) {
        // fall back to the single biggest discretionary category
        const top = Object.entries(spend).filter(([c]) => NEEDS_WANTS_MAP[c] === 'want')
          .sort(([, a], [, b]) => b - a)[0];
        if (top) { best = { cat: top[0], over: top[1] }; basis = 'total_spent'; }
      }
      const breakdown = categoryBreakdown(ctx);
      // v10.38 (F4) — advice sees the POSITION, not just this month's categories.
      // Without it, "what should I do?" could only suggest trimming the largest
      // discretionary line — ₹54 for a household with a 95% savings rate and a
      // mortgage at 8.75%. The biggest lever is rarely a category.
      const prescriptiveFacts = {
        savings_goal: target ? money(target, ctx) : 'not specified',
        ...positionFacts(ctx),
        debts_highest_rate_first: debtFacts(ctx),
        discretionary_categories: breakdown.filter(r => r.kind === 'discretionary'),
        essential_categories: breakdown.filter(r => r.kind === 'essential'),
      };
      const compared = `Compared ${breakdown.length} ${breakdown.length === 1 ? 'category' : 'categories'} with your usual month`;
      const positionRead = 'Read your income, savings rate, cushion and debts';
      if (!best) return { kind: 'forecast', outcome: 'ok', vars: { months: '0' },
        facts: { ...prescriptiveFacts, note: 'no discretionary spending recorded this month' },
        analysis: [positionRead, compared, 'No discretionary spending found to trim'] };
      return { kind: 'forecast', outcome: 'suggest',
        facts: {
          ...prescriptiveFacts,
          easiest_trim: getCat(best.cat).label,
          easiest_trim_figure: money(best.over, ctx),
          easiest_trim_figure_means: basis === 'above_usual'
            ? 'how much this category is above its usual month'
            : 'total spent in this category this month (no history yet to compare)',
        },
        analysis: [
          positionRead,
          compared,
          'Separated discretionary spending from essentials',
          `${getCat(best.cat).label} is the easiest place to trim`,
        ],
        vars: {
          target: target ? money(target, ctx) : 'some room',
          category: getCat(best.cat).label.toLowerCase(),
          over: money(best.over, ctx),
        } };
    }

    default:
      return fallback();
  }
}

function fallback(): ResolveResult {
  // v10.38 — a question we cannot place now arrives at the model WITH the
  // capability list, so the reply names the nearest thing that does work instead of
  // being a dead end. Validation produced a run of these ("plan October for the
  // festival season", "how much over the last 60 days") and every one deserved a
  // useful redirect rather than a shrug.
  return {
    kind: 'fallback', outcome: 'default',
    facts: { ...CAPABILITIES },
    analysis: ['Could not match this to something I can compute'],
    vars: {},
  };
}

/**
 * What Ask Vyact can and cannot answer, in the assistant's own words (v10.38).
 *
 * Handed to the model for `meta.assistant` and for any question whose data the app
 * does not hold, so "I can't do that" arrives WITH the nearest thing that works
 * instead of as a dead end. Kept beside `resolve()` because it must change whenever
 * the intent set does — a capability list that drifts is worse than none.
 */
export const CAPABILITIES = {
  can_answer: [
    'spending for this month or a named past month, by category or in total',
    'why spending moved, and which categories are above their usual',
    'your overall position: net worth, assets, debt, liquid cover, savings rate',
    'budget status, and which budgets are over their limit',
    'debts with balances and interest rates, and which to clear first',
    'upcoming and recurring bills',
    'whether a purchase fits above your safety floor',
    'how long your savings would last without income',
    'where you could cut back',
    'recording an expense, income, transfer, investment or split (you confirm the form)',
  ],
  cannot_answer_yet: [
    'windows other than whole months (last 60 days, since payday, daily pace)',
    'simulations: what an extra payment does to a payoff date, or to a net worth milestone',
    'who in the household logged or paid something, and how a shared split is balanced',
    'what changed over a period and why (net worth attribution)',
    'whether allocations cover a future dated commitment such as an annual premium',
    'anything about a future month: seasonal or festival planning',
  ],
} as const;

// ── LlmBackend — the ONLY assistant backend (v10.20) ────────────────────────────
//
// The deterministic `RulesBackend` was REMOVED in v10.20 by product decision:
// Ask Vyact is model-backed, with no rules fallback for classify/phrase.
//
// What did NOT move: stage 4, `resolve()` above. Every figure the assistant says
// still comes from it. The model decides WHICH question this is and says the
// answer in words — it never computes money. That is the binding rule, and
// `assertNoInventedFigures` enforces it on the way out rather than trusting the
// prompt to have been obeyed.
//
// CONSEQUENCE, stated plainly: with no model configured and reachable, Ask Vyact
// cannot answer. `runAssistant` surfaces that as an explicit unavailable turn —
// it must never silently degrade to a canned reply, because a finance assistant
// that quietly stops thinking while still sounding confident is worse than one
// that says it is unavailable.
export class LlmBackend implements AssistantBackend {
  readonly id = 'llm' as const;
  constructor(private readonly call: ModelCall) {}

  async classifyIntent(utterance: string, ctx: AssistantContext): Promise<IntentResult> {
    return classifyIntentViaModel(utterance, ctx, this.call);
  }

  /** `seed` is accepted for interface conformance; a model does not use a
   *  variant table, so phrasing variety comes from the model itself. */
  async phraseResponse(
    intent: IntentResult, result: ResolveResult, _ctx?: AssistantContext, _seed?: number,
    prevAllowed: readonly string[] = [],
  ): Promise<string> {
    return phraseViaModel(intent, result, this.call, prevAllowed);
  }
}

/**
 * The model transport. Resolved per turn (never memoised at module scope) so a
 * DB-driven configuration change takes effect on the next question rather than
 * requiring a page reload.
 *
 * Returns null when no model is configured — the caller must treat that as
 * "unavailable", not as a reason to invent an answer.
 */
export function selectModelCall(): ModelCall | null {
  return resolveConfiguredModelCall();
}

/** The active backend, or null when no model is reachable. */
export function selectAssistantBackend(): AssistantBackend | null {
  const call = selectModelCall();
  return call ? new LlmBackend(call) : null;
}

// ── The orchestrator — runs all five stages ─────────────────────────────────────
// The `backend` default is evaluated PER CALL (not captured at module load), so a
// runtime change to `FEATURES.askVyact.backend` takes effect on the next turn.
/** Plain-English name for each intent, shown as the "Recognised: …" step. */
const INTENT_LABEL: Record<string, string> = {
  'capture.expense': 'recording an expense',
  'capture.income': 'recording income',
  'capture.transfer': 'recording a transfer',
  'capture.investment': 'recording an investment',
  'capture.split': 'splitting a bill',
  'interpret.lookup': 'looking up your spending',
  'interpret.status': 'reviewing your overall position',
  'interpret.diagnostic': "working out what's driving your spending",
  'interpret.budgets': 'checking your budgets',
  'interpret.debts': 'reviewing your debts',
  'interpret.bills': 'finding your upcoming bills',
  'forecast.affordability': 'checking whether you can afford it',
  'forecast.runway': 'working out how long your money lasts',
  'forecast.prescriptive': 'finding where you could save',
  'meta.assistant': 'answering about me, not your money',
};

export async function runAssistant(
  utterance: string,
  ctx: AssistantContext,
  backend: AssistantBackend | null = selectAssistantBackend(),
  seed = Date.now(),
  /**
   * v10.36 — receives each analysis step as it ACTUALLY happens, so the chat can
   * print real progress while the model works. Each step maps to a real stage;
   * none is a timed placeholder. Optional: every existing caller and test passes
   * four arguments and is unaffected.
   */
  onProgress?: (step: string) => void,
  /**
   * v10.38 — figures the PREVIOUS assistant turn was allowed to use. Passed to the
   * guard so a follow-up may cite the number it is challenging; the guard is
   * otherwise per-turn, and discarded exactly that kind of correction.
   */
  prevAllowed: readonly string[] = [],
): Promise<AssistantTurn> {
  // No model configured or reachable. Say so — never fake an answer. There is no
  // rules fallback by design (v10.20), and a finance assistant that invents a
  // reply when it cannot think is worse than one that admits it is offline.
  if (!backend) return unavailableTurn('not_configured');

  onProgress?.('Understanding your question');
  let intent: IntentResult;
  try {
    intent = await backend.classifyIntent(utterance, ctx);         // stages 1–3
  } catch (err) {
    if (err instanceof ModelUnavailableError) return unavailableTurn('unreachable');
    throw err;
  }

  // Per-bucket gate: a disabled bucket degrades to a clarifying fallback (§2).
  const gated = intent.bucket !== 'none' && !isAskVyactBucketEnabled(intent.bucket);
  const effective: IntentResult = gated
    ? { ...intent, id: 'fallback', bucket: 'none' }
    : intent;
  if (INTENT_LABEL[effective.id]) onProgress?.(`Recognised: ${INTENT_LABEL[effective.id]}`);
  const result = gated ? fallback() : resolve(effective, ctx);     // stage 4 (never LLM)
  for (const step of result.analysis ?? []) onProgress?.(step);

  // v10.38 (F7) — a seeded capture is acknowledged DETERMINISTICALLY, with no model
  // call at all.
  //
  // Capture handed the model `facts: {}` — there was nothing to phrase — and the
  // chat navigated to the pre-filled form as soon as the turn resolved, so the
  // sentence the model was writing arrived after the form had replaced the chat, or
  // (when the guard rejected a date or the user's own amount) never arrived at all.
  // One less call, half the latency, and the acknowledgement always exists.
  if (result.kind === 'capture' && result.outcome === 'seeded') {
    return {
      reply: captureAcknowledgement(result),
      bucket: effective.bucket,
      intentId: effective.id,
      seed: result.seed,
      chips: normaliseChips(result.chips),
      clarify: false,
      allowedFigures: figuresAllowedBy(result),
    };
  }

  onProgress?.('Writing your answer');
  let reply: string;
  try {
    reply = await backend.phraseResponse(effective, result, ctx, seed, prevAllowed);
  } catch (err) {
    if (err instanceof ModelUnavailableError) return unavailableTurn('unreachable');
    // The model put a figure in the reply that no tool computed. Discard the
    // whole reply: showing an invented number in a finance app is the one
    // failure this system exists to prevent.
    if (err instanceof InventedFigureError) return unavailableTurn('unverified_figures');
    throw err;
  }

  return {
    reply,
    bucket: effective.bucket,
    intentId: effective.id,
    seed: result.seed,
    // The ONE place the cap and the well-formedness rule are applied, so every
    // channel gets the same list and no call site can opt out of the limit.
    chips: normaliseChips(result.chips),
    clarify: gated || result.kind === 'fallback' || result.outcome === 'missing_amount',
    allowedFigures: figuresAllowedBy(result),
  };
}

/** Reason codes are distinct so telemetry can tell "never set up" from
 *  "set up but broken" from "the model misbehaved" — three different fixes. */
export type UnavailableReason = 'not_configured' | 'unreachable' | 'unverified_figures';

const UNAVAILABLE_COPY: Record<UnavailableReason, string> = {
  not_configured: "Ask Vyact isn't set up yet.",
  unreachable: "I can't reach the assistant right now. Your data is untouched — please try again shortly.",
  unverified_figures: "I couldn't verify the numbers in that answer, so I haven't shown it. Please ask again.",
};

function unavailableTurn(reason: UnavailableReason): AssistantTurn {
  return {
    reply: UNAVAILABLE_COPY[reason],
    bucket: 'none',
    intentId: 'unavailable',
    clarify: true,
  };
}

// ── Proactive "what to know" (spec §5, gated by proactiveInsight) ───────────────
export interface ProactiveInsight { text: string; chipPrompt?: string; }

/** At most ONE insight, ranked by materiality. Positive observations count too.
 *  Pure read over the summary + entities; caller rate-limits to one per session. */
export function proactiveInsight(ctx: AssistantContext): ProactiveInsight | null {
  if (!FEATURES.askVyact.proactiveInsight || !isAskVyactBucketEnabled('interpret')) return null;
  const s = ctx.summary;

  // 1) A budget meaningfully over — highest materiality.
  const over = s.budgets.filter(b => b.spentPct > 100).sort((a, b) => b.spentPct - a.spentPct)[0];
  if (over) {
    return {
      text: `Your ${getCat(over.category).label.toLowerCase()} is ${Math.round(over.spentPct)}% of budget — want to see why?`,
      chipPrompt: `why is my ${over.category} so high`,
    };
  }
  // 2) A category running hot vs its norm.
  const mk = nowMonthKey();
  const spend = spendByCategory(ctx.transactions, mk, cur(ctx), ctx.rates);
  let hot: { cat: string; pct: number } | null = null;
  for (const [c, amt] of Object.entries(spend)) {
    const avg = categoryRollingAvg(ctx, c);
    if (avg > 0) {
      const pct = Math.round(((amt - avg) / avg) * 100);
      if (pct >= 30 && (!hot || pct > hot.pct)) hot = { cat: c, pct };
    }
  }
  if (hot) {
    return {
      text: `Your ${getCat(hot.cat).label.toLowerCase()} is ${hot.pct}% above your usual — want to see why?`,
      chipPrompt: `where is my money going`,
    };
  }
  // 3) Positive: beating the savings target.
  if (s.thisMonth.netSavingsRate >= 0.2) {
    return { text: `You're on track to save ${Math.round(s.thisMonth.netSavingsRate * 100)}% this month — nicely done.` };
  }
  return null;
}
