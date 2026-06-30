// Vyact — notifications slice (TD-25 increment 4).
//
// The v7 in-app notification feed + prefs. The compute (upcoming bills, missed
// payments, budget thresholds, goal milestones) reads the rest of the store via
// `get()`; persistence goes through the shared localJson helpers. Moved verbatim
// from the store god-module.
import type { StateCreator } from 'zustand';
import type { Notification, NotificationPrefs } from '../../types';
import type { Store } from '../../store';
import {
  upcomingBillNotifs, missedPaymentNotifs, budgetThresholdNotifs,
  goalMilestoneNotifs, DEFAULT_PREFS, isInQuietHours, showWebPush,
} from '../../lib/notifications';
import { readLocalJson, setLocalJson } from '../localJson';

export interface NotifySlice {
  notifications: Notification[];
  notificationPrefs: NotificationPrefs;
  refreshNotifications: () => void;
  markNotificationRead: (id: string) => void;
  dismissNotification: (id: string) => void;
  updateNotificationPrefs: (patch: Partial<NotificationPrefs>) => void;
}

export const createNotifySlice: StateCreator<Store, [], [], NotifySlice> = (set, get) => ({
  notifications: readLocalJson<Notification[]>('notifications', []),
  notificationPrefs: { ...DEFAULT_PREFS, ...readLocalJson('notification_prefs', {}) },

  // ── v7: NOTIFICATIONS ────────────────────────────────────────
  refreshNotifications: () => {
    const { recurringSchedules, notifications, notificationPrefs,
            budgets, transactions, goals, profile, rates } = get();
    if (!notificationPrefs.master) return;

    const fresh: Notification[] = [
      ...upcomingBillNotifs(recurringSchedules, notificationPrefs, notifications),
      ...missedPaymentNotifs(recurringSchedules, notificationPrefs, notifications),
      ...budgetThresholdNotifs(budgets, transactions, notificationPrefs, notifications, profile.baseCurrency, rates),
      ...goalMilestoneNotifs(goals, notificationPrefs, notifications),
    ];
    if (!fresh.length) return;
    const merged = [...notifications, ...fresh];
    setLocalJson('notifications', merged);
    set({ notifications: merged });

    // Web Push for high-priority types if outside quiet hours
    if (notificationPrefs.webPushEnabled && !isInQuietHours(notificationPrefs)) {
      for (const n of fresh) {
        if (n.type === 'missed_payment' || n.type === 'goal_milestone') {
          showWebPush(n.title, n.body);
        }
      }
    }
  },

  markNotificationRead: (id) => {
    const updated = get().notifications.map(n => n.id === id ? { ...n, status: 'read' as const } : n);
    setLocalJson('notifications', updated);
    set({ notifications: updated });
  },

  dismissNotification: (id) => {
    const updated = get().notifications.map(n => n.id === id ? { ...n, status: 'dismissed' as const } : n);
    setLocalJson('notifications', updated);
    set({ notifications: updated });
  },

  updateNotificationPrefs: (patch) => {
    const next = { ...get().notificationPrefs, ...patch };
    setLocalJson('notification_prefs', next);
    set({ notificationPrefs: next });
  },
});
