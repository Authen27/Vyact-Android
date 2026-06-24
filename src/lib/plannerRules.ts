// Vyact v7.5 — Rules-based Finance Planner
// Deterministic recommendation engine. NO LLM.
// 30+ rules across 5 domains: Income, Expenses, Investments, Debt, Tax.
//
// Each rule has: priority (1-5), severity (info/watch/critical),
// trigger (boolean function on PlannerContext), and a templated text.
// Engine evaluates all, sorts by (severity × priority), returns top 5.

import type { Transaction, Budget, Goal, Debt, Asset, ExchangeRates, ProfileTypeKey } from '../types';
import {
  monthlyData, totalAssets, totalLiabilities, liquidAssets,
  totalMonthlyDebtPayment, reportableTxns, effectiveAmount,
} from './calculations';
import { fmt, getMonthKey, nowMonthKey } from './format';

export type Domain = 'income' | 'expenses' | 'investments' | 'debt' | 'tax';
export type Severity = 'info' | 'watch' | 'critical';

export interface PlannerContext {
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  debts: Debt[];
  assets: Asset[];
  baseCurrency: string;
  rates: ExchangeRates;
  /** #8 — Planner advice adapts to the household type (personal/family/business).
   *  Defaults to 'personal' when unset. */
  householdType?: ProfileTypeKey;
}

/** True for the business-flavoured household types. */
function isBusiness(ctx: PlannerContext): boolean {
  return ctx.householdType === 'business' || ctx.householdType === 'multi_biz';
}

export interface Recommendation {
  id: string;
  domain: Domain;
  severity: Severity;
  priority: 1 | 2 | 3 | 4 | 5;
  title: string;
  body: string;
  action?: { label: string; route: string };
}

interface Rule {
  id: string;
  domain: Domain;
  priority: 1 | 2 | 3 | 4 | 5;
  evaluate(ctx: PlannerContext): { match: boolean; rec?: Omit<Recommendation, 'id' | 'domain' | 'priority'> };
}

const SEVERITY_SCORE: Record<Severity, number> = { critical: 100, watch: 50, info: 20 };

// ── Helpers ────────────────────────────────────────────────────
function recentMonths(transactions: Transaction[], n: number): string[] {
  const set = new Set(transactions.map(t => getMonthKey(t.date)));
  return [...set].sort().slice(-n);
}

function monthlyExpenses(ctx: PlannerContext, months: number): number[] {
  return recentMonths(ctx.transactions, months).map(mk => monthlyData(ctx.transactions, mk, ctx.baseCurrency, ctx.rates).expense);
}

function monthlyIncomes(ctx: PlannerContext, months: number): number[] {
  return recentMonths(ctx.transactions, months).map(mk => monthlyData(ctx.transactions, mk, ctx.baseCurrency, ctx.rates).income);
}

function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, n) => s + n, 0) / arr.length;
  return arr.reduce((s, n) => s + (n - mean) ** 2, 0) / arr.length;
}

// ── INCOME RULES ───────────────────────────────────────────────
const incomeRules: Rule[] = [
  {
    id: 'income.single_source',
    domain: 'income',
    priority: 4,
    evaluate(ctx) {
      const incomeTxns = ctx.transactions.filter(t => t.type === 'income' && !t.excluded);
      const sources = new Set(incomeTxns.map(t => t.category));
      if (sources.size > 1) return { match: false };
      return {
        match: true,
        rec: {
          severity: 'watch',
          title: 'Single income source — concentrated risk',
          body: 'All your income comes from one source. A redundancy or job loss leaves zero cash flow. Consider a 6-month emergency fund or a secondary income stream.',
          action: { label: 'Check net worth', route: '/networth' },
        },
      };
    },
  },
  {
    id: 'income.unstable',
    domain: 'income',
    priority: 3,
    evaluate(ctx) {
      const incomes = monthlyIncomes(ctx, 6);
      if (incomes.length < 3) return { match: false };
      const mean = incomes.reduce((s, n) => s + n, 0) / incomes.length;
      const stdDev = Math.sqrt(variance(incomes));
      const cov = mean > 0 ? stdDev / mean : 0;
      if (cov < 0.25) return { match: false };
      return {
        match: true,
        rec: {
          severity: 'watch',
          title: `Income varies ${Math.round(cov * 100)}% month to month`,
          body: 'High income variance means budgets sized for an average month will fail in lean months. Build a 3-month buffer based on your lowest months.',
          action: { label: 'View Reports', route: '/reports' },
        },
      };
    },
  },
];

