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
import { computeNetWorth, cardDues } from './netWorth';
import { computeAccountBalance } from './accountBalance';
import { NEEDS_WANTS_MAP } from '../constants';
import { convert } from './format';
import { nowMonthKey, getMonthKey } from './format';
// Type-only, and one-directional: askVyactResponses does not import this module,
// so the transcript can carry chips without creating an import cycle.
import type { AssistantChip } from './askVyactResponses';


/**
 * v10.38 — the household's typical monthly spending, and how much history that
 * average actually rests on.
 *
 * WHY IT EXISTS. "Months of cover" and the emergency floor were each computed
 * from a different denominator: the status seam divided by THIS month's expense
 * (so cover looked huge on the 2nd and shrank all month), while affordability and
 * runway used a 6-month mean. One definition, stated to the user: the average over
 * up to six COMPLETED months, fewer when that is all the history there is, and
 * `monthsConsidered` says which — an answer may never imply more history than the
 * household has. The needs/wants split comes from `NEEDS_WANTS_MAP`, so an answer
 * can separate the part of spending that is genuinely flexible.
 */
export interface SpendBasis {
  /** Completed months the averages rest on; 0 when only the current month exists. */
  monthsConsidered: number;
  /** True when the figures come from the current, still-incomplete month. */
  partialMonthOnly: boolean;
  averageMonthly: number;
  averageEssential: number;
  averageDiscretionary: number;
}

/**
 * Average monthly spend over up to `maxMonths` completed months.
 *
 * Uses `spendByCategory` (already currency-converted) so the needs/wants split and
 * the total cannot drift apart, and excludes the current month because a partial
 * month understates every average. A household with no completed month at all
 * falls back to the current month with `partialMonthOnly: true`.
 */
