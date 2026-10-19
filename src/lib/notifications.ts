// Vyact — Notification engine (Aurora v10.1, notifications-spec.md).
// 13 canonical types. Notifications are generated on-device from app state each
// refresh (no DB table); the store scopes/persists them per active household.
//
// This pass WIRES the types whose producing data already exists synchronously:
//   recurring_due_confirm · recurring_reminder · budget_threshold ·
//   debt_payment_due · stale_balance · income_landed.
// The remaining types (recurring_posted, member_activity, sync_conflict, milestone) keep their type +
// NOTIF_META + settings toggle so the sheet renders them, but their producers
// are follow-ups (need a query/engine not available in this synchronous pass —
// e.g. an activity-log subscription). v10.107.0: trend_alert and insight_fresh are Pip's nudges
// (pipNudgeNotifs). sync_conflict
// already has its persistent banner. invite_received and invite_pending (v10.95.0) are built from
// live invitation lists and never saved (see "Household invitations" below).

import type {
  Notification, NotifType, NotifPriority, NotifActionSpec, NotificationPrefs,
  RecurringSchedule, Transaction, Budget, BudgetAllocation, Debt, Account, ExchangeRates, SharedSplit, AppRole,
} from '../types';
import { uid, today, getMonthKey, fmt, convert } from './format';
import { upcomingSchedules, isLoanEmiSchedule } from './recurring';
import { spendByCategoryInRange, spendByCategory } from './calculations';
import { getCat } from '../constants';
import { staleAccounts } from './accountsView';
import { roleLabel } from './permissions';
import type { MyInvitation, HouseholdInvitation } from './invitations';

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
  split_received:        { icon: '🤝', tint: 'var(--accent)', priority: 'P1' },
  split_settled:         { icon: '🤝', tint: 'var(--good)', priority: 'P2' },
  split_closed:          { icon: '🤝', tint: 'var(--ff-ink-3)', priority: 'P2' },
  invite_pending:        { icon: '⌂', tint: 'var(--info)', priority: 'P1' },
};

