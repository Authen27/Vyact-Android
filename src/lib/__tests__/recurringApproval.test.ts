import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { LocalStorageAdapter } from '../dataAdapter';
import { computeAccountBalance } from '../accountBalance';
import type { RecurringSchedule } from '../../types';

vi.mock('../supabase', () => ({ isCloudEnabled: () => false, supabase: null }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-09T12:00:00Z'));
  useStore.setState({ ...useStore.getInitialState(), adapter: new LocalStorageAdapter(),
    currentHouseholdId: crypto.randomUUID(), cloudEnabled: false, accounts: [
      { id: 'bank', kind: 'bank', name: 'Bank', currency: 'USD', openingBalance: 1000 }],
    transactions: [], recurringSchedules: [], refreshNotifications: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => vi.useRealTimers());

it('keeps an approval-required bill due without posting or advancing it', async () => {
  const schedule = await useStore.getState().upsertRecurring({ frequency: 'monthly', dayOfMonth: 9,
    startDate: '2026-09-09', nextDueDate: '2026-09-09', autoConfirm: false,
    transactionTemplate: { type: 'expense', amount: 100, currency: 'USD', category: 'utilities', accountId: 'bank', description: 'Bill' } });
  await useStore.getState().runRecurringEngine();
  expect(useStore.getState().transactions).toEqual([]);
  expect(useStore.getState().recurringSchedules[0].nextDueDate).toBe('2026-09-09');
  await useStore.getState().approveRecurring(schedule.id, '2026-09-09');
  await useStore.getState().approveRecurring(schedule.id, '2026-09-09');
  const state = useStore.getState();
  expect(state.transactions).toHaveLength(1);
  expect(state.transactions[0]).toMatchObject({ amount: 100, date: '2026-09-09', accountId: 'bank', recurringScheduleId: schedule.id });
  expect(computeAccountBalance(state.accounts[0], state.transactions, 'USD', { USD: 1 })).toBe(900);
  expect(state.recurringSchedules[0].nextDueDate).toBe('2026-10-09');
  expect(await new LocalStorageAdapter().list('transactions', state.currentHouseholdId)).toEqual(state.transactions);
  expect(await new LocalStorageAdapter().list('recurring', state.currentHouseholdId)).toEqual(state.recurringSchedules);
});
it('W3-D13-012 · a schedule keeps its rule, owner and month-end rule, and closes after its last occurrence', async () => {
  const schedule = await useStore.getState().upsertRecurring({ frequency: 'monthly', dayOfMonth: 9,
    rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=9;COUNT=2', shortMonthPolicy: 'next_month_first', ownerMemberId: 'm-1',
    startDate: '2026-08-09', nextDueDate: '2026-09-09', autoConfirm: true,
    transactionTemplate: { type: 'expense', amount: 100, currency: 'USD', category: 'utilities', accountId: 'bank', description: 'Bill' } });
  // Before W3e the store dropped all three, so the form's rule never reached the database.
  expect(schedule).toMatchObject({ rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=9;COUNT=2', shortMonthPolicy: 'next_month_first', ownerMemberId: 'm-1' });

  await useStore.getState().runRecurringEngine();      // 9 Sep is the second of two
  await useStore.getState().runRecurringEngine();
  const state = useStore.getState();
  expect(state.transactions).toHaveLength(1);
  expect(state.transactions[0]).toMatchObject({ date: '2026-09-09', memberId: 'm-1', recurringScheduleId: schedule.id });
  expect(state.recurringSchedules[0]).toMatchObject({ active: false, nextDueDate: '2026-09-09', lastGenerated: '2026-09-09' });
  const [stored] = await new LocalStorageAdapter().list<RecurringSchedule>('recurring', state.currentHouseholdId);
  expect(stored).toMatchObject({ active: false, rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=9;COUNT=2', shortMonthPolicy: 'next_month_first', ownerMemberId: 'm-1' });
});

it('W4-D16-006 · in cloud mode the app leaves auto-approved bills to the server; an EMI schedule is paid from its loan, not posted', async () => {
  useStore.setState({ cloudEnabled: true });
  const bill = { frequency: 'monthly' as const, dayOfMonth: 9, startDate: '2026-08-09', nextDueDate: '2026-09-09', autoConfirm: true };
  const rent = await useStore.getState().upsertRecurring({ ...bill,
    transactionTemplate: { type: 'expense', amount: 100, currency: 'USD', category: 'utilities', accountId: 'bank', description: 'Bill' } });
  const emi = await useStore.getState().upsertRecurring({ ...bill,
    transactionTemplate: { type: 'expense', amount: 300, currency: 'USD', category: 'loan_emi', accountId: 'bank', description: 'EMI' } });
  await useStore.getState().runRecurringEngine();
  const state = useStore.getState();
  // The server's job posts the bill from the database's copy; this device does not touch it. W4f (D19):
  // an EMI is never posted as one expense — it is paid from the loan (interest + principal, by pay_loan).
  expect(state.transactions).toEqual([]);
  expect(state.recurringSchedules.find(s => s.id === rent.id)).toMatchObject({ nextDueDate: '2026-09-09', lastGenerated: undefined });
  expect(state.recurringSchedules.find(s => s.id === emi.id)?.nextDueDate).toBe('2026-09-09');
});
