// Vyact v7 — Amortisation engine
// Properly computes interest/principal split per payment from the
// outstanding balance — matches Bank of England standard PMT.
//
// On a £200,000 mortgage at 5% over 25 years:
//   Month 1:   £833 interest, £337 principal (of £1,170 EMI)
//   Month 120: £625 interest, £545 principal
//   Month 300: £5 interest, £1,165 principal
//
// Pre-v7 we incorrectly used a flat split. This file is the fix.
//
// TD-01 phase C (PR #10) — the amount-bearing pieces now go through
// dinero in the debt's native currency, so:
//   • per-payment interest splits are rounded to the currency's native
//     minor unit (banker's), not left as e.g. 833.333333… pence,
//   • the chained `outstanding -= principal` over up-to-300 iterations
//     can't accumulate float drift,
//   • interestSummary aggregates via the same integer-cents `add`
//     as calculations.ts's sumDinero (TD-01 phase B).
// computeEmi / computeRemainingMonths are kept as float derivations:
// their outputs feed into the dinero-quantised layers below, which is
// where currency-aware exactness lives.

import type { Debt, AmortizationEntry, PartPaymentChoice, PaymentLogEntry } from '../types';
import { uid, today } from './format';
import { toDinero, fromDinero, sumDinero } from './money';
import { dinero, multiply, subtract, toSnapshot, type Dinero, type DineroCurrency } from 'dinero.js';

// ── Internal helpers ─────────────────────────────────────────────

/**
 * Re-quantise a Dinero to its currency's native exponent with banker's
 * rounding. Used after `multiply` in amortisation chains so per-step
 * drift can't accumulate across hundreds of iterations.
 */
function quantizeDinero(d: Dinero<number>): Dinero<number> {
  const snap = toSnapshot(d);
  const native = snap.currency.exponent as number;
  if (snap.scale <= native) return d;
  const factor = Math.pow(10, snap.scale - native);
  const requantized = bankersRound(snap.amount / factor);
  return dinero({ amount: requantized, currency: snap.currency as DineroCurrency<number> });
}

function bankersRound(n: number): number {
  const trunc = Math.trunc(n);
  const frac = n - trunc;
  if (frac === 0.5)  return trunc % 2 === 0 ? trunc : trunc + 1;
  if (frac === -0.5) return trunc % 2 === 0 ? trunc : trunc - 1;
  return Math.round(n);
}

/**
 * Express a JS float rate (e.g. 0.05 / 12 ≈ 0.004166666…) as the scaled
 * factor dinero's `multiply` accepts. Scale 12 keeps ~12 digits of rate
 * precision, well under JS's 2^53 ceiling for realistic balances.
 */
function rateAsScaled(rate: number, scale = 12): { amount: number; scale: number } {
  return { amount: Math.round(rate * Math.pow(10, scale)), scale };
}

// ── EMI / tenure derivations (unchanged — float math, outputs feed quantised layers) ─

// Compute the EMI from principal, annual rate %, tenure months
export function computeEmi(principal: number, annualRate: number, tenureMonths: number): number {
  if (!principal || !tenureMonths) return 0;
  if (!annualRate) return principal / tenureMonths;
  const r = annualRate / 100 / 12;
  const x = Math.pow(1 + r, tenureMonths);
  return (principal * r * x) / (x - 1);
}

// Compute remaining tenure given outstanding, EMI, rate
export function computeRemainingMonths(outstanding: number, emi: number, annualRate: number): number {
  if (!outstanding || !emi) return 0;
  if (!annualRate) return Math.ceil(outstanding / emi);
  const r = annualRate / 100 / 12;
  if (emi <= outstanding * r) return Infinity; // EMI doesn't even cover interest
  // n = -log(1 - rP/M) / log(1+r)
  return Math.ceil(-Math.log(1 - (r * outstanding) / emi) / Math.log(1 + r));
}

// ── Per-payment interest / principal split (currency-quantised) ─