/** Settings grouping (Settings ▸ Notifications). */
export const NOTIF_GROUPS: { label: string; types: NotifType[] }[] = [
  { label: 'Money movement', types: ['recurring_due_confirm', 'recurring_reminder', 'recurring_posted', 'income_landed'] },
  { label: 'Budgets & debts', types: ['budget_threshold', 'debt_payment_due'] },
  { label: 'Insights',        types: ['insight_fresh', 'trend_alert', 'milestone'] },
  { label: 'Household',       types: ['invite_received', 'invite_pending', 'member_activity'] },
  { label: 'Splits',          types: ['split_received', 'split_settled', 'split_closed'] },
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
  split_received:        'Split shared with you',
  split_settled:         'Split settled',
  split_closed:          'Split closed',
  invite_pending:        'Invitation waiting',
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
  lockScreenDetails: true,
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
function daysUntil(dateStr: string, tz?: string | null): number {
  const d = new Date(dateStr + 'T00:00:00').getTime();
  const now = new Date(today(tz) + 'T00:00:00').getTime();
  return Math.round((d - now) / 86400000);
}
function relDate(dateStr: string, tz?: string | null): string {
  const n = daysUntil(dateStr, tz);
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
  /** W3a — the household's zone on the server; absent in the app (the device's day). */
  tz?: string | null;
}
function base(type: NotifType, dedupeKey: string, ctx: Ctx): Pick<Notification, 'id' | 'type' | 'priority' | 'status' | 'createdAt' | 'householdId' | 'dedupeKey'> {
  return { id: uid(), type, priority: NOTIF_META[type].priority, status: 'unread', createdAt: iso(), householdId: ctx.householdId, dedupeKey };
}

// ── Generators (wired types) ────────────────────────────────────────────────

/** 1 · recurring_due_confirm (P1) — due/overdue, active, auto-confirm OFF. */
export function recurringDueNotifs(schedules: RecurringSchedule[], prefs: NotificationPrefs, existing: Notification[], ctx: Ctx): Notification[] {
  if (!typeEnabled(prefs, 'recurring_due_confirm')) return [];
  const now = today(ctx.tz);
  const out: Notification[] = [];
  for (const s of schedules) {
    if (!s.active || s.autoConfirm || s.nextDueDate > now) continue;
    // Track E, E6a (owner, E-3): a leftover EMI schedule cannot be approved (the loan pays its EMI, and
    // the loan's own EMI-day reminder asks for it).
    if (isLoanEmiSchedule(s)) continue;
    const key = `recurring_due_confirm:${s.id}:${s.nextDueDate}`;
    if (existing.some(n => n.dedupeKey === key)) continue;
    const amt = s.transactionTemplate.amount ?? 0;
    out.push({
      ...base('recurring_due_confirm', key, ctx),
      title: `${s.transactionTemplate.description} · ${fmt(amt, ctx.baseCurrency)} — due ${relDate(s.nextDueDate, ctx.tz)}`,
      body: 'Auto-approve is off for this schedule',
      dueAt: s.nextDueDate, amountRef: amt, scheduleId: s.id,
      deepLink: `/recurring?id=${s.id}`,
      actions: [A('approve', 'Approve', 'primary'), A('skip', 'Skip once', 'neu'), A('edit', 'Edit schedule', 'ghost')],
    });
  }
  return out;
}

/**
 * W4d (audit FE-UIS-04, INT-TXN-13) — the occurrence a bill card is about, as YYYY-MM-DD. A card
 * read back from the cloud carries `due_at` as a timestamp ("2026-10-21T00:00:00+00:00"), which never
 * equalled the schedule's due date, so Approve quietly did nothing while saying it had posted.
 */
export function notificationOccurrence(n: Pick<Notification, 'dueAt'>): string | undefined {
  return n.dueAt ? n.dueAt.slice(0, 10) : undefined;
}

/**
 * Aurora 4.0 NT1 — a card waiting on the person: unread, action-required (P1) and carrying buttons.
 * The bell lists these as "Needs you" above Today and Earlier and keeps each one there until it is
 * handled, instead of letting a bill to approve fall into "Earlier" once a day passes.
 */
export function needsYou(n: Pick<Notification, 'status' | 'priority' | 'actions'>): boolean {
  return n.status === 'unread' && n.priority === 'P1' && (n.actions?.length ?? 0) > 0;
}

/**
 * W4d — unread "approve this bill" cards whose bill was already handled: approved or skipped in the
 * app, "paid X" on WhatsApp, another member, or the schedule paused. Its schedule has moved past the
 * card's occurrence. A card whose schedule this device does not hold is left alone (it may simply not
 * have loaded yet).
 */
export function resolvedBillCards(notifications: Notification[], schedules: RecurringSchedule[]): string[] {
  const byId = new Map(schedules.map(s => [s.id, s]));
  return notifications
    .filter(n => n.type === 'recurring_due_confirm' && n.status === 'unread' && n.scheduleId)
    .filter(n => {
      const s = byId.get(n.scheduleId!);
      const occurrence = notificationOccurrence(n);
      // E6a: a card for a leftover EMI schedule is settled too — that schedule is retired (E-3).
      return !!s && (s.active === false || isLoanEmiSchedule(s) || (!!occurrence && s.nextDueDate > occurrence));
    })
    .map(n => n.id);
}

/** 2 · recurring_reminder (P2) — lead-time reminder for upcoming schedules. */
export function recurringReminderNotifs(schedules: RecurringSchedule[], prefs: NotificationPrefs, existing: Notification[], ctx: Ctx): Notification[] {
  if (!typeEnabled(prefs, 'recurring_reminder')) return [];
  const out: Notification[] = [];
  for (const s of schedules) {
    if (isLoanEmiSchedule(s)) continue;   // E6a: the loan reminds about its own EMI
    const lead = s.reminderLeadDays ?? prefs.defaultLeadDays;
    if (!upcomingSchedules([s], lead, today(ctx.tz)).length) continue;
    const key = `recurring_reminder:${s.id}:${s.nextDueDate}`;
    if (existing.some(n => n.dedupeKey === key)) continue;
    const amt = s.transactionTemplate.amount ?? 0;
    out.push({
      ...base('recurring_reminder', key, ctx),
      title: `${s.transactionTemplate.description} · ${fmt(amt, ctx.baseCurrency)} — ${relDate(s.nextDueDate, ctx.tz)}`,
      body: 'Upcoming recurring charge',
      dueAt: s.nextDueDate, amountRef: amt, scheduleId: s.id,
      deepLink: `/recurring?id=${s.id}`,
      actions: [A('view', 'View schedule', 'neu')],
    });
  }
  return out;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** One budget line at or past a threshold today: what the bell and WhatsApp both say about it. */
export interface BudgetThresholdLine {
  budgetId: string;
  category: string;
  /** The budget's own period (a legacy single-category budget: the current month). */
  start: string;
  end: string;
  /** 'April' for a month, '2026' for a year. */
  period: string;
  limit: number;
  spent: number;
  /** spent ÷ limit, unrounded (the threshold is read on it; a figure shown is rounded once). */
  share: number;
  threshold: 80 | 100;
}

/**
 * 4 · budget_threshold (P1) — a budget LINE crosses 80% / 100% of its allocation.
 *
 * v10.48.0 (TD-39) — since v9.1 a budget is a period container whose categories live
 * in `BudgetAllocation` rows; the budget itself has no `category`. This rule used to
 * read `b.category`, so for every current budget it looked up spend for '' and never
 * fired (production had zero budget_threshold notifications). It now checks each
 * allocation over the budget's own period with the Budgets screen's figure
 * (`spendByCategoryInRange` in base currency). A legacy single-category budget (no
 * allocations) is still checked as one line for the current month.
 *
 * T5c (v10.122.0; audit XC-ARC-06) — THE budget-threshold rule, for the bell, push and WhatsApp alike.
 * Every line of every budget whose period holds today, at or past 80% of its limit, measured over that
 * budget's own period in base currency. WhatsApp kept its own copy of the 80% rule until v10.122.0 and
 * now reads these lines through the bundled engine (`serverEngine.budgetLinesOnServer`).
 */
export function budgetThresholdLines(
  budgets: Budget[], allocations: BudgetAllocation[], txns: Transaction[],
  ctx: Pick<Ctx, 'baseCurrency' | 'rates'>, now: string,
): BudgetThresholdLine[] {
  const out: BudgetThresholdLine[] = [];
  const cur = ctx.baseCurrency;
  for (const b of budgets) {
    const own = allocations.filter(a => a.budgetId === b.id);
    let start = b.periodStart, end = b.periodEnd;
    const lines: { category: string; limit: number }[] = own.length
      ? own.map(a => ({ category: a.category, limit: convert(a.amount, b.currency, cur, ctx.rates) }))
      : b.category ? [{ category: b.category, limit: convert(b.limit, b.currency, cur, ctx.rates) }] : [];
    if (!own.length && (!start || !end)) {            // legacy: the current month
      const mk = getMonthKey(now);
      start = `${mk}-01`;
      // T5c — its real last day (WhatsApp counts the days left to it), not "-31" in a 30-day month.
      end = new Date(Date.UTC(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)), 0)).toISOString().slice(0, 10);
    }
    if (!lines.length || !start || !end || start > now || end < now) continue;
    const spend = spendByCategoryInRange(txns, start, end, cur, ctx.rates);
    const period = b.scope === 'annual' ? `${b.periodYear ?? start.slice(0, 4)}`
      : MONTH_NAMES[Number(start.slice(5, 7)) - 1] ?? start.slice(0, 7);
    for (const line of lines) {
      if (!(line.limit > 0)) continue;
      const spent = spend[line.category] || 0;
      const share = spent / line.limit;
      const threshold: 80 | 100 | null = share >= 1 ? 100 : share >= 0.8 ? 80 : null;
      if (!threshold) continue;
      out.push({ budgetId: b.id, category: line.category, start, end, period, limit: line.limit, spent, share, threshold });
    }
  }
  return out;
}

