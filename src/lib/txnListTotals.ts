// W7a (audit FE-UIC-17) — the Transactions page's own totals (filtered net, month-group nets, the
// heat calendar's per-day sums) follow the same rules as every other total: reportable rows only
// (no transfer legs, no balance adjustments, nothing marked "not in totals") at the effective amount
// (your share of a split bill). They used to sum raw amounts, so a split dinner counted in full and a
// paired transfer or a reconciliation correction moved the month's net.
import type { Transaction } from '../types';
import { effectiveAmount, isLoanPrincipalRow, reportableTxns, totalBalance } from './calculations';

/**
 * Track E (v10.97.0) — the list's type filter. "Expense" also lists a loan payment's principal row,
 * which counts as Loan / EMI spending, so the rows shown and their total agree with Reports. The row
 * is still a transfer: "Transfer" lists it too.
 */
export function matchesType(t: Transaction, type: string): boolean {
  return t.type === type || (type === 'expense' && isLoanPrincipalRow(t));
}

/** Track E — the list's category filter: "Loan / EMI" lists the principal rows as well. */
export function matchesCategory(t: Transaction, category: string): boolean {
  return t.category === category || (category === 'loan_emi' && isLoanPrincipalRow(t));
}

/** Income − expense over the given rows, counted like the dashboard. */
export function listNet(txns: Transaction[], baseCurrency: string): number {
  return totalBalance(txns, baseCurrency, {});
}

/** Per-day income and expense for one month (YYYY-MM), counted like the dashboard. */
export function dayTotalsForMonth(txns: Transaction[], monthKey: string, baseCurrency: string): Map<string, { income: number; expense: number }> {
  const map = new Map<string, { income: number; expense: number }>();
  for (const t of reportableTxns(txns)) {
    if (!t.date.startsWith(monthKey + '-')) continue;
    const cur = map.get(t.date) ?? { income: 0, expense: 0 };
    cur[t.type as 'income' | 'expense'] += Math.abs(effectiveAmount(t, baseCurrency, {}));
    map.set(t.date, cur);
  }
  return map;
}
