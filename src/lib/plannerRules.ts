// Vyact v7.5 — Rules-based Finance Planner
// Deterministic recommendation engine. NO LLM.
// 30+ rules across 5 domains: Income, Expenses, Investments, Debt, Tax.
//
// Each rule has: priority (1-5), severity (info/watch/critical),
// trigger (boolean function on PlannerContext), and a templated text.
// Engine evaluates all, sorts by (severity × priority), returns top 5.

import type { Transaction, Budget, BudgetAllocation, Goal, Debt, Asset, Account, RecurringSchedule, ExchangeRates, ProfileTypeKey } from '../types';
import {
  monthlyData, totalAssets,
  totalMonthlyDebtPayment, reportableTxns, effectiveAmount, budgetLinesForMonth, budgetWindow, resolveBudgetPeriod, spendByCategoryInRange,
} from './calculations';
import { convert, fmt, getMonthKey, nowMonthKey } from './format';
import { computeNetWorth, type NetWorthProjection } from './netWorth';
import { getCat } from '../constants';

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
  accounts?: Account[];
  budgetAllocations?: BudgetAllocation[];
  recurring?: RecurringSchedule[];
  position?: NetWorthProjection;
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
  issue?: string;
  period?: string;
  basis?: string;
  relatedIssues?: { issue: string; period: string }[];
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
      const incomeTxns = reportableTxns(ctx.transactions).filter(t => t.type === 'income');
      const sources = new Set(incomeTxns.map(t => t.category));
      if (sources.size !== 1) return { match: false };
      return {
        match: true,
        rec: {
          severity: 'watch',
          title: 'Review income resilience',
          body: 'Recorded income uses one category. This does not establish how many earners or employers you have; review your income sources and available buffer.',
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
          body: 'Recorded spending is using most of the income recorded this month so far. Review remaining bills and the timing of your next income before changing your budget.',
          issue: 'cash-flow', period: mk, basis: 'Income and reportable spending this month to date.',
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
      const over = budgetLinesForMonth(ctx.budgets, ctx.budgetAllocations ?? [], mk).filter(b => {
        const range = b.scope && b.periodYear
          ? resolveBudgetPeriod(b.scope, b.periodYear, b.periodMonth ?? 1)
          : { periodStart: b.periodStart || budgetWindow(b).start, periodEnd: b.periodEnd || budgetWindow(b).end };
        const spend = spendByCategoryInRange(ctx.transactions, range.periodStart, range.periodEnd, ctx.baseCurrency, ctx.rates);
        return (spend[b.category ?? ''] || 0) > convert(b.limit, b.currency, ctx.baseCurrency, ctx.rates);
      });
      if (!over.length) return { match: false };
      return {
        match: true,
        rec: {
          severity: 'watch',
          title: `${over.length} category limit${over.length === 1 ? '' : 's'} exceeded`,
          body: `${over.map(b => getCat(b.category ?? '').label).slice(0, 3).join(', ')}. Review spending against each budget's own period before adjusting a limit.`,
          issue: 'budget-pressure', period: mk, basis: 'Active monthly and annual category allocations, each compared over its own budget period.',
          relatedIssues: over.filter(b => b.scope !== 'annual' && (!b.period || b.period === 'monthly') && (!b.periodStart || b.periodStart === `${mk}-01`))
            .map(b => ({ issue: `category:${b.category}`, period: mk })),
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
      if (ctx.recurring) {
        const schedules = ctx.recurring.filter(schedule => schedule.active && schedule.transactionTemplate.type === 'expense');
        if (!schedules.length) return { match: false };
        return { match: true, rec: {
          severity: 'info', title: `${schedules.length} repeating expense${schedules.length === 1 ? '' : 's'} to review`,
          body: 'Check the next due dates and approval settings. A schedule is a future instruction, not proof that its payment has posted.',
          issue: 'recurring-commitments', period: nowMonthKey(), basis: 'Active expense schedules; no assumed monthly total.',
          action: { label: 'Review upcoming bills', route: '/recurring' },
        } };
      }
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
      const investments = ctx.transactions.filter(t => t.type === 'investment' && !t.excluded && getMonthKey(t.date) === mk
        && !(t.assetId && t.toAccountId && !t.accountId) && t.category !== 'investment_out');
      const invested = investments.reduce((s, t) => s + effectiveAmount(t, ctx.baseCurrency, ctx.rates), 0);
      const rate = invested / income;
      if (rate >= 0.10) return { match: false };
      return {
        match: true,
        rec: {
          severity: rate < 0.03 ? 'watch' : 'info',
          title: `You invest ${Math.round(rate * 100)}% of monthly income`,
          body: 'This is the share of recorded income directed to investment purchases, not an expense. Review near-term bills, debt and your cash buffer before increasing contributions.',
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
      const projection = ctx.position ?? (ctx.accounts ? computeNetWorth({ assets: ctx.assets, accounts: ctx.accounts, debts: ctx.debts, transactions: ctx.transactions }, ctx.baseCurrency, ctx.rates) : null);
      const rows = projection ? projection.assetRows.map(row => ({ type: row.account?.kind ?? row.asset?.type ?? 'other', value: row.value }))
        : ctx.assets.map(asset => ({ type: asset.type, value: convert(asset.value, asset.currency, ctx.baseCurrency, ctx.rates) }));
      if (rows.length < 2) return { match: false };
      const total = projection?.totalAssets ?? totalAssets(ctx.assets, ctx.baseCurrency, ctx.rates);
      const byType: Record<string, number> = {};
      for (const row of rows) {
        byType[row.type] = (byType[row.type] || 0) + row.value;
      }
      const max = Math.max(...Object.values(byType));
      const pct = total > 0 ? max / total : 0;
      if (pct < 0.7) return { match: false };
      const dominant = Object.entries(byType).find(([, v]) => v === max)?.[0] ?? 'one type';
      return {
        match: true,
        rec: {
          severity: 'info',
          title: `${Math.round(pct * 100)}% of recorded assets are in ${dominant.replace(/_/g, ' ')}`,
          body: 'Review whether this mix suits the money you need soon and your longer-term plans. An asset type alone does not describe every risk within it.',
          basis: 'Current account-aware asset values; linked assets are counted once.',
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
          body: 'Compare tracked minimum monthly payments with recorded income so far this month. The month may be incomplete; this is not a lender eligibility assessment.',
          issue: 'debt-payments', period: mk, basis: 'Tracked monthly minimum debt payments divided by month-to-date recorded income.',
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
      const cards = ctx.debts.filter(d => d.direction !== 'owed_to_me' && d.currentBalance > 0 && d.type === 'credit_card' && d.interestRate >= 18);
      if (!cards.length) return { match: false };
      const top = cards.sort((a, b) => b.interestRate - a.interestRate)[0];
      return {
        match: true,
        rec: {
          severity: 'watch',
          title: `${top.name} at ${top.interestRate}% APR`,
          body: 'Review the balance, interest rate and payment plan. Keep essential bills and minimum payments covered when comparing payoff priorities.',
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