export function budgetThresholdNotifs(
  budgets: Budget[], allocations: BudgetAllocation[], txns: Transaction[],
  prefs: NotificationPrefs, existing: Notification[], ctx: Ctx, now: string = today(ctx.tz),
): Notification[] {
  if (!typeEnabled(prefs, 'budget_threshold')) return [];
  const out: Notification[] = [];
  const cur = ctx.baseCurrency;
  for (const line of budgetThresholdLines(budgets, allocations, txns, ctx, now)) {
    const key = `budget_threshold:${line.budgetId}:${line.category}:${line.start}:${line.threshold}`;
    if (existing.some(n => n.dedupeKey === key)) continue;
    const remaining = Math.max(0, line.limit - line.spent);
    out.push({
      ...base('budget_threshold', key, ctx),
      tint: line.threshold === 100 ? 'var(--crit)' : 'var(--warn)',
      title: `${getCat(line.category).label} at ${Math.round(line.share * 100)}% of the ${line.period} budget`,
      body: line.spent > line.limit ? `${fmt(line.spent - line.limit, cur)} over` : `${fmt(remaining, cur)} left`,
      budgetId: line.budgetId, amountRef: remaining,
      deepLink: `/budgets?budgetId=${line.budgetId}`,
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
    // W4g (D19): the loan's NEXT EMI date (pay_loan moves it on); a paid-off loan has none.
    if (d.direction === 'owed_to_me' || !d.dueDate || d.currentBalance <= 0 || d.paidOffAt) continue;
    const n = daysUntil(d.dueDate, ctx.tz);
    if (n < 0 || n > 3) continue;
    const key = `debt_payment_due:${d.id}:${d.dueDate}`;
    if (existing.some(x => x.dedupeKey === key)) continue;
    const amt = d.minimumPayment ?? 0;
    out.push({
      ...base('debt_payment_due', key, ctx),
      title: `${d.name} payment · ${fmt(amt, ctx.baseCurrency)} — due ${relDate(d.dueDate, ctx.tz)}`,
      body: d.autoRecord ? 'Vyact records this EMI on the day' : 'EMI coming up',
      dueAt: d.dueDate, amountRef: amt, debtId: d.id,
      deepLink: `/debts?debtId=${d.id}`,
      actions: d.autoRecord
        ? [A('view', 'View loan', 'ghost')]
        : [A('record', 'Record payment', 'primary'), A('view', 'View loan', 'ghost')],
    });
  }
  return out;
}

/** 5 · income_landed (P2) — income transaction posted today. */
export function incomeLandedNotifs(txns: Transaction[], prefs: NotificationPrefs, existing: Notification[], ctx: Ctx): Notification[] {
  if (!typeEnabled(prefs, 'income_landed')) return [];
  const now = today(ctx.tz);
  const out: Notification[] = [];
  for (const t of txns) {
    if (t.type !== 'income' || t.date !== now) continue;
    const key = `income_landed:${t.id}`;
    if (existing.some(n => n.dedupeKey === key)) continue;
    out.push({
      ...base('income_landed', key, ctx),
      title: `${t.description || 'Income'} landed — +${fmt(t.amount, ctx.baseCurrency)}`,
      body: 'Money in',
      amountRef: t.amount, txnId: t.id,
      deepLink: `/transactions?id=${t.id}`,
      actions: [A('view', 'View', 'neu')],
    });
  }
  return out;
}

/** 9 · stale_balance (P1) — bank, card and cash balances not checked in 30 days (aggregated, ≤1/wk). */
export function staleBalanceNotifs(accounts: Account[], prefs: NotificationPrefs, existing: Notification[], ctx: Ctx): Notification[] {
  if (!typeEnabled(prefs, 'stale_balance')) return [];
  // W8a (audit INT-PAR-05): the one stale rule (lib/accountsView.ts) — bank, card and cash, by the last
  // check, else creation. A just-added account is not "out of date".
  const stale = staleAccounts(accounts, new Date());
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

// ── v10.107.0 — Pip's proactive nudges ──────────────────────────────────────
//
// Pip speaks first only when something is worth knowing, and rarely: at most PIP_NUDGE_DAILY_CAP a
// day and PIP_NUDGE_WEEKLY_CAP a week across every kind, P2 (in the bell, never pushed), each with
// its own switch in Settings › Notifications ("fewer like this" is turning that kind off). A nudge
// opens Pip with its question in the field (/chat?ask=…); nothing is asked or sent for the person.
// Every figure is computed here from the ledger, the same way the Transactions page totals it.

export const PIP_NUDGE_DAILY_CAP = 1;
export const PIP_NUDGE_WEEKLY_CAP = 3;
/** A category nudge needs it to be this much above a WHOLE usual month already, and at least 2 months of history. */
export const TREND_NUDGE_RATIO = 1.25;
const PIP_NUDGE_PREFIX = 'pip:';

const askPip = (question: string) => `/chat?ask=${encodeURIComponent(question)}`;

/** How many more Pip nudges may be raised now (0 when the day's or the week's are used). */
export function pipNudgeRoom(existing: Notification[], nowMs = Date.now()): number {
  const pip = existing.filter(n => n.dedupeKey?.startsWith(PIP_NUDGE_PREFIX));
  const startOfDay = new Date(nowMs); startOfDay.setHours(0, 0, 0, 0);
  const today_ = pip.filter(n => Date.parse(n.createdAt) >= startOfDay.getTime()).length;
  const week = pip.filter(n => Date.parse(n.createdAt) >= nowMs - 7 * 86_400_000).length;
  return Math.max(0, Math.min(PIP_NUDGE_DAILY_CAP - today_, PIP_NUDGE_WEEKLY_CAP - week));
}

/**
 * trend_alert — a category that has ALREADY gone past a whole usual month, this month. Compared with a
 * whole month (not a pro-rated one), so the sentence is true whatever day it is: nothing is projected.
 * The largest such gap only; once per category per month.
 */
function categoryTrendNudge(txns: Transaction[], existing: Notification[], ctx: Ctx, now: string): Notification | null {
  const month = getMonthKey(now);
  const history = [...new Set(txns.map(t => getMonthKey(t.date)))].filter(m => m < month).sort().slice(-3);
  if (history.length < 2) return null;
  const nowSpend = spendByCategory(txns, month, ctx.baseCurrency, ctx.rates);
  const past = history.map(m => spendByCategory(txns, m, ctx.baseCurrency, ctx.rates));
  let best: { category: string; spent: number; usual: number } | null = null;
  for (const [category, spent] of Object.entries(nowSpend)) {
    // Loan payments run on their own schedule; a prepayment is a decision, not a trend.
    if (category === 'loan_emi') continue;
    const usual = past.reduce((s, p) => s + (p[category] || 0), 0) / history.length;
    if (!(usual > 0) || spent < usual * TREND_NUDGE_RATIO) continue;
    if (existing.some(n => n.dedupeKey === `${PIP_NUDGE_PREFIX}trend:${category}:${month}`)) continue;
    if (!best || spent - usual > best.spent - best.usual) best = { category, spent, usual };
  }
  if (!best) return null;
  const label = getCat(best.category).label;
  return {
    ...base('trend_alert', `${PIP_NUDGE_PREFIX}trend:${best.category}:${month}`, ctx),
    title: `${label} is already above a usual month`,
    body: `${fmt(Math.round(best.spent), ctx.baseCurrency)} so far, against ${fmt(Math.round(best.usual), ctx.baseCurrency)} in a usual month`,
    amountRef: Math.round(best.spent),
    deepLink: askPip(`Why is my ${label.toLowerCase()} spending so high?`),
    actions: [A('ask_pip', 'Ask Pip why', 'primary')],
  };
}

/** insight_fresh — in the first five days of a month, last month's review is ready (once per month). */
function monthReviewNudge(txns: Transaction[], existing: Notification[], ctx: Ctx, now: string): Notification | null {
  if (Number(now.slice(8, 10)) > 5) return null;
  const [y, m] = getMonthKey(now).split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const prevKey = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
  const key = `${PIP_NUDGE_PREFIX}review:${prevKey}`;
  if (existing.some(n => n.dedupeKey === key)) return null;
  if (!txns.some(t => getMonthKey(t.date) === prevKey)) return null;
  return {
    ...base('insight_fresh', key, ctx),
    title: `Your ${MONTH_NAMES[prev.getUTCMonth()]} review is ready`,
    body: 'What came in, what went out and what moved',
    deepLink: askPip('Give me a review of last month.'),
    actions: [A('ask_pip', 'Ask Pip', 'primary')],
  };
}

/** Pip's nudges for this refresh, most useful first, within the day's and the week's allowance. */
export function pipNudgeNotifs(
  txns: Transaction[], prefs: NotificationPrefs, existing: Notification[], ctx: Ctx,
  now: string = today(ctx.tz), nowMs = Date.now(),
): Notification[] {
  const room = pipNudgeRoom(existing, nowMs);
  if (room <= 0) return [];
  const candidates = [
    typeEnabled(prefs, 'trend_alert') ? categoryTrendNudge(txns, existing, ctx, now) : null,
    typeEnabled(prefs, 'insight_fresh') ? monthReviewNudge(txns, existing, ctx, now) : null,
  ].filter((n): n is Notification => n !== null);
  return candidates.slice(0, room);
}

/** 14 · split_settled (P2, owner-facing) — a participant self-settled their
 *  share via settle_share() (settled_user_id set — distinguishes it from the
 *  owner marking a row paid themselves, which sets no settled_user_id). */
export function splitSettledNotifs(owned: SharedSplit[], prefs: NotificationPrefs, existing: Notification[], ctx: Ctx): Notification[] {
  if (!typeEnabled(prefs, 'split_settled')) return [];
  const out: Notification[] = [];
  for (const sp of owned) {
    for (const sh of sp.shares) {
      if (!sh.paid || !sh.settledUserId) continue;
      const key = `split_settled:${sh.id}`;
      if (existing.some(n => n.dedupeKey === key)) continue;
      out.push({
        ...base('split_settled', key, ctx),
        title: `${sh.email} settled their share of "${sp.description}"`,
        body: `${fmt(sh.share, sp.currency)} settled`,
        amountRef: sh.share, splitId: sp.id,
        deepLink: `/splits?splitId=${sp.id}`,
        actions: [A('view', 'View split', 'neu')],
      });
    }
  }
  return out;
}

/** 14 · split_received (P1, participant-facing) — a split was shared with the
 *  caller's email. Fires once per split (until they settle or it's closed) so
 *  they see it in the bell, not only by visiting the Splits page. */
export function splitReceivedNotifs(withMe: SharedSplit[], myEmail: string | undefined, prefs: NotificationPrefs, existing: Notification[], ctx: Ctx): Notification[] {
  if (!typeEnabled(prefs, 'split_received') || !myEmail) return [];
  const email = myEmail.toLowerCase();
  const out: Notification[] = [];
  for (const sp of withMe) {
    if (sp.closedAt) continue;
    const mine = sp.shares.find(s => s.email.toLowerCase() === email);
    if (!mine || mine.paid) continue;
    const key = `split_received:${sp.id}`;
    if (existing.some(n => n.dedupeKey === key)) continue;
    out.push({
      ...base('split_received', key, ctx),
      title: `${sp.description || 'A split'} was shared with you`,
      body: `Your share is ${fmt(mine.share, sp.currency)}`,
      amountRef: mine.share, splitId: sp.id,
      deepLink: `/splits?splitId=${sp.id}`,
      actions: [A('settle', 'Settle my share', 'primary'), A('view', 'View split', 'ghost')],
    });
  }
  return out;
}

/** 16 · split_closed (P2, participant-facing) — the owner closed a split the
 *  caller is a participant in. */
export function splitClosedNotifs(withMe: SharedSplit[], prefs: NotificationPrefs, existing: Notification[], ctx: Ctx): Notification[] {
  if (!typeEnabled(prefs, 'split_closed')) return [];
  const out: Notification[] = [];
  for (const sp of withMe) {
    if (!sp.closedAt) continue;
    const key = `split_closed:${sp.id}`;
    if (existing.some(n => n.dedupeKey === key)) continue;
    out.push({
      ...base('split_closed', key, ctx),
      title: `"${sp.description}" was marked closed`,
      body: 'The owner closed this shared split',
      splitId: sp.id,
      deepLink: `/splits?splitId=${sp.id}`,
      actions: [A('view', 'View split', 'neu')],
    });
  }
  return out;
}

// ── Household invitations (v10.95.0, #9; owner decisions 13 Oct 2026) ─────────
// Built on the device from live invitation lists on every render and NEVER saved: the notifications
// table is readable by every member of the open household, and an invitee's card would tell them which
// other household invited this person. A card disappears as soon as its invitation is answered, revoked
// or expires, so there is nothing to dedupe or resolve. (No lock-screen push: that reads the table.)

const expiryDay = (iso: string) => iso.slice(0, 10);

/** invite_received (P1, invitee-facing) — Join / Decline, whichever household is open. */
export function invitationReceivedNotifs(invites: MyInvitation[], prefs: NotificationPrefs, now = Date.now()): Notification[] {
  if (!typeEnabled(prefs, 'invite_received')) return [];
  return invites
    .filter(i => new Date(i.expiresAt).getTime() > now)
    .map(i => ({
      id: `invite_received:${i.id}`,
      type: 'invite_received' as const,
      priority: NOTIF_META.invite_received.priority,
      status: 'unread' as const,
      createdAt: i.createdAt,
      dedupeKey: `invite_received:${i.id}`,
      invitationId: i.id,
      title: `${i.invitedByName} invited you to ${i.householdName}`,
      body: `Join as ${roleLabel(i.role as AppRole)}. The invitation expires on ${expiryDay(i.expiresAt)}.`,
      actions: [A('join', 'Join', 'primary'), A('decline', 'Decline', 'ghost')],
    }));
}

/** invite_pending (P1, owner/admin-facing) — each open invitation of the open household, with Revoke. */
export function invitationPendingNotifs(invites: HouseholdInvitation[], prefs: NotificationPrefs, householdId: string, now = Date.now()): Notification[] {
  if (!typeEnabled(prefs, 'invite_pending')) return [];
  return invites
    .filter(i => i.householdId === householdId && new Date(i.expiresAt).getTime() > now)
    .map(i => ({
      id: `invite_pending:${i.id}`,
      type: 'invite_pending' as const,
      priority: NOTIF_META.invite_pending.priority,
      status: 'unread' as const,
      createdAt: i.createdAt,
      householdId,
      dedupeKey: `invite_pending:${i.id}`,
      invitationId: i.id,
      title: i.recipientEmail ? `Invitation to ${i.recipientEmail} is waiting` : 'An invitation link is waiting',
      body: `${roleLabel(i.role as AppRole)} access. Expires on ${expiryDay(i.expiresAt)}.`,
      actions: [A('revoke', 'Revoke', 'ghost')],
    }));
}

// ── What a notification says outside the app (v10.126.0, T4c; audit BE-FN-12) ─
// Owner, 19 Oct 2026: "show by default, and hide via settings". With Settings → Notifications → "Show details
// on the lock screen" off, a device's pushes (from the server, and the open app's own popups) say only what
// kind of thing needs a look: no amount, payee, account, person or household name. The server reads this
// table through the bundled engine (serverEngine.lockScreenTextOnServer), so the two never differ. Every type
// has its line (a Record, so a new type does not compile without one).
const PRIVATE_TEXT: Record<NotifType, { title: string; body: string }> = {
  recurring_due_confirm: { title: 'A bill is due', body: 'Open Vyact to approve or skip it.' },
  recurring_reminder:    { title: 'A bill is coming up', body: 'Open Vyact to see it.' },
  recurring_posted:      { title: 'A bill was recorded', body: 'Open Vyact to see it.' },
  debt_payment_due:      { title: 'A loan payment is due', body: 'Open Vyact to see it.' },
  budget_threshold:      { title: 'A budget needs a look', body: 'Open Vyact to see which one.' },
  stale_balance:         { title: 'A balance needs a check', body: 'Open Vyact to update it.' },
  income_landed:         { title: 'Money came in', body: 'Open Vyact to see it.' },
  insight_fresh:         { title: 'A new insight is ready', body: 'Open Vyact to see it.' },
  trend_alert:           { title: 'Your spending needs a look', body: 'Open Vyact to see it.' },
  member_activity:       { title: 'New activity in your household', body: 'Open Vyact to see it.' },
  milestone:             { title: 'A milestone was reached', body: 'Open Vyact to see it.' },
  split_received:        { title: 'A split was shared with you', body: 'Open Vyact to see it.' },
  split_settled:         { title: 'A split share was settled', body: 'Open Vyact to see it.' },
  split_closed:          { title: 'A split was closed', body: 'Open Vyact to see it.' },
  invite_received:       { title: "You're invited to a household", body: 'Open Vyact to see it.' },
  invite_pending:        { title: 'An invitation is waiting', body: 'Open Vyact to see it.' },
  sync_conflict:         { title: 'A change needs your attention', body: 'Open Vyact to review it.' },
};
const PRIVATE_FALLBACK = { title: 'Vyact', body: 'You have a new notification. Open Vyact to see it.' };

/** The private title and body for a notification type: what it is about, never its amounts or names. */
export function lockScreenText(type: string): { title: string; body: string } {
  return Object.prototype.hasOwnProperty.call(PRIVATE_TEXT, type) ? PRIVATE_TEXT[type as NotifType] : PRIVATE_FALLBACK;
}

/** What this device shows for a notification: its own words, or the private line when details are off. */
export function deviceNotificationText(
  n: { type: string; title: string; body?: string | null }, prefs: Pick<NotificationPrefs, 'lockScreenDetails'>,
): { title: string; body: string } {
  return prefs.lockScreenDetails === false ? lockScreenText(n.type) : { title: n.title, body: n.body ?? '' };
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
