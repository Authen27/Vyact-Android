import { describe, it, expect } from 'vitest';
import type { Budget, Debt, Goal, Profile, ExchangeRates, Transaction } from '../../types';
import { convert } from '../format';
import { buildSafeSummary } from '../aiSummary';

// CON-UNIT-123..124 — one FX path (audit F4).
//
// THE BUGS THESE PIN:
//   • The Transactions page summed raw txn.amount across currencies — USD 100
//     and INR 100 read as the same unit — then displayed the total in the base
//     currency. (Page-level fix is verified by the e2e/conversion behaviour;
//     the pure rule pinned here is the one conversion function.)
//   • buildSafeSummary multiplied by `rates[src] / rates[base]` — the INVERSE
//     of the central convention (rates are units-per-USD). An INR debt against
//     a USD base came out ~83× too small.

// Units-per-USD, matching the central convention.
const RATES: ExchangeRates = { USD: 1, GBP: 0.8, INR: 83 };

describe('one FX path (audit F4)', () => {
  it('CON-UNIT-123 · convert() is units-per-USD and is the convention every surface uses', () => {
    // 83 INR = 1 USD. 1000 INR → ~12.05 USD. The OLD aiSummary math did
    // 1000 * (83 / 1) = 83000 — the inversion this pins.
    expect(convert(1000, 'INR', 'USD', RATES)).toBeCloseTo(12.05, 1);
    expect(convert(100, 'USD', 'INR', RATES)).toBeCloseTo(8300, 0);
    // Same-currency and identity are exact no-ops.
    expect(convert(42.5, 'USD', 'USD', RATES)).toBe(42.5);
  });

  it('CON-UNIT-124 · SafeSummary converts a foreign-currency debt CORRECTLY (not the inverted ratio)', () => {
    const debts: Debt[] = [
      { id: 'd', type: 'loan', name: 'INR loan', principal: 0, currentBalance: 83000, interestRate: 9, minimumPayment: 1000, currency: 'INR', direction: 'owed_by_me' },
    ];
    const s = buildSafeSummary(
      [] as Transaction[], [] as Budget[], [] as Goal[], debts, [],
      { baseCurrency: 'USD', household: 'family', language: 'en' } as unknown as Profile,
      RATES, [], [],
    );
    // 83000 INR ≈ 1000 USD (the inverted bug reported 6,889,000).
    expect(s.debts[0].balance).toBeCloseTo(1000, 0);
    expect(s.debts[0].balance).toBeLessThan(2000);
  });
});
