// Vyact W4f (v10.75.0; owner decisions D19, D17, D30) — the loan model's arithmetic, in the app.
//
// The DATABASE computes every payment's split (`pay_loan`, migration 20261016120000). This module is
// its twin for everything the app shows before and around a payment — the outstanding, the
// instalment due, the schedule, "Clears <Mon YYYY>" — and for local-only households, which have no
// server. The functions below mirror the SQL ones of the same name and are parity-tested against
// Postgres (loanScheduleParity.test.ts):
//   loan_minor_scale · loan_interest · loan_emi · loan_instalments_left · loan_next_instalment ·
//   loan_rate_on · loan_instalment_state.
//
// THE MODEL: a loan's outstanding is its loan ACCOUNT's ledger. Instalment k's interest is the
// outstanding × rate/12 (banker's rounding to the minor unit), fixed when its first payment
// arrives; its amount is min(EMI, outstanding + interest); a payment pays interest first, then
// principal. Short leaves the instalment open; more than due is refused (owner).
import type { Account, Debt, LoanDue, Transaction } from '../types';
import { computeAccountBalance } from './accountBalance';

export type LoanPaymentKind = 'emi' | 'prepayment' | 'payoff' | 'bank_override';
export type PrepaymentChoice = 'reduce_tenure' | 'reduce_emi';
export interface RateChange { from: string; rate: number }

// ── The SQL twins ─────────────────────────────────────────────────────────────

/** loan_minor_scale: units per currency unit (JPY has none). */
export const minorScale = (currency: string): number => (currency === 'JPY' ? 1 : 100);
const toUnits = (amount: number, scale: number): bigint => BigInt(Math.round(amount * scale));
const fromUnits = (units: bigint, scale: number): number => Number(units) / scale;

/** loan_interest: one instalment's interest — round(O·scale) × round(rate/1200, 12), banker's. Exact. */
export function loanInterest(outstanding: number, annualRate: number, currency: string): number {
  const scale = minorScale(currency);
  const o = toUnits(outstanding, scale);
  const r = BigInt(Math.round((annualRate * 1e12) / 1200));   // round(annual/1200, 12) × 1e12
  const ONE = 1_000_000_000_000n;
  const product = o * r;
  const q = product / ONE;
  const rem = product % ONE;
  const twice = rem * 2n;
  const units = twice > ONE ? q + 1n : twice < ONE ? q : (q % 2n === 0n ? q : q + 1n);
  return fromUnits(units, scale);
}

/**
 * loan_emi: the standard EMI P·r(1+r)^n/((1+r)^n−1), rounded UP to the minor unit (no stub instalment).
 * Exact: with r = R/B (R = rate × 10⁶, B = 1200 × 10⁶) the EMI in minor units is U·R·Aⁿ / (B·(Aⁿ − Bⁿ)),
 * A = B + R — a ratio of integers, so no float drift can push it across a paisa (103,000.00 read as
 * 103,000.01 in floats). The SQL's −1e-9 guard is applied the same way.
 */
export function loanEmi(outstanding: number, annualRate: number, months: number, currency: string): number | null {
  const scale = minorScale(currency);
  if (!months || months < 1 || outstanding <= 0) return null;
  const u = toUnits(outstanding, scale);
  if (annualRate === 0) return Number(ceilDiv(u, BigInt(months))) / scale;
  const r = BigInt(Math.round(annualRate * 1e6));
  const b = 1_200_000_000n;
  const an = (b + r) ** BigInt(months);
  const bn = b ** BigInt(months);
  const num = u * r * an;
  const den = b * (an - bn);
  const guard = 1_000_000_000n;   // ceil(x − 1e-9), as the SQL does
  return Number(ceilDiv(num * guard - den, den * guard)) / scale;
}

const ceilDiv = (n: bigint, d: bigint): bigint => (n <= 0n ? -((-n) / d) : (n + d - 1n) / d);

/** loan_instalments_left: instalments at this EMI; null when it never clears the loan. */
export function instalmentsLeft(outstanding: number, annualRate: number, emi: number): number | null {
  if (outstanding <= 0) return 0;
  if (!emi || emi <= 0) return null;
  if (annualRate === 0) return Math.ceil(outstanding / emi - 1e-9);
  const r = annualRate / 1200;
  if (emi <= outstanding * r) return null;
  return Math.ceil(-Math.log(1 - (r * outstanding) / emi) / Math.log(1 + r) - 1e-9);
}

