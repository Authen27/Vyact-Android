// Vyact v6 — Pure computation layer
// All pulse-score / aggregation / loan / split logic.
// No React, no DOM. Easy to unit-test.

import type { Transaction, Budget, BudgetAllocation, Goal, Debt, Asset, Profile, ExchangeRates, BudgetPeriod, RecurringSchedule } from '../types';
import { convert, getMonthKey, nowMonthKey, clamp } from './format';
import { ruleOf, policyOf } from './recurring';
import { expandRRule } from './rrule';
import { toDinero, fromDinero, convertViaUsdRates, sumDinero, dineroZero, addDinero } from './money';
import type { Dinero } from 'dinero.js';

// ── Multi-currency aware amount in BASE ────────────────────────
//
// TD-01 phase B: every aggregator below folds amounts in *dinero space*
// (integer minor units, exact integer add) rather than via `reduce` over
// JS `number`. Public signatures still return `number` so call sites are
// unchanged; the gain is that summing many converted amounts no longer
// drifts. `0.10 + 0.10 + 0.10 ≠ 0.30` does not happen here any more.
//
// `effectiveDinero` is the internal helper that maps a transaction (with
// optional split share + optional foreign currency) into a Dinero in the
// base currency. Every aggregator uses it.

export function txnAmountInBase(t: Transaction, baseCurrency: string, rates: ExchangeRates): number {
  return convert(t.amount, t.currency || baseCurrency, baseCurrency, rates);
}

// W3b (v10.66.0; owner decision D14) — ONE CURRENCY PER HOUSEHOLD, NO CONVERSION. Every amount is
// read at face value in the household's currency: a row still labelled with another currency (an old
// row, or one saved before the household's currency was changed) counts as the household's, and a
// currency change only changes the symbol. The `rates` argument is accepted and ignored, so the many
// callers that still pass it need no change; removing that plumbing is TECH_DEBT TD-45.
function effectiveDinero(t: Transaction, baseCurrency: string, _rates?: ExchangeRates): Dinero<number> {
  const raw = t.split?.isSplit && typeof t.split.yourShare === 'number'
    ? t.split.yourShare
    : t.amount;
  return toDinero(raw, baseCurrency);   // face value: the row's own currency label is not read
}

export function effectiveAmount(t: Transaction, baseCurrency: string, rates: ExchangeRates): number {
  return fromDinero(effectiveDinero(t, baseCurrency, rates));
}

// Reportable = excludes private/excluded txns and BOTH transfer encodings:
//   • v7.0.3 paired rows  — each leg has type 'income'/'expense' but
//     category === 'transfer'; the category filter drops them.
//   • v7.2 single-row     — type === 'transfer'; the type filter drops it.
// Money Map (v7.2) keeps both filters live throughout the dual-encoding
// window so a household viewing a row written by either client gets
// identical totals.
//
// Track E (v10.97.0; owner decisions 13 Oct 2026, E-1) — "full EMI = spend, everywhere". A loan payment
// is two ledger rows: the interest (an expense, Loan / EMI) and the PRINCIPAL (a transfer into the loan
// account), both carrying `emiSplit`. For every SPENDING figure the principal row reads as Loan / EMI
// spending too, for every kind of payment (EMI, prepayment, payoff, bank figures). This is a reporting
// rule only: the ledger row stays a transfer, and balances, the loan's outstanding and net worth never
// read reportableTxns. The stand-in shares the row's id; nothing edits a reportable row.
export function reportableTxns(transactions: Transaction[]): Transaction[] {
  const out: Transaction[] = [];
  for (const t of transactions) {
    if (t.excluded) continue;
    if (isLoanPrincipalRow(t)) { out.push({ ...t, type: 'expense', category: 'loan_emi' }); continue; }
    if ((t.type === 'income' || t.type === 'expense')
      && t.category !== 'transfer'
      // Money-Model B1.3 — reconciliation Balance Adjustments move an account but
      // are corrections, not spend/earn; they must never count in income/expense
      // or category totals (mirrors the transfer exclusion).
      && t.category !== 'balance_adjustment') out.push(t);
  }
  return out;
}

/** Track E — a loan payment's principal row: a transfer carrying the payment's `emiSplit`. */
export function isLoanPrincipalRow(t: Pick<Transaction, 'type' | 'emiSplit'>): boolean {
  return t.type === 'transfer' && !!t.emiSplit;
}

/**
 * Track E (v10.96.0) — the rows that count as SPENDING: reportable expenses (since v10.97.0 a loan
 * payment's principal too). The one rule every spending total reads, and, through the bundled engine,
 * every WhatsApp spending alert and digest.
 */
