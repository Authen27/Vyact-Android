// Vyact — Money-Model Epic 2: budget intelligence (B2.2 history, B2.4 copy+suggest).
//
// Per principle A8, the only cross-entity "connection" worth building is READ-ONLY
// inference over the truth. These helpers READ recurring + debts + goals to PROPOSE
// a budget; they never write phantom money and add no new arithmetic beyond folding
// existing values. Pure + unit-tested. Budgets v2 is a permanent part of the app.

import type {
  Transaction, Budget, Debt, RecurringSchedule, ExchangeRates, BudgetPeriod,
} from '../types';
import { spendByCategory, monthlyData, periodMonths } from './calculations';
import { getMonthKey, nowMonthKey } from './format';
import { EXPENSE_CATEGORIES, LEGACY_CATEGORY_ALIASES } from '../constants';
import { ruleOf, isLoanEmiSchedule } from './recurring';

const EXPENSE_IDS = new Set<string>(EXPENSE_CATEGORIES.map(c => c.id));

/**
 * W4h (v10.77.0; owner decision D27) — the category a budget line can carry: the CURRENT expense id
 * (a legacy id like `rent` or `transport` resolved through LEGACY_CATEGORY_ALIASES), or null for
 * anything the budget form does not show (`savings` from the retired Goals, income ids, unknown ids).
 * A line the form cannot show was still counted and saved: the "huge total, tiny split" report.
 */
export function budgetCategoryOf(id: string | null | undefined): string | null {
  if (!id) return null;
  const current = LEGACY_CATEGORY_ALIASES[id] ?? id;
  return EXPENSE_IDS.has(current) ? current : null;
}

/** How often a schedule's own rule falls in a year (W3e: the rule, not the frequency label). */
function timesPerYear(s: RecurringSchedule): number {
  const r = ruleOf(s);
  const every = Math.max(1, r.interval);
  switch (r.freq) {
    case 'DAILY': return 365 / every;
    case 'WEEKLY': return (52 / every) * Math.max(1, r.byDay?.length ?? 1);
    case 'MONTHLY': return (12 / every) * (r.bySetPos?.length ? 1 : Math.max(1, r.byMonthDay?.length ?? 1));
    default: return 1 / every;
  }
}

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
  basis: 'recurring' | 'debt' | 'history';
}

/**
 * Build an editable budget proposal (W4h, owner decision D27). Every line is a category the budget
 * form SHOWS (budgetCategoryOf) and traceable to a real source:
 *   • recurring — active expense schedules, monthly-normalised from each one's own rule (a daily bill
 *     is ×365/12, a quarterly one ÷3) and SUMMED per category (two bills in one category are both paid);
 *   • debt      — each live loan's EMI, once (receivables and paid-off loans are not the household's to
 *     pay; an EMI schedule is not counted on top — it is the same EMI);
 *   • history   — the last three completed months' average, where that is more than the commitments.
 * No goal line (Goals are retired) and no category the form hides. Never invents money.
 */
export function suggestBudget(input: {
  transactions: Transaction[];
  debts: Debt[];
  recurring: RecurringSchedule[];
  baseCurrency: string;
  rates: ExchangeRates;
}): BudgetSuggestion[] {
  const { transactions, debts, recurring, baseCurrency, rates } = input;
  const committed = new Map<string, { amount: number; basis: BudgetSuggestion['basis'] }>();
  const add = (category: string, amount: number, basis: BudgetSuggestion['basis']) => {
    const current = committed.get(category);
    committed.set(category, { amount: (current?.amount ?? 0) + amount, basis: current?.basis ?? basis });
  };

  for (const r of recurring) {
    const t = r.transactionTemplate;
    if (!t || t.type !== 'expense' || r.active === false || isLoanEmiSchedule(r)) continue;
    const category = budgetCategoryOf(t.category);
    if (!category || !(t.amount > 0)) continue;
    add(category, (t.amount * timesPerYear(r)) / 12, 'recurring');
  }

  for (const d of debts) {
    if ((d.direction ?? 'owed_by_me') === 'owed_to_me' || d.paidOffAt || !(d.currentBalance > 0)) continue;
    if (d.minimumPayment > 0) add('loan_emi', d.minimumPayment, 'debt');
  }

  // The last three completed months' average, by the category the form shows.
  const months = [...new Set(transactions.map(t => getMonthKey(t.date)))].sort().filter(m => m !== nowMonthKey()).slice(-3);
  const average = new Map<string, number>();
  for (const mk of months) {
    for (const [raw, amt] of Object.entries(spendByCategory(transactions, mk, baseCurrency, rates))) {
      const category = budgetCategoryOf(raw);
      if (category) average.set(category, (average.get(category) || 0) + amt / months.length);
    }
  }

  const out = new Map<string, BudgetSuggestion>();
  for (const [category, { amount, basis }] of committed) out.set(category, { category, limit: Math.round(amount), basis });
  for (const [category, amount] of average) {
    const limit = Math.round(amount);
    const existing = out.get(category);
    if (!existing || limit > existing.limit) out.set(category, { category, limit, basis: 'history' });
  }
  return [...out.values()].filter(s => s.limit > 0).sort((a, b) => b.limit - a.limit);
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
