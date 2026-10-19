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
  DEFAULT_PREFS, isInQuietHours, showWebPush, resolvedBillCards,
} from '../../lib/notifications';
import { isNative, fireNativeNotifications } from '../../lib/native';
import {
  insertNotifications, fetchNotifications, updateNotificationStatus, purgeExpired,
} from '../../lib/notificationsCloud';
import { readLocalJson, setLocalJson } from '../localJson';
import { deviceHasServerPush, syncPush } from '../../lib/webPush';

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
        if (fresh.length) await insertNotifications(fresh);
        void purgeExpired(hid);
        const { list: all, resolved } = settle(purge(await fetchNotifications(hid)));
        set({ notifications: all });
        if (resolved.length) void updateNotificationStatus(resolved, 'read');
      } catch {
        // Offline / RLS hiccup — keep whatever we have; a later refresh retries.
        set({ notifications: purge(existing) });
      }
    } else {
      const { list: merged } = settle(purge(fresh.length ? [...existing, ...fresh] : existing));
      setLocalJson(KEY(hid), merged);
      set({ notifications: merged });
    }

    // ANDROID-OVERLAY — push the fresh alerts outside quiet hours. On native
    // (Capacitor) push is ON by default: every fresh alert becomes a tappable local
    // notification that deep-links to its view (the Android WebView cannot receive
    // Web Push, so there is no double-delivery with the server push below).
    // On web it stays opt-in (webPushEnabled) and limited to action-required (P1) types.
    // Upstream v10.127.0 (T4d; owner, 19 Oct 2026: "the server is the only source on a registered phone"):
    // once this phone is registered for Firebase push (upstream lib/nativePush.ts, deviceHasServerPush()),
    // the server sends its alerts with the app closed too, so the app stops raising its own. Until then (no
    // push plugin in this APK, or not registered yet) it keeps the local notifications below.
    // At the sync that brings upstream v10.126.0: pass each alert through deviceNotificationText(n,
    // notificationPrefs) here too, so "Show details on the lock screen" applies to these.
    if (fresh.length && !isInQuietHours(notificationPrefs)) {
      if (isNative()) {
        if (deviceHasServerPush()) return;
        // v10.107.0 — Pip's nudges (dedupe keys "pip:…") are bell-only by product decision: capped
        // and never pushed, so they stay out of the phone's notification shade too.
        void fireNativeNotifications(
          fresh
            .filter(n => !n.dedupeKey?.startsWith('pip:'))
            .map(n => ({ id: n.id, type: n.type, title: n.title, body: n.body, deepLink: n.deepLink })),
        );
      } else if (notificationPrefs.webPushEnabled && !deviceHasServerPush()) {
        // v10.48.0 — a device registered for real push gets these from the server (with the
        // app closed too); popping them here as well would show each one twice.
        for (const n of fresh) if (n.priority === 'P1') showWebPush(n.title, n.body);
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
    if (cloudEnabled && currentHouseholdId && currentHouseholdId !== 'local' && next.webPushEnabled) {
      void syncPush(currentHouseholdId, next);
    }
  },
});