export function spendRows(transactions: Transaction[]): Transaction[] {
  return reportableTxns(transactions).filter(t => t.type === 'expense');
}

/**
 * Track E — which ENTRY a spending row belongs to. A loan payment is one entry made of two rows (its
 * interest and its principal), so both carry the payment's key: its operation id, else (older rows) the
 * interest row's id, which the principal links to. Every other row is its own entry.
 */
export function spendEntryKey(t: Pick<Transaction, 'id' | 'emiSplit' | 'linkedTxnId' | 'type'>): string {
  if (!t.emiSplit) return t.id;
  return t.emiSplit.operation_id ?? (t.type === 'transfer' && t.linkedTxnId ? t.linkedTxnId : t.id);
}

/** How many entries these spending rows are (a loan payment counts once). */
export function countSpendEntries(rows: Transaction[]): number {
  return new Set(rows.map(spendEntryKey)).size;
}

export interface MonthData { income: number; expense: number; net: number; }

export function monthlyData(transactions: Transaction[], monthKey: string, baseCurrency: string, rates: ExchangeRates): MonthData {
  const txns = reportableTxns(transactions).filter(t => getMonthKey(t.date) === monthKey);
  const incomeD  = sumDinero(txns.filter(t => t.type === 'income'),  t => effectiveDinero(t, baseCurrency, rates), baseCurrency);
  const expenseD = sumDinero(txns.filter(t => t.type === 'expense'), t => effectiveDinero(t, baseCurrency, rates), baseCurrency);
  const income = fromDinero(incomeD);
  const expense = fromDinero(expenseD);
  // net is income − expense in dinero space too, so subtraction doesn't drift.
  // (dinero exposes `subtract` but a single `add` of a negated income suffices;
  //  for clarity we compute via the JS-number difference of two exact values,
  //  which is itself exact provided both are integer minor units / 10^exp.)
  return { income, expense, net: income - expense };
}

export function totalBalance(transactions: Transaction[], baseCurrency: string, rates: ExchangeRates): number {
  // income adds, expense subtracts. Building both as dinero sums then
  // subtracting at the JS-number edge is exact (both sides quantised
  // to the base currency's native exponent by sumDinero).
  const txns = reportableTxns(transactions);
  const incomeD  = sumDinero(txns.filter(t => t.type === 'income'),  t => effectiveDinero(t, baseCurrency, rates), baseCurrency);
  const expenseD = sumDinero(txns.filter(t => t.type === 'expense'), t => effectiveDinero(t, baseCurrency, rates), baseCurrency);
  return fromDinero(incomeD) - fromDinero(expenseD);
}

export function spendByCategory(transactions: Transaction[], monthKey: string, baseCurrency: string, rates: ExchangeRates): Record<string, number> {
  // One Dinero accumulator per category; fold each expense txn into its
  // bucket, then collapse to a `number` map at the edge.
  const buckets: Record<string, Dinero<number>> = {};
  for (const t of reportableTxns(transactions)) {
    if (t.type !== 'expense' || getMonthKey(t.date) !== monthKey) continue;
    const inBase = effectiveDinero(t, baseCurrency, rates);
    buckets[t.category] = buckets[t.category]
      ? addDinero(buckets[t.category], inBase)
      : inBase;
  }
  const out: Record<string, number> = {};
  for (const [k, d] of Object.entries(buckets)) out[k] = fromDinero(d);
  return out;
}

// v9.1 §4 — flatten budgets + their per-category allocations into concrete
// category lines (the legacy {category, limit} shape). Category-level compliance
// (Pulse, planner, notifications, summaries) reads these lines so it keeps working
// against the new container-budget model. A legacy budget that still carries its
// own `category` is emitted as a single line; a v9.1 container emits one line per
// allocation, inheriting the parent's period window + currency.
export function budgetLines(budgets: Budget[], allocations: BudgetAllocation[]): Budget[] {
  const lines: Budget[] = [];
  for (const b of budgets) {
    const allocs = allocations.filter(a => a.budgetId === b.id);
    if (allocs.length) {
      for (const a of allocs) lines.push({
        id: a.id, category: a.category, limit: a.amount, currency: b.currency,
        period: b.period, periodStart: b.periodStart, periodEnd: b.periodEnd,
        scope: b.scope, periodYear: b.periodYear, periodMonth: b.periodMonth,
      });
    } else if (b.category) {
      lines.push(b);
    }
  }
  return lines;
}

