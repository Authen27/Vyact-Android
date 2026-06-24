import { describe, it, expect } from 'vitest';
import { convert, getMonthKey, nowMonthKey, clamp, daysUntil } from '../format';
import { DEFAULT_RATES } from '../../constants';

// Test scenarios CON-UNIT-001..011. IDs are catalogued in docs/TEST_SCENARIOS.md
// and reconciled by scripts/test-scenarios-check.mjs as a CI gate.

describe('convert', () => {
  it('CON-UNIT-001 · returns the same amount when from === to', () => {
    expect(convert(100, 'USD', 'USD', DEFAULT_RATES)).toBe(100);
  });

  it('CON-UNIT-002 · returns 0 (falsy amount) unchanged', () => {
    expect(convert(0, 'USD', 'EUR', DEFAULT_RATES)).toBe(0);
  });

  it('CON-UNIT-003 · converts USD → EUR using the rate table', () => {
    // USD rate 1.00, EUR rate 0.92 → 100 USD = 92 EUR
    expect(convert(100, 'USD', 'EUR', DEFAULT_RATES)).toBeCloseTo(92, 10);
  });

  it('CON-UNIT-004 · converts a non-USD pair via the USD base (INR → GBP)', () => {
    // (amount / rINR) * rGBP = (8320 / 83.20) * 0.79 = 100 * 0.79 = 79
    expect(convert(8320, 'INR', 'GBP', DEFAULT_RATES)).toBeCloseTo(79, 10);
  });

  it('CON-UNIT-005 · treats an unknown currency code as rate 1 (documented fallback)', () => {
    expect(convert(50, 'XYZ', 'USD', DEFAULT_RATES)).toBeCloseTo(50, 10);
    expect(convert(50, 'USD', 'XYZ', DEFAULT_RATES)).toBeCloseTo(50, 10);
  });

  // --- Was the TD-01 characterization test: previously asserted that
  //     round-trip USD→EUR→USD DRIFTED off the original. After TD-01
  //     phase A wired `convert()` through dinero.js with banker's
  //     rounding at the FX boundary, the round-trip is EXACT for every
  //     amount whose minor-unit representation survives the rate ratio
  //     intact (and bounded to half-a-minor-unit otherwise). This now
  //     positively asserts the fixed behaviour for the canonical example
  //     from the original characterization. ---
  it('CON-UNIT-006 · [TD-01 fixed] round-trip USD→EUR→USD returns exactly the original', () => {
    const start = 100.10;
    const round = convert(convert(start, 'USD', 'EUR', DEFAULT_RATES), 'EUR', 'USD', DEFAULT_RATES);
    expect(round).toBe(start);
  });
});

describe('getMonthKey / nowMonthKey', () => {
  it('CON-UNIT-007 · extracts YYYY-MM from an ISO date', () => {
    expect(getMonthKey('2026-05-22')).toBe('2026-05');
  });
  it('CON-UNIT-008 · nowMonthKey is 7 chars (YYYY-MM)', () => {
    expect(nowMonthKey()).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('clamp', () => {
  it('CON-UNIT-009 · clamps below, within, and above the range', () => {
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(50, 0, 100)).toBe(50);
    expect(clamp(150, 0, 100)).toBe(100);
  });
});

describe('daysUntil', () => {
  it('CON-UNIT-010 · returns null for no date', () => {
    expect(daysUntil(undefined)).toBeNull();
  });
  it('CON-UNIT-011 · returns a positive number for a future date', () => {
    const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    expect(daysUntil(future)!).toBeGreaterThan(0);
  });
});
