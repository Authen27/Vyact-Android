// Vyact v7.5 — AI Summary
// Privacy-safe aggregation for the Chatbot.
// CRITICAL: this is the ONLY data shape that ever leaves the device for AI.
// Per the v7 PRD: no merchant names, no transaction descriptions, no notes.
// Only categories + amounts + date ranges + aggregates.

import type {
  Transaction, Budget, Goal, Debt, Asset, Profile, ExchangeRates,
} from '../types';
import {
  monthlyData, totalAssets, totalLiabilities, computePulseScore,
  liquidAssets, totalMonthlyDebtPayment, spendByCategory, reportableTxns, effectiveAmount,
} from './calculations';
import { nowMonthKey, getMonthKey } from './format';
import { GeminiChatBackend } from './geminiBackend';


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

// --- Sub-agent interface and registry ---
export interface SubAgent {
  id: string;
  canHandle: (question: string) => boolean;
  handle: (question: string, summary: SafeSummary, history: ChatMessage[]) => Promise<string>;
}

const subAgents: SubAgent[] = [];

export function registerSubAgent(agent: SubAgent) {
  subAgents.push(agent);
}

// Intent-based router
async function routeToSubAgent(question: string, summary: SafeSummary, history: ChatMessage[]): Promise<string> {
  const agent = subAgents.find(a => a.canHandle(question));
  if (agent) return agent.handle(question, summary, history);
  // fallback to default stub
  return defaultStubAgent.handle(question, summary, history);
}

// No specialised sub-agents are registered yet — every question falls through to
// the data-driven defaultStubAgent below. Register real ones here when wired (v8).

// --- Default stub agent (pattern-matcher, as before) ---
const defaultStubAgent: SubAgent = {
  id: 'default',
  canHandle: () => true,
  async handle(question, summary, history) {
    // Pattern-match common questions against the summary.
    const q = question.toLowerCase();
    const total = summary.pulseScore.total ?? 0;

    if (/(spend|spent|spending).*month/.test(q) || /this month/.test(q)) {
      return `This month (${summary.thisMonth.monthKey}) you've spent ${formatMoney(summary.thisMonth.expense, summary.baseCurrency)} ` +
        `against ${formatMoney(summary.thisMonth.income, summary.baseCurrency)} of income  a ` +
        `${(summary.thisMonth.netSavingsRate * 100).toFixed(0)}% savings rate. ` +
        `Your top expense categories: ${summary.thisMonth.topCategories.slice(0, 3).map(c => c.category).join(', ')}.`;
    }
    if (/pulse|score/.test(q)) {
      const c = summary.pulseScore.components;
      return `Your Family Pulse Score is ${total}/100. ` +
        `Components: Budgets ${c.budget}, Savings ${c.savings}, Goals ${c.goals}, Trend ${c.trend}, Debt ${c.debt}. ` +
        `${total >= 80 ? 'Excellent — keep it going.' : total >= 65 ? 'Good — small wins compound.' : 'Room to improve. Check the Planner page for prioritised recommendations.'}`;
    }
    if (/net.*worth|wealth/.test(q)) {
      return `Net worth: ${formatMoney(summary.netWorth.netWorth, summary.baseCurrency)}. ` +
        `Assets ${formatMoney(summary.netWorth.totalAssets, summary.baseCurrency)} minus ` +
        `Liabilities ${formatMoney(summary.netWorth.totalLiabilities, summary.baseCurrency)}. ` +
        `Liquidity coverage: ${summary.netWorth.liquidityMonths.toFixed(1)} months of expenses. ` +
        `Debt-to-asset: ${summary.netWorth.debtToAssetPct.toFixed(0)}%.`;
    }
    if (/emergency|fund|savings goal/.test(q)) {
      const eg = summary.goals.find(g => g.type === 'emergency');
      if (eg) return `Your emergency fund is ${eg.targetPct.toFixed(0)}% complete. ${eg.daysToDeadline !== null ? `${eg.daysToDeadline} days to deadline.` : ''}`;
      return 'No emergency fund tracked. The standard recommendation: 36 months of expenses in liquid savings.';
    }
    if (/debt|owe|loan/.test(q)) {
      if (!summary.debts.length) return "You're debt-free  no debts tracked.";
      const total = summary.debts.reduce((s, d) => s + d.balance, 0);
      const highApr = summary.debts.sort((a, b) => b.aprPct - a.aprPct)[0];
      return `Total debt: ${formatMoney(total, summary.baseCurrency)} across ${summary.debts.length} accounts. ` +
        `Highest APR: ${highApr.type} at ${highApr.aprPct}% (${formatMoney(highApr.balance, summary.baseCurrency)}). ` +
        `Avalanche strategy targets this debt first.`;
    }
    if (/budget/.test(q)) {
      const over = summary.budgets.filter(b => b.spentPct > 100);
      const near = summary.budgets.filter(b => b.spentPct > 80 && b.spentPct <= 100);
      if (over.length) return `${over.length} budgets exceeded this month: ${over.map(b => b.category).join(', ')}.`;
      if (near.length) return `${near.length} budgets near their limit: ${near.map(b => b.category).join(', ')}.`;
      return `All ${summary.budgets.length} budgets are on track this month.`;
    }
    if (/help|what.*ask/.test(q)) {
      return `I can answer questions about your spending, savings rate, Pulse Score, net worth, debts, and goals. Try: "How much did I spend this month?" or "What's my net worth?"`;
    }

    // Generic fallback summary
    return `(stub mode · backend not yet wired) ` +
      `This month: ${formatMoney(summary.thisMonth.income, summary.baseCurrency)} in, ${formatMoney(summary.thisMonth.expense, summary.baseCurrency)} out. ` +
      `Pulse Score: ${total}/100. ` +
      `When the Supabase Edge Function lands in v8, this will route through Claude Haiku and answer richer questions.`;
  }
};