/**
 * The budget lines that apply to ONE month — a monthly budget for exactly that
 * month, or an annual budget covering the year.
 *
 * 🔴 `budgetLines` above flattens EVERY budget the household has ever had, in
 * whatever order the adapter returned them. The dashboard called it directly and
 * then took `.slice(0, 5)`, so which month you were looking at was decided by
 * array position. In September it showed August's budget, because August's lines
 * happened to come first. Nothing in the UI said which month it was.
 *
 * The bug was masked for as long as the array order happened to be favourable;
 * clearing the local cache in v10.20.7 changed the order and exposed it. Order
 * is not a contract — this filters on the budget's declared identity instead.
 *
 * Kept separate from `budgetLines` on purpose: that function is pinned by a
 * parity test against the Deno `_shared` port, and changing its shape would
 * break the port without cause.
 */
export function budgetLinesForMonth(
  budgets: Budget[], allocations: BudgetAllocation[], monthKey: string,
): Budget[] {
  const [y, m] = monthKey.split('-').map(Number);
  return budgetLines(budgets, allocations).filter((b) => {
    if (b.scope === 'annual') return b.periodYear === y;
    if (b.periodYear != null && b.periodMonth != null) {
      return b.periodYear === y && b.periodMonth === m;
    }
    // Legacy rows carry an explicit window rather than a scope identity.
    if (b.periodStart && b.periodEnd) {
      return b.periodStart <= `${monthKey}-31` && b.periodEnd >= `${monthKey}-01`;
    }
    // Audit F5 — a LEGACY budget (a category + limit, no scope/period/window,
    // the pre-container shape) is a rolling monthly budget: it applies to every
    // month. Without this branch the container-model switch would have made
    // every legacy budget invisible to Pulse and Ask Vyact.
    return !!b.category;
  });
}

/**
 * W5 (P1, owner decision; audit FE-PIP-01) — a budget line whose limit covers MORE than one
 * month: an annual budget, or a legacy row whose window or period is longer than a month.
 * `budgetLinesForMonth` returns it for every month of its year, so one month's spending must
 * never be measured against it ("₹60,000 left" of a Travel budget already 97% spent).
 */
export function coversMoreThanAMonth(b: Budget): boolean {
  if (b.scope) return b.scope === 'annual';
  if (b.periodStart && b.periodEnd) return b.periodStart.slice(0, 7) !== b.periodEnd.slice(0, 7);
  return !!b.period && b.period !== 'monthly';
}

// v9.1 §4 — resolve a budget's scope+identity into a concrete [start, end] range.
//   month  → first..last day of (year, month)
//   annual → Jan 1 .. Dec 31 of year
export function resolveBudgetPeriod(
  scope: 'month' | 'annual',
  year: number, month: number,
): { periodStart: string; periodEnd: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (scope === 'annual') return { periodStart: `${year}-01-01`, periodEnd: `${year}-12-31` };
  // month — last day via day 0 of next month
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { periodStart: iso(start), periodEnd: iso(end) };
}

/** A schedule as the forecast reads it: its rule's columns, its month-end rule, and its template. */
export type ForecastSchedule = Pick<RecurringSchedule, 'frequency' | 'startDate'>
  & Partial<Pick<RecurringSchedule, 'rrule' | 'dayOfMonth' | 'weekday' | 'shortMonthPolicy' | 'active'>>
  & { transactionTemplate: { type?: string; amount?: number; currency?: string; category?: string; debtId?: string; linkedDebtId?: string } };

// v9.1 §4.2 — read-only recurring FORECAST: what each recurring EXPENSE schedule will cost over
// [periodStart, periodEnd], bucketed by category. Informs the budget, writes nothing (money-model A8).
// Transfers/investments/income are excluded from spend forecast.
// FE-MNY-16 (v10.91.0; owner decision 13 Oct 2026) — the cost is the schedule's amount × its REAL dates
// in the period, read from its own rule (`ruleOf` + `policyOf` → `expandRRule`, from its start date,
// COUNT and UNTIL included): the same rule the engine and the bill calendar read. The old
// period-length × frequency estimate put a quarterly bill (FREQ=MONTHLY;INTERVAL=3) in every month at
// its full amount, and counted a Mon + Thu bill once a week. A schedule with no date in the period adds
// nothing, and its category is left out.
export function recurringForecastByCategory(
  schedules: ForecastSchedule[],
  periodStart: string, periodEnd: string,
  baseCurrency: string, rates: ExchangeRates,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of schedules) {
    const t = s.transactionTemplate;
    if (!t || t.type !== 'expense' || !t.amount || !t.category) continue;
    // W8a (audit FE-MNY-16): a paused schedule posts nothing, and a loan EMI is the loan's payment, not
    // category spend (the same rule as lib/recurring.ts isLoanEmiSchedule) — neither belongs in the forecast.
    if (s.active === false || t.category === 'loan_emi' || t.debtId || t.linkedDebtId) continue;
    const dates = expandRRule(ruleOf(s), s.startDate, periodStart, periodEnd, { shortMonthPolicy: policyOf(s) });
    if (!dates.length) continue;
    const inBase = convert(t.amount * dates.length, t.currency || baseCurrency, baseCurrency, rates);
    out[t.category] = (out[t.category] || 0) + Math.round(inBase * 100) / 100;
  }
  return out;
}

