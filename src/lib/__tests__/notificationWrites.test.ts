// T2B-001..002 — v10.115.0 (Track T2b-1; audit DB-SEC-06; owner decision 18 Oct 2026: lock screens get only
// what the server raised). The app side ships first: a viewer's device reads the household's notifications
// but never writes them (from T2b-2 the database refuses it), and a refused write never stops the bell
// from loading. Before, a failed insert skipped the fetch and left the list as it was.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ isCloudEnabled: () => false, supabase: null }));
const cloud = vi.hoisted(() => ({
  insertNotifications: vi.fn(), fetchNotifications: vi.fn(), updateNotificationStatus: vi.fn(), purgeExpired: vi.fn(),
}));
vi.mock('../notificationsCloud', () => cloud);

import { useStore } from '../../store';
import { LocalStorageAdapter } from '../dataAdapter';
import { today } from '../format';
import type { Notification, RecurringSchedule } from '../../types';

const rent: RecurringSchedule = {
  id: 'rent', frequency: 'monthly', startDate: today(), nextDueDate: today(), autoConfirm: false, active: true,
  transactionTemplate: { type: 'expense', amount: 25_000, currency: 'INR', category: 'rent_mortgage', description: 'Rent' },
} as RecurringSchedule;
const fromCloud = [{ id: 'n-cloud', type: 'recurring_due_confirm', priority: 'P1', title: 'Rent is due', status: 'unread',
  createdAt: new Date().toISOString(), dedupeKey: 'k' }] as unknown as Notification[];

beforeEach(() => {
  for (const fn of Object.values(cloud)) fn.mockReset();
  cloud.fetchNotifications.mockResolvedValue(fromCloud);
  cloud.purgeExpired.mockResolvedValue(undefined);
  cloud.updateNotificationStatus.mockResolvedValue(undefined);
  useStore.setState({ ...useStore.getInitialState(), adapter: new LocalStorageAdapter(), cloudEnabled: true,
    currentHouseholdId: 'hh-1', recurringSchedules: [rent], notifications: [], toast: vi.fn() });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('who writes the household\'s notifications (DB-SEC-06, app side)', () => {
  it('T2B-001 · a viewer\'s device raises nothing into the household; a member\'s does', async () => {
    useStore.setState({ myRole: 'viewer' });
    await useStore.getState().refreshNotifications();
    expect(cloud.insertNotifications).not.toHaveBeenCalled();
    expect(useStore.getState().notifications.map(n => n.id)).toEqual(['n-cloud']);   // still reads them

    useStore.setState({ myRole: 'member' });
    cloud.insertNotifications.mockResolvedValue(undefined);
    await useStore.getState().refreshNotifications();
    expect(cloud.insertNotifications).toHaveBeenCalledTimes(1);
    expect(cloud.insertNotifications.mock.calls[0][0].map((n: Notification) => n.title).join(' ')).toMatch(/Rent/);
  });

  it('T2B-002 · a refused write never stops the bell from loading', async () => {
    useStore.setState({ myRole: 'member' });
    cloud.insertNotifications.mockRejectedValue({ code: '42501', message: 'new row violates row-level security policy' });
    await useStore.getState().refreshNotifications();
    expect(cloud.fetchNotifications).toHaveBeenCalledTimes(1);
    expect(useStore.getState().notifications.map(n => n.id)).toEqual(['n-cloud']);
  });
});