export function buildSafeSummary(
  txns: Transaction[], budgets: Budget[], goals: Goal[],
  debts: Debt[], assets: Asset[], profile: Profile, rates: ExchangeRates,
): SafeSummary {
  const cur = profile.baseCurrency;
  const mk = nowMonthKey();
  const month = monthlyData(txns, mk, cur, rates);
  const ta = totalAssets(assets, cur, rates);
  const tl = totalLiabilities(debts, cur, rates);
  const liquid = liquidAssets(assets, cur, rates);
  const monthlyExpFor6m = monthlyData(txns, mk, cur, rates).expense;
  const liquidityMonths = monthlyExpFor6m > 0 ? liquid / monthlyExpFor6m : 0;
  const pulse = computePulseScore(txns, budgets, goals, debts, cur, rates);

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

  // Budgets with usage % only — no spending detail
  const safeBudgets = budgets.map(b => {
    const limitBase = b.limit * ((rates[b.currency] || 1) / (rates[cur] || 1));
    const spent = spend[b.category ?? ''] || 0;
    return {
      category: b.category ?? '',
      limit: round2(limitBase),
      spentPct: limitBase > 0 ? round2(spent / limitBase * 100) : 0,
    };
  });

  // Goals with progress only
  const safeGoals = goals.map(g => {
    const tgt = g.target * ((rates[g.currency] || 1) / (rates[cur] || 1));
    const pct = tgt > 0 ? (g.current / g.target) * 100 : 0;
    const daysToDeadline = g.deadline
      ? Math.ceil((new Date(g.deadline).getTime() - Date.now()) / 86400000)
      : null;
    return { type: g.type, targetPct: round2(pct), daysToDeadline };
  });

  // Debts with balance + APR only — no lender name, no account number
  const safeDebts = debts.map(d => ({
    type: d.type,
    balance: round2(d.currentBalance * ((rates[d.currency] || 1) / (rates[cur] || 1))),
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

// ── Chat backend client ──────────────────────────────────────
// In v7.5 this calls a Supabase Edge Function. Until that's wired up,
// we use a local stub that returns deterministic responses based on the
// summary. This is a SAFE FALLBACK: no data leaves the device.

export interface ChatMessage { role: 'user' | 'assistant'; content: string; }

export interface ChatBackend {
  ask(question: string, summary: SafeSummary, history: ChatMessage[]): Promise<string>;
  isReal(): boolean;  // false = stub, true = real backend wired
}


export class StubChatBackend implements ChatBackend {
  isReal() { return false; }

  async ask(question: string, summary: SafeSummary, history: ChatMessage[] = []): Promise<string> {
    return routeToSubAgent(question, summary, history);
  }
}

function formatMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(0)}`;
  }
}

// Real backend stub — wires to Supabase Edge Function in v8
export class SupabaseChatBackend implements ChatBackend {
  isReal() { return true; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async ask(_question: string, _summary: SafeSummary, _history: ChatMessage[]): Promise<string> {
    // TODO(v8): const { data, error } = await supabase.functions.invoke('ai-chat', { body: { question, summary, history } });
    throw new Error('SupabaseChatBackend not yet wired — use StubChatBackend until v8.');
  }
}

// TD-07 — backend factory. Selects the Gemini backend when a free-tier
// API key is configured at build time (`VITE_GEMINI_API_KEY`), otherwise
// falls back to the deterministic pattern-matching stub so the app still
// works offline / without keys. Kept in this file so callers don't have
// to know which concrete backend exists.
export function selectChatBackend(): ChatBackend {
  // `import.meta.env` is the Vite-injected env; guarded so unit tests in
  // plain node (without a Vite transform) don't crash on the access.
  let key: string | undefined;
  try {
    key = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_GEMINI_API_KEY;
  } catch { /* import.meta not available — fall through to stub */ }
  if (key && key.trim()) {
    return new GeminiChatBackend(key.trim());
  }
  return new StubChatBackend();
}
