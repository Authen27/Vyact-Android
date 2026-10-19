// T4C-001..004 — v10.126.0 (Track T4c; audit BE-FN-12; owner, 19 Oct 2026: "show by default, and hide via
// settings"). A notification outside the app (a pushed one on the lock screen, or the open app's own popup)
// shows its amounts and names unless this device's "Show details on the lock screen" is off; then it says only
// what kind of thing needs a look. One table (lockScreenText) for the app and the server (through the bundle).
// The Android app, a WebView with no Web Push, says so instead of "This browser can't receive push".
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ isCloudEnabled: () => false, supabase: null }));
// A static render reads the store's initial state; read the current one (as dashboardPresentation does).
vi.mock('../../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store')>();
  return { ...actual, useStore: Object.assign((selector: (state: Store) => unknown) => selector(actual.useStore.getState()), actual.useStore) };
});
const popup = vi.hoisted(() => ({ showWebPush: vi.fn() }));
vi.mock('../notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../notifications')>()),
  showWebPush: popup.showWebPush,
}));

import { useStore, type Store } from '../../store';
import { LocalStorageAdapter } from '../dataAdapter';
import { today } from '../format';
import { DEFAULT_PREFS, lockScreenText, deviceNotificationText, NOTIF_META } from '../notifications';
import { lockScreenTextOnServer } from '../serverEngine';
import * as bundle from '../../../../supabase/functions/_shared/agent/engine.generated.js';
import { payloadFor, type NotificationRow } from '../../../../supabase/functions/_shared/web-push-rules';
import PushNotifications from '../../components/settings/PushNotifications';
import type { NotifType, RecurringSchedule } from '../../types';

const TYPES = Object.keys(NOTIF_META) as NotifType[];
const NOTIF: NotificationRow = {
  id: 'n1', household_id: 'h1', type: 'recurring_due_confirm', priority: 'P1', title: 'Rent ₹25,000 is due today',
  body: 'From HDFC Salary. Approve or skip.', status: 'unread', created_at: '2026-10-19T05:00:00Z',
  deep_link: '/recurring?id=rent', dedupe_key: 'recurring_due:rent:2026-10-19',
};

describe('the private line (BE-FN-12)', () => {
  it('T4C-001 · every notification type has a private title and body with no amount, number or name, and the server reads the same table', () => {
    for (const type of TYPES) {
      const t = lockScreenText(type);
      expect(t.title, type).toBeTruthy();
      expect(`${t.title} ${t.body}`, type).not.toMatch(/[0-9₹$€£%]|\{|\}/);
      expect(t, type).not.toEqual(lockScreenText('no_such_type'));   // each type is named, not the fallback
    }
    expect(lockScreenText('no_such_type')).toEqual({ title: 'Vyact', body: 'You have a new notification. Open Vyact to see it.' });
    expect(lockScreenText('recurring_due_confirm')).toEqual({ title: 'A bill is due', body: 'Open Vyact to approve or skip it.' });
    const fromBundle = (bundle as unknown as { lockScreenTextOnServer: (t: string) => unknown }).lockScreenTextOnServer;
    for (const type of [...TYPES, 'no_such_type']) {
      expect(lockScreenTextOnServer(type), type).toEqual(lockScreenText(type));
      expect(fromBundle(type), type).toEqual(lockScreenText(type));
    }
  });

  it('T4C-002 · details on (the default, and prefs saved before the switch) show the notification; off shows the private line, link and tag kept', () => {
    expect(DEFAULT_PREFS.lockScreenDetails).toBe(true);
    const n = { type: NOTIF.type, title: NOTIF.title, body: NOTIF.body };
    expect(deviceNotificationText(n, { lockScreenDetails: true })).toEqual({ title: NOTIF.title, body: NOTIF.body });
    expect(deviceNotificationText(n, {})).toEqual({ title: NOTIF.title, body: NOTIF.body });
    expect(deviceNotificationText(n, { lockScreenDetails: false })).toEqual({ title: 'A bill is due', body: 'Open Vyact to approve or skip it.' });

    expect(payloadFor(NOTIF)).toMatchObject({ title: NOTIF.title, body: NOTIF.body });
    expect(payloadFor(NOTIF, null, lockScreenTextOnServer)).toMatchObject({ title: NOTIF.title });
    expect(payloadFor(NOTIF, { master: true }, lockScreenTextOnServer)).toMatchObject({ title: NOTIF.title });
    expect(payloadFor(NOTIF, { lockScreenDetails: false }, lockScreenTextOnServer)).toEqual({
      title: 'A bill is due', body: 'Open Vyact to approve or skip it.', url: '/recurring?id=rent', tag: NOTIF.dedupe_key, type: NOTIF.type,
    });
    // Without the table (never in the function), hidden still means hidden.
    expect(payloadFor(NOTIF, { lockScreenDetails: false })).toMatchObject({ title: 'Vyact', body: 'You have a new notification. Open Vyact to see it.' });
  });
});