/** loan_next_instalment: the next month's instalment on the loan's day (a 31st → that month's last day). */
export function nextInstalmentDate(from: string, anchorDay: number): string {
  const [y, m] = from.split('-').map(Number);
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(anchorDay, last);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** loan_rate_on: the rate on a date — the latest change on or before it; before every change, the first. */
export function rateOn(history: readonly RateChange[] | undefined, current: number, on: string | null | undefined): number {
  if (!on || !history?.length) return current;
  const sorted = [...history].sort((a, b) => a.from.localeCompare(b.from));
  const before = sorted.filter(c => c.from <= on);
  return (before.length ? before[before.length - 1] : sorted[0]).rate;
}

// ── A loan as the app shows it ────────────────────────────────────────────────

/** The loan's own account (the outstanding lives here), if it has one yet. */
export function loanAccountOf(debt: Pick<Debt, 'id'>, accounts: readonly Account[]): Account | undefined {
  return accounts.find(a => a.kind === 'loan' && a.debtId === debt.id);
}

/** loan_outstanding: the loan account's ledger; a loan with no account yet reads its own figure. */
export function loanOutstanding(debt: Debt, accounts: readonly Account[], transactions: readonly Transaction[]): number {
  const account = loanAccountOf(debt, accounts);
  if (!account) return Math.max(0, debt.currentBalance);
  const balance = computeAccountBalance(account, transactions as Transaction[], account.currency, {});
  return Math.max(0, Math.round(-balance * 100) / 100);
}

/** A payment's legs carry the split the server computed (`extras.emi_split`). */
interface SplitInfo { interest?: number; principal?: number; kind?: string; instalment_no?: number | null; operation_id?: string }
const splitOf = (t: Transaction): SplitInfo | undefined => (t.emiSplit as SplitInfo | undefined);


export interface InstalmentState {
  /** The instalment due: its number and date. */
  no: number;
  date: string | null;
  /** Its interest (fixed at its first payment), its amount, what is paid, what is left. */
  interest: number;
  due: number;
  paid: number;
  interestPaid: number;
  remaining: number;
  started: boolean;
}

/**
 * loan_instalment_state, from what the app holds: the part-payments of the due instalment are the legs
 * marked with its number. Its interest was fixed on the outstanding before the first of them, i.e. the
 * outstanding now plus the principal they paid (a prepayment cannot interleave: it is refused while an
 * instalment is part-paid).
 */
export function instalmentState(debt: Debt, outstanding: number, transactions: readonly Transaction[], currency: string, on?: string): InstalmentState {
  const no = (debt.instalmentsPaid ?? 0) + 1;
  const legs = transactions.filter(t => t.debtId === debt.id && splitOf(t)?.kind === 'emi' && splitOf(t)?.instalment_no === no);
  const paid = round2(legs.reduce((s, t) => s + t.amount, 0));
  const interestPaid = round2(legs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  const principalPaid = round2(paid - interestPaid);
  const started = legs.length > 0;
  const base = started ? outstanding + principalPaid : outstanding;
  const interest = loanInterest(base, rateOn(debt.rateHistory, debt.interestRate, debt.dueDate ?? on), currency);
  const due = Math.min(debt.minimumPayment, round2(base + interest));
  return { no, date: debt.dueDate ?? null, interest, due, paid, interestPaid, remaining: round2(Math.max(due - paid, 0)), started };
}

export interface ScheduleRow { no: number; date: string | null; payment: number; interest: number; principal: number; outstandingAfter: number }

/**
 * The instalments left, as the loan stands: from the due one (whatever is still owed on it) until the
 * outstanding is cleared at today's EMI and rate history. Stops (and says so) if the EMI cannot clear it.
 */
export function projectSchedule(debt: Debt, outstanding: number, state: InstalmentState, currency: string): { rows: ScheduleRow[]; clears: boolean } {
  const rows: ScheduleRow[] = [];
  let o = outstanding;
  let date = state.date;
  const anchor = Number((debt.firstEmiDate ?? debt.dueDate ?? '').slice(8, 10)) || null;
  if (o <= 0) return { rows, clears: true };
  if (state.started) {
    const interest = round2(Math.max(state.interest - state.interestPaid, 0));
    const payment = Math.min(state.remaining, round2(o + interest));
    const principal = round2(payment - interest);
    o = round2(o - principal);
    rows.push({ no: state.no, date, payment, interest, principal, outstandingAfter: o });
    date = date && anchor ? nextInstalmentDate(date, anchor) : null;
  }
  for (let no = state.started ? state.no + 1 : state.no; o > 0 && rows.length < 600; no++) {
    const interest = loanInterest(o, rateOn(debt.rateHistory, debt.interestRate, date), currency);
    const payment = Math.min(debt.minimumPayment, round2(o + interest));
    const principal = round2(payment - interest);
    if (principal <= 0) return { rows, clears: false };
    o = round2(o - principal);
    rows.push({ no, date, payment, interest, principal, outstandingAfter: o });
    date = date && anchor ? nextInstalmentDate(date, anchor) : null;
  }
  return { rows, clears: o <= 0 };
}

export interface LoanView {
  debt: Debt;
  outstanding: number;
  state: InstalmentState;
  schedule: ScheduleRow[];
  /** The EMI clears it (false: it never will at this EMI). */
  clears: boolean;
  /** The last instalment's date, the instalments and the interest still to come. */
  clearsOn: string | null;
  monthsLeft: number;
  interestLeft: number;
  /** Exactly what `payoff` accepts. */
  payoff: number;
  paidOff: boolean;
  /** Principal cleared so far, against the sanctioned amount. */
  cleared: number;
  /** Terms are estimates until the owner confirms them (existing loans). */
  estimated: boolean;
}

export function loanView(debt: Debt, accounts: readonly Account[], transactions: readonly Transaction[], currency: string, on?: string): LoanView {
  const outstanding = loanOutstanding(debt, accounts, transactions);
  const state = instalmentState(debt, outstanding, transactions, currency, on);
  const { rows, clears } = outstanding > 0 && debt.minimumPayment > 0
    ? projectSchedule(debt, outstanding, state, currency) : { rows: [], clears: outstanding <= 0 };
  const interestLeft = round2(rows.reduce((s, r) => s + r.interest, 0));
  const last = rows[rows.length - 1];
  const payoff = round2(outstanding + (state.started ? Math.max(state.interest - state.interestPaid, 0) : 0));
  const sanctioned = debt.principal || outstanding;
  return {
    debt, outstanding, state, schedule: rows, clears,
    clearsOn: clears && last ? last.date : null,
    monthsLeft: clears ? rows.length : 0,
    interestLeft, payoff,
    paidOff: !!debt.paidOffAt || outstanding <= 0,
    cleared: round2(Math.max(0, sanctioned - outstanding)),
    estimated: debt.termsConfirmed === false,
  };
}

/** "Clears Mar 2029" — the month of the last instalment. */
export const clearsLabel = (iso: string | null): string | null =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }) : null;

