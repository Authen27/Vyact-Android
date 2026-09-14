// Vyact v7.5 — AI Summary
// Privacy-safe aggregation for the Chatbot.
// CRITICAL: this is the ONLY data shape that ever leaves the device for AI.
// Per the v7 PRD: no merchant names, no transaction descriptions, no notes.
// Only categories + amounts + date ranges + aggregates.

import type {
  Transaction, Budget, BudgetAllocation, Goal, Debt, Asset, Account, Profile, ExchangeRates,
} from '../types';
import {
  monthlyData, computePulseScore,
  spendByCategory, reportableTxns, budgetLinesForMonth,
} from './calculations';
import { computeNetWorth } from './netWorth';
import { convert } from './format';
import { nowMonthKey, getMonthKey } from './format';
// Type-only, and one-directional: askVyactResponses does not import this module,
// so the transcript can carry chips without creating an import cycle.
import type { AssistantChip } from './askVyactResponses';


// The structure sent to the LLM. NO PII. NO descriptions.
export interface SafeSummary {
  asOf: string;                          // ISO date
  baseCurrency: string;
  household: {
    type: string;
    members: number;
  };
  // NOTE/TODO: `computePulseScore` now may return `total: number | null`.
  // TODO(review): The handoff brief assumed `pulseScore.total` was always a
  // number and that only the gauge consumed it. In this code the summary
  // also includes the pulse. Accept `null` here and coerce to `0` in the
  // consumer below. Senior review: confirm whether `null` should be
  // represented differently in AI summaries.
  pulseScore: { total: number | null; components: Record<string, number> };
  thisMonth: {
    monthKey: string;
    income: number;
    expense: number;
    netSavingsRate: number;              // 0..1
    topCategories: { category: string; amount: number }[];
  };
  trend6m: { monthKey: string; income: number; expense: number }[];
  netWorth: {
    totalAssets: number;
    totalLiabilities: number;
    netWorth: number;
    liquidityMonths: number;             // liquid / monthly expenses
    debtToAssetPct: number;
  };
  budgets: { category: string; limit: number; spentPct: number }[];
  goals:   { type: string; targetPct: number; daysToDeadline: number | null }[];
  debts:   { type: string; balance: number; aprPct: number; monthsRemaining?: number }[];
}

// NOTE (v10.20): the SubAgent registry, its intent router and the default
// pattern-matching stub agent were REMOVED with the ChatBackend cluster they
// served. Nothing outside this file ever registered an agent, and the stub
// shipped stale user-facing copy ("backend not yet wired"). The agent service
// in supabase/functions/_shared/agent/ is the extension point now.

