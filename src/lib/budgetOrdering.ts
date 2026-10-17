// Vyact v10.27.2 — display order for budgets and their categories.
//
// Presentation only: nothing here computes spend, limits or totals, and nothing
// is written. Both orders used to be whatever the store happened to return,
// which is not a contract (see ordering.test.ts for the same lesson on
// transactions).
//
//   Categories within a budget → most utilised first (spent ÷ limit, unclamped),
//                                so an overrun sits above a line at 95%.
//   Budgets on the Budgets page → the current month on top, then any future
//                                periods (soonest first), then past periods from
//                                the most recent down to the oldest.

import type { Budget } from '../types';

/** spent ÷ limit, NOT clamped at 100%. A zero limit with any spend is the most
 *  over a line can be; a zero limit with no spend is unused. */
export function utilisation(spent: number, limit: number): number {
  if (limit > 0) return spent / limit;
  return spent > 0 ? Number.POSITIVE_INFINITY : 0;
}

/** Most utilised first. Ties: the larger spend first, then the label A→Z, then
 *  the original order — so the result never depends on the input's order for
 *  distinguishable lines. Returns a new array. */
export function sortByUtilisation<T>(
  items: readonly T[],
  pick: (item: T) => { spent: number; limit: number; label: string },
): T[] {
  return items
    .map((item, index) => {
      const { spent, limit, label } = pick(item);
      return { item, index, spent, label, use: utilisation(spent, limit) };
    })
    .sort((a, b) => {
      if (a.use !== b.use) return a.use < b.use ? 1 : -1;   // Infinity-safe
      if (a.spent !== b.spent) return b.spent - a.spent;
      return a.label.localeCompare(b.label) || a.index - b.index;
    })
    .map(entry => entry.item);
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (year: number, month: number) => new Date(year, month, 0).getDate();

/** The inclusive YYYY-MM-DD window a budget covers, or null for a legacy rolling
 *  budget (a category + limit with no period), which applies to every month. */
export function budgetPeriodWindow(b: Budget): { start: string; end: string } | null {
  if (b.scope === 'month' && b.periodYear && b.periodMonth) {
    return {
      start: `${b.periodYear}-${pad(b.periodMonth)}-01`,
      end: `${b.periodYear}-${pad(b.periodMonth)}-${pad(lastDay(b.periodYear, b.periodMonth))}`,
    };
  }
  if (b.scope === 'annual' && b.periodYear) {
    return { start: `${b.periodYear}-01-01`, end: `${b.periodYear}-12-31` };
  }
  if (b.periodStart && b.periodEnd) return { start: b.periodStart, end: b.periodEnd };
  return null;
}

const SCOPE_RANK: Record<string, number> = { month: 0, annual: 1 };

/**
 * Budgets in display order for `now` (local calendar, matching the page's own
 * current-month check): budgets covering the current month first — the month
 * budget, then the annual one, then any custom or legacy window — then future
 * periods soonest first, then past periods from the most recent to the oldest.
 * Returns a new array; the input is not mutated.
 */
export function sortBudgetsForDisplay(budgets: readonly Budget[], now: Date): Budget[] {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const monthStart = `${y}-${pad(m)}-01`;
  const monthEnd = `${y}-${pad(m)}-${pad(lastDay(y, m))}`;

  return budgets
    .map((b, index) => {
      const window = budgetPeriodWindow(b);
      const bucket = !window || (window.start <= monthEnd && window.end >= monthStart) ? 0
        : window.start > monthEnd ? 1
        : 2;
      return { b, index, window, bucket, scope: SCOPE_RANK[b.scope ?? ''] ?? 2 };
    })
    .sort((a, c) => {
      if (a.bucket !== c.bucket) return a.bucket - c.bucket;
      if (a.bucket === 0) {
        if (a.scope !== c.scope) return a.scope - c.scope;
      } else if (a.window && c.window) {
        const byDate = a.bucket === 1
          ? a.window.start.localeCompare(c.window.start)                  // future: soonest first
          : c.window.end.localeCompare(a.window.end)                      // past: most recent first
            || c.window.start.localeCompare(a.window.start);
        if (byDate) return byDate;
      }
      return a.index - c.index;
    })
    .map(entry => entry.b);
}