// ── EXPENSE RULES ──────────────────────────────────────────────
const expenseRules: Rule[] = [
  {
    id: 'expenses.high_consumption',
    domain: 'expenses',
    priority: 5,
    evaluate(ctx) {
      const mk = nowMonthKey();
      const { income, expense } = monthlyData(ctx.transactions, mk, ctx.baseCurrency, ctx.rates);
      if (income <= 0) return { match: false };
      const pct = expense / income;
      if (pct < 0.8) return { match: false };
      return {
        match: true,
        rec: {
          severity: pct > 0.95 ? 'critical' : 'watch',
          title: `You spend ${Math.round(pct * 100)}% of your income`,
          body: `Healthy threshold is 70–80%. ${pct > 0.95 ? "You're spending nearly everything you earn — one shock and you're underwater." : 'Trim 5–10% in the top category to widen your margin.'}`,
          action: { label: 'View Budgets', route: '/budgets' },
        },
      };
    },
  },
  {
    id: 'expenses.budget_exceeded',
    domain: 'expenses',
    priority: 4,
    evaluate(ctx) {
      const mk = nowMonthKey();
      const txns = reportableTxns(ctx.transactions).filter(t => t.type === 'expense' && getMonthKey(t.date) === mk);
      const spend: Record<string, number> = {};
      for (const t of txns) spend[t.category] = (spend[t.category] || 0) + effectiveAmount(t, ctx.baseCurrency, ctx.rates);
      const over = ctx.budgets.filter(b => {
        const limitBase = b.limit * ((ctx.rates[b.currency] || 1) / (ctx.rates[ctx.baseCurrency] || 1));
        return (spend[b.category ?? ''] || 0) > limitBase;
      });
      if (!over.length) return { match: false };
      return {
        match: true,
        rec: {
          severity: 'watch',
          title: `${over.length} budget${over.length === 1 ? '' : 's'} exceeded this month`,
          body: `${over.map(b => b.category).slice(0, 3).join(', ')}. Either raise the limits to be realistic, or rein in spending. Hidden over-spending is the #1 reason budgets fail.`,
          action: { label: 'Review budgets', route: '/budgets' },
        },
      };
    },
  },
  {
    id: 'expenses.subscription_leak',
    domain: 'expenses',
    priority: 3,
    evaluate(ctx) {
      const recurring = ctx.transactions.filter(t => t.type === 'expense' && t.recurring && !t.excluded);
      if (recurring.length < 4) return { match: false };
      const monthly = recurring.reduce((s, t) => s + effectiveAmount(t, ctx.baseCurrency, ctx.rates), 0);
      return {
        match: true,
        rec: {
          severity: 'info',
          title: `${recurring.length} recurring subscriptions detected`,
          body: `You have ${recurring.length} recurring expenses costing ${fmt(monthly, ctx.baseCurrency)}/mo. Audit these — most households cancel 2–3 zombie subscriptions on review.`,
          action: { label: 'Recurring page', route: '/recurring' },
        },
      };
    },
  },
];

