// Vyact — Money-Model Epic 2: budget intelligence (B2.2 history, B2.4 copy+suggest).
//
// Per principle A8, the only cross-entity "connection" worth building is READ-ONLY
// inference over the truth. These helpers READ recurring + debts + goals to PROPOSE
// a budget; they never write phantom money and add no new arithmetic beyond folding
// existing values. Pure + unit-tested. Budgets v2 is a permanent part of the app.

import type {
  Transaction, Budget, Debt, Goal, RecurringSchedule, ExchangeRates, BudgetPeriod,
} from '../types';
import { spendByCategory, monthlyData, periodMonths } from './calculations';
import { getMonthKey, nowMonthKey } from './format';

// ── B2.4(a) — copy from previous month ─────────────────────────────────────────
/** Clone the category + limit set so the user can carry a budget forward. Returns
 *  bare proposals (no ids); the caller persists them via the normal store path. */
export function copyBudgets(budgets: Budget[]): Pick<Budget, 'category' | 'limit' | 'currency' | 'period'>[] {
  return budgets.map(b => ({ category: b.category, limit: b.limit, currency: b.currency, period: b.period ?? 'monthly' }));
}

// ── B2.4(b) — suggested budget (read-only inference over recurring+debts+goals) ──
export interface BudgetSuggestion {
  category: string;
  /** Proposed monthly limit, rounded. */
  limit: number;
  /** Where the number came from — shown so the proposal is transparent (A1). */
  basis: 'recurring' | 'debt' | 'goal' | 'history';
}

/** Build an editable budget proposal. Each line is traceable to a real source:
 *  recurring fixed costs (by category), debt minimum payments, goal monthly pace,
 *  and a 3-month spending average for categories with neither. Never invents money. */
export function suggestBudget(input: {
  transactions: Transaction[];
  debts: Debt[];
  goals: Goal[];
  recurring: RecurringSchedule[];
  baseCurrency: string;
  rates: ExchangeRates;
}): BudgetSuggestion[] {
  const { transactions, debts, goals, recurring, baseCurrency, rates } = input;
  const byCat = new Map<string, BudgetSuggestion>();
  const put = (category: string, limit: number, basis: BudgetSuggestion['basis']) => {
    const rounded = Math.round(limit);
    if (rounded <= 0) return;
    const existing = byCat.get(category);
    // Prefer the more concrete basis; otherwise take the larger estimate.
    if (!existing || rounded > existing.limit) byCat.set(category, { category, limit: rounded, basis });
  };

  // Recurring fixed costs → their category (monthly-normalised).
  for (const r of recurring) {
    const t = r.transactionTemplate;
    if (!t || t.type !== 'expense') continue;
    const monthly = r.frequency === 'weekly' ? t.amount * 52 / 12
      : r.frequency === 'yearly' ? t.amount / 12
      : t.amount; // monthly / custom_day ≈ monthly
    put(t.category, monthly, 'recurring');
  }

  // Debt minimum payments → the v9 loan_emi category (txn-redesign §3).
  const debtMin = debts.reduce((s, d) => s + (d.minimumPayment || 0), 0);
  if (debtMin > 0) put('loan_emi', debtMin, 'debt');

  // Goal monthly pace → savings category.
  let goalMonthly = 0;
  for (const g of goals) {
    if (g.completed || g.target <= g.current) continue;
    const remaining = g.target - g.current;
    const months = g.deadline
      ? Math.max(1, Math.ceil((new Date(g.deadline).getTime() - Date.now()) / (30 * 86400000)))
      : 12;
    goalMonthly += remaining / months;
  }
  if (goalMonthly > 0) put('savings', goalMonthly, 'goal');

  // Fill remaining everyday categories from a 3-month average where no proposal yet.
  const months = [...new Set(transactions.map(t => getMonthKey(t.date)))].sort().filter(m => m !== nowMonthKey()).slice(-3);
  const avg = new Map<string, number>();
  for (const mk of months) {
    for (const [cat, amt] of Object.entries(spendByCategory(transactions, mk, baseCurrency, rates))) {
      avg.set(cat, (avg.get(cat) || 0) + amt / months.length);
    }
  }
  for (const [cat, amt] of avg) if (!byCat.has(cat)) put(cat, amt, 'history');

  return [...byCat.values()].sort((a, b) => b.limit - a.limit);
}

// ── B2.2 — budget history & timeline ────────────────────────────────────────────
export interface BudgetMonth {
  monthKey: string;
  budgeted: number;
  actual: number;
  /** budgeted − actual; positive = saved, negative = overspent. */
  variance: number;
  /** actual / budgeted as a percentage (0 when no budget). */
  pct: number;
}

/** Month-by-month budget-vs-actual for the last `count` months, oldest→newest.
 *  Answers "are we improving?" at a glance (B2.2). Sums all budget limits as the
 *  period target and all reportable spend as actual. */
export function budgetHistory(
  transactions: Transaction[],
  budgets: Budget[],
  baseCurrency: string,
  rates: ExchangeRates,
  count = 6,
): BudgetMonth[] {
  const budgeted = budgets.reduce((s, b) => s + (b.limit || 0), 0);
  const months = [...new Set(transactions.map(t => getMonthKey(t.date)))].sort().slice(-count);
  return months.map(mk => {
    const actual = monthlyData(transactions, mk, baseCurrency, rates).expense;
    const variance = Math.round((budgeted - actual) * 100) / 100;
    return {
      monthKey: mk,
      budgeted: Math.round(budgeted * 100) / 100,
      actual: Math.round(actual * 100) / 100,
      variance,
      pct: budgeted > 0 ? Math.round((actual / budgeted) * 100) : 0,
    };
  });
}

// ── B2.3 (c) — period roll-up: category budgets are children of a monthly /
//    annual total. monthlyEquivalent normalises each budget's limit to a month;
//    the parent totals sum the children. ──────────────────────────────────────
export interface BudgetRollup {
  /** Sum of every budget's monthly-equivalent limit. */
  monthlyTotal: number;
  /** monthlyTotal × 12. */
  annualTotal: number;
  /** Per-category children with their monthly-equivalent contribution. */
  children: { category: string; monthly: number }[];
}

/** Normalise a budget's window limit to a per-month figure. */
export function monthlyEquivalent(limit: number, period: BudgetPeriod | undefined): number {
  const months = periodMonths(period);
  return months > 1 ? limit / months : limit;
}

/** Roll category budgets up into monthly + annual parents (decision c).
 *  Currency conversion is the caller's responsibility (pass base-currency limits). */
export function budgetRollup(budgets: { category: string; limitBase: number; period?: BudgetPeriod }[]): BudgetRollup {
  const children = budgets.map(b => ({ category: b.category, monthly: Math.round(monthlyEquivalent(b.limitBase, b.period) * 100) / 100 }));
  const monthlyTotal = Math.round(children.reduce((s, c) => s + c.monthly, 0) * 100) / 100;
  return { monthlyTotal, annualTotal: Math.round(monthlyTotal * 12 * 100) / 100, children };
}