/**
 * Single-step interest/principal decomposition for one payment.
 *
 * The math is `interest = outstandingBefore * (annualRate/100/12)`, then
 * `principal = max(0, payment - interest)`. When `currency` is supplied,
 * the interest is computed in dinero (multiply + native-exponent banker's
 * round) so it's a clean minor-unit number; principal is then `payment -
 * interestRounded`. When `currency` is omitted the result is the legacy
 * float behaviour, preserved for back-compat with any caller that
 * doesn't (yet) thread currency through.
 */
export function splitPayment(
  outstandingBefore: number,
  annualRate: number,
  paymentAmount: number,
  currency?: string,
): { interest: number; principal: number } {
  if (currency) {
    const outDinero = toDinero(outstandingBefore, currency);
    const interestDinero = quantizeDinero(multiply(outDinero, rateAsScaled(annualRate / 100 / 12)));
    const interest = fromDinero(interestDinero);
    // Do the principal subtraction in dinero space too — otherwise the
    // JS-number subtract (`payment - interest`) reintroduces drift on the
    // very value the caller will store/display. e.g. 1170 - 833.33 was
    // 336.66999999999996 instead of 336.67 before this line existed.
    const principalDinero = subtract(toDinero(paymentAmount, currency), interestDinero);
    const principalRaw = fromDinero(principalDinero);
    const principal = principalRaw < 0 ? 0 : principalRaw;
    return { interest, principal };
  }
  const r = annualRate / 100 / 12;
  const interest = outstandingBefore * r;
  const principal = Math.max(0, paymentAmount - interest);
  return { interest, principal };
}

// ── Full amortisation schedule (chained, dinero outstanding) ─────

export function calculateAmortizationSchedule(debt: Debt): AmortizationEntry[] {
  const out: AmortizationEntry[] = [];
  const annualRate = debt.interestRate;
  const monthsLeft = debt.remainingMonths ?? debt.tenureMonths ?? 0;
  if (monthsLeft <= 0) return out;
  const emi = debt.minimumPayment || computeEmi(debt.currentBalance, annualRate, monthsLeft);
  const currency = debt.currency || 'USD';
  const monthlyRateScaled = rateAsScaled(annualRate / 100 / 12);

  // outstanding is carried as a Dinero in the debt's native currency
  // across the entire iteration so drift can't accumulate.
  let outstandingD = toDinero(debt.currentBalance, currency);
  const start = new Date(debt.dueDate || today());

  for (let m = 1; m <= monthsLeft; m++) {
    const outstandingBefore = fromDinero(outstandingD);
    if (outstandingBefore <= 0.01) break;

    // interest = outstanding * monthlyRate, quantised to the currency's
    // native exponent (e.g. £833 not £833.333333… pence).
    const interestD = quantizeDinero(multiply(outstandingD, monthlyRateScaled));
    const interest = fromDinero(interestD);

    // principal = min(EMI - interest, outstanding). We compute it as
    // a number (the EMI input is already float) and quantise via the
    // dinero path.
    const principalRaw = Math.max(0, Math.min(emi - interest, outstandingBefore));
    const principalD = toDinero(principalRaw, currency);
    const principal = fromDinero(principalD);

    // outstanding -= principal, done in dinero space.
    outstandingD = subtract(outstandingD, principalD);
    const outstanding = Math.max(0, fromDinero(outstandingD));

    const d = new Date(start);
    d.setMonth(d.getMonth() + (m - 1));
    out.push({
      month: m,
      date: d.toISOString().split('T')[0],
      emi,
      interest,
      principal,
      outstanding,
    });
    if (outstanding <= 0.01) break;
  }
  return out;
}

// ── Apply a single payment (re-amortise with chosen strategy) ────

export interface ApplyPaymentResult {
  debt: Debt;
  log: PaymentLogEntry;
  message: string;
}

