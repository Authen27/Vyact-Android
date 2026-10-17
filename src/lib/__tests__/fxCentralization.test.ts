import { describe, it, expect } from 'vitest';
import type { Budget, Debt, Goal, Profile, ExchangeRates, Transaction } from '../../types';
import { convert } from '../format';
import { buildSafeSummary } from '../aiSummary';

// CON-UNIT-123..124 — one FX path (audit F4); since v10.66.0 (W3b, owner decision D14) that path
// is FACE VALUE: a household has one currency and nothing is converted. The two pins below now
// assert that no surface applies a rate — the inverted-ratio bug they were written for cannot
// return, because there is no ratio any more.
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
  it('CON-UNIT-123 · convert() applies no rate in either direction (face value)', () => {
    expect(convert(1000, 'INR', 'USD', RATES)).toBe(1000);
    expect(convert(100, 'USD', 'INR', RATES)).toBe(100);
    expect(convert(42.5, 'USD', 'USD', RATES)).toBe(42.5);
  });

  it('CON-UNIT-124 · SafeSummary reads a debt labelled in another currency at face value', () => {
    const debts: Debt[] = [
      { id: 'd', type: 'loan', name: 'INR loan', principal: 0, currentBalance: 83000, interestRate: 9, minimumPayment: 1000, currency: 'INR', direction: 'owed_by_me' },
    ];
    const s = buildSafeSummary(
      [] as Transaction[], [] as Budget[], [] as Goal[], debts, [],
      { baseCurrency: 'USD', household: 'family', language: 'en' } as unknown as Profile,
      RATES, [], [],
    );
    // Neither 1,000 (converted) nor 6,889,000 (the old inverted ratio): the amount as stored.
    expect(s.debts[0].balance).toBe(83000);
  });
});
