// W4h (v10.77.0; owner decision D27) — "Suggest" proposes only what the budget form shows, so the total
// it sets is exactly the split you see. The report: a huge total with a tiny split — invisible lines
// (a goal's 'savings', legacy and income ids) were counted, receivables' minimums were added, a daily
// bill counted once a month, and an EMI was counted twice (the loan and its schedule).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { suggestBudget, budgetCategoryOf } from '../budgetIntel';
import type { Debt, RecurringSchedule, Transaction } from '../../types';

const schedule = (p: Partial<RecurringSchedule> & { category: string; amount: number; type?: string }): RecurringSchedule => ({
  id: crypto.randomUUID(), frequency: 'monthly', startDate: '2026-01-05', nextDueDate: '2026-10-05', autoConfirm: true, active: true,
  ...p,
  transactionTemplate: { type: p.type ?? 'expense', amount: p.amount, currency: 'INR', description: '', category: p.category } as RecurringSchedule['transactionTemplate'],
} as RecurringSchedule);
const debt = (p: Partial<Debt>): Debt => ({
  id: crypto.randomUUID(), type: 'personal_loan', name: 'Loan', principal: 100000, currentBalance: 50000, interestRate: 12,
  minimumPayment: 5000, currency: 'INR', direction: 'owed_by_me', ...p,
} as Debt);
const suggest = (recurring: RecurringSchedule[], debts: Debt[] = [], transactions: Transaction[] = []) =>
  Object.fromEntries(suggestBudget({ recurring, debts, transactions, baseCurrency: 'INR', rates: {} }).map(s => [s.category, [s.limit, s.basis]]));

describe('budget suggestion (W4h, D27)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-07T06:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('W4-D27-001 · only categories the form shows: legacy ids as their current one; goals, income and unknown ids never', () => {
    expect(budgetCategoryOf('rent')).toBe('rent_mortgage');
    expect(budgetCategoryOf('transport')).toBe('travel');
    expect(budgetCategoryOf('groceries')).toBe('groceries');
    for (const hidden of ['savings', 'salary', 'other_income', 'made_up', '', null, undefined]) expect(budgetCategoryOf(hidden)).toBeNull();
    expect(suggest([
      schedule({ category: 'rent', amount: 20000 }),
      schedule({ category: 'transport', amount: 1500 }),
      schedule({ category: 'salary', amount: 90000, type: 'income' }),
      schedule({ category: 'savings', amount: 10000 }),
    ])).toEqual({ rent_mortgage: [20000, 'recurring'], travel: [1500, 'recurring'] });
  });

  it('W4-D27-002 · each live loan’s EMI once: not receivables, not paid-off loans, not again for its EMI schedule', () => {
    expect(suggest(
      [schedule({ category: 'loan_emi', amount: 5000 })],                     // the same EMI, as a schedule
      [debt({}), debt({ direction: 'owed_to_me', minimumPayment: 999 }), debt({ paidOffAt: '2026-01-01', minimumPayment: 7000 }),
       debt({ currentBalance: 0, minimumPayment: 3000 })],
    )).toEqual({ loan_emi: [5000, 'debt'] });
  });

  it('W4-D27-003 · bills in one category add up, each by its own rule; paused ones do not count', () => {
    expect(suggest([
      schedule({ category: 'utilities', amount: 1200 }),                                                   // monthly
      schedule({ category: 'utilities', amount: 600, rrule: 'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=5' }),       // quarterly → 200
      schedule({ category: 'food_dining', amount: 60, frequency: 'daily' }),                               // 60 × 365 / 12
      schedule({ category: 'health', amount: 300, frequency: 'weekly', rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH' }),   // 300 × 104 / 12
      schedule({ category: 'shopping', amount: 5000, active: false }),
    ])).toEqual({ utilities: [1400, 'recurring'], food_dining: [1825, 'recurring'], health: [2600, 'recurring'] });
  });

  it('W4-D27-004 · history tops up where spending runs higher than the bills, and fills categories with none', () => {
    const spend = (date: string, category: string, amount: number) =>
      ({ id: crypto.randomUUID(), type: 'expense', amount, currency: 'INR', date, description: '', category, accountId: 'bank' } as Transaction);
    const transactions = ['2026-07-10', '2026-08-10', '2026-09-10'].flatMap(date => [
      spend(date, 'groceries', 9000), spend(date, 'utilities', 2000), spend(date, 'food', 3000),
    ]).concat(spend('2026-10-03', 'groceries', 50000));          // this month is not history yet
    expect(suggest([schedule({ category: 'utilities', amount: 1200 })], [], transactions))
      .toEqual({ groceries: [9000, 'history'], utilities: [2000, 'history'], food_dining: [3000, 'history'] });
  });
});