export function applyPayment(
  debt: Debt,
  paymentAmount: number,
  partChoice?: PartPaymentChoice,
  paymentDate = today(),
): ApplyPaymentResult {
  const annualRate = debt.interestRate;
  const emi = debt.minimumPayment;
  const currency = debt.currency || 'USD';
  const isPartPayment = paymentAmount > emi * 1.05; // > 5% over EMI = considered "part-payment"

  // Standard payment math, currency-quantised via splitPayment.
  const { interest, principal } = splitPayment(debt.currentBalance, annualRate, paymentAmount, currency);
  // newOutstanding = currentBalance - principal, in dinero space, then
  // back to a JS number for persistence.
  const newOutstandingD = subtract(toDinero(debt.currentBalance, currency), toDinero(principal, currency));
  const newOutstanding = Math.max(0, fromDinero(newOutstandingD));

  // Re-amortisation logic per user choice
  let newRemainingMonths = debt.remainingMonths ?? debt.tenureMonths ?? 0;
  let newEmi = emi;
  let message = '';

  if (isPartPayment && partChoice) {
    if (partChoice === 'reduce_tenure') {
      // EMI stays, recompute remaining months on new outstanding
      newRemainingMonths = computeRemainingMonths(newOutstanding, emi, annualRate);
      const monthsSaved = (debt.remainingMonths ?? debt.tenureMonths ?? 0) - newRemainingMonths - 1;
      message = `Loan now ends in ${newRemainingMonths} months · ${monthsSaved} months earlier.`;
    } else if (partChoice === 'reduce_emi') {
      // Tenure stays, recompute EMI on new outstanding
      newRemainingMonths = (debt.remainingMonths ?? debt.tenureMonths ?? 0) - 1;
      newEmi = computeEmi(newOutstanding, annualRate, newRemainingMonths);
      message = `EMI reduced to ${newEmi.toFixed(2)} from ${emi.toFixed(2)}.`;
    } else if (partChoice === 'apply_advance') {
      // Both stay. Advance N future EMIs (= floor((payment - thisMonthEmi) / emi))
      const advanceCount = Math.floor((paymentAmount - emi) / emi);
      newRemainingMonths = (debt.remainingMonths ?? debt.tenureMonths ?? 0) - 1 - advanceCount;
      message = `Next ${advanceCount} EMIs covered in advance.`;
    }
  } else {
    newRemainingMonths = Math.max(0, (debt.remainingMonths ?? debt.tenureMonths ?? 0) - 1);
    message = `Payment recorded · ${interest.toFixed(2)} interest, ${principal.toFixed(2)} principal.`;
  }

  const log: PaymentLogEntry = {
    id: uid(),
    date: paymentDate,
    amount: paymentAmount,
    interest,
    principal,
    outstandingAfter: newOutstanding,
    isPartPayment,
    partChoice,
  };

  const updated: Debt = {
    ...debt,
    currentBalance: newOutstanding,
    remainingMonths: newRemainingMonths,
    minimumPayment: newEmi,
    paymentLog: [...(debt.paymentLog || []), log],
  };

  return { debt: updated, log, message };
}

// ── Lifetime / YTD interest aggregation (dinero-space sum) ───────

export function interestSummary(debt: Debt): { lifetime: number; ytd: number; principalPaid: number } {
  const log = debt.paymentLog || [];
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const currency = debt.currency || 'USD';
  // Each payment-log entry contributes an integer-cents value in the
  // debt's currency; folding via sumDinero means no float drift across
  // long payment histories.
  const lifetime = fromDinero(sumDinero(log, e => toDinero(e.interest, currency), currency));
  const principalPaid = fromDinero(sumDinero(log, e => toDinero(e.principal, currency), currency));
  const ytd = fromDinero(sumDinero(
    log.filter(e => e.date >= yearStart),
    e => toDinero(e.interest, currency),
    currency,
  ));
  return { lifetime, ytd, principalPaid };
}
