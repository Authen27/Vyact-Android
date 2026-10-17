// W4g (v10.76.0; owner decision D19) — a loan's EMIs are on the bill calendar, read from the loan's own
// schedule, and its EMI-day reminder knows whether Vyact records it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { billCalendar } from '../billCalendar';
import { debtDueNotifs, DEFAULT_PREFS } from '../notifications';
import type { Account, Debt, Transaction } from '../../types';

const NOW = '2026-10-05';
const loan = (p: Partial<Debt> = {}): Debt => ({
  id: 'car', type: 'auto_loan', name: 'Car loan', currency: 'INR', principal: 100000, currentBalance: 100000,
  interestRate: 12, minimumPayment: 8884.88, instalmentsPaid: 0, dueDate: NOW, firstEmiDate: NOW, termsConfirmed: true,
  direction: 'owed_by_me', ...p,
} as Debt);
const account: Account = { id: 'car-acc', kind: 'loan', name: 'Car loan', currency: 'INR', openingBalance: -100000, debtId: 'car' } as Account;

describe('loans on the bill calendar (W4g)', () => {
  it('W4-D19-020 · each EMI from the loan’s schedule: the due one is payable (or posts automatically), later ones wait', () => {
    const cal = billCalendar({ schedules: [], transactions: [], baseCurrency: 'INR', rates: {}, horizonDays: 62, now: NOW,
      debts: [loan()], accounts: [account] });
    const items = cal.days.flatMap(d => d.items);
    expect(items.map(i => [i.date, i.description, i.amount, i.status, i.actionable])).toEqual([
      ['2026-10-05', 'Car loan EMI #1', 8884.88, 'awaiting-approval', true],
      ['2026-11-05', 'Car loan EMI #2', 8884.88, 'approval-when-due', false],
      ['2026-12-05', 'Car loan EMI #3', 8884.88, 'approval-when-due', false],
    ]);
    expect(items.every(i => i.debtId === 'car' && i.category === 'loan_emi')).toBe(true);
    expect(cal.outgoing).toBe(26654.64);

    const auto = billCalendar({ schedules: [], transactions: [], baseCurrency: 'INR', rates: {}, horizonDays: 30, now: NOW,
      debts: [loan({ autoRecord: true, fundingAccountId: 'bank' })], accounts: [account] });
    expect(auto.days.flatMap(d => d.items).map(i => [i.status, i.actionable])).toEqual([['auto', false]]);
  });

  it('W4-D19-021 · a part-paid EMI shows what is left; paid-off loans and money owed to you are not on it', () => {
    // 3,000 paid toward EMI #1 (1,000 interest + 2,000 principal).
    const legs = [
      { id: 'i', type: 'expense', amount: 1000, debtId: 'car', accountId: 'bank', date: NOW, emiSplit: { interest: 1000, principal: 0, debt_id: 'car', kind: 'emi', instalment_no: 1, operation_id: 'op' } },
      { id: 'p', type: 'transfer', amount: 2000, debtId: 'car', accountId: 'bank', toAccountId: 'car-acc', date: NOW, emiSplit: { interest: 0, principal: 2000, debt_id: 'car', kind: 'emi', instalment_no: 1, operation_id: 'op' } },
    ] as unknown as Transaction[];
    const cal = billCalendar({ schedules: [], transactions: legs, baseCurrency: 'INR', rates: {}, horizonDays: 10, now: NOW,
      debts: [loan(), loan({ id: 'gone', name: 'Old', paidOffAt: '2026-01-01' }), loan({ id: 'lent', name: 'Lent', direction: 'owed_to_me' })],
      accounts: [account] });
    expect(cal.days.flatMap(d => d.items).map(i => [i.description, i.amount])).toEqual([['Car loan EMI #1', 5884.88]]);
  });

  afterEach(() => vi.useRealTimers());

  it('W4-D19-022 · the EMI-day reminder: "Record payment" when it is yours to pay, only "View" when Vyact records it', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T06:00:00Z'));   // the EMI is due today, in India
    const ctx = { householdId: 'h', baseCurrency: 'INR', rates: {}, tz: 'Asia/Kolkata' };
    const due = loan({ dueDate: '2026-10-07' });
    const [manual] = debtDueNotifs([due], DEFAULT_PREFS, [], ctx);
    expect(manual?.actions?.map(a => a.id)).toEqual(['record', 'view']);
    const [auto] = debtDueNotifs([{ ...due, autoRecord: true }], DEFAULT_PREFS, [], ctx);
    expect(auto).toMatchObject({ body: 'Vyact records this EMI on the day' });
    expect(auto.actions?.map(a => a.id)).toEqual(['view']);
    expect(debtDueNotifs([{ ...due, paidOffAt: '2026-10-01' }], DEFAULT_PREFS, [], ctx)).toEqual([]);
  });
});