export function spendBasis(
  txns: Transaction[], baseCurrency: string, rates: ExchangeRates, maxMonths = 6,
): SpendBasis {
  const current = nowMonthKey();
  const months = [...new Set(txns.map(t => getMonthKey(t.date)))]
    .filter(mk => mk < current)
    .sort()
    .slice(-maxMonths);
  const keys = months.length > 0 ? months : [current];
  let total = 0, essential = 0, discretionary = 0;
  for (const mk of keys) {
    for (const [category, amount] of Object.entries(spendByCategory(txns, mk, baseCurrency, rates))) {
      total += amount;
      if (NEEDS_WANTS_MAP[category] === 'want') discretionary += amount;
      else essential += amount;   // 'need' and anything unmapped count as essential
    }
  }
  const n = keys.length;
  return {
    monthsConsidered: months.length,
    partialMonthOnly: months.length === 0,
    averageMonthly: round2(total / n),
    averageEssential: round2(essential / n),
    averageDiscretionary: round2(discretionary / n),
  };
}

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
    /**
     * v10.38 — THE canonical liquid figure: `computeNetWorth().liquidAssets`,
     * i.e. live account balances plus liquid-tier assets, the same projection the
     * Dashboard and Net Worth pages render.
     *
     * 🔴 Ask Vyact's affordability and runway seams used to call
     * `calculations.liquidAssets(assets)` instead — the assets ARRAY only, at its
     * static `value`, with no account balances. On a real household that read
     * ₹24,000 against this field's ₹11.7 lakh, so the same app reported 1.2 and
     * 68.6 months of cover for the same money in the same minute. Every seam
     * reads this field now; `askVyactFacts.test.ts` fails if one diverges again.
     */
    liquidAssets: number;
    liquidityMonths: number;             // liquidAssets / spendBasis.averageMonthly
    debtToAssetPct: number;
    /**
     * v10.39.1 (P19) — credit-card outstanding, from the same liability rows
     * (`cardDues`). `liquidAssets − cardDues` is what is FREE to spend: a card bill
     * is paid out of the liquid money, so quoting the gross figure as spendable
     * overstates it by exactly the bill.
     */
    cardDues: number;
  };
  /** v10.38 — the ONE spend baseline every cover/floor figure divides by. */
  spendBasis: SpendBasis;
  /**
   * v10.39 — WHERE THE MONEY SITS, not just how much of it there is.
   *
   * Three questions in one validation session died on the absence of this: "₹58k or
   * ₹33k — which is right?", "which account am I spending from?", "what should I
   * sell?". A total nobody can decompose is a figure you have to take on trust, and
   * the household had just caught the app being wrong about that very total.
   *
   * 🔴 EGRESS NOTE. These are ACCOUNT AND ASSET NAMES, which the customer wrote
   * ("Federal Bank", "Emergency cash"). Until now facts carried category labels and
   * debt *types* only, never anything user-authored. This is a deliberate, narrow
   * widening — names and amounts, no account numbers, no masked digits, no
   * descriptions — made because a liquidity figure that cannot be traced to the
   * accounts holding it is not checkable. Do not extend it to transaction
   * descriptions or merchant text: those remain excluded.
   */
  holdings: {
    name: string;
    source: 'account' | 'asset';
    liquidity: 'liquid' | 'short' | 'long';
    value: number;
  }[];
  /**
   * v10.38.1 — data-quality signals the assistant may RAISE but must never
   * silently correct.
   *
   * `cashBalanceNegative` was found on a real household: physical cash computed to
   * −₹342, which cannot happen — it means spends were recorded against cash that
   * was never recorded as received. Clamping it to zero would fabricate money and
   * hide the gap; saying so lets the customer fix the cause.
   */
  dataQuality: {
    cashBalanceNegative: boolean;
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
  // v10.38 — cover divides by the TYPICAL month (see SpendBasis), not by this
  // month's partial expense, which made cover look enormous early in a month and
  // disagreed with the floor every other seam used.
  const basis = spendBasis(txns, cur, rates);
  const liquidityMonths = basis.averageMonthly > 0 ? liquid / basis.averageMonthly : 0;
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
  // v10.38.1 — RECEIVABLES ARE NOT YOUR DEBTS.
  //
  // `direction: 'owed_to_me'` is money someone owes the household. Net worth has
  // excluded it from liabilities since v10.17, but this mapping passed every debt
  // through, so the assistant listed a ₹1,245 receivable among "your debts" and
  // advised on clearing it. Same filter as `liveLiabilityRows`, so the assistant's
  // debt list and the liability side cannot disagree about what a debt is.
  const safeDebts = debts
    .filter(d => d.direction !== 'owed_to_me')
    .map(d => ({
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
      liquidAssets: round2(liquid),
      liquidityMonths: round2(liquidityMonths),
      debtToAssetPct: ta > 0 ? round2(tl / ta * 100) : 0,
      cardDues: cardDues(nwProjection),
    },
    spendBasis: basis,
    // The SAME rows the projection totalled, so a breakdown can never disagree with
    // the total it decomposes (asserted by askVyactFacts).
    holdings: nwProjection.assetRows.map(r => ({
      name: r.name,
      source: r.source === 'asset' ? 'asset' as const : 'account' as const,
      liquidity: (r.liquidity ?? 'liquid') as 'liquid' | 'short' | 'long',
      value: round2(r.value),
    })),
    dataQuality: {
      cashBalanceNegative: accounts.some(a =>
        a.kind === 'cash' && !a.isArchived
        && computeAccountBalance(a, txns, cur, rates) < 0),
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
   * v10.38 — the money-shaped figures this assistant turn was allowed to use.
   *
   * Carried so the NEXT turn's invented-figure guard can accept a figure the user
   * is challenging ("you said ₹1,200 — that doesn't sound right"). The guard is
   * per-turn, so without this a follow-up citing the previous answer's number was
   * discarded wholesale — which is exactly how a correction to a contradictory
   * figure was lost during v10.37 validation. Figures only; never prose.
   */
  allowedFigures?: string[];
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
