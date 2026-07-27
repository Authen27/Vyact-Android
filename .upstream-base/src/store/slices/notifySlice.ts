// Vyact — notifications slice (Aurora v10.1, 13-type model · notifications-spec.md).
//
// Notifications are generated on-device from app state each refresh and are
// **household-scoped**. Persistence:
//   • Cloud mode → the `notifications` Supabase table (cross-device: same feed
//     + unread badge on every device a member signs in on). The client upserts
//     freshly generated rows (deduped by household_id + dedupe_key) and reads
//     the household's list back; status changes sync.
//   • Local-only mode → localStorage keyed per household (no account, no sync).
// Retention: dismissed purged after 30 d, read after 90 d (spec §1).
import type { StateCreator } from 'zustand';
import type { Notification, NotificationPrefs } from '../../types';
import type { Store } from '../../store';
import {
  recurringDueNotifs, recurringReminderNotifs, budgetThresholdNotifs,
  debtDueNotifs, incomeLandedNotifs, staleBalanceNotifs,
  DEFAULT_PREFS, isInQuietHours, showWebPush,
} from '../../lib/notifications';
import {
  insertNotifications, fetchNotifications, updateNotificationStatus, purgeExpired,
} from '../../lib/notificationsCloud';
import { readLocalJson, setLocalJson } from '../localJson';

const KEY = (hid: string) => `notifications_${hid}`;
const DAY = 86_400_000;

function purge(list: Notification[]): Notification[] {
  const now = Date.now();
  return list.filter(n => {
    const age = now - new Date(n.createdAt).getTime();
    if (n.status === 'dismissed') return age < 30 * DAY;
    if (n.status === 'read') return age < 90 * DAY;
    return true;
  });
}

export interface NotifySlice {
  notifications: Notification[];
  notificationPrefs: NotificationPrefs;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  dismissNotification: (id: string) => void;
  updateNotificationPrefs: (patch: Partial<NotificationPrefs>) => void;
}

export const createNotifySlice: StateCreator<Store, [], [], NotifySlice> = (set, get) => ({
  notifications: [],
  notificationPrefs: { ...DEFAULT_PREFS, ...readLocalJson('notification_prefs', {}) },

  refreshNotifications: async () => {
    const {
      cloudEnabled, currentHouseholdId, recurringSchedules, budgets, transactions,
      debts, accounts, profile, rates, notificationPrefs,
    } = get();
    const hid = currentHouseholdId || 'local';
    const cloud = cloudEnabled && hid !== 'local';

    // The active household's own list is the source of truth for dedupe.
    const existing = cloud
      ? get().notifications
      : purge(readLocalJson<Notification[]>(KEY(hid), []));

    if (!notificationPrefs.master) { set({ notifications: purge(existing) }); return; }

    const ctx = { householdId: hid, baseCurrency: profile.baseCurrency, rates };
    const fresh: Notification[] = [
      ...recurringDueNotifs(recurringSchedules, notificationPrefs, existing, ctx),
      ...recurringReminderNotifs(recurringSchedules, notificationPrefs, existing, ctx),
      ...budgetThresholdNotifs(budgets, transactions, notificationPrefs, existing, ctx),
      ...debtDueNotifs(debts, notificationPrefs, existing, ctx),
      ...incomeLandedNotifs(transactions, notificationPrefs, existing, ctx),
      ...staleBalanceNotifs(accounts, notificationPrefs, existing, ctx),
    ];

    if (cloud) {
      try {
        if (fresh.length) await insertNotifications(fresh);
        void purgeExpired(hid);
        const all = purge(await fetchNotifications(hid));
        set({ notifications: all });
      } catch {
        // Offline / RLS hiccup — keep whatever we have; a later refresh retries.
        set({ notifications: purge(existing) });
      }
    } else {
      const merged = purge(fresh.length ? [...existing, ...fresh] : existing);
      setLocalJson(KEY(hid), merged);
      set({ notifications: merged });
    }

    // Web Push for action-required (P1) types outside quiet hours (opt-in).
    if (fresh.length && notificationPrefs.webPushEnabled && !isInQuietHours(notificationPrefs)) {
      for (const n of fresh) if (n.priority === 'P1') showWebPush(n.title, n.body);
    }
  },

  markNotificationRead: (id) => {
    const { cloudEnabled, currentHouseholdId } = get();
    const updated = get().notifications.map(n => n.id === id ? { ...n, status: 'read' as const } : n);
    set({ notifications: updated });
    if (cloudEnabled && (currentHouseholdId || 'local') !== 'local') {
      void updateNotificationStatus([id], 'read');
    } else {
      setLocalJson(KEY(currentHouseholdId || 'local'), updated);
    }
  },

  markAllNotificationsRead: () => {
    const { cloudEnabled, currentHouseholdId } = get();
    const ids = get().notifications.filter(n => n.status === 'unread').map(n => n.id);
    const updated = get().notifications.map(n => n.status === 'unread' ? { ...n, status: 'read' as const } : n);
    set({ notifications: updated });
    if (cloudEnabled && (currentHouseholdId || 'local') !== 'local') {
      void updateNotificationStatus(ids, 'read');
    } else {
      setLocalJson(KEY(currentHouseholdId || 'local'), updated);
    }
  },

  dismissNotification: (id) => {
    const { cloudEnabled, currentHouseholdId } = get();
    const updated = get().notifications.map(n => n.id === id ? { ...n, status: 'dismissed' as const } : n);
    set({ notifications: updated });
    if (cloudEnabled && (currentHouseholdId || 'local') !== 'local') {
      void updateNotificationStatus([id], 'dismissed');
    } else {
      setLocalJson(KEY(currentHouseholdId || 'local'), updated);
    }
  },

  updateNotificationPrefs: (patch) => {
    const next = { ...get().notificationPrefs, ...patch };
    setLocalJson('notification_prefs', next);
    set({ notificationPrefs: next });
  },
});