// ── v6.4: Budget period windows + range-based aggregation ─────
// `budgetWindow` returns the [start, end] inclusive ISO date range for the
// active period of a budget, anchored at `today`. The window for monthly /
// quarterly / half_yearly / annual budgets is calendar-aligned.
export function budgetWindow(b: Pick<Budget, 'period'|'periodStart'|'periodEnd'>, today: Date = new Date()): { start: string; end: string } {
  const period: BudgetPeriod = b.period || 'monthly';
  const y = today.getFullYear();
  const m = today.getMonth(); // 0-indexed
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const startOf = (year: number, month: number) => new Date(Date.UTC(year, month, 1));
  const endOf   = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0));
  if (period === 'custom') {
    return {
      start: b.periodStart || iso(startOf(y, m)),
      end:   b.periodEnd   || iso(endOf(y, m)),
    };
  }
  if (period === 'annual') {
    return { start: iso(startOf(y, 0)), end: iso(endOf(y, 11)) };
  }
  if (period === 'half_yearly') {
    const half = m < 6 ? 0 : 6;
    return { start: iso(startOf(y, half)), end: iso(endOf(y, half + 5)) };
  }
  if (period === 'quarterly') {
    const q = Math.floor(m / 3) * 3;
    return { start: iso(startOf(y, q)), end: iso(endOf(y, q + 2)) };
  }
  // monthly
  return { start: iso(startOf(y, m)), end: iso(endOf(y, m)) };
}

export function spendByCategoryInRange(
  transactions: Transaction[],
  start: string,
  end: string,
  baseCurrency: string,
  rates: ExchangeRates,
): Record<string, number> {
  const buckets: Record<string, Dinero<number>> = {};
  for (const t of reportableTxns(transactions)) {
    if (t.type !== 'expense' || t.date < start || t.date > end) continue;
    const inBase = effectiveDinero(t, baseCurrency, rates);
    buckets[t.category] = buckets[t.category]
      ? addDinero(buckets[t.category], inBase)
      : inBase;
  }
  const out: Record<string, number> = {};
  for (const [k, d] of Object.entries(buckets)) out[k] = fromDinero(d);
  return out;
}

/** Cumulative spend (base currency) at the end of each calendar day in
 *  `[start, upto]`, restricted to `categories`. Board-C Budgets pace chart:
 *  drives the cumulative-spend-vs-limit hero. Uses the same
 *  `reportableTxns`/`effectiveDinero` machinery as `spendByCategoryInRange`,
 *  so the final entry's `cumulative` equals that function's total over the
 *  same window — the chart never contradicts the tracked spend. Returns one
 *  entry per day (inclusive). `null` categories = ALL spending (Track E, E5: a
 *  budget's total is measured against every category, lib/budgetProgress.ts). */
