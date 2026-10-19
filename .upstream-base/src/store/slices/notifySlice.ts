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
  debtDueNotifs, incomeLandedNotifs, staleBalanceNotifs, pipNudgeNotifs,
  splitReceivedNotifs, splitSettledNotifs, splitClosedNotifs,
  DEFAULT_PREFS, isInQuietHours, showWebPush, resolvedBillCards, deviceNotificationText,
} from '../../lib/notifications';
import {
  insertNotifications, fetchNotifications, updateNotificationStatus, purgeExpired,
} from '../../lib/notificationsCloud';
import { readLocalJson, setLocalJson } from '../localJson';
import { deviceHasServerPush, syncPush } from '../../lib/webPush';
import { normalizeAppRole } from '../../lib/permissions';
import { expected } from '../../lib/faults';
import { landIn } from '../landIn';

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

export const createNotifySlice: StateCreator<Store, [], [], NotifySlice> = (set, get) => {
  // T5b (v10.121.0; audit XC-ARC-10) — a write after an await lands only in the household it was made for.
  const commit = landIn(set, get);
  return ({
  notifications: [],
  notificationPrefs: { ...DEFAULT_PREFS, ...readLocalJson('notification_prefs', {}) },

  refreshNotifications: async () => {
    const {
      cloudEnabled, currentHouseholdId, recurringSchedules, budgets, budgetAllocations, transactions,
      debts, accounts, profile, rates, notificationPrefs,
      sharedSplitsOwned, sharedSplitsWithMe, session,
    } = get();
    const myEmail = session?.user?.email;
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
      ...budgetThresholdNotifs(budgets, budgetAllocations, transactions, notificationPrefs, existing, ctx),
      ...debtDueNotifs(debts, notificationPrefs, existing, ctx),
      ...incomeLandedNotifs(transactions, notificationPrefs, existing, ctx),
      ...staleBalanceNotifs(accounts, notificationPrefs, existing, ctx),
      // v10.107.0 — Pip's nudges (capped: one a day, three a week; bell only).
      ...pipNudgeNotifs(transactions, notificationPrefs, existing, ctx),
      ...splitReceivedNotifs(sharedSplitsWithMe, myEmail, notificationPrefs, existing, ctx),
      ...splitSettledNotifs(sharedSplitsOwned, notificationPrefs, existing, ctx),
      ...splitClosedNotifs(sharedSplitsWithMe, notificationPrefs, existing, ctx),
    ];

    // W4d (audit FE-UIS-04) — a bill card whose bill was handled elsewhere (approved, skipped, "paid X",
    // paused) is marked read: acting on it would skip or "approve" the wrong occurrence.
    const settle = (list: Notification[]): { list: Notification[]; resolved: string[] } => {
      const resolved = resolvedBillCards(list, recurringSchedules);
      if (!resolved.length) return { list, resolved };
      const ids = new Set(resolved);
      return { list: list.map(n => (ids.has(n.id) ? { ...n, status: 'read' as const } : n)), resolved };
    };

    if (cloud) {
      try {
        // v10.115.0 (Track T2b-1, audit DB-SEC-06): a viewer reads the household's notifications but
        // never writes them (from T2b-2 the database refuses it), and a refused write never stops the
        // bell from loading: it used to skip the fetch below and leave the list as it was.
        if (fresh.length && normalizeAppRole(get().myRole) !== 'viewer') {
          try { await insertNotifications(fresh); } catch (e) { expected(e, 'notifications:insert'); }
        }
        void purgeExpired(hid);
        const { list: all, resolved } = settle(purge(await fetchNotifications(hid)));
        commit(hid, { notifications: all });
        if (resolved.length) void updateNotificationStatus(resolved, 'read');
      } catch {
        // Offline / RLS hiccup — keep whatever we have; a later refresh retries.
        commit(hid, { notifications: purge(existing) });
      }
    } else {
      const { list: merged } = settle(purge(fresh.length ? [...existing, ...fresh] : existing));
      setLocalJson(KEY(hid), merged);
      commit(hid, { notifications: merged });
    }

    // Web Push for action-required (P1) types outside quiet hours (opt-in).
    // v10.48.0 — a device registered for real push gets these from the server (with the
    // app closed too); popping them here as well would show each one twice.
    if (fresh.length && notificationPrefs.webPushEnabled && !isInQuietHours(notificationPrefs) && !deviceHasServerPush()) {
      // v10.126.0 (T4c, BE-FN-12): with "Show details on the lock screen" off, only the private line.
      for (const n of fresh) {
        if (n.priority !== 'P1') continue;
        const text = deviceNotificationText(n, notificationPrefs);
        void showWebPush(text.title, text.body);
      }
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
    // v10.48.0 — the server applies this device's switches and quiet hours when it pushes.
    const { cloudEnabled, currentHouseholdId } = get();
    // T4d: syncPush decides (a browser only when its switch is on; the Android app unless turned off there),
    // so a phone that registered by default still gets its quiet hours and "Show details" changes.
    if (cloudEnabled && currentHouseholdId && currentHouseholdId !== 'local') {
      void syncPush(currentHouseholdId, next);
    }
  },
});
};
