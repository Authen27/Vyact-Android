// Vyact — cross-device notification sync (v10.1.0).
// Notifications are generated on-device (lib/notifications.ts) but persisted to
// the household-scoped `notifications` Supabase table so every device sees the
// same feed + unread badge. The client upserts freshly generated rows (deduped
// by household_id + dedupe_key), reads the household's list back, and syncs
// status changes. Local-only mode never calls these (notifySlice falls back to
// localStorage). See migration 20260709120000_v101_notifications_sync.sql.
import { sb } from './supabase';
import type { Notification } from '../types';

interface NotifRow {
  id: string;
  household_id: string;
  type: Notification['type'];
  priority: Notification['priority'];
  title: string;
  body: string | null;
  status: Notification['status'];
  created_at: string;
  due_at: string | null;
  member_id: string | null;
  amount_ref: number | null;
  deep_link: string | null;
  tint: string | null;
  actions: Notification['actions'] | null;
  context: Record<string, string> | null;
  dedupe_key: string;
}

const CTX_KEYS = ['scheduleId', 'budgetId', 'debtId', 'accountId', 'txnId', 'inviteToken'] as const;

function toInsertRow(n: Notification): Omit<NotifRow, 'id'> {
  const context: Record<string, string> = {};
  for (const k of CTX_KEYS) { const v = n[k]; if (v != null) context[k] = v; }
  return {
    household_id: n.householdId!,
    type: n.type, priority: n.priority, title: n.title, body: n.body ?? null,
    status: n.status, created_at: n.createdAt, due_at: n.dueAt ?? null,
    member_id: n.memberId ?? null, amount_ref: n.amountRef ?? null,
    deep_link: n.deepLink ?? null, tint: n.tint ?? null, actions: n.actions ?? null,
    context: Object.keys(context).length ? context : null,
    dedupe_key: n.dedupeKey!,
  };
}

function fromRow(r: NotifRow): Notification {
  const ctx = r.context || {};
  return {
    id: r.id, householdId: r.household_id, type: r.type, priority: r.priority,
    title: r.title, body: r.body ?? '', status: r.status, createdAt: r.created_at,
    dueAt: r.due_at ?? undefined, memberId: r.member_id ?? undefined,
    amountRef: r.amount_ref ?? undefined, deepLink: r.deep_link ?? undefined,
    tint: r.tint ?? undefined, actions: r.actions ?? undefined, dedupeKey: r.dedupe_key,
    scheduleId: ctx.scheduleId, budgetId: ctx.budgetId, debtId: ctx.debtId,
    accountId: ctx.accountId, txnId: ctx.txnId, inviteToken: ctx.inviteToken,
  };
}

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
