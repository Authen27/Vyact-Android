import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { LocalStorageAdapter } from '../dataAdapter';
import { computeAccountBalance } from '../accountBalance';

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