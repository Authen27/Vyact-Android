import { describe, expect, it } from 'vitest';
import type { RecurringSchedule, Transaction } from '../../types';
import { billCalendar } from '../billCalendar';
import { recurringInstanceId } from '../recurring';

const NOW = '2026-09-11';
const schedule = (patch: Partial<RecurringSchedule> & { template?: Partial<RecurringSchedule['transactionTemplate']> }): RecurringSchedule => {
  const { template, ...rest } = patch;
  return {
    id: 'rent', frequency: 'monthly', startDate: '2026-01-15', nextDueDate: '2026-09-15', autoConfirm: true, active: true,
    rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15',
    transactionTemplate: { type: 'expense', amount: 1200, currency: 'USD', description: 'Rent', category: 'rent_mortgage', ...template } as RecurringSchedule['transactionTemplate'],
    ...rest,
  } as RecurringSchedule;
};
const run = (schedules: RecurringSchedule[], transactions: Transaction[] = [], horizonDays = 30) =>
  billCalendar({ schedules, transactions, baseCurrency: 'USD', rates: { USD: 1, EUR: 0.8 }, horizonDays, now: NOW });
const flat = (result: ReturnType<typeof run>) => result.days.flatMap(day => day.items.map(item => [item.scheduleId, item.date, item.status]));

describe('Approval-aware bill calendar (v10.32.0)', () => {
  it('projects auto-approved occurrences from the RRULE, including several weekdays, within the horizon', () => {
    const gym = schedule({ id: 'gym', startDate: '2026-09-01', nextDueDate: '2026-09-11', rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,FR', template: { description: 'Gym', amount: 10 } });
    expect(flat(run([gym], [], 10))).toEqual([
      ['gym', '2026-09-11', 'auto'], ['gym', '2026-09-14', 'auto'], ['gym', '2026-09-18', 'auto'],
    ]);
  });

  it('makes only the due occurrence at the pointer actionable for an approval schedule; later ones wait', () => {
    const manual = schedule({ autoConfirm: false, nextDueDate: '2026-09-05', rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=SA', startDate: '2026-08-01', template: { description: 'Cleaner', amount: 50 } });
    const result = run([manual], [], 14);
    expect(flat(result)).toEqual([
      ['rent', '2026-09-05', 'awaiting-approval'], ['rent', '2026-09-12', 'approval-when-due'], ['rent', '2026-09-19', 'approval-when-due'],
    ]);
    expect(result.days[0].items[0]).toMatchObject({ actionable: true, overdue: true });
    expect(result.days[1].items[0]).toMatchObject({ actionable: false, overdue: false });
    expect(result.awaitingApproval).toBe(1);
  });

  it('never shows occurrences before the pointer, marks a posted occurrence, and skips exhausted, inactive or stale schedules', () => {
    const today = schedule({ id: 'salary', nextDueDate: '2026-09-11', rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=11', startDate: '2026-01-11', template: { type: 'income', description: 'Salary', amount: 5000 } });
    const postedTxn = { id: recurringInstanceId('salary', '2026-09-11'), date: '2026-09-11' } as Transaction;
    const skippedPast = schedule({ id: 'skipped', nextDueDate: '2026-10-15' });
    const finished = schedule({ id: 'done', rrule: 'FREQ=MONTHLY;COUNT=2;BYMONTHDAY=15', startDate: '2026-01-15' });
    const inactive = schedule({ id: 'off', active: false });
    const stale = schedule({ id: 'stale', autoConfirm: false, nextDueDate: '2026-05-15' });
    expect(flat(run([today, skippedPast, finished, inactive, stale], [postedTxn]))).toEqual([['salary', '2026-09-11', 'posted']]);
  });

  it('falls back to the frequency fields for a schedule without an RRULE', () => {
    const legacy = schedule({ id: 'legacy', rrule: undefined, frequency: 'monthly', dayOfMonth: 20, nextDueDate: '2026-09-20' });
    expect(flat(run([legacy]))).toEqual([['legacy', '2026-09-20', 'auto']]);
  });

  it('totals what is not yet posted in household currency, by kind, and groups by day', () => {
    const rent = schedule({});
    const phone = schedule({ id: 'phone', nextDueDate: '2026-09-15', template: { description: 'Phone', amount: 40, currency: 'EUR' } });
    const salary = schedule({ id: 'salary', nextDueDate: '2026-09-25', rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=25', template: { type: 'income', description: 'Salary', amount: 3000 } });
    const sip = schedule({ id: 'sip', nextDueDate: '2026-09-20', rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=20', template: { type: 'investment', description: 'SIP', amount: 500, category: '' } });
    const result = run([rent, phone, salary, sip]);
    expect(result.days.map(day => [day.date, day.items.map(item => item.description)])).toEqual([
      ['2026-09-15', ['Phone', 'Rent']], ['2026-09-20', ['SIP']], ['2026-09-25', ['Salary']],
    ]);
    expect(result).toMatchObject({ from: NOW, to: '2026-10-10', outgoing: 1250, incoming: 3000, investing: 500 });
  });
});
