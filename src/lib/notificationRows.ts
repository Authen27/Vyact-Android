// Vyact — notification ⇄ `notifications` row mapping (v10.48.0).
//
// Pure (no Supabase client), so the SAME mapping runs in the app
// (lib/notificationsCloud.ts) and on the server, where `serverEngine` bundles it
// for the web-push dispatcher. A row the server writes is therefore exactly the
// row a device would have written for the same notification, and the two
// collapse on (household_id, dedupe_key).
import type { Notification } from '../types';

export interface NotifRow {
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

export type NotifInsertRow = Omit<NotifRow, 'id'>;

const CTX_KEYS = ['scheduleId', 'budgetId', 'debtId', 'accountId', 'txnId', 'inviteToken', 'splitId'] as const;

export function toInsertRow(n: Notification): NotifInsertRow {
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

export function fromRow(r: NotifRow): Notification {
  const ctx = r.context || {};
  return {
    id: r.id, householdId: r.household_id, type: r.type, priority: r.priority,
    title: r.title, body: r.body ?? '', status: r.status, createdAt: r.created_at,
    dueAt: r.due_at ?? undefined, memberId: r.member_id ?? undefined,
    amountRef: r.amount_ref ?? undefined, deepLink: r.deep_link ?? undefined,
    tint: r.tint ?? undefined, actions: r.actions ?? undefined, dedupeKey: r.dedupe_key,
    scheduleId: ctx.scheduleId, budgetId: ctx.budgetId, debtId: ctx.debtId,
    accountId: ctx.accountId, txnId: ctx.txnId, inviteToken: ctx.inviteToken,
    splitId: ctx.splitId,
  };
}
