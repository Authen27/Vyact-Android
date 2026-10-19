// Android overlay (upstream v10.127.0, T4d; owner, 19 Oct 2026: "the server is the only source on a registered
// phone"). The app raises its own local notifications for fresh alerts only while the phone is NOT registered
// for Firebase push; once it is (deviceHasServerPush), the server sends them, with the app closed too, and the
// app stays quiet so nothing arrives twice.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ isCloudEnabled: () => false, supabase: null, APP_URL: 'https://vyact.app' }));
const native = vi.hoisted(() => ({ isNative: () => true, fireNativeNotifications: vi.fn(async () => undefined) }));
vi.mock('../native', () => native);
const push = vi.hoisted(() => ({ deviceHasServerPush: vi.fn(() => false), syncPush: vi.fn(async () => undefined) }));
vi.mock('../webPush', async (importOriginal) => ({ ...(await importOriginal<typeof import('../webPush')>()), ...push }));

import { useStore } from '../../store';
import { LocalStorageAdapter } from '../dataAdapter';
import { DEFAULT_PREFS } from '../notifications';
import { today } from '../format';
import type { RecurringSchedule } from '../../types';

const rent = {
  id: 'rent', frequency: 'monthly', startDate: today(), nextDueDate: today(), autoConfirm: false, active: true,
  transactionTemplate: { type: 'expense', amount: 25_000, currency: 'INR', category: 'rent_mortgage', description: 'Rent' },
} as RecurringSchedule;

beforeEach(() => {
  const kept: Record<string, string> = {};
  vi.stubGlobal('localStorage', { getItem: (k: string) => kept[k] ?? null, setItem: (k: string, v: string) => { kept[k] = v; },
    removeItem: (k: string) => { delete kept[k]; }, clear: () => undefined, key: () => null, length: 0 });
  native.fireNativeNotifications.mockClear();
  useStore.setState({ ...useStore.getInitialState(), adapter: new LocalStorageAdapter(), cloudEnabled: false, currentHouseholdId: 'local',
    recurringSchedules: [rent], notifications: [], toast: vi.fn(),
    notificationPrefs: { ...DEFAULT_PREFS, quietStart: '00:00', quietEnd: '00:00' } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('local notifications in the Android app', () => {
  it('a phone not registered for Firebase push shows the fresh alert itself', async () => {
    push.deviceHasServerPush.mockReturnValue(false);
    await useStore.getState().refreshNotifications();
    expect(native.fireNativeNotifications).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(native.fireNativeNotifications.mock.calls[0])).toMatch(/Rent/);
  });

  it('a registered phone stays quiet: the server is the only source', async () => {
    push.deviceHasServerPush.mockReturnValue(true);
    await useStore.getState().refreshNotifications();
    expect(native.fireNativeNotifications).not.toHaveBeenCalled();
    expect(useStore.getState().notifications.length).toBeGreaterThan(0);   // the bell still has it
  });
});