export function buildSafeSummary(
  txns: Transaction[], budgets: Budget[], goals: Goal[],
  debts: Debt[], assets: Asset[], profile: Profile, rates: ExchangeRates,
  accounts: Account[] = [], allocations: BudgetAllocation[] = [],
): SafeSummary {
  const cur = profile.baseCurrency;
  const mk = nowMonthKey();
  const month = monthlyData(txns, mk, cur, rates);
  // Audit F3 — the assistant's net worth comes from the SAME canonical
  // projection the Dashboard and Net Worth pages render (live account balances
  // on both sides, unlinked assets/debts, receivables excluded), not the
  // static assets/debts arrays that used to disagree with the UI.
  const nwProjection = computeNetWorth({ assets, accounts, debts, transactions: txns }, cur, rates);
  const ta = nwProjection.totalAssets;
  const tl = nwProjection.totalLiabilities;
  const liquid = nwProjection.liquidAssets;
  const monthlyExpFor6m = month.expense;
  const liquidityMonths = monthlyExpFor6m > 0 ? liquid / monthlyExpFor6m : 0;
  // Audit F5 — Pulse sees the allocation-derived budget lines.
  const pulse = computePulseScore(txns, budgets, goals, debts, cur, rates, allocations);

  // Top 5 expense categories this month — by category id only (no merchants)
  const spend = spendByCategory(txns, mk, cur, rates);
  const topCategories = Object.entries(spend)
    .sort(([, a], [, b]) => b - a).slice(0, 5)
    .map(([category, amount]) => ({ category, amount: round2(amount) }));

  // 6-month trend
  const months = [...new Set(reportableTxns(txns).map(t => getMonthKey(t.date)))].sort().slice(-6);
  const trend6m = months.map(m => {
    const md = monthlyData(txns, m, cur, rates);
    return { monthKey: m, income: round2(md.income), expense: round2(md.expense) };
  });

  // Budgets with usage % only — no spending detail.
  // Audit F5: read the CURRENT month's allocation-derived category lines (a
  // container budget is not a category line). Audit F4: convert() — the ONE
  // FX path (USD-based rate table, dinero-exact); the old `rates[c]/rates[cur]`
  // was the INVERSE ratio and skipped unknown rates silently.
  const safeBudgets = budgetLinesForMonth(budgets, allocations, mk).map(b => {
    const limitBase = convert(b.limit, b.currency, cur, rates);
    const spent = spend[b.category ?? ''] || 0;
    return {
      category: b.category ?? '',
      limit: round2(limitBase),
      spentPct: limitBase > 0 ? round2(spent / limitBase * 100) : 0,
    };
  });

  // Goals with progress only (audit F4: central conversion).
  const safeGoals = goals.map(g => {
    const tgt = convert(g.target, g.currency, cur, rates);
    const pct = tgt > 0 ? (convert(g.current, g.currency, cur, rates) / tgt) * 100 : 0;
    const daysToDeadline = g.deadline
      ? Math.ceil((new Date(g.deadline).getTime() - Date.now()) / 86400000)
      : null;
    return { type: g.type, targetPct: round2(pct), daysToDeadline };
  });

  // Debts with balance + APR only — no lender name, no account number.
  // Audit F4: the old `* rates[d.currency] / rates[cur]` inverted the ratio
  // (an INR debt came out 83× too small against a USD base).
  const safeDebts = debts.map(d => ({
    type: d.type,
    balance: round2(convert(d.currentBalance, d.currency, cur, rates)),
    aprPct: d.interestRate,
    monthsRemaining: d.remainingMonths,
  }));

  return {
    asOf: new Date().toISOString().split('T')[0],
    baseCurrency: cur,
    household: { type: profile.household, members: 0 /* caller sets */ },
    pulseScore: pulse,
    thisMonth: {
      monthKey: mk,
      income: round2(month.income),
      expense: round2(month.expense),
      netSavingsRate: month.income > 0 ? round2((month.income - month.expense) / month.income) : 0,
      topCategories,
    },
    trend6m,
    netWorth: {
      totalAssets: round2(ta),
      totalLiabilities: round2(tl),
      netWorth: round2(ta - tl),
      liquidityMonths: round2(liquidityMonths),
      debtToAssetPct: ta > 0 ? round2(tl / ta * 100) : 0,
    },
    budgets: safeBudgets,
    goals: safeGoals,
    debts: safeDebts,
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── Chat message shape ───────────────────────────────────────────────────────
//
// v10.20: the ChatBackend cluster that lived here — ChatBackend, StubChatBackend,
// SupabaseChatBackend (which only ever threw), selectChatBackend, the SubAgent
// registry and the browser-direct Gemini client — was REMOVED. It was a second,
// parallel chat path, reachable only when Ask Vyact was switched off, and it
// shipped its provider key in the browser bundle where anyone could read it.
//
// Ask Vyact is now the single assistant, and its key lives server-side in the
// ask-vyact Edge Function. See askVyactModelCall.ts.

/** A turn in the visible chat transcript. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /**
   * Assistant turns only — the one-tap follow-ups offered with this reply (#62).
   *
   * Stored ON the message rather than in component state because the transcript
   * is persisted to localStorage: keeping them together means reopening Ask
   * Vyact restores the reply and its chips as one unit, and a message can never
   * be paired with another turn's chips.
   *
   * Already normalised and capped at three by `runAssistant` — a renderer shows
   * them as given. Old transcripts predate the field and simply have none.
   */
  chips?: AssistantChip[];
  /**
   * Audit 6.5 — a per-turn id set when the reply row is created. The streaming
   * writer targets the row by this id (never "the last item"), so a message
   * appended mid-stream cannot be corrupted by an in-flight stream. Optional;
   * persisted transcripts carry it harmlessly.
   */
  turnId?: string;
  /**
   * v10.36 — analysis steps printed live while the turn is in flight, then kept
   * (collapsed) with the reply. Deterministic progress labels from the pipeline,
   * never model-authored text.
   */
  steps?: string[];
  /** Wall-clock time from send until the answer was ready — "Analysed in Ns". */
  thinkingMs?: number;
  /**
   * True while the turn is in flight. Stripped when the transcript is reloaded,
   * so a turn interrupted mid-flight never renders as permanently thinking.
   */
  pending?: boolean;
}
