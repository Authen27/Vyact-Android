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
  spendByCategory, monthlyData, liquidAssets, totalMonthlyDebtPayment,
} from './calculations';
import { getCat, NEEDS_WANTS_MAP } from '../constants';
import { fmt } from './format';
import { nowMonthKey, getMonthKey } from './format';
import type { SafeSummary } from './aiSummary';
import {
  classifyIntent as rulesClassify, type IntentResult, type AssistantBucket,
} from './askVyactIntents';
import { parse } from './askVyactParser';
import { phraseResponse as rulesPhrase, type ResolveResult } from './askVyactResponses';
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
}

// ── The two-method seam (rules now, LLM later) ─────────────────────────────────
export interface AssistantBackend {
  id: 'rules' | 'llm';
  classifyIntent(utterance: string, ctx: AssistantContext): IntentResult;   // stage 3
  phraseResponse(intent: IntentResult, result: ResolveResult, ctx: AssistantContext): string; // stage 5
}

export interface AssistantTurn {
  reply: string;
  bucket: AssistantBucket | 'none';
  intentId: string;
  /** Capture only — seed for the existing TransactionFormModal (openAddTxn). */
  seed?: Partial<Transaction>;
  /** True when the turn is a clarifying chip / fallback rather than an answer. */
  clarify: boolean;
}

// ── helpers ─────────────────────────────────────────────────────────────────
const cur = (ctx: AssistantContext) => ctx.baseCurrency;
const money = (n: number, ctx: AssistantContext) => fmt(Math.round(n), cur(ctx));

/** Rolling monthly average expense for a category over the last `n` months
 *  (excluding the current month). Pure composition of `spendByCategory`. */
function categoryRollingAvg(ctx: AssistantContext, category: string, n = 3): number {
  const months = [...new Set(ctx.transactions.map(t => getMonthKey(t.date)))]
    .sort().filter(m => m !== nowMonthKey()).slice(-n);
  if (!months.length) return 0;
  const sum = months.reduce((s, mk) => s + (spendByCategory(ctx.transactions, mk, cur(ctx), ctx.rates)[category] || 0), 0);
  return sum / months.length;
}

/** Average monthly expense (burn) over recent months — for runway/affordability. */
function monthlyBurn(ctx: AssistantContext): number {
  const t = ctx.summary.trend6m;
  if (t.length) return t.reduce((s, m) => s + m.expense, 0) / t.length;
  return ctx.summary.thisMonth.expense;
}

/** Emergency-fund floor: 3× monthly burn (goals are no longer a module). */
function emergencyFloor(ctx: AssistantContext): number {
  return monthlyBurn(ctx) * 3;
}

