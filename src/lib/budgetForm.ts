// Budget helpers shared by the Budgets page and its form (Aurora 4.0 CF6, FB1).
import type { Budget } from '../types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 2026" for a month budget, "2026" for an annual one. */
export function budgetTitle(b: Pick<Budget, 'scope' | 'periodYear' | 'periodMonth' | 'periodStart' | 'periodEnd'>): string {
  if (b.scope === 'annual') return `${b.periodYear}`;
  if (b.scope === 'month' && b.periodMonth) return `${MONTHS[b.periodMonth - 1]} ${b.periodYear}`;
  // legacy fallback
  return b.periodStart ? `${b.periodStart} → ${b.periodEnd}` : 'Budget';
}

/**
 * Aurora 4.0 FB1 — "Trim allocations": scale every line down so they sum exactly to `total`, in
 * whole hundredths, keeping each line's share. Rounding is down per line; the cents left over go to
 * the largest line, so the sum is exactly the total and no line goes negative. Lines at 0 stay 0.
 */
export function trimAllocations(amounts: number[], total: number): number[] {
  const sum = amounts.reduce((s, a) => s + (a > 0 ? a : 0), 0);
  if (sum <= total || total <= 0) return amounts.map(a => (a > 0 && total <= 0 ? 0 : a));
  const cents = Math.round(total * 100);
  const scaled = amounts.map(a => (a > 0 ? Math.floor((a * cents) / sum) : 0));
  let left = cents - scaled.reduce((s, c) => s + c, 0);
  const order = amounts.map((a, i) => i).sort((i, j) => amounts[j] - amounts[i]);
  for (let k = 0; left > 0 && k < order.length; k++) {
    if (amounts[order[k]] > 0) { scaled[order[k]] += left; left = 0; }
  }
  return scaled.map(c => c / 100);
}
