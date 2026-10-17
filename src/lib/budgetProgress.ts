// Track E, E5 (v10.99.0; owner decisions 13–14 Oct 2026: E-6 and its follow-ups) — ONE budget-progress
// basis, read by the Budgets page, the Dashboard (pace banner and Budget progress panel), Reports'
// budget vs actual and Pip.
//
// Before (audit FE-UIC-08, FE-MNY-06) one budget had three "left" figures: the Budgets hero subtracted
// only ALLOCATED spending from the full total, the Dashboard pace used all spending, and Reports compared
// the sum of allocations with allocated spending. The Dashboard panel also measured annual lines against
// one month's spending.
//
// The rule (owner):
//   • A budget's TOTAL is measured against ALL spending in its own period (`spendByCategoryInRange`, so
//     unallocated categories and a loan payment in full count too). A month budget counts its month; an
//     annual budget counts its year, the aggregation of all its months, so an expense counts once in its
//     month and once in its year. The annual total is the figure typed in the form.
//   • Each LINE (an allocation) is measured over its own budget's period: an annual line over the year.
//   • A category with spending in the period and nothing allocated to it (no row, or 0) is a NOT-PLANNED
//     line: always over, listed after the planned lines on every budget card, the Dashboard panel and in
//     Pip. Bell and WhatsApp alerts and the Pulse score do not read it (owner, 14 Oct 2026).
//
// Pure: no store, no browser API (bundled into the server engine through aiSummary).
import type { Budget, BudgetAllocation, ExchangeRates, Transaction } from '../types';
import { getCat } from '../constants';
import { spendByCategoryInRange } from './calculations';
import { budgetCategoryOf } from './budgetIntel';
import { convert, today } from './format';
import { budgetPeriodWindow, sortByUtilisation } from './budgetOrdering';

export interface BudgetLineProgress {
  category: string;
  /** The allocation in the base currency; 0 for a not-planned line. */
  limit: number;
  spent: number;
  /** False: spending in a category this budget allocates nothing to. Always over. */
  planned: boolean;
  /** spent ÷ limit × 100, unclamped; null for a not-planned line. */
  pct: number | null;
  /** limit − spent: below zero is over. */
  left: number;
}