/** Does this category lean on onboarding estimates? (provenance, spec §5). */
function categoryUsesEstimate(ctx: AssistantContext, category: string): boolean {
  const b = ctx.budgets.find(x => x.category === category);
  if (b && b.confidence && b.confidence !== 'confirmed') return true;
  return ctx.transactions.some(t => t.category === category && t.confidence && t.confidence !== 'confirmed');
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
        return { kind: 'capture', outcome: 'missing_amount', vars: {}, chip: { label: 'Add details' } };
      }
      const type: TxnType = intent.id === 'capture.income' ? 'income'
        : intent.id === 'capture.transfer' ? 'transfer'
        : intent.id === 'capture.investment' ? 'investment' : 'expense';
      // v9 §3 — transfer-class rows carry no category ('' → null at the adapter).
      const transferClass = type === 'transfer' || type === 'investment';
      const category = transferClass ? ''
        : (e.category ?? (type === 'income' ? 'salary' : 'other_expense'));
      const seed: Partial<Transaction> = {
        type, amount: e.amount, category,
        description: e.merchant ? e.merchant.charAt(0).toUpperCase() + e.merchant.slice(1) : '',
      };
      return {
        kind: 'capture', outcome: 'seeded', seed,
        vars: {
          amount: money(e.amount, ctx),
          category: transferClass
            ? (type === 'investment' ? 'investment' : 'transfer')
            : getCat(category).label.toLowerCase(),
        },
      };
    }
    case 'capture.split': {
      if (e.amount == null) {
        return { kind: 'capture', outcome: 'missing_amount', vars: {}, chip: { label: 'Add details' } };
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
      const mk = nowMonthKey();
      const spend = spendByCategory(ctx.transactions, mk, cur(ctx), ctx.rates);
      const category = e.category
        ?? Object.entries(spend).sort(([, a], [, b]) => b - a)[0]?.[0];
      if (!category) return fallback();
      const amount = spend[category] || 0;
      const budget = ctx.budgets.find(b => b.category === category);
      const usesEstimate = categoryUsesEstimate(ctx, category);
      if (budget && budget.limit > 0) {
        return {
          kind: 'interpret', outcome: 'vs_budget', usesEstimate,
          vars: {
            amount: money(amount, ctx), category: getCat(category).label.toLowerCase(),
            pct: `${Math.round((amount / budget.limit) * 100)}%`, budget: money(budget.limit, ctx),
          },
        };
      }
      return {
        kind: 'interpret', outcome: 'ok', usesEstimate,
        vars: { amount: money(amount, ctx), category: getCat(category).label.toLowerCase() },
      };
    }
    case 'interpret.status': {
      const s = ctx.summary;
      if (/net ?worth|wealth/.test(e.text)) {
        return { kind: 'interpret', outcome: 'ok', vars: {
          headline: `Your net worth is ${money(s.netWorth.netWorth, ctx)}.`,
          detail: `That's ${money(s.netWorth.totalAssets, ctx)} in assets minus ${money(s.netWorth.totalLiabilities, ctx)} of debt, with about ${s.netWorth.liquidityMonths.toFixed(1)} months of liquid cover.`,
        } };
      }
      if (/balance/.test(e.text)) {
        return { kind: 'interpret', outcome: 'ok', vars: {
          headline: `You've got about ${money(s.netWorth.totalAssets, ctx)} across your accounts.`,
          detail: `Roughly ${s.netWorth.liquidityMonths.toFixed(1)} months of expenses in liquid savings.`,
        } };
      }
      const total = s.pulseScore.total ?? 0;
      return { kind: 'interpret', outcome: 'ok', vars: {
        headline: `Your Pulse Score is ${total}/100.`,
        detail: total >= 80 ? 'Strong — keep doing what you are doing.'
          : total >= 65 ? 'Solid, with a little room to push.'
          : 'There is room to improve — the Planner has prioritised steps.',
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
      if (worst && worst.delta / Math.max(worst.avg, 1) >= 0.2) {
        const pct = Math.round((worst.delta / worst.avg) * 100);
        return { kind: 'interpret', outcome: 'found', usesEstimate: categoryUsesEstimate(ctx, worst.cat), vars: {
          headline: `${getCat(worst.cat).label} is ${pct}% above your usual.`,
          detail: `It's at ${money(worst.now, ctx)} this month vs about ${money(worst.avg, ctx)} normally — that's the main pull on your cash.`,
        }, chip: { label: `See ${getCat(worst.cat).label}`, prompt: `how much on ${worst.cat} this month` } };
      }
      return { kind: 'interpret', outcome: 'clear', vars: {
        detail: `your spending is tracking close to your normal pattern this month.`,
      } };
    }
    case 'interpret.budgets': {
      const over = ctx.summary.budgets.filter(b => b.spentPct > 100);
      const near = ctx.summary.budgets.filter(b => b.spentPct > 80 && b.spentPct <= 100);
      const detail = over.length
        ? `${over.length} over: ${over.map(b => getCat(b.category).label).join(', ')}.`
        : near.length
          ? `${near.length} close to the limit: ${near.map(b => getCat(b.category).label).join(', ')}.`
          : ctx.summary.budgets.length ? `all ${ctx.summary.budgets.length} budgets are on track.` : `you have no budgets yet.`;
      return { kind: 'interpret', outcome: 'ok', vars: {
        headline: over.length ? 'Some budgets need attention.' : near.length ? 'A couple of budgets are getting close.' : 'Budgets look healthy.',
        detail,
      } };
    }
    case 'interpret.debts': {
      const d = ctx.summary.debts;
      if (!d.length) return { kind: 'interpret', outcome: 'ok', vars: { headline: "You're debt-free.", detail: 'Nothing to pay down right now.' } };
      const totalDebt = d.reduce((s, x) => s + x.balance, 0);
      const top = [...d].sort((a, b) => b.aprPct - a.aprPct)[0];
      return { kind: 'interpret', outcome: 'ok', vars: {
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
      if (!soon.length) return { kind: 'interpret', outcome: 'ok', vars: { headline: 'No upcoming bills tracked.', detail: 'Add a recurring schedule to see what is due.' } };
      const detail = soon.map(x => `${x.r.transactionTemplate.description || getCat(x.r.transactionTemplate.category).label} (${x.r.nextDueDate})`).join(', ');
      return { kind: 'interpret', outcome: 'ok', vars: { headline: `Next up: ${soon.length} bill${soon.length === 1 ? '' : 's'}.`, detail } };
    }

    // ── Forecast (Planner-grounded) ──────────────────────────────────────────────
    case 'forecast.affordability': {
      if (e.amount == null) return { kind: 'forecast', outcome: 'missing_amount', vars: {}, chip: { label: 'How much?' } };
      const liquid = liquidAssets(ctx.assets, cur(ctx), ctx.rates);
      const floor = emergencyFloor(ctx);
      const headroom = liquid - floor;
      if (headroom >= e.amount) {
        return { kind: 'forecast', outcome: 'fits', vars: {
          amount: money(e.amount, ctx), headroom: money(headroom, ctx),
          cushion: money(headroom - e.amount, ctx),
        } };
      }
      return { kind: 'forecast', outcome: 'tight', vars: {
        amount: money(e.amount, ctx), shortfall: money(e.amount - headroom, ctx),
      }, chip: { label: 'When is it comfortable?' } };
    }
    case 'forecast.runway': {
      const liquid = liquidAssets(ctx.assets, cur(ctx), ctx.rates);
      const burn = monthlyBurn(ctx) || (totalMonthlyDebtPayment(ctx.debts, cur(ctx), ctx.rates) + 1);
      const months = burn > 0 ? liquid / burn : 0;
      return { kind: 'forecast', outcome: 'ok', vars: { months: months.toFixed(1) } };
    }
    case 'forecast.prescriptive': {
      const target = e.amount;
      const mk = nowMonthKey();
      const spend = spendByCategory(ctx.transactions, mk, cur(ctx), ctx.rates);
      // Rank "want" categories by overage vs rolling average — least-painful trims.
      let best: { cat: string; over: number } | null = null;
      for (const [c, amt] of Object.entries(spend)) {
        if (NEEDS_WANTS_MAP[c] !== 'want') continue;
        const over = amt - categoryRollingAvg(ctx, c);
        if (over > 0 && (!best || over > best.over)) best = { cat: c, over };
      }
      if (!best) {
        // fall back to the single biggest discretionary category
        const top = Object.entries(spend).filter(([c]) => NEEDS_WANTS_MAP[c] === 'want')
          .sort(([, a], [, b]) => b - a)[0];
        if (top) best = { cat: top[0], over: top[1] };
      }
      if (!best) return { kind: 'forecast', outcome: 'ok', vars: { months: '0' } };
      return { kind: 'forecast', outcome: 'suggest', vars: {
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
  return { kind: 'fallback', outcome: 'default', vars: {} };
}

// ── RulesBackend — the shipped AssistantBackend (stages 3 + 5) ──────────────────
export class RulesBackend implements AssistantBackend {
  readonly id = 'rules' as const;
  classifyIntent(utterance: string): IntentResult {
    return rulesClassify(parse(utterance));
  }
  // The variant key is `${intent.id}.${outcome}` — intent.id already distinguishes
  // expense/income/transfer/split, so no remapping is needed.
  phraseResponse(intent: IntentResult, result: ResolveResult, _ctx?: AssistantContext, seed?: number): string {
    return rulesPhrase(intent, result, seed);
  }
}

// ── LlmBackend — future drop-in. Inherits stages 1/2/4 with ZERO change; only
//    classify (3) + phrase (5) become model calls. Stubbed so the seam compiles
//    and an acceptance test can swap it in (spec §9). ─────────────────────────
export class LlmBackend implements AssistantBackend {
  readonly id = 'llm' as const;
  // TODO(future-major v7.0): replace these two bodies with model calls. The
  // payload is the existing aiSummary aggregation only — never raw transactions.
  classifyIntent(utterance: string): IntentResult {
    return rulesClassify(parse(utterance)); // safe default until the model lands
  }
  phraseResponse(intent: IntentResult, result: ResolveResult): string {
    return rulesPhrase(intent, result);
  }
}

/** Select the active backend per the feature flag (the existing selection seam). */
export function selectAssistantBackend(): AssistantBackend {
  return FEATURES.askVyact.backend === 'llm' ? new LlmBackend() : new RulesBackend();
}

// ── The orchestrator — runs all five stages ─────────────────────────────────────
export function runAssistant(
  utterance: string,
  ctx: AssistantContext,
  backend: AssistantBackend = selectAssistantBackend(),
  seed = Date.now(),
): AssistantTurn {
  const intent = backend.classifyIntent(utterance, ctx);          // stages 1–3
  // Per-bucket gate: a disabled bucket degrades to a clarifying fallback (§2).
  if (intent.bucket !== 'none' && !isAskVyactBucketEnabled(intent.bucket)) {
    const r = fallback();
    return { reply: backend.phraseResponse({ ...intent, id: 'fallback' }, r, ctx), bucket: 'none', intentId: 'fallback', clarify: true };
  }
  const result = resolve(intent, ctx);                            // stage 4 (never LLM)
  // RulesBackend accepts a 4th `seed` arg for deterministic phrasing in tests;
  // the AssistantBackend interface only requires the first three.
  const reply = (backend as RulesBackend).phraseResponse(intent, result, ctx, seed);
  return {
    reply,
    bucket: intent.bucket,
    intentId: intent.id,
    seed: result.seed,
    clarify: result.kind === 'fallback' || result.outcome === 'missing_amount',
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