describe('the open app\'s own popup (local mode)', () => {
  const rent: RecurringSchedule = {
    id: 'rent', frequency: 'monthly', startDate: today(), nextDueDate: today(), autoConfirm: false, active: true,
    transactionTemplate: { type: 'expense', amount: 25_000, currency: 'INR', category: 'rent_mortgage', description: 'Rent' },
  } as RecurringSchedule;
  const start = (lockScreenDetails: boolean | undefined) => {
    const kept: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => kept[k] ?? null, setItem: (k: string, v: string) => { kept[k] = v; },
      removeItem: (k: string) => { delete kept[k]; }, clear: () => undefined, key: () => null, length: 0,
    });
    const prefs = { ...DEFAULT_PREFS, webPushEnabled: true, quietStart: '00:00', quietEnd: '00:00' };
    if (lockScreenDetails === undefined) delete (prefs as { lockScreenDetails?: boolean }).lockScreenDetails;
    else prefs.lockScreenDetails = lockScreenDetails;
    useStore.setState({ ...useStore.getInitialState(), adapter: new LocalStorageAdapter(), cloudEnabled: false,
      currentHouseholdId: 'local', recurringSchedules: [rent], notifications: [], notificationPrefs: prefs, toast: vi.fn() });
  };
  beforeEach(() => { popup.showWebPush.mockReset(); popup.showWebPush.mockResolvedValue(undefined); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('T4C-003 · with details off the popup says only "A bill is due"; on, or never set, it names the bill', async () => {
    start(false);
    await useStore.getState().refreshNotifications();
    expect(popup.showWebPush).toHaveBeenCalledWith('A bill is due', 'Open Vyact to approve or skip it.');
    expect(JSON.stringify(popup.showWebPush.mock.calls)).not.toMatch(/Rent|25,000/);

    for (const setting of [true, undefined]) {
      popup.showWebPush.mockClear();
      start(setting);
      await useStore.getState().refreshNotifications();
      expect(popup.showWebPush, String(setting)).toHaveBeenCalled();
      expect(popup.showWebPush.mock.calls[0][0], String(setting)).toMatch(/Rent/);
    }
  });
});

describe('Settings → Notifications → Push on this device', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const render = (lockScreenDetails?: boolean) => {
    useStore.setState({ ...useStore.getInitialState(), cloudEnabled: false, currentHouseholdId: 'local',
      notificationPrefs: { ...DEFAULT_PREFS, webPushEnabled: true, ...(lockScreenDetails === undefined ? {} : { lockScreenDetails }) } });
    return renderToStaticMarkup(<PushNotifications />);
  };
  const detailsBox = (html: string) => /<input[^>]*aria-label="Show details on the lock screen"[^>]*>/.exec(html)?.[0] ?? '';

  it('T4C-004 · with push on, a "Show details on the lock screen" switch, on by default; the Android app says push is not there yet and where it is', () => {
    let html = render();
    expect(html).toContain('Show details on the lock screen');
    expect(detailsBox(html)).toMatch(/checked=""/);
    expect(html).toContain('Notifications show amounts and names.');
    html = render(false);
    expect(detailsBox(html)).not.toMatch(/checked=""/);
    expect(html).toContain('Notifications say only what needs a look, such as &quot;A bill is due&quot;.');
    useStore.setState({ notificationPrefs: { ...DEFAULT_PREFS, webPushEnabled: false } });
    expect(renderToStaticMarkup(<PushNotifications />)).not.toContain('Show details on the lock screen');   // push off: nothing to hide

    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true }, navigator: {} });
    html = render();
    expect(html).toContain("The Vyact Android app can&#x27;t show notifications on your lock screen yet.");
    expect(/<input[^>]*aria-label="Push notifications on this device"[^>]*>/.exec(html)?.[0]).toMatch(/disabled=""/);
  });
});
