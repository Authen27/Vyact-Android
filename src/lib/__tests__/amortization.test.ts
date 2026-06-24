import { describe, it, expect } from 'vitest';
import {
  computeEmi, computeRemainingMonths, calculateAmortizationSchedule,
  splitPayment, applyPayment, interestSummary,
} from '../amortization';
import type { Debt } from '../../types';

// Test scenarios CON-UNIT-027..039, CON-UNIT-047..048. See docs/TEST_SCENARIOS.md.
//
// TD-01 phase C (PR #10) migrated amortization.ts so the amount-bearing
// pieces (splitPayment, calculateAmortizationSchedule, applyPayment,
// interestSummary) operate in dinero space when a currency is in scope.
// Tests that previously used `toBeCloseTo` to tolerate accumulated float
// drift across the 300-month schedule are tightened here.

function debt(over: Partial<Debt>): Debt {
  return {
    id: 'd1', type: 'mortgage', name: 'Home loan',
    principal: 200000, currentBalance: 200000,
    interestRate: 5, minimumPayment: 1170,
    tenureMonths: 300, currency: 'GBP',
    ...over,
  };
}

describe('computeEmi', () => {
  it('CON-UNIT-027 · matches the documented £200k @ 5% / 25y example (~£1170/mo)', () => {
    // Standard PMT; file header cites ~£1,170 EMI.
    const emi = computeEmi(200000, 5, 300);
    expect(emi).toBeGreaterThan(1160);
    expect(emi).toBeLessThan(1180);
  });
  it('CON-UNIT-028 · returns 0 with no principal or no tenure', () => {
    expect(computeEmi(0, 5, 300)).toBe(0);
    expect(computeEmi(200000, 5, 0)).toBe(0);
  });
  it('CON-UNIT-029 · falls back to straight-line when rate is 0', () => {
    expect(computeEmi(1200, 0, 12)).toBe(100);
  });
});

describe('splitPayment', () => {
  it('CON-UNIT-030 · interest = balance * monthly rate; principal = payment - interest (legacy float mode)', () => {
    // 200000 @ 5%/yr → monthly interest = 200000 * (0.05/12) ≈ 833.33
    // No currency passed → legacy float behaviour, still toBeCloseTo-tolerant.
    const { interest, principal } = splitPayment(200000, 5, 1170);
    expect(interest).toBeCloseTo(833.333, 2);
    expect(principal).toBeCloseTo(1170 - 833.333, 2);
  });
  it('CON-UNIT-031 · never returns negative principal when payment < interest', () => {
    const { principal } = splitPayment(200000, 5, 100);
    expect(principal).toBe(0);
  });
  it('CON-UNIT-048 · [TD-01 phase C] currency-quantised interest is the exact native-minor-unit value', () => {
    // Same inputs as CON-UNIT-030 but with explicit currency. The interest
    // is now the GBP-native (2 decimals, banker's-rounded) value: 833.33,
    // not the float-trailing 833.333333333. principal is computed off the
    // quantised interest, so it's also exact: 1170 - 833.33 = 336.67.
    const { interest, principal } = splitPayment(200000, 5, 1170, 'GBP');
    expect(interest).toBe(833.33);
    expect(principal).toBe(336.67);
  });
});

describe('computeRemainingMonths', () => {
  it('CON-UNIT-032 · returns Infinity when EMI does not cover monthly interest', () => {
    expect(computeRemainingMonths(200000, 100, 5)).toBe(Infinity);
  });
  it('CON-UNIT-033 · uses straight-line when rate is 0', () => {
    expect(computeRemainingMonths(1200, 100, 0)).toBe(12);
  });
});

describe('calculateAmortizationSchedule', () => {
  it('CON-UNIT-034 · amortises the balance down toward zero by the final entry', () => {
    const sched = calculateAmortizationSchedule(debt({ remainingMonths: 300 }));
    expect(sched.length).toBeGreaterThan(0);
    expect(sched[sched.length - 1].outstanding).toBeLessThanOrEqual(0.01);
  });
  it('CON-UNIT-035 · interest portion decreases while principal portion increases over time', () => {
    const sched = calculateAmortizationSchedule(debt({ remainingMonths: 300 }));
    expect(sched[0].interest).toBeGreaterThan(sched[100].interest);
    expect(sched[0].principal).toBeLessThan(sched[100].principal);
  });
  it('CON-UNIT-047 · [TD-01 phase C] 300-row schedule does not accumulate per-step drift', () => {
    // The whole point of carrying the outstanding balance as a Dinero across
    // 300 iterations: the sum of every row's `principal` portion must equal
    // the starting balance, within at most one minor-unit (the final row's
    // "pay off remaining" rounding). Pre-phase-C the chained
    // `outstanding -= principal` on floats drifted by 10s of pence by month
    // 300 on this fixture.
    const d = debt({ currentBalance: 200000, remainingMonths: 300 });
    const sched = calculateAmortizationSchedule(d);
    const totalPrincipal = sched.reduce((s, r) => s + r.principal, 0);
    expect(Math.abs(totalPrincipal - 200000)).toBeLessThanOrEqual(0.01);
  });
});

describe('applyPayment', () => {
  it('CON-UNIT-036 · a normal payment reduces balance by the principal portion and decrements months', () => {
    const d = debt({ currentBalance: 200000, remainingMonths: 300 });
    const { debt: updated, log } = applyPayment(d, 1170, undefined, '2026-05-22');
    expect(updated.currentBalance).toBeLessThan(200000);
    // Phase C: currentBalance is now subtract(toDinero(200000), toDinero(principal))
    // in GBP, so the relation is exact (no toBeCloseTo tolerance needed).
    expect(updated.currentBalance).toBe(200000 - log.principal);
    expect(updated.remainingMonths).toBe(299);
    expect(log.isPartPayment).toBe(false);
  });
  it('CON-UNIT-037 · reduce_tenure keeps EMI and shortens the loan on a part-payment', () => {
    const d = debt({ currentBalance: 200000, remainingMonths: 300, minimumPayment: 1170 });
    const { debt: updated } = applyPayment(d, 50000, 'reduce_tenure', '2026-05-22');
    expect(updated.minimumPayment).toBe(1170);            // EMI unchanged, strict
    expect(updated.remainingMonths).toBeLessThan(299);    // tenure shortened
  });
  it('CON-UNIT-038 · reduce_emi keeps tenure (minus one) and lowers the EMI', () => {
    const d = debt({ currentBalance: 200000, remainingMonths: 300, minimumPayment: 1170 });
    const { debt: updated } = applyPayment(d, 50000, 'reduce_emi', '2026-05-22');
    expect(updated.remainingMonths).toBe(299);
    expect(updated.minimumPayment).toBeLessThan(1170);
  });
});

describe('interestSummary', () => {
  it('CON-UNIT-039 · aggregates lifetime interest, principal, and YTD from the payment log', () => {
    const year = new Date().getFullYear();
    const d = debt({
      paymentLog: [
        { id: '1', date: `${year - 1}-06-01`, amount: 1170, interest: 800, principal: 370, outstandingAfter: 199630, isPartPayment: false },
        { id: '2', date: `${year}-02-01`,     amount: 1170, interest: 700, principal: 470, outstandingAfter: 199160, isPartPayment: false },
      ],
    });
    const s = interestSummary(d);
    // Phase B/C: integer-cents sums in dinero space, so exact.
    expect(s.lifetime).toBe(1500);
    expect(s.principalPaid).toBe(840);
    expect(s.ytd).toBe(700); // only the current-year entry
  });
});
