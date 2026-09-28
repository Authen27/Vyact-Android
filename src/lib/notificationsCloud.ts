// Vyact — cross-device notification sync (v10.1.0).
// Notifications are generated on-device (lib/notifications.ts) but persisted to
// the household-scoped `notifications` Supabase table so every device sees the
// same feed + unread badge. The client upserts freshly generated rows (deduped
// by household_id + dedupe_key), reads the household's list back, and syncs
// status changes. Local-only mode never calls these (notifySlice falls back to
// localStorage). See migration 20260709120000_v101_notifications_sync.sql.
import { sb } from './supabase';
import type { Notification } from '../types';
import { toInsertRow, fromRow, type NotifRow } from './notificationRows';

/** Insert freshly generated notifications; duplicate (household, dedupe_key) rows are ignored. */
export async function insertNotifications(fresh: Notification[]): Promise<void> {
  if (!fresh.length) return;
  const { error } = await sb()
    .from('notifications')
    .upsert(fresh.map(toInsertRow), { onConflict: 'household_id,dedupe_key', ignoreDuplicates: true });
  if (error) throw error;
}

/** Read a household's notifications, newest first. */
export async function fetchNotifications(householdId: string): Promise<Notification[]> {
  const { data, error } = await sb()
    .from('notifications')
    .select('*')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as NotifRow[]).map(fromRow);
}

/** Sync a status change (read / dismissed) for one or many rows. */
export async function updateNotificationStatus(ids: string[], status: Notification['status']): Promise<void> {
  if (!ids.length) return;
  const { error } = await sb().from('notifications').update({ status }).in('id', ids);
  if (error) throw error;
}

/** Retention purge (spec §1): dismissed >30 d, read >90 d. Best-effort. */
export async function purgeExpired(householdId: string): Promise<void> {
  const d30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const d90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
  await sb().from('notifications').delete().eq('household_id', householdId).eq('status', 'dismissed').lt('created_at', d30);
  await sb().from('notifications').delete().eq('household_id', householdId).eq('status', 'read').lt('created_at', d90);
}