// ── INVESTMENT RULES ───────────────────────────────────────────
const investmentRules: Rule[] = [
  {
    id: 'investments.low_rate',
    domain: 'investments',
    priority: 4,
    evaluate(ctx) {
      const mk = nowMonthKey();
      const { income } = monthlyData(ctx.transactions, mk, ctx.baseCurrency, ctx.rates);
      if (income <= 0) return { match: false };
      const investments = ctx.transactions.filter(t => t.type === 'investment' && getMonthKey(t.date) === mk);
      const invested = investments.reduce((s, t) => s + effectiveAmount(t, ctx.baseCurrency, ctx.rates), 0);
      const rate = invested / income;
      if (rate >= 0.10) return { match: false };
      return {
        match: true,
        rec: {
          severity: rate < 0.03 ? 'watch' : 'info',
          title: `You invest ${Math.round(rate * 100)}% of monthly income`,
          body: `Target for sustained wealth-building: 15–20%. Even an extra ${fmt(income * 0.02, ctx.baseCurrency)}/mo into an index fund compounds meaningfully over 10+ years.`,
          action: { label: 'View Net Worth', route: '/networth' },
        },
      };
    },
  },
  {
    id: 'investments.asset_concentration',
    domain: 'investments',
    priority: 3,
    evaluate(ctx) {
      if (ctx.assets.length < 2) return { match: false };
      const total = totalAssets(ctx.assets, ctx.baseCurrency, ctx.rates);
      const byType: Record<string, number> = {};
      for (const a of ctx.assets) {
        const v = a.value * ((ctx.rates[a.currency] || 1) / (ctx.rates[ctx.baseCurrency] || 1));
        byType[a.type] = (byType[a.type] || 0) + v;
      }
      const max = Math.max(...Object.values(byType));
      const pct = total > 0 ? max / total : 0;
      if (pct < 0.7) return { match: false };
      const dominant = Object.entries(byType).find(([, v]) => v === max)?.[0] ?? 'one type';
      return {
        match: true,
        rec: {
          severity: 'info',
          title: `${Math.round(pct * 100)}% of your wealth is in ${dominant}`,
          body: 'Concentration in a single asset class amplifies risk. Consider diversifying across cash, equities, real estate, and retirement accounts as your balance grows.',
          action: { label: 'View Net Worth', route: '/networth' },
        },
      };
    },
  },
];

// ── DEBT RULES ─────────────────────────────────────────────────
const debtRules: Rule[] = [
  {
    id: 'debt.high_dti',
    domain: 'debt',
    priority: 5,
    evaluate(ctx) {
      const mk = nowMonthKey();
      const { income } = monthlyData(ctx.transactions, mk, ctx.baseCurrency, ctx.rates);
      if (income <= 0 || !ctx.debts.length) return { match: false };
      const dti = (totalMonthlyDebtPayment(ctx.debts, ctx.baseCurrency, ctx.rates) / income) * 100;
      if (dti < 36) return { match: false };
      return {
        match: true,
        rec: {
          severity: dti > 50 ? 'critical' : 'watch',
          title: `Debt-to-Income ratio: ${dti.toFixed(0)}%`,
          body: `Healthy threshold is 36%. ${dti > 50 ? 'Above 50% means most income services debt — emergency-fund building stalls.' : 'Above 36% blocks most mortgage approvals and constrains flexibility.'}`,
          action: { label: 'View Debts', route: '/debts' },
        },
      };
    },
  },
  {
    id: 'debt.high_apr_card',
    domain: 'debt',
    priority: 4,
    evaluate(ctx) {
      const cards = ctx.debts.filter(d => d.type === 'credit_card' && d.interestRate >= 18);
      if (!cards.length) return { match: false };
      const top = cards.sort((a, b) => b.interestRate - a.interestRate)[0];
      return {
        match: true,
        rec: {
          severity: 'watch',
          title: `${top.name} at ${top.interestRate}% APR`,
          body: `High-APR cards compound expensively. Avalanche this debt before increasing investment contributions — the guaranteed return on debt payoff exceeds most market expectations.`,
          action: { label: 'View Debts', route: '/debts' },
        },
      };
    },
  },
];

