// Vyact — Notification engine (Aurora v10.1, notifications-spec.md).
// 13 canonical types. Notifications are generated on-device from app state each
// refresh (no DB table); the store scopes/persists them per active household.
//
// This pass WIRES the types whose producing data already exists synchronously:
//   recurring_due_confirm · recurring_reminder · budget_threshold ·
//   debt_payment_due · stale_balance · income_landed.
// The remaining types (recurring_posted, insight_fresh, trend_alert,
// member_activity, sync_conflict, invite_received, milestone) keep their type +
// NOTIF_META + settings toggle so the sheet renders them, but their producers
// are follow-ups (need a query/engine not available in this synchronous pass —
// e.g. trend detection, activity-log subscription, invite lookup). sync_conflict
// already has its persistent banner.

import type {
  Notification, NotifType, NotifPriority, NotifActionSpec, NotificationPrefs,
  RecurringSchedule, Transaction, Budget, Debt, Account, ExchangeRates,
} from '../types';
import { uid, today, getMonthKey, fmt } from './format';
import { upcomingSchedules } from './recurring';
import { spendByCategory } from './calculations';

// ── Per-type render metadata (icon glyph + default tint + priority) ──────────
export interface NotifMeta { icon: string; tint: string; priority: NotifPriority }
export const NOTIF_META: Record<NotifType, NotifMeta> = {
  recurring_due_confirm: { icon: '↻', tint: 'var(--accent)', priority: 'P1' },
  recurring_reminder:    { icon: '↻', tint: 'var(--ff-ink-3)', priority: 'P2' },
  recurring_posted:      { icon: '↻', tint: 'var(--ff-ink-3)', priority: 'P2' },
  budget_threshold:      { icon: '◐', tint: 'var(--warn)', priority: 'P1' },
  income_landed:         { icon: '✓', tint: 'var(--good)', priority: 'P2' },
  insight_fresh:         { icon: '✦', tint: 'var(--fore)', priority: 'P2' },
  trend_alert:           { icon: '✦', tint: 'var(--fore)', priority: 'P2' },
  debt_payment_due:      { icon: '⚠', tint: 'var(--warn)', priority: 'P1' },
  stale_balance:         { icon: '◌', tint: 'var(--warn)', priority: 'P1' },
  invite_received:       { icon: '⌂', tint: 'var(--accent)', priority: 'P1' },
  member_activity:       { icon: '⌂', tint: 'var(--info)', priority: 'P2' },
  sync_conflict:         { icon: '!', tint: 'var(--crit)', priority: 'P1' },
  milestone:             { icon: '✦', tint: 'var(--good)', priority: 'P2' },
};

/** Settings grouping (Settings ▸ Notifications). */
export const NOTIF_GROUPS: { label: string; types: NotifType[] }[] = [
  { label: 'Money movement', types: ['recurring_due_confirm', 'recurring_reminder', 'recurring_posted', 'income_landed'] },
  { label: 'Budgets & debts', types: ['budget_threshold', 'debt_payment_due'] },
  { label: 'Insights',        types: ['insight_fresh', 'trend_alert', 'milestone'] },
  { label: 'Household',       types: ['invite_received', 'member_activity'] },
  { label: 'System',          types: ['stale_balance', 'sync_conflict'] },
];

export const NOTIF_TYPE_LABEL: Record<NotifType, string> = {
  recurring_due_confirm: 'Recurring needs approval',
  recurring_reminder:    'Recurring reminder',
  recurring_posted:      'Recurring posted',
  budget_threshold:      'Budget threshold',
  income_landed:         'Income landed',
  insight_fresh:         'Fresh insights',
  trend_alert:           'Trend alert',
  debt_payment_due:      'Debt payment due',
  stale_balance:         'Stale balance',
  invite_received:       'Household invite',
  member_activity:       'Member activity',
  sync_conflict:         'Sync conflict',
  milestone:             'Milestone',
};

/** `sync_conflict` can never be silenced (spec §4). */
export const NOTIF_LOCKED: NotifType[] = ['sync_conflict'];

export const DEFAULT_PREFS: NotificationPrefs = {
  master: true,
  perType: {},           // absent ⇒ enabled
  quietStart: '22:00',
  quietEnd: '07:00',
  webPushEnabled: false,
  defaultLeadDays: 3,
};

export function typeEnabled(prefs: NotificationPrefs, type: NotifType): boolean {
  if (!prefs.master && !NOTIF_LOCKED.includes(type)) return false;
  return prefs.perType[type] !== false;
}

export function isInQuietHours(prefs: NotificationPrefs, now = new Date()): boolean {
  const cur = now.getHours() * 60 + now.getMinutes();
  const [qsH, qsM] = prefs.quietStart.split(':').map(Number);
  const [qeH, qeM] = prefs.quietEnd.split(':').map(Number);
  const start = qsH * 60 + qsM, end = qeH * 60 + qeM;
  return start > end ? cur >= start || cur < end : cur >= start && cur < end;
}