export interface BudgetProgress {
  budget: Budget;
  /** The budget's own period (inclusive YYYY-MM-DD). */
  start: string;
  end: string;
  /** More than one month: an annual budget, or a legacy window longer than a month. */
  annual: boolean;
  /** The total (the budget's limit) in the base currency. */
  limit: number;
  /** ALL spending in the period: every category, planned or not. */
  spent: number;
  /** limit − spent: below zero is over. */
  left: number;
  /** spent ÷ limit × 100, unclamped (0 for a zero total). */
  pct: number;
  /** Allocations, most used first. */
  lines: BudgetLineProgress[];
  /** Spending nothing was allocated to, largest first. */
  notPlanned: BudgetLineProgress[];
  /** What the total leaves unallocated (limit − the planned lines); below zero when they exceed it. */
  unallocated: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');

/** The current calendar month of `now` as a window (a legacy rolling budget applies to every month). */
function monthWindow(now: string): { start: string; end: string } {
  const [y, m] = now.split('-').map(Number);
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}` };
}

/**
 * A per-category budget: a category and a limit, no allocations (the pre-container shape, whatever its
 * scope). It is a single line, not a container — as `budgetLines` has always read it.
 */
const isLegacyCategoryBudget = (b: Budget, own: BudgetAllocation[]) => !!b.category && own.length === 0;

export function budgetProgress(
  budget: Budget, allocations: BudgetAllocation[], transactions: Transaction[],
  opts: { baseCurrency: string; rates: ExchangeRates; now?: string },
): BudgetProgress {
  const cur = opts.baseCurrency;
  const period = budgetPeriodWindow(budget) ?? monthWindow(opts.now ?? today());
  const own = allocations.filter(a => a.budgetId === budget.id);
  // A stored legacy id (e.g. 'food') spends against its current category, the same rule the budget form
  // uses to save an allocation (budgetCategoryOf). Without this the old row was listed twice: once
  // planned, once as "not planned" under the same name.
  const spend: Record<string, number> = {};
  for (const [category, amount] of Object.entries(spendByCategoryInRange(transactions, period.start, period.end, cur, opts.rates))) {
    const current = budgetCategoryOf(category) ?? category;
    spend[current] = round2((spend[current] ?? 0) + amount);
  }
  const limit = round2(convert(budget.limit, budget.currency, cur, opts.rates));
  const legacy = isLegacyCategoryBudget(budget, own);

  // The planned line is keyed by the same current id as the spend it is measured against.
  const currentIdOf = (category: string) => budgetCategoryOf(category) ?? category;
  const plannedRows = legacy
    ? [{ category: currentIdOf(budget.category!), amount: limit }]
    : own.map(a => ({ category: currentIdOf(a.category), amount: round2(convert(a.amount, budget.currency, cur, opts.rates)) }));
  const planned = new Set<string>();
  const lines: BudgetLineProgress[] = [];
  for (const row of plannedRows) {
    if (!(row.amount > 0) || planned.has(row.category)) continue;
    planned.add(row.category);
    const spent = round2(spend[row.category] ?? 0);
    lines.push({ category: row.category, limit: row.amount, spent, planned: true, pct: spent / row.amount * 100, left: round2(row.amount - spent) });
  }
  const notPlanned: BudgetLineProgress[] = legacy ? [] : Object.entries(spend)
    .filter(([category, amount]) => amount > 0 && !planned.has(category))
    .map(([category, amount]) => ({ category, limit: 0, spent: round2(amount), planned: false, pct: null, left: round2(-amount) }))
    .sort((a, b) => b.spent - a.spent || a.category.localeCompare(b.category));

  // A legacy category budget's total is its one line; every other budget's total is all spending.
  const spent = legacy ? (lines[0]?.spent ?? 0) : round2(Object.values(spend).reduce((s, n) => s + n, 0));
  const plannedSum = lines.reduce((s, l) => s + l.limit, 0);
  const annual = budget.scope ? budget.scope === 'annual' : period.start.slice(0, 7) !== period.end.slice(0, 7);
  return {
    budget, start: period.start, end: period.end, annual,
    limit, spent, left: round2(limit - spent), pct: limit > 0 ? spent / limit * 100 : 0,
    lines: sortByUtilisation(lines, l => ({ spent: l.spent, limit: l.limit, label: getCat(l.category).label })),
    notPlanned,
    unallocated: round2(limit - plannedSum),
  };
}

/**
 * The budgets that apply to a month (YYYY-MM): that month's own budget, the annual budget of its year,
 * and any legacy budget whose window covers it (a legacy category budget with no window applies to every
 * month). The month's own budget comes first, then the annual one, then legacy ones.
 */
export function budgetsForMonth(budgets: Budget[], monthKey: string): Budget[] {
  const [y, m] = monthKey.split('-').map(Number);
  const rank = (b: Budget) => b.scope === 'month' ? 0 : b.scope === 'annual' ? 1 : 2;
  // The same identity rules as `budgetLinesForMonth` (calculations.ts), on the budgets themselves.
  return budgets.filter(b => {
    if (b.scope === 'annual') return b.periodYear === y;
    if (b.periodYear != null && b.periodMonth != null) return b.periodYear === y && b.periodMonth === m;
    if (b.periodStart && b.periodEnd) return b.periodStart <= `${monthKey}-31` && b.periodEnd >= `${monthKey}-01`;
    return !!b.category;
  }).sort((a, b) => rank(a) - rank(b));
}

export interface BudgetLinesNow {
  /** Every budget covering the month, measured over its own period. */
  progress: BudgetProgress[];
  /** The month's own budget, when there is one. */
  month?: BudgetProgress;
  /** The year's annual budget, when there is one. */
  year?: BudgetProgress;
  /** Every planned line of those budgets, most used first; `annual` marks a line measured over its year. */
  lines: (BudgetLineProgress & { budgetId: string; annual: boolean })[];
  /** Not-planned spending this month: from the month's own budget, else from the annual one (over its year). */
  notPlanned: (BudgetLineProgress & { budgetId: string; annual: boolean })[];
}

/** The budgets as they stand in a month: what the Dashboard panel, the pace banner and Pip read. */
export function budgetLinesNow(
  budgets: Budget[], allocations: BudgetAllocation[], transactions: Transaction[],
  opts: { baseCurrency: string; rates: ExchangeRates; now?: string },
): BudgetLinesNow {
  const now = opts.now ?? today();
  const progress = budgetsForMonth(budgets, now.slice(0, 7)).map(b => budgetProgress(b, allocations, transactions, { ...opts, now }));
  const month = progress.find(p => p.budget.scope === 'month');
  const year = progress.find(p => p.budget.scope === 'annual');
  const tag = (p: BudgetProgress) => (l: BudgetLineProgress) => ({ ...l, budgetId: p.budget.id, annual: p.annual });
  const lines = sortByUtilisation(progress.flatMap(p => p.lines.map(tag(p))),
    l => ({ spent: l.spent, limit: l.limit, label: getCat(l.category).label }));
  const source = month ?? year;
  return { progress, month, year, lines, notPlanned: source ? source.notPlanned.map(tag(source)) : [] };
}

/**
 * The Dashboard pace banner: month-to-date spending against the month budget's total, pro-rated by day.
 * Null without a month budget (never a fabricated pace).
 */
export function budgetPace(month: BudgetProgress | undefined, now: string = today()): { under: boolean; amount: number } | null {
  if (!month || !(month.limit > 0)) return null;
  const [y, m, d] = now.split('-').map(Number);
  const expected = month.limit * (d / new Date(y, m, 0).getDate());
  const diff = expected - month.spent;
  return { under: diff >= 0, amount: round2(Math.abs(diff)) };
}