// ── TAX RULES ──────────────────────────────────────────────────
const taxRules: Rule[] = [
  {
    id: 'tax.isa_unused',
    domain: 'tax',
    priority: 2,
    evaluate(ctx) {
      // UK heuristic: if currency is GBP and contributions to "investment" txns this tax year < 5K
      if (ctx.baseCurrency !== 'GBP') return { match: false };
      const invested = ctx.transactions.filter(t => t.type === 'investment' && t.date >= `${new Date().getFullYear()}-04-06`)
        .reduce((s, t) => s + effectiveAmount(t, ctx.baseCurrency, ctx.rates), 0);
      const remaining = 20000 - invested;
      if (remaining <= 0) return { match: false };
      return {
        match: true,
        rec: {
          severity: 'info',
          title: `${fmt(remaining, 'GBP')} of ISA allowance unused this year`,
          body: 'UK ISA allowance is £20,000 per tax year and resets every 6 April. Unused allowance is gone — it does not roll over. Even modest ISA contributions compound tax-free for life.',
        },
      };
    },
  },
  {
    id: 'tax.401k_under_max',
    domain: 'tax',
    priority: 2,
    evaluate(ctx) {
      if (ctx.baseCurrency !== 'USD') return { match: false };
      const retirement = ctx.assets.find(a => a.type === 'retirement');
      if (!retirement) {
        return {
          match: true,
          rec: {
            severity: 'info',
            title: 'No retirement account tracked',
            body: 'US 401(k) employer match is the highest-return investment most workers can access. If your employer offers any match, contribute at least to the match — it is free money.',
            action: { label: 'Add asset', route: '/networth' },
          },
        };
      }
      return { match: false };
    },
  },
];

// ── ENGINE ─────────────────────────────────────────────────────
// #8 — business-specific advice (only for SMB / multi-business households).
const businessRules: Rule[] = [
  {
    id: 'smb.tax_reserve',
    domain: 'tax',
    priority: 4,
    evaluate(ctx) {
      if (!isBusiness(ctx)) return { match: false };
      const income = monthlyIncomes(ctx, 3).reduce((s, v) => s + v, 0);
      if (income <= 0) return { match: false };
      return { match: true, rec: {
        severity: 'watch',
        title: 'Set aside for tax',
        body: 'As a business, reserve ~25–30% of profit for tax in a dedicated account so a bill never catches you short. Transfer it the moment income lands.',
        action: { label: 'Open accounts', route: '/accounts' },
      } };
    },
  },
  {
    id: 'smb.runway',
    domain: 'income',
    priority: 3,
    evaluate(ctx) {
      if (!isBusiness(ctx)) return { match: false };
      const burn = monthlyExpenses(ctx, 3);
      const avgBurn = burn.length ? burn.reduce((s, v) => s + v, 0) / burn.length : 0;
      if (avgBurn <= 0) return { match: false };
      return { match: true, rec: {
        severity: 'info',
        title: 'Watch your cash runway',
        body: 'Track how many months of burn your liquid cash covers. For a business, aim for 6+ months so a slow quarter is survivable.',
        action: { label: 'Check net worth', route: '/networth' },
      } };
    },
  },
];

export const ALL_RULES = [
  ...incomeRules, ...expenseRules, ...investmentRules, ...debtRules, ...taxRules, ...businessRules,
];

export function evaluateRecommendations(ctx: PlannerContext, top = 5): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const rule of ALL_RULES) {
    const { match, rec } = rule.evaluate(ctx);
    if (match && rec) {
      recs.push({
        ...rec,
        id: rule.id,
        domain: rule.domain,
        priority: rule.priority,
      });
    }
  }
  recs.sort((a, b) => SEVERITY_SCORE[b.severity] * b.priority - SEVERITY_SCORE[a.severity] * a.priority);
  return recs.slice(0, top);
}

// Group recs by domain for the Planner page UI
export function recsByDomain(recs: Recommendation[]): Record<Domain, Recommendation[]> {
  const out: Record<Domain, Recommendation[]> = { income:[], expenses:[], investments:[], debt:[], tax:[] };
  for (const r of recs) out[r.domain].push(r);
  return out;
}