// ── helpers ──────────────────────────────────────────────────────────────
const iso = () => new Date().toISOString();
function daysUntil(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00').getTime();
  const now = new Date(today() + 'T00:00:00').getTime();
  return Math.round((d - now) / 86400000);
}
function relDate(dateStr: string): string {
  const n = daysUntil(dateStr);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${Math.abs(n)} days ago`;
}
const A = (id: string, label: string, kind: NotifActionSpec['kind']): NotifActionSpec => ({ id, label, kind });

interface Ctx {
  householdId: string;
  baseCurrency: string;
  rates: ExchangeRates;
}
function base(type: NotifType, dedupeKey: string, ctx: Ctx): Pick<Notification, 'id' | 'type' | 'priority' | 'status' | 'createdAt' | 'householdId' | 'dedupeKey'> {
  return { id: uid(), type, priority: NOTIF_META[type].priority, status: 'unread', createdAt: iso(), householdId: ctx.householdId, dedupeKey };
}

// ── Generators (wired types) ────────────────────────────────────────────────

/** 1 · recurring_due_confirm (P1) — due/overdue, active, auto-confirm OFF. */
export function recurringDueNotifs(schedules: RecurringSchedule[], prefs: NotificationPrefs, existing: Notification[], ctx: Ctx): Notification[] {
  if (!typeEnabled(prefs, 'recurring_due_confirm')) return [];
  const now = today();
  const out: Notification[] = [];
  for (const s of schedules) {
    if (!s.active || s.autoConfirm || s.nextDueDate > now) continue;
    const key = `recurring_due_confirm:${s.id}:${s.nextDueDate}`;
    if (existing.some(n => n.dedupeKey === key)) continue;
    const amt = s.transactionTemplate.amount ?? 0;
    out.push({
      ...base('recurring_due_confirm', key, ctx),
      title: `${s.transactionTemplate.description} · ${fmt(amt, s.transactionTemplate.currency || ctx.baseCurrency)} — due ${relDate(s.nextDueDate)}`,
      body: 'Auto-approve is off for this schedule',
      dueAt: s.nextDueDate, amountRef: amt, scheduleId: s.id,
      deepLink: `/recurring?id=${s.id}`,
      actions: [A('approve', 'Approve', 'primary'), A('skip', 'Skip once', 'neu'), A('edit', 'Edit schedule', 'ghost')],
    });
  }
  return out;
}

/** 2 · recurring_reminder (P2) — lead-time reminder for upcoming schedules. */
export function recurringReminderNotifs(schedules: RecurringSchedule[], prefs: NotificationPrefs, existing: Notification[], ctx: Ctx): Notification[] {
  if (!typeEnabled(prefs, 'recurring_reminder')) return [];
  const out: Notification[] = [];
  for (const s of schedules) {
    const lead = s.reminderLeadDays ?? prefs.defaultLeadDays;
    if (!upcomingSchedules([s], lead).length) continue;
    const key = `recurring_reminder:${s.id}:${s.nextDueDate}`;
    if (existing.some(n => n.dedupeKey === key)) continue;
    const amt = s.transactionTemplate.amount ?? 0;
    out.push({
      ...base('recurring_reminder', key, ctx),
      title: `${s.transactionTemplate.description} · ${fmt(amt, s.transactionTemplate.currency || ctx.baseCurrency)} — ${relDate(s.nextDueDate)}`,
      body: 'Upcoming recurring charge',
      dueAt: s.nextDueDate, amountRef: amt, scheduleId: s.id,
      deepLink: `/recurring?id=${s.id}`,
      actions: [A('view', 'View schedule', 'neu')],
    });
  }
  return out;
}

/** 4 · budget_threshold (P1) — allocation crosses 80% / 100%. */
export function budgetThresholdNotifs(budgets: Budget[], txns: Transaction[], prefs: NotificationPrefs, existing: Notification[], ctx: Ctx): Notification[] {
  if (!typeEnabled(prefs, 'budget_threshold')) return [];
  const out: Notification[] = [];
  const mk = getMonthKey(today());
  const spend = spendByCategory(txns, mk, ctx.baseCurrency, ctx.rates);
  for (const b of budgets) {
    const limitBase = b.limit * ((ctx.rates[b.currency] / ctx.rates[ctx.baseCurrency]) || 1);
    const spent = spend[b.category ?? ''] || 0;
    const pct = limitBase > 0 ? spent / limitBase : 0;
    const threshold: 80 | 100 | null = pct >= 1 ? 100 : pct >= 0.8 ? 80 : null;
    if (!threshold) continue;
    const key = `budget_threshold:${b.id}:${mk}:${threshold}`;
    if (existing.some(n => n.dedupeKey === key)) continue;
    const remaining = Math.max(0, limitBase - spent);
    out.push({
      ...base('budget_threshold', key, ctx),
      tint: threshold === 100 ? 'var(--crit)' : 'var(--warn)',
      title: `${b.category ?? 'Budget'} at ${Math.round(pct * 100)}% of ${mk} budget`,
      body: `${fmt(remaining, ctx.baseCurrency)} left`,
      budgetId: b.id, amountRef: remaining,
      deepLink: `/budgets?budgetId=${b.id}`,
      actions: [A('review', 'Review budget', 'primary'), A('see_txns', 'See transactions', 'ghost')],
    });
  }
  return out;
}

/** 8 · debt_payment_due (P1) — liability min-payment due in ≤3 days. */
export function debtDueNotifs(debts: Debt[], prefs: NotificationPrefs, existing: Notification[], ctx: Ctx): Notification[] {
  if (!typeEnabled(prefs, 'debt_payment_due')) return [];
  const out: Notification[] = [];
  for (const d of debts) {
    if (d.direction === 'owed_to_me' || !d.dueDate || d.currentBalance <= 0) continue;
    const n = daysUntil(d.dueDate);
    if (n < 0 || n > 3) continue;
    const key = `debt_payment_due:${d.id}:${d.dueDate}`;
    if (existing.some(x => x.dedupeKey === key)) continue;
    const amt = d.minimumPayment ?? 0;
    out.push({
      ...base('debt_payment_due', key, ctx),
      title: `${d.name} payment · ${fmt(amt, d.currency)} — due ${relDate(d.dueDate)}`,
      body: 'Minimum payment coming up',
      dueAt: d.dueDate, amountRef: amt, debtId: d.id,
      deepLink: `/debts?debtId=${d.id}`,
      actions: [A('record', 'Record payment', 'primary'), A('view', 'View debt', 'ghost')],
    });
  }
  return out;
}

/** 5 · income_landed (P2) — income transaction posted today. */
export function incomeLandedNotifs(txns: Transaction[], prefs: NotificationPrefs, existing: Notification[], ctx: Ctx): Notification[] {
  if (!typeEnabled(prefs, 'income_landed')) return [];
  const now = today();
  const out: Notification[] = [];
  for (const t of txns) {
    if (t.type !== 'income' || t.date !== now) continue;
    const key = `income_landed:${t.id}`;
    if (existing.some(n => n.dedupeKey === key)) continue;
    out.push({
      ...base('income_landed', key, ctx),
      title: `${t.description || 'Income'} landed — +${fmt(t.amount, t.currency || ctx.baseCurrency)}`,
      body: 'Money in',
      amountRef: t.amount, txnId: t.id,
      deepLink: `/transactions?id=${t.id}`,
      actions: [A('view', 'View', 'neu')],
    });
  }
  return out;
}

/** 9 · stale_balance (P1) — liquid account balances >30 d old (aggregated, ≤1/wk). */
export function staleBalanceNotifs(accounts: Account[], prefs: NotificationPrefs, existing: Notification[], ctx: Ctx): Notification[] {
  if (!typeEnabled(prefs, 'stale_balance')) return [];
  const LIQUID: Account['kind'][] = ['bank', 'cash', 'investment'];
  const cutoff = Date.now() - 30 * 86400000;
  const lastTouched = (a: Account): number => {
    const rec = a.reconciliationLog?.length ? a.reconciliationLog[a.reconciliationLog.length - 1].at : undefined;
    const stamp = a.confirmedAt || rec || a.estimatedAt;
    return stamp ? new Date(stamp).getTime() : 0;
  };
  const stale = accounts.filter(a => !a.isArchived && LIQUID.includes(a.kind) && lastTouched(a) < cutoff);
  if (!stale.length) return [];
  // Aggregate; re-notify at most weekly.
  const weekKey = Math.floor(Date.now() / (7 * 86400000));
  const key = `stale_balance:${weekKey}`;
  if (existing.some(n => n.dedupeKey === key)) return [];
  return [{
    ...base('stale_balance', key, ctx),
    title: `${stale.length} balance${stale.length === 1 ? '' : 's'} may be out of date`,
    body: 'Last updated over 30 days ago',
    deepLink: '/accounts',
    actions: [A('update', 'Update balances', 'primary'), A('dismiss', 'Dismiss', 'ghost')],
  }];
}

// ── Web Push (unchanged) ─────────────────────────────────────────────────────
export async function showWebPush(title: string, body: string): Promise<void> {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, icon: '/favicon.svg', badge: '/favicon.svg', tag: title });
  } catch (e) { console.warn('Web Push failed:', e); }
}

export async function requestWebPushPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}