export function cumulativeSpendSeries(
  transactions: Transaction[],
  categories: Set<string> | null,
  start: string,
  upto: string,
  baseCurrency: string,
  rates: ExchangeRates,
): { date: string; cumulative: number }[] {
  if (upto < start) return [];
  // per-day exact spend within the category set (dinero space)
  const perDay = new Map<string, Dinero<number>>();
  for (const t of reportableTxns(transactions)) {
    if (t.type !== 'expense' || (categories && !categories.has(t.category))) continue;
    if (t.date < start || t.date > upto) continue;
    const d = effectiveDinero(t, baseCurrency, rates);
    const prev = perDay.get(t.date);
    perDay.set(t.date, prev ? addDinero(prev, d) : d);
  }
  const out: { date: string; cumulative: number }[] = [];
  let running: Dinero<number> | null = null;
  const cur = new Date(`${start}T00:00:00`);
  const end = new Date(`${upto}T00:00:00`);
  // Guard against a malformed range spinning forever.
  for (let guard = 0; cur <= end && guard < 400; guard++) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    const day = perDay.get(key);
    if (day) running = running ? addDinero(running, day) : day;
    out.push({ date: key, cumulative: running ? fromDinero(running) : 0 });
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** How many calendar months the period covers (used to derive a per-month
 *  view of an aggregated period limit). */
export function periodMonths(period: BudgetPeriod | undefined): number {
  switch (period) {
    case 'annual':      return 12;
    case 'half_yearly': return 6;
    case 'quarterly':   return 3;
    case 'monthly':
    case undefined:     return 1;
    case 'custom':      return 1; // approximation; UI shows literal dates
  }
}

// ── BALANCE SHEET ──────────────────────────────────────────────
// Each helper folds its inputs in dinero space (one accumulator per call,
// FX done per-row, exact integer adds) and returns a JS number at the edge.

export const totalAssets = (assets: Asset[], baseCurrency: string, rates: ExchangeRates): number =>
  fromDinero(sumDinero(assets, a => convertViaUsdRates(toDinero(a.value, a.currency), baseCurrency, rates), baseCurrency));

// v7.1 Money Map — only debts the household *owes* count as liabilities.
// `direction === 'owed_to_me'` rows are receivables (money owed back to
// the household) and surface as a separate Net Worth line item.
export const totalLiabilities = (debts: Debt[], baseCurrency: string, rates: ExchangeRates): number =>
  fromDinero(sumDinero(
    debts.filter(d => (d.direction || 'owed_by_me') !== 'owed_to_me'),
    d => convertViaUsdRates(toDinero(d.currentBalance, d.currency), baseCurrency, rates),
    baseCurrency,
  ));

export const totalReceivables = (debts: Debt[], baseCurrency: string, rates: ExchangeRates): number =>
  fromDinero(sumDinero(
    debts.filter(d => d.direction === 'owed_to_me'),
    d => convertViaUsdRates(toDinero(d.currentBalance, d.currency), baseCurrency, rates),
    baseCurrency,
  ));

export const liquidAssets = (assets: Asset[], baseCurrency: string, rates: ExchangeRates): number =>
  fromDinero(sumDinero(
    assets.filter(a => a.liquidity === 'liquid'),
    a => convertViaUsdRates(toDinero(a.value, a.currency), baseCurrency, rates),
    baseCurrency,
  ));

// Receivables don't have a recurring minimum payment; only true liabilities
// contribute to the household's monthly outflow.
export const totalMonthlyDebtPayment = (debts: Debt[], baseCurrency: string, rates: ExchangeRates): number =>
  fromDinero(sumDinero(
    // W4f (D19): a paid-off loan has no EMI to pay any more, whatever its last EMI was.
    debts.filter(d => (d.direction || 'owed_by_me') !== 'owed_to_me' && !d.paidOffAt),
    d => convertViaUsdRates(toDinero(d.minimumPayment, d.currency), baseCurrency, rates),
    baseCurrency,
  ));

// ── DEBT PAYOFF SIMULATION (forecast; not part of the money model) ──
//
// Board C · Debts strategy toggle. Simulates the standard debt-snowball /
// avalanche cascade month-by-month in base currency to project total interest
// paid, so the on-page toggle can state the honest trade-off ("Avalanche saves
// you $340 in interest") instead of a fabricated figure. This is a PROJECTION —
// it never mutates stored balances and is not consumed by any aggregator, so it
// is outside the money-model invariants. When every debt is paid at exactly its
// minimum (no rolling headroom) the two strategies are identical, which the
// simulation reflects (savings → 0).
export function simulatePayoffInterest(
  debts: Debt[],
  extraPerMonth: number,        // base currency, applied above the minimums
  strategy: 'avalanche' | 'snowball',
  baseCurrency: string,
  rates: ExchangeRates,
): { months: number; totalInterest: number; terminates: boolean } {
  const work = debts
    .filter(d => (d.direction || 'owed_by_me') !== 'owed_to_me' && d.currentBalance > 0)
    .map(d => ({
      balance: convert(d.currentBalance, d.currency, baseCurrency, rates),
      rate: (d.interestRate || 0) / 100 / 12,
      min: convert(d.minimumPayment, d.currency, baseCurrency, rates),
    }));
  if (!work.length) return { months: 0, totalInterest: 0, terminates: true };
  // Total monthly budget = every original minimum + the extra. As debts clear,
  // their freed minimum stays in the budget and rolls onto the priority debt.
  const monthlyBudget = work.reduce((s, w) => s + Math.max(0, w.min), 0) + Math.max(0, extraPerMonth);
  let totalInterest = 0;
  let months = 0;
  const CAP = 1200;   // 100 years — a runaway (budget < interest) bails out here
  while (work.some(w => w.balance > 0.005) && months < CAP) {
    months++;
    let budget = monthlyBudget;
    // 1) accrue interest
    for (const w of work) {
      if (w.balance <= 0) continue;
      const interest = w.balance * w.rate;
      totalInterest += interest;
      w.balance += interest;
    }
    // 2) pay each active debt its own minimum (capped at balance)
    for (const w of work) {
      if (w.balance <= 0 || budget <= 0) continue;
      const pay = Math.min(w.min, w.balance, budget);
      w.balance -= pay;
      budget -= pay;
    }
    // 3) cascade whatever is left (extra + freed minimums) onto priority order
    const active = work.filter(w => w.balance > 0.005)
      .sort((a, b) => strategy === 'avalanche' ? b.rate - a.rate : a.balance - b.balance);
    for (const w of active) {
      if (budget <= 0.005) break;
      const pay = Math.min(budget, w.balance);
      w.balance -= pay;
      budget -= pay;
    }
  }
  return { months, totalInterest, terminates: months < CAP };
}

// ── PULSE SCORE — 4 components ─────────────────────────────────
// Goals were removed as a module, so Goal Progress is no longer a Pulse
// component; the score is Budgets / Savings / Trend / Debt, renormalised over
// whichever are applicable.
export interface PulseScore {
  total: number | null;   // null = not enough data yet (honest empty state)
  components: { budget: number; savings: number; trend: number; debt: number };
  applicable: { budget: boolean; savings: boolean; trend: boolean; debt: boolean };
}

export function computePulseScore(
  transactions: Transaction[], budgets: Budget[], _goals: Goal[], debts: Debt[],
  baseCurrency: string, rates: ExchangeRates,
  allocations: BudgetAllocation[] = [],
  tz?: string | null,   // W3a: the household's month on the server, the device's in the app
): PulseScore {
  const mk = nowMonthKey(tz);
  const { income, expense } = monthlyData(transactions, mk, baseCurrency, rates);

  // 1. Budget compliance — applicable only if budgets exist.
  //    Audit F5: compliance reads the CURRENT month's allocation-derived
  //    category lines (budgetLinesForMonth), never raw container budgets — a
  //    container with no category used to look like zero spending and perfect
  //    compliance. And "on budget" means spending UP TO the plan: ≤100% is a
  //    full score; only overspend degrades it (the old formula decayed toward
  //    zero as the budget was consumed, so spending exactly the plan scored 0).
  const lines = budgetLinesForMonth(budgets, allocations, mk);
  const budgetApplicable = lines.length > 0;
  let budgetScore = 0;
  if (budgetApplicable) {
    const spend = spendByCategory(transactions, mk, baseCurrency, rates);
    const compliance = lines.map(b => {
      const limitBase = convert(b.limit, b.currency, baseCurrency, rates);
      const pct = limitBase > 0 ? (spend[b.category ?? ''] || 0) / limitBase * 100 : 0;
      if (pct <= 100) return 100;                     // on/under budget: full
      return clamp(200 - pct, 0, 100);                // overspend degrades
    });
    budgetScore = compliance.reduce((s, v) => s + v, 0) / compliance.length;
  }

  // 2. Savings rate — applicable only if there is income this month (target 20% => 100)
  const savingsApplicable = income > 0;
  const rate = savingsApplicable ? (income - expense) / income * 100 : 0;
  const savingsScore = clamp(rate * 5, 0, 100);

  // (Goal progress removed — goals are no longer a module.)

  // 4. Expense trend — applicable only if there was spend last month to compare
  const [y, m] = mk.split('-').map(Number);
  const prevMk = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const prevExp = monthlyData(transactions, prevMk, baseCurrency, rates).expense;
  const trendApplicable = prevExp > 0;
  let trendScore = 0;
  if (trendApplicable) {
    const change = (expense - prevExp) / prevExp * 100;
    if      (change <= 0)  trendScore = 100;
    else if (change <= 10) trendScore = 80;
    else if (change <= 20) trendScore = 60;
    else if (change <= 40) trendScore = 40;
    else                   trendScore = 20;
  }

  // 5. Debt health (DTI). Applicable only if the household HAS debts —
  //    debt-free is intentionally EXCLUDED (not gifted 100, not penalised).
  const debtApplicable = debts.length > 0;
  let debtScore = 0;
  if (debtApplicable) {
    if (income === 0) {
      debtScore = 40; // debts but no income to compute DTI -> "watch"
    } else {
      const dti = (totalMonthlyDebtPayment(debts, baseCurrency, rates) / income) * 100;
      if      (dti <= 15) debtScore = 100;
      else if (dti <= 25) debtScore = 85;
      else if (dti <= 36) debtScore = 65;
      else if (dti <= 50) debtScore = 35;
      else                debtScore = 10;
    }
  }

  // Renormalise the original weights over applicable components only.
  const parts = [
    { score: budgetScore,  weight: 0.25, ok: budgetApplicable  },
    { score: savingsScore, weight: 0.25, ok: savingsApplicable },
    { score: trendScore,   weight: 0.15, ok: trendApplicable   },
    { score: debtScore,    weight: 0.20, ok: debtApplicable    },
  ];
  const totalWeight = parts.reduce((s, p) => s + (p.ok ? p.weight : 0), 0);
  const total = totalWeight === 0
    ? null
    : clamp(Math.round(parts.reduce((s, p) => s + (p.ok ? p.score * p.weight : 0), 0) / totalWeight), 0, 100);

  return {
    total,
    components: {
      budget:  Math.round(budgetScore),
      savings: Math.round(savingsScore),
      trend:   Math.round(trendScore),
      debt:    Math.round(debtScore),
    },
    applicable: {
      budget: budgetApplicable, savings: savingsApplicable,
      trend: trendApplicable, debt: debtApplicable,
    },
  };
}

export function pulseStatus(score: number | null): { label: string; cssVar: string } {
  if (score === null) return { label: 'No data yet', cssVar: 'hsl(var(--ink-dim))' };
  if (score >= 80) return { label: 'Excellent',   cssVar: 'hsl(var(--sage))'  };
  if (score >= 65) return { label: 'Good',        cssVar: 'hsl(var(--coral))' };
  if (score >= 45) return { label: 'Fair',        cssVar: 'hsl(var(--honey))' };
  return                  { label: 'Needs Work',  cssVar: 'hsl(var(--terra))' };
}

// ── INSIGHTS ───────────────────────────────────────────────────
export interface Insight {
  icon: string;
  text: string;
  cls: 'chip-good'|'chip-warn'|'chip-alert'|'chip-info';
  /** Plain-language meaning + the next action, shown as an inline sub-line so an
   *  insight explains the term AND tells the user what to do (v9.5.2). */
  detail?: string;
  /** Where the chip navigates, so every insight has an action path. */
  to?: string;
}

/** W8a (audit FE-MNY-06) — what the chips need beyond the raw arrays, so they say what the screens say:
 *  the canonical net-worth projection (live account balances, receivables excluded) and this month's
 *  budget lines (allocations, scope and period). Without it the chips read the static asset/debt
 *  arrays and every budget row's own `category` (a container budget has none). */
export interface InsightContext { allocations: BudgetAllocation[]; netWorth: number | null }

export function getInsights(
  transactions: Transaction[], budgets: Budget[], goals: Goal[], debts: Debt[], assets: Asset[],
  baseCurrency: string, rates: ExchangeRates, ctx?: InsightContext,
): Insight[] {
  const chips: Insight[] = [];
  const mk = nowMonthKey();
  const { income, expense } = monthlyData(transactions, mk, baseCurrency, rates);
  const spend = spendByCategory(transactions, mk, baseCurrency, rates);
  const rate = income > 0 ? Math.round((income - expense) / income * 100) : 0;

  if (income > 0) {
    // Savings rate = the share of this month's income left after spending.
    if (rate >= 20) chips.push({ icon:'💚', text:`Savings rate ${rate}% — great work!`, cls:'chip-good',
      detail:`That's the share of income you keep after spending. You're above the 20% target — put the surplus to work.`, to:'/reports?from=savings' });
    else if (rate >= 10) chips.push({ icon:'📊', text:`Savings rate ${rate}% — aim for 20%+`, cls:'chip-warn',
      detail:`Share of income left after spending. Trim a discretionary category to lift it toward 20%.`, to:'/budgets' });
    else chips.push({ icon:'⚠️', text:`Low savings rate (${rate}%)`, cls:'chip-alert',
      detail:`Little income is left after spending this month. Review your biggest expenses to free up cash.`, to:'/transactions?type=expense' });
  }

  // This month's monthly lines only: an annual line's limit is not one month's (W5, FE-PIP-01).
  const lines = ctx ? budgetLinesForMonth(budgets, ctx.allocations, mk).filter(b => !coversMoreThanAMonth(b)) : budgets;
  const over = lines.filter(b => b.category && (spend[b.category] || 0) > convert(b.limit, b.currency, baseCurrency, rates));
  if (over.length) chips.push({ icon:'🚨', text:`${over.length} budget${over.length>1?'s':''} exceeded`, cls:'chip-alert',
    detail:`You've spent past the limit in ${over.length} categor${over.length>1?'ies':'y'} this month. Review and adjust.`, to:'/budgets' });

  if (debts.length) {
    // DTI = debt-to-income: this month's debt payments as a share of income.
    const dti = income > 0 ? (totalMonthlyDebtPayment(debts, baseCurrency, rates) / income) * 100 : 0;
    if (dti > 36) chips.push({ icon:'📉', text:`DTI ${dti.toFixed(0)}% — above 36%`, cls:'chip-alert',
      detail:`Debt-to-income = monthly debt payments ÷ income. Above 36% is risky — prioritise high-APR payoff.`, to:'/debts' });
    else if (dti > 0 && dti <= 25) chips.push({ icon:'📈', text:`DTI ${dti.toFixed(0)}% — healthy`, cls:'chip-good',
      detail:`Debt-to-income = monthly debt payments ÷ income. Under 36% is healthy; extra payments finish debt sooner.`, to:'/debts' });
  }

  if (ctx ? ctx.netWorth !== null : (assets.length || debts.length)) {
    const nw = ctx ? ctx.netWorth! : totalAssets(assets, baseCurrency, rates) - totalLiabilities(debts, baseCurrency, rates);
    if (nw > 0) chips.push({ icon:'🏆', text:`Net worth building`, cls:'chip-good',
      detail:`Net worth = assets − debts, and yours is positive. Keep growing assets or cutting debt to widen the gap.`, to:'/networth' });
    else chips.push({ icon:'⬇️', text:`Net worth — focus on payoff`, cls:'chip-warn',
      detail:`Your debts currently outweigh your assets. Paying down debt is the fastest way to lift net worth.`, to:'/debts' });
  }
  return chips.slice(0, 4);
}

// ── LOAN / EMI ─────────────────────────────────────────────────
// W4f (D19): the EMI and its split live in lib/loanSchedule.ts (the database's twin, parity-tested);
// the float copies that were here disagreed with the server by the paisa and are gone.

// ── SPLITS ─────────────────────────────────────────────────────
// v10.17 — `email` is surfaced so the Splits page can aggregate the outstanding
// details into a per-person (email-keyed) breakdown. The value already carries
// it at runtime (the whole participant is pushed); the type just now admits it.
type SplitDetailParticipant = { name: string; share: number; paid: boolean; isYou?: boolean; email?: string };
export interface SplitOutstanding {
  owedToYou: number;
  youOwe: number;
  owedDetails: Array<{ txn: Transaction; participant: SplitDetailParticipant }>;
  youOweDetails: Array<{ txn: Transaction; participant: SplitDetailParticipant }>;
}

export function splitsOutstanding(transactions: Transaction[], baseCurrency: string, rates: ExchangeRates): SplitOutstanding {
  let owedToYouD = dineroZero(baseCurrency);
  let youOweD = dineroZero(baseCurrency);
  const owedDetails: SplitOutstanding['owedDetails'] = [];
  const youOweDetails: SplitOutstanding['youOweDetails'] = [];
  transactions.forEach(t => {
    if (!t.split?.isSplit) return;
    const cur = t.currency || baseCurrency;
    // v7.3 \u2014 Income splits invert polarity: when YOU received the total
    // (paidBy === 'me'), each other participant has a share you'll forward
    // to them, i.e. you owe them. When SOMEONE ELSE received the total
    // (paidBy === 'external') and you haven't been paid out yet, they owe
    // you. Expense splits keep their original meaning.
    const isIncome = t.type === 'income';
    (t.split.participants || []).forEach(p => {
      if (p.paid) return;
      const shareInBase = convertViaUsdRates(toDinero(p.share, cur), baseCurrency, rates);
      if (!isIncome && t.split!.paidBy === 'me' && !p.isYou) {
        owedToYouD = addDinero(owedToYouD, shareInBase);
        owedDetails.push({ txn: t, participant: p });
      } else if (!isIncome && t.split!.paidBy === 'external' && p.isYou) {
        youOweD = addDinero(youOweD, shareInBase);
        youOweDetails.push({ txn: t, participant: p });
      } else if (isIncome && t.split!.paidBy === 'me' && !p.isYou) {
        // You received the total \u2014 each other participant is owed by you.
        youOweD = addDinero(youOweD, shareInBase);
        youOweDetails.push({ txn: t, participant: p });
      } else if (isIncome && t.split!.paidBy === 'external' && p.isYou) {
        // External recipient hasn't forwarded your share yet.
        owedToYouD = addDinero(owedToYouD, shareInBase);
        owedDetails.push({ txn: t, participant: p });
      }
    });
  });
  return {
    owedToYou: fromDinero(owedToYouD),
    youOwe:    fromDinero(youOweD),
    owedDetails,
    youOweDetails,
  };
}
