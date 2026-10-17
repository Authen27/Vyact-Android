// W6 (audit FE-UIC-07) — two ratios, defined once.
//
// Debts divided ALL-TIME income by 12, with `|| 1` when there was none: three years of salary
// made a 30% DTI read as 10%, one month of data read as 360%. Net Worth divided by `income || 1`,
// so on the 2nd of a month with no salary yet "Kept this month" read −499,900%. Both now use this
// month's income (the Dashboard's basis, and the planner's and insights'), and say nothing — null,
// shown as "—" — when no income is recorded this month.

/** Monthly debt payments as a % of this month's income; null when there is no income to divide by. */
export function debtToIncomePct(monthlyDebtPayment: number, monthIncome: number): number | null {
  if (!(monthIncome > 0)) return null;
  return (Math.max(0, monthlyDebtPayment) / monthIncome) * 100;
}

/** What was kept of this month's income, as a %; null when there is no income this month. */
export function keptThisMonthPct(monthIncome: number, monthExpense: number): number | null {
  if (!(monthIncome > 0)) return null;
  return ((monthIncome - monthExpense) / monthIncome) * 100;
}

/** A ratio for display: "—" when it cannot be stated. */
export function pctLabel(pct: number | null, digits: number): string {
  return pct == null ? '—' : `${pct.toFixed(digits)}%`;
}