// ── One payment, decided exactly as pay_loan decides it ──────────────────────────

export interface LoanPaymentInput {
  kind: LoanPaymentKind;
  amount: number;
  date: string;
  choice?: PrepaymentChoice;
  bankInterest?: number;
  bankPrincipal?: number;
}
export interface LoanPaymentPlan {
  interest: number;
  principal: number;
  closes: boolean;
  instalmentNo: number | null;
  emiAfter: number;
  dueAfter: string | null;
  outstandingAfter: number;
  paidOff: boolean;
}

/** A refusal, with pay_loan's own code and (when it has one) the figure it names. */
export class LoanPaymentRefused extends Error {
  constructor(public code: string, public figure?: number) { super(code); this.name = 'LoanPaymentRefused'; }
}

/** pay_loan's rules, for a local-only household (and to check a form before it is sent). */
export function planLoanPayment(view: LoanView, input: LoanPaymentInput, currency: string): LoanPaymentPlan {
  const { debt, outstanding: o, state } = view;
  const scale = minorScale(currency);
  const exact = (n: number) => Math.round(n * scale) === n * scale;
  if (!(input.amount > 0) || !exact(input.amount)) throw new LoanPaymentRefused('invalid_payment');
  if (view.paidOff) throw new LoanPaymentRefused('loan_paid_off');
  let interest = 0;
  let principal = 0;
  let closes = false;
  if (input.kind === 'emi') {
    if (!(debt.minimumPayment > 0)) throw new LoanPaymentRefused('no_emi');
    if (input.amount > state.remaining) throw new LoanPaymentRefused('more_than_due', state.remaining);
    interest = Math.min(input.amount, round2(Math.max(state.interest - state.interestPaid, 0)));
    principal = round2(input.amount - interest);
    closes = round2(state.paid + input.amount) === state.due;
  } else if (input.kind === 'prepayment') {
    if (state.started) throw new LoanPaymentRefused('instalment_open', state.remaining);
    if (input.amount > o) throw new LoanPaymentRefused('more_than_outstanding', o);
    principal = input.amount;
  } else if (input.kind === 'payoff') {
    interest = state.started ? round2(Math.max(state.interest - state.interestPaid, 0)) : 0;
    if (input.amount !== round2(o + interest)) throw new LoanPaymentRefused('payoff_amount', round2(o + interest));
    principal = o;
    closes = state.started;
  } else {
    if (state.started) throw new LoanPaymentRefused('instalment_open', state.remaining);
    const bi = input.bankInterest ?? NaN, bp = input.bankPrincipal ?? NaN;
    if (!(bi >= 0) || !(bp >= 0) || round2(bi + bp) !== input.amount || bp > o || !exact(bi) || !exact(bp)) {
      throw new LoanPaymentRefused('bank_figures_invalid');
    }
    interest = bi; principal = bp; closes = true;
  }
  const after = round2(o - principal);
  let emiAfter = debt.minimumPayment;
  if (input.kind === 'prepayment' && (input.choice ?? 'reduce_tenure') === 'reduce_emi' && after > 0) {
    const rate = rateOn(debt.rateHistory, debt.interestRate, debt.dueDate ?? input.date);
    const left = instalmentsLeft(o, rate, debt.minimumPayment);
    if (left == null) throw new LoanPaymentRefused('non_amortizing_payment');
    emiAfter = loanEmi(after, rate, left, currency) ?? emiAfter;
  }
  const anchor = Number((debt.firstEmiDate ?? debt.dueDate ?? '').slice(8, 10)) || 1;
  const dueAfter = after === 0 ? null : closes && debt.dueDate ? nextInstalmentDate(debt.dueDate, anchor) : debt.dueDate ?? null;
  return {
    interest, principal, closes, instalmentNo: input.kind === 'prepayment' ? null : state.no,
    emiAfter, dueAfter, outstandingAfter: after, paidOff: after === 0,
  };
}

