import { describe, it, expect } from 'vitest';
import { parseRRule, formatRRule, expandRRule, describeRRule } from '../rrule';

// CON-UNIT-RR-* — vendored RFC 5545 subset (v9.1 recurring redesign §5.2).
// Pins the dangerous cases the spec calls out: month-end skip, leap years,
// COUNT vs UNTIL, quarterly = monthly-interval-3.

describe('rrule — parse/format round-trip', () => {
  it('CON-UNIT-RR-001 · round-trips the supported encodings', () => {
    expect(formatRRule(parseRRule('FREQ=MONTHLY;INTERVAL=3'))).toBe('FREQ=MONTHLY;INTERVAL=3');
    expect(parseRRule('FREQ=WEEKLY;BYDAY=MO,WE').byDay).toEqual([1, 3]);
    expect(parseRRule('FREQ=MONTHLY;BYMONTHDAY=31').byMonthDay).toEqual([31]);
    expect(parseRRule('FREQ=YEARLY;UNTIL=20300101').until).toBe('2030-01-01');
    expect(parseRRule('freq=daily;interval=2').interval).toBe(2);   // tolerant of case
  });
});

describe('rrule — expansion', () => {
  it('CON-UNIT-RR-010 · daily with interval', () => {
    const occ = expandRRule(parseRRule('FREQ=DAILY;INTERVAL=2'), '2026-01-01', '2026-01-01', '2026-01-07');
    expect(occ).toEqual(['2026-01-01', '2026-01-03', '2026-01-05', '2026-01-07']);
  });

  it('CON-UNIT-RR-011 · weekly BYDAY generates each named weekday', () => {
    const occ = expandRRule(parseRRule('FREQ=WEEKLY;BYDAY=MO,FR'), '2026-06-01', '2026-06-01', '2026-06-14');
    // Jun 2026: Mondays 1,8 · Fridays 5,12
    expect(occ).toEqual(['2026-06-01', '2026-06-05', '2026-06-08', '2026-06-12']);
  });

  it('CON-UNIT-RR-012 · monthly BYMONTHDAY=31 SKIPS short months (RFC, not clamped)', () => {
    const occ = expandRRule(parseRRule('FREQ=MONTHLY;BYMONTHDAY=31'), '2026-01-31', '2026-01-01', '2026-06-30');
    // Only Jan, Mar, May have a 31st in this window — Feb/Apr/Jun are skipped.
    expect(occ).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });

  it('CON-UNIT-RR-013 · quarterly = monthly interval 3', () => {
    const occ = expandRRule(parseRRule('FREQ=MONTHLY;INTERVAL=3'), '2026-01-15', '2026-01-01', '2026-12-31');
    expect(occ).toEqual(['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']);
  });

  it('CON-UNIT-RR-014 · yearly skips Feb 29 in common years', () => {
    const occ = expandRRule(parseRRule('FREQ=YEARLY'), '2024-02-29', '2024-01-01', '2032-12-31');
    // 2024 and 2028 and 2032 are leap years; 2025-2027, 2029-2031 skipped.
    expect(occ).toEqual(['2024-02-29', '2028-02-29', '2032-02-29']);
  });

  it('CON-UNIT-RR-015 · COUNT ends after N occurrences (counts those before the window too)', () => {
    // COUNT=3 from Jan: occurrences Jan/Feb/Mar. Window starts Feb → Feb,Mar shown,
    // but the third (Mar) is the last because Jan already consumed one of the 3.
    const occ = expandRRule(parseRRule('FREQ=MONTHLY;COUNT=3'), '2026-01-10', '2026-02-01', '2026-12-31');
    expect(occ).toEqual(['2026-02-10', '2026-03-10']);
  });

  it('CON-UNIT-RR-016 · UNTIL is inclusive and stops generation', () => {
    const occ = expandRRule(parseRRule('FREQ=MONTHLY;UNTIL=20260315'), '2026-01-15', '2026-01-01', '2026-12-31');
    expect(occ).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
  });

  it('CON-UNIT-RR-017 · never (no COUNT/UNTIL) is window-bounded, not infinite', () => {
    const occ = expandRRule(parseRRule('FREQ=MONTHLY'), '2026-01-01', '2026-01-01', '2026-12-31');
    expect(occ).toHaveLength(12);
  });
});

describe('rrule — describe', () => {
  it('CON-UNIT-RR-020 · human labels', () => {
    expect(describeRRule(parseRRule('FREQ=MONTHLY;INTERVAL=3'))).toBe('Every quarter');
    expect(describeRRule(parseRRule('FREQ=WEEKLY'))).toBe('Every week');
    expect(describeRRule(parseRRule('FREQ=MONTHLY;COUNT=6'))).toBe('Every month, 6 times');
  });
});
