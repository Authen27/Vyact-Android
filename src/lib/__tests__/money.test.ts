import { describe, it, expect } from 'vitest';
import { toDinero, fromDinero, convertViaUsdRates, CURRENCY_REGISTRY, currencyOf, parseMoneyFromCloud } from '../money';
import { toSnapshot } from 'dinero.js';
import { DEFAULT_RATES } from '../../constants';

// Test scenarios CON-UNIT-040..045, CON-UNIT-049..050. TD-01 phase A
// pinned the dinero boundary; phase D adds the cloud-boundary entry
// helper used by supabaseAdapter row mappers.

describe('CURRENCY_REGISTRY / currencyOf', () => {
  it('CON-UNIT-040 · registers all 12 supported currency codes', () => {
    // Mirrors CURRENCIES in constants.ts. Adding a currency requires
    // updating both files in lock-step — this test pins the contract.
    expect(Object.keys(CURRENCY_REGISTRY).sort()).toEqual(
      ['AED', 'AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'EUR', 'GBP', 'INR', 'JPY', 'SGD', 'USD'],
    );
  });

  it('CON-UNIT-041 · unknown currency code falls back to USD (documented contract)', () => {
    // Matches the historic format.ts behaviour where an unknown code is
    // silently treated as USD with rate 1.
    expect(currencyOf('XYZ').code).toBe('USD');
    expect(currencyOf('JPY').code).toBe('JPY');
  });
});

describe('toDinero / fromDinero', () => {
  it('CON-UNIT-042 · scales a USD major-unit number to integer cents and back', () => {
    const d = toDinero(100.10, 'USD');
    expect(toSnapshot(d).amount).toBe(10010);
    expect(toSnapshot(d).scale).toBe(2);
    expect(fromDinero(d)).toBe(100.10);
  });

  it('CON-UNIT-043 · respects JPY zero-decimals (no minor unit)', () => {
    // JPY exponent = 0, so 1000.0 yen = 1000 minor units (not 100000).
    const d = toDinero(1000, 'JPY');
    expect(toSnapshot(d).amount).toBe(1000);
    expect(toSnapshot(d).scale).toBe(0);
    expect(fromDinero(d)).toBe(1000);
  });
});

describe('convertViaUsdRates', () => {
  it('CON-UNIT-044 · no-ops when source and target currencies match', () => {
    const d = toDinero(50, 'EUR');
    const out = convertViaUsdRates(d, 'EUR', DEFAULT_RATES);
    expect(fromDinero(out)).toBe(50);
  });

  it('CON-UNIT-045 · post-conversion result is quantised to the target currency\'s native exponent', () => {
    // 100 USD → EUR at rate 0.92 must produce exactly 92 EUR (scale 2),
    // not 92.0000... at some higher dinero internal scale. Sub-cent
    // precision bleeding through this boundary is the exact bug that
    // broke the TD-01 round-trip in CON-UNIT-006.
    const out = convertViaUsdRates(toDinero(100, 'USD'), 'EUR', DEFAULT_RATES);
    const snap = toSnapshot(out);
    expect(snap.currency.code).toBe('EUR');
    expect(snap.scale).toBe(2);
    expect(snap.amount).toBe(9200);
    expect(fromDinero(out)).toBe(92);
  });
});

describe('parseMoneyFromCloud', () => {
  it('CON-UNIT-049 · accepts string, number, null, undefined, and empty without throwing', () => {
    // Supabase serialises numeric(15,2) as a string. The mappers used to
    // do a blanket Number(...) which gives NaN for some inputs; this
    // helper centralises the contract.
    expect(parseMoneyFromCloud('100.10')).toBe(100.10);
    expect(parseMoneyFromCloud(250.50)).toBe(250.50);
    expect(parseMoneyFromCloud(null)).toBe(0);
    expect(parseMoneyFromCloud(undefined)).toBe(0);
    expect(parseMoneyFromCloud('')).toBe(0);
  });

  it('CON-UNIT-050 · returns 0 for non-finite inputs (NaN, garbage strings)', () => {
    // Defensive: bad row data must not propagate NaN into the math layer
    // and silently corrupt aggregations. 0 is the documented fallback.
    expect(parseMoneyFromCloud('not-a-number')).toBe(0);
    expect(parseMoneyFromCloud(Number.NaN)).toBe(0);
  });
});