/** The friendly sentence for each refusal (pay_loan's codes and the app's own). */
export function loanErrorMessage(code: string, figure: number | undefined, money: (n: number) => string): string {
  const f = figure != null ? money(figure) : '';
  switch (code) {
    case 'more_than_due': return `That's more than this instalment. ${f} is due — record anything extra as a prepayment.`;
    case 'instalment_open': return `Finish this month's EMI first (${f} left), then prepay or use the bank's figures.`;
    case 'more_than_outstanding': return `That's more than the loan's outstanding (${f}). To close it, use Pay off.`;
    case 'payoff_amount': return `To close the loan today, pay exactly ${f}.`;
    case 'bank_figures_invalid': return "The interest and principal must add up to the amount, and the principal can't be more than the outstanding.";
    case 'no_emi': return 'This loan has no EMI set. Add it in Edit, or record a prepayment.';
    case 'loan_paid_off': return 'This loan is already paid off.';
    case 'non_amortizing_payment': return "At this rate the EMI doesn't cover the interest, so a lower EMI can't be worked out. Choose Reduce tenure.";
    case 'funding_account_invalid': return 'Choose a bank or cash account to pay from.';
    case 'not_latest_payment': return 'Only the latest payment on a loan can be undone.';
    case 'cannot_undo_legacy': return "This payment was recorded before payments could be undone, so it can't be.";
    case 'debt_not_paid_off': return `This loan still has ${f || 'money'} owing. Mark it paid off first, or keep it.`;
    case 'not_authorized': return "You can view this household but can't record in it.";
    case 'invalid_precision': return 'Use at most two decimal places.';
    case 'invalid_payment': return 'Enter an amount greater than zero.';
    case 'operation_id_reused': return 'That payment changed while it was being sent. Please try again.';
    default: return 'The payment could not be recorded. Please try again.';
  }
}

/** The latest payment on a loan, from its legs (they are appended in order); null when it has none
 *  this app can undo (legs written before payments carried an operation id). */
export function latestLoanPayment(debtId: string, transactions: readonly Transaction[]): LoanDue['latestPayment'] {
  let latest: Transaction | undefined;
  for (const t of transactions) if (t.debtId === debtId && t.emiSplit?.operation_id) latest = t;
  if (!latest?.emiSplit?.operation_id) return null;
  const op = latest.emiSplit.operation_id;
  const legs = transactions.filter(t => t.emiSplit?.operation_id === op);
  return { operationId: op, kind: latest.emiSplit.kind ?? null, amount: round2(legs.reduce((s, t) => s + t.amount, 0)), date: latest.date };
}

/** loan_due, from what the app holds (local-only households, or offline display). */
export function loanDueFromView(view: LoanView, transactions: readonly Transaction[]): LoanDue {
  return {
    outstanding: view.outstanding, emi: view.debt.minimumPayment, paidOff: view.paidOff,
    instalmentNo: view.state.no, dueDate: view.state.date, interest: view.state.interest, due: view.state.due,
    paid: view.state.paid, remaining: view.state.remaining, started: view.state.started, payoff: view.payoff,
    loanAccountId: null, latestPayment: latestLoanPayment(view.debt.id, transactions),
  };
}

/** The next date a loan's instalment falls on, for a new loan with a first EMI date. */
export function firstDueOnOrAfter(firstEmiDate: string, instalmentsPaid: number): string {
  let date = firstEmiDate;
  const anchor = Number(firstEmiDate.slice(8, 10));
  for (let i = 0; i < instalmentsPaid && i < 600; i++) date = nextInstalmentDate(date, anchor);
  return date;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
