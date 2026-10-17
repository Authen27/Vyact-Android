// Vyact v10.31.0 — budget vs actual by MATCHING SCOPE
// (docs/INSIGHTS_ASK_REPORTS_UX.md, "Further Product Work").
//
// Contract: a monthly budget is compared per month and an annual budget per year,
// each over its OWN full period, never mixed in one series. The current period is
// "in progress", never over or under. Reports shows which budgets overlap its range;
// this adds no score.
//
// Track E, E5 (v10.99.0; owner, E-6): the figures are the ONE budget-progress basis
// (lib/budgetProgress.ts), the ones the Budgets page shows. Budgeted = the budget's
// TOTAL; actual = ALL spending in its period, unallocated categories included. It
// used to compare the sum of the allocations with spending in allocated categories
// only, so a budget read differently here than on the Budgets page, and a budget
// with no allocations was not compared at all.
import type { Budget, BudgetAllocation, ExchangeRates, Transaction } from '../types';
import { budgetProgress } from './budgetProgress';
import { today } from './format';

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
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
  for (const budget of input.budgets) {
    const scope = budget.scope;
    if ((scope !== 'month' && scope !== 'annual') || !budget.periodYear) continue;
    if (scope === 'month' && !budget.periodMonth) continue;
    const p = budgetProgress(budget, input.allocations, input.transactions, { baseCurrency: input.baseCurrency, rates: input.rates, now });
    if (p.start > input.range.to || p.end < input.range.from || !(p.limit > 0)) continue;
    const status: BudgetTrendStatus = p.end >= now ? 'in-progress' : p.spent > p.limit ? 'over' : p.spent < p.limit ? 'under' : 'on';
    rows.push({
      budgetId: budget.id, scope, start: p.start, end: p.end, budgeted: p.limit, actual: p.spent, difference: p.left, status,
      label: scope === 'annual' ? String(budget.periodYear) : `${MONTHS[(budget.periodMonth ?? 1) - 1]} ${budget.periodYear}`,
    });
  }
  const byStart = (left: BudgetTrendRow, right: BudgetTrendRow) => left.start.localeCompare(right.start);
  const monthly = rows.filter(row => row.scope === 'month').sort(byStart);
  const annual = rows.filter(row => row.scope === 'annual').sort(byStart);
  return {
    monthly, annual,
    completedOver: rows.filter(row => row.status === 'over').length,
    completedUnder: rows.filter(row => row.status === 'under').length,
  };
}
