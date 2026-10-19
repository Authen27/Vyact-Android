// TE6-001..007 — Track E, E6a (v10.100.0; owner decisions 13 Oct 2026, E-3 and E-4): each loan's EMI in
// Recurring, mirrored from the loan — never a schedule — with the loan's own "Record automatically"
// switch; the leftover EMI schedules hidden everywhere; and the budget forecast counting EMIs on their dates.
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loanEmiForecast, loanEmiRows } from '../loanRecurring';
import { billCalendar } from '../billCalendar';
import { DEFAULT_PREFS, recurringDueNotifs, recurringReminderNotifs, resolvedBillCards } from '../notifications';
import type { Account, Debt, Notification, RecurringSchedule, Transaction } from '../../types';

const ROOT = resolvePath(__dirname, '../../../..');
const NOW = '2026-10-15';
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${NOW}T06:00:00Z`)); });
afterAll(() => { vi.useRealTimers(); });

const loan = (p: Partial<Debt> = {}): Debt => ({
  id: 'd1', type: 'car', name: 'Car loan', principal: 160_000, currentBalance: 100_000, interestRate: 12,
  minimumPayment: 10_000, currency: 'INR', direction: 'owed_by_me', termsConfirmed: true,
  firstEmiDate: '2026-05-05', dueDate: '2026-11-05', instalmentsPaid: 6, ...p,
} as Debt);
const BANK = { id: 'bank', name: 'HDFC', kind: 'bank', currency: 'INR', openingBalance: 0 } as unknown as Account;
const emiSchedule = (p: Partial<RecurringSchedule> = {}): RecurringSchedule => ({
  id: 'old-emi', frequency: 'monthly', startDate: '2026-01-05', nextDueDate: '2026-11-05', autoConfirm: true, active: true,
  rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=5',
  transactionTemplate: { type: 'expense', amount: 10_000, currency: 'INR', description: 'Car EMI', category: 'loan_emi' },
  ...p,
} as RecurringSchedule);

describe('Loan EMIs in Recurring (Track E, E6a)', () => {
  it('TE6-001 · one row per live loan, from the loan\'s own schedule; receivables, paid-off loans and cards are not loans to mirror', () => {
    const debts = [
      loan({ fundingAccountId: 'bank', autoRecord: true }),
      loan({ id: 'd2', name: 'Home loan', dueDate: '2026-10-20', firstEmiDate: '2024-01-20', minimumPayment: 25_000, currentBalance: 2_000_000, interestRate: 8.5 }),
      loan({ id: 'r1', name: 'Lent to Ravi', direction: 'owed_to_me' }),
      loan({ id: 'p1', name: 'Old bike loan', paidOffAt: '2026-06-01' }),
      loan({ id: 'c1', name: 'Card', type: 'credit_card' }),
    ];
    const rows = loanEmiRows(debts, [BANK], [], 'INR', NOW);
    expect(rows.map(r => r.debt.id)).toEqual(['d2', 'd1']);                  // the next EMI first
    expect(rows[1]).toMatchObject({ no: 7, date: '2026-11-05', amount: 10_000, emi: 10_000, autoRecord: true, needs: [], fundingAccount: BANK });
    // Turning on "Record automatically" needs the paying account (and the next EMI date).
    expect(rows[0]).toMatchObject({ autoRecord: false, needs: ['account'] });
    expect(loanEmiRows([loan({ dueDate: undefined })], [BANK], [], 'INR', NOW)[0].needs).toEqual(['account', 'date']);
    // An archived paying account is no paying account.
    expect(loanEmiRows([loan({ fundingAccountId: 'bank' })], [{ ...BANK, isArchived: true } as Account], [], 'INR', NOW)[0].needs).toEqual(['account']);
  });

  it('TE6-002 · a part-paid instalment shows what is left of it', () => {
    const split = { interest: 1_000, principal: 3_000, debt_id: 'd1', kind: 'emi', instalment_no: 7, operation_id: 'op7' };
    const legs = [
      { id: 'i7', type: 'expense', category: 'loan_emi', amount: 1_000, currency: 'INR', date: '2026-11-05', description: '', debtId: 'd1', emiSplit: split },
      { id: 'p7', type: 'transfer', category: '', amount: 3_000, currency: 'INR', date: '2026-11-05', description: '', debtId: 'd1', linkedTxnId: 'i7', emiSplit: split },
    ] as unknown as Transaction[];
    expect(loanEmiRows([loan()], [], legs, 'INR', NOW)[0]).toMatchObject({ no: 7, amount: 6_000, emi: 10_000 });
  });

  it('TE6-003 · the bill calendar shows a loan\'s EMI ONCE: a leftover EMI schedule is not listed beside it', () => {
    const cal = billCalendar({ schedules: [emiSchedule()], transactions: [], baseCurrency: 'INR', rates: { INR: 1 }, horizonDays: 30, now: NOW, debts: [loan()], accounts: [] });
    const items = cal.days.flatMap(d => d.items);
    expect(items.map(i => [i.scheduleId, i.date])).toEqual([['loan:d1', '2026-11-05']]);
    expect(cal.outgoing).toBe(10_000);
  });

  it('TE6-004 · the bell raises no due or reminder card for a leftover EMI schedule, and settles one already raised', () => {
    const ctx = { householdId: 'h', baseCurrency: 'INR', rates: { INR: 1 } };
    const due = emiSchedule({ autoConfirm: false, nextDueDate: '2026-10-05' });
    expect(recurringDueNotifs([due], DEFAULT_PREFS, [], ctx)).toEqual([]);
    expect(recurringReminderNotifs([emiSchedule({ nextDueDate: '2026-10-16', reminderLeadDays: 3 })], DEFAULT_PREFS, [], ctx)).toEqual([]);
    const card = { id: 'n1', type: 'recurring_due_confirm', status: 'unread', scheduleId: 'old-emi', dueAt: '2026-10-05' } as Notification;
    expect(resolvedBillCards([card], [due])).toEqual(['n1']);
    // A plain bill is untouched.
    const rent = { ...due, id: 'rent', transactionTemplate: { ...due.transactionTemplate, category: 'rent_mortgage', description: 'Rent' } };
    expect(recurringDueNotifs([rent], DEFAULT_PREFS, [], ctx)).toHaveLength(1);
    expect(recurringReminderNotifs([{ ...rent, nextDueDate: '2026-10-16', reminderLeadDays: 3 }], DEFAULT_PREFS, [], ctx)).toHaveLength(1);
  });

  it('TE6-005 · E-4: the budget forecast counts each loan\'s EMIs on their real dates in the period', () => {
    const debts = [loan()];
    expect(loanEmiForecast(debts, [], [], '2026-10-01', '2026-10-31', 'INR', NOW)).toBe(10_000);   // Oct 5, already due
    expect(loanEmiForecast(debts, [], [], '2026-11-01', '2026-11-30', 'INR', NOW)).toBe(10_000);   // Nov 5, the due one
    // The year: May–Oct (6 already due, at the EMI) + Nov and Dec from the loan's schedule.
    expect(loanEmiForecast(debts, [], [], '2026-01-01', '2026-12-31', 'INR', NOW)).toBe(80_000);
    // A receivable, a paid-off loan and a month before the first EMI add nothing.
    expect(loanEmiForecast([loan({ direction: 'owed_to_me' }), loan({ paidOffAt: '2026-06-01' })], [], [], '2026-10-01', '2026-10-31', 'INR', NOW)).toBe(0);
    expect(loanEmiForecast(debts, [], [], '2026-03-01', '2026-03-31', 'INR', NOW)).toBe(0);
  });

  it('TE6-006 · the Recurring switch is the LOAN\'s autoRecord; a missing account or date opens the loan form; EMI schedules are not listed', () => {
    const page = readFileSync(resolvePath(ROOT, 'react/src/pages/Recurring.tsx'), 'utf8');
    expect(page).toMatch(/loanEmiRows\(debts, accounts, transactions, baseCur\)/);
    expect(page).toMatch(/await upsertDebt\(\{ \.\.\.row\.debt, autoRecord: !row\.autoRecord \}\)/);
    // v10.109.0 (R-1): the loan opens with Record automatically already on.
    expect(page).toMatch(/if \(!row\.autoRecord && row\.needs\.length\) \{[\s\S]*?openEditDebt\(row\.debt, \{ mode: \x27edit\x27, debtId: row\.debt\.id, autoRecord: true \}\);/);
    expect(page).toMatch(/schedules\.filter\(s => !isLoanEmiSchedule\(s\)\)/);
    expect(page).toMatch(/navigate\(`\/debts\?pay=\$\{row\.debt\.id\}`\)/);
    expect(page).not.toMatch(/this schedule no longer posts/);
  });

  it('TE6-007 · the budget form adds the loans\' EMIs to its recurring forecast, under Loan / EMI', () => {
    const form = readFileSync(resolvePath(ROOT, 'react/src/components/budgets/BudgetFormModal.tsx'), 'utf8');
    expect(form).toMatch(/loanEmiForecast\(debts, accounts, transactions, period\.periodStart, period\.periodEnd, form\.currency\)/);
    expect(form).toMatch(/loan_emi: Math\.round\(\(\(byCategory\.loan_emi \?\? 0\) \+ emis\) \* 100\) \/ 100/);
  });
});
