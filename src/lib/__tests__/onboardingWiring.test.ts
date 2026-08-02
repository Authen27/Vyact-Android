import { describe, it, expect } from 'vitest';
import {
  nextMonthlyDate, chipCategory, mergeAllocationsByCategory, type OnboardingBill,
} from '../onboardingWiring';

describe('onboardingWiring — pure helpers', () => {
  describe('nextMonthlyDate — first occurrence is always STRICTLY future', () => {
    it('mid-month join: paycheck (day 1) and bills (day 2) land next month', () => {
      const from = new Date(Date.UTC(2026, 6, 15)); // 2026-07-15
      expect(nextMonthlyDate(1, from)).toBe('2026-08-01');
      expect(nextMonthlyDate(2, from)).toBe('2026-08-02');
    });

    it('joining ON the target day still moves to next month (never today → no immediate post)', () => {
      // Join on the 1st: this month's paycheck is already represented by the
      // opening balance, so the schedule must start NEXT 1st.
      expect(nextMonthlyDate(1, new Date(Date.UTC(2026, 6, 1)))).toBe('2026-08-01');
      // Join on the 2nd: the bills schedule must start next 2nd.
      expect(nextMonthlyDate(2, new Date(Date.UTC(2026, 6, 2)))).toBe('2026-08-02');
    });

    it('early-month join keeps this month when the target day is still ahead', () => {
      const from = new Date(Date.UTC(2026, 6, 1)); // the 1st
      expect(nextMonthlyDate(2, from)).toBe('2026-07-02'); // the 2nd is still ahead
    });

    it('year rollover from December', () => {
      expect(nextMonthlyDate(1, new Date(Date.UTC(2026, 11, 20)))).toBe('2027-01-01');
    });

    it('clamps to the last day of a short target month', () => {
      // A day-31 schedule viewed from late January lands on Feb 28 (2026 non-leap).
      expect(nextMonthlyDate(31, new Date(Date.UTC(2026, 0, 31)))).toBe('2026-02-28');
    });
  });

  describe('chipCategory — fixed-cost chips resolve to real expense categories', () => {
    it('maps known chips and folds unknowns into other_expense', () => {
      expect(chipCategory('rent')).toBe('rent_mortgage');
      expect(chipCategory('mortgage')).toBe('rent_mortgage');
      expect(chipCategory('phone')).toBe('utilities');
      expect(chipCategory('subscriptions')).toBe('entertainment');
      expect(chipCategory('payroll')).toBe('other_expense');
      expect(chipCategory('something_new')).toBe('other_expense');
    });
  });

  describe('mergeAllocationsByCategory — budget allocations sum per category', () => {
    it('folds two chips that share a category into one allocation and drops blanks', () => {
      const bills: OnboardingBill[] = [
        { key: 'rent', label: 'Rent', amount: 26000 },
        { key: 'utilities', label: 'Utilities', amount: 3200 },
        { key: 'phone', label: 'Phone', amount: 499 }, // also → utilities
        { key: 'subscriptions', label: 'Subscriptions', amount: 899 },
        { key: 'transport', label: 'Transport', amount: 0 }, // blank → excluded
      ];
      const allocs = mergeAllocationsByCategory(bills);
      const byCat = Object.fromEntries(allocs.map(a => [a.category, a.amount]));
      expect(byCat.rent_mortgage).toBe(26000);
      expect(byCat.utilities).toBe(3200 + 499); // Utilities + Phone merged
      expect(byCat.entertainment).toBe(899);
      expect(byCat.transport).toBeUndefined(); // zero-amount excluded
      // one row per distinct category, no duplicate utilities row
      expect(allocs.filter(a => a.category === 'utilities')).toHaveLength(1);
    });

    it('returns nothing when no bill carries an amount', () => {
      expect(mergeAllocationsByCategory([{ key: 'rent', label: 'Rent', amount: 0 }])).toHaveLength(0);
    });
  });
});
