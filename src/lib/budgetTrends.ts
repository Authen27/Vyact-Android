// Vyact v10.31.0 — budget vs actual by MATCHING SCOPE
// (docs/INSIGHTS_ASK_REPORTS_UX.md, "Further Product Work").
//
// Contract: a monthly budget is compared per month and an annual budget per year,
// each over its OWN full period, never mixed in one series. Budgeted = the sum of
// its category allocations through central FX; actual = reportable spending in
// those categories within the period, up to today. The current period is "in
// progress", never over or under. A budget with no allocations tracks nothing on
// the Budgets screen, so it is skipped here (and counted) rather than shown as a
// zero budget. Reports shows which budgets overlap its range; this adds no score.
import type { Budget, BudgetAllocation, ExchangeRates, Transaction } from '../types';
import { resolveBudgetPeriod, spendByCategoryInRange } from './calculations';
import { convert, today } from './format';

export type BudgetTrendStatus = 'under' | 'on' | 'over' | 'in-progress';

export interface BudgetTrendRow {
  budgetId: string;
  scope: 'month' | 'annual';
  label: string;
  start: string;
  end: string;
  budgeted: number;
  actual: number;
  /** budgeted − actual: positive = room left, negative = overspent. */
  difference: number;
  status: BudgetTrendStatus;
}

export interface BudgetTrends {
  monthly: BudgetTrendRow[];
  annual: BudgetTrendRow[];
  completedOver: number;
  completedUnder: number;
  /** Budgets in range with no category allocations — not compared. */
  unallocated: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const round2 = (n: number) => Math.round(n * 100) / 100;

export function budgetTrends(input: {
  budgets: Budget[];
  allocations: BudgetAllocation[];
  transactions: Transaction[];
  baseCurrency: string;
  rates: ExchangeRates;
  range: { from: string; to: string };
  now?: string;
}): BudgetTrends {
  const now = input.now ?? today();
  const rows: BudgetTrendRow[] = [];
  let unallocated = 0;
  for (const budget of input.budgets) {
    const scope = budget.scope;
    if ((scope !== 'month' && scope !== 'annual') || !budget.periodYear) continue;
    if (scope === 'month' && !budget.periodMonth) continue;
    const { periodStart: start, periodEnd: end } = resolveBudgetPeriod(scope, budget.periodYear, budget.periodMonth ?? 1);
    if (start > input.range.to || end < input.range.from) continue;
    const lines = input.allocations.filter(line => line.budgetId === budget.id);
    if (!lines.length) { unallocated++; continue; }
    const budgeted = round2(lines.reduce((sum, line) => sum + convert(line.amount, budget.currency, input.baseCurrency, input.rates), 0));
    const spendTo = end < now ? end : now;
    const spend = start <= spendTo ? spendByCategoryInRange(input.transactions, start, spendTo, input.baseCurrency, input.rates) : {};
    const actual = round2(lines.reduce((sum, line) => sum + (spend[line.category] ?? 0), 0));
    const status: BudgetTrendStatus = end >= now ? 'in-progress' : actual > budgeted ? 'over' : actual < budgeted ? 'under' : 'on';
    rows.push({
      budgetId: budget.id, scope, start, end, budgeted, actual, difference: round2(budgeted - actual), status,
      label: scope === 'annual' ? String(budget.periodYear) : `${MONTHS[(budget.periodMonth ?? 1) - 1]} ${budget.periodYear}`,
    });
  }
  const byStart = (left: BudgetTrendRow, right: BudgetTrendRow) => left.start.localeCompare(right.start);
  const monthly = rows.filter(row => row.scope === 'month').sort(byStart);
  const annual = rows.filter(row => row.scope === 'annual').sort(byStart);
  return {
    monthly, annual, unallocated,
    completedOver: rows.filter(row => row.status === 'over').length,
    completedUnder: rows.filter(row => row.status === 'under').length,
  };
}
