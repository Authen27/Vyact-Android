// Vyact v7 — Notification engine
// Generates notifications from app state. Six types per the PRD.
// Web Push is delegated to a service worker (public/sw.js).

import type {
  Notification, NotificationPrefs, RecurringSchedule, Transaction,
  Budget, Goal, ExchangeRates,
} from '../types';
import { uid, today, getMonthKey } from './format';
import { upcomingSchedules } from './recurring';
import { spendByCategory } from './calculations';

export const DEFAULT_PREFS: NotificationPrefs = {
  master: true,
  upcoming_bill: true,
  missed_payment: true,
  budget_threshold: false,
  goal_milestone: true,
  weekly_digest: false,
  custom_reminder: true,
  quietStart: '22:00',
  quietEnd: '07:00',
  webPushEnabled: false,
  defaultLeadDays: 3,
};

export function isInQuietHours(prefs: NotificationPrefs, now = new Date()): boolean {
  const hh = now.getHours();
  const mm = now.getMinutes();
  const cur = hh * 60 + mm;
  const [qsH, qsM] = prefs.quietStart.split(':').map(Number);
  const [qeH, qeM] = prefs.quietEnd.split(':').map(Number);
  const start = qsH * 60 + qsM;
  const end = qeH * 60 + qeM;
  return start > end
    ? cur >= start || cur < end          // wraps midnight
    : cur >= start && cur < end;
}

// Build upcoming-bill notifications for schedules due within lead window
export function upcomingBillNotifs(
  schedules: RecurringSchedule[],
  prefs: NotificationPrefs,
  existing: Notification[],
): Notification[] {
  if (!prefs.master || !prefs.upcoming_bill) return [];
  const out: Notification[] = [];
  for (const s of schedules) {
    const lead = s.reminderLeadDays ?? prefs.defaultLeadDays;
    const upcoming = upcomingSchedules([s], lead);
    if (!upcoming.length) continue;
    // Skip if we've already notified for this scheduleId on this dueDate
    const already = existing.find(n =>
      n.type === 'upcoming_bill' && n.scheduleId === s.id && n.dueAt === s.nextDueDate
    );
    if (already) continue;
    out.push({
      id: uid(),
      type: 'upcoming_bill',
      title: `Upcoming · ${s.transactionTemplate.description}`,
      body: `Due in ${lead} day${lead === 1 ? '' : 's'} on ${s.nextDueDate}`,
      createdAt: new Date().toISOString(),
      dueAt: s.nextDueDate,
      status: 'unread',
      scheduleId: s.id,
    });
  }
  return out;
}

// Missed-payment: schedule's nextDueDate has passed and no matching transaction logged
export function missedPaymentNotifs(
  schedules: RecurringSchedule[],
  prefs: NotificationPrefs,
  existing: Notification[],
): Notification[] {
  if (!prefs.master || !prefs.missed_payment) return [];
  const out: Notification[] = [];
  const now = today();
  for (const s of schedules) {
    if (!s.active || s.nextDueDate >= now) continue;
    const already = existing.find(n =>
      n.type === 'missed_payment' && n.scheduleId === s.id && n.dueAt === s.nextDueDate
    );
    if (already) continue;
    out.push({
      id: uid(),
      type: 'missed_payment',
      title: `Missed · ${s.transactionTemplate.description}`,
      body: `Was due on ${s.nextDueDate}. Tap to record now.`,
      createdAt: new Date().toISOString(),
      dueAt: s.nextDueDate,
      status: 'unread',
      scheduleId: s.id,
    });
  }
  return out;
}

// Budget threshold notifications — fires at 80% and 100%
export function budgetThresholdNotifs(
  budgets: Budget[], txns: Transaction[], prefs: NotificationPrefs,
  existing: Notification[], baseCurrency: string, rates: ExchangeRates,
): Notification[] {
  if (!prefs.master || !prefs.budget_threshold) return [];
  const out: Notification[] = [];
  const mk = getMonthKey(today());
  const spend = spendByCategory(txns, mk, baseCurrency, rates);
  for (const b of budgets) {
    const limitBase = b.limit * (rates[b.currency] / rates[baseCurrency] || 1);
    const spent = spend[b.category ?? ''] || 0;
    const pct = limitBase > 0 ? spent / limitBase : 0;
    const threshold: 80 | 100 | null = pct >= 1 ? 100 : pct >= 0.8 ? 80 : null;
    if (!threshold) continue;
    const already = existing.find(n =>
      n.type === 'budget_threshold' && n.budgetId === b.id && n.body.includes(`${threshold}%`)
    );
    if (already) continue;
    out.push({
      id: uid(),
      type: 'budget_threshold',
      title: threshold === 100 ? `Budget exceeded` : `Budget at 80%`,
      body: `${b.category} · ${threshold}% of monthly limit`,
      createdAt: new Date().toISOString(),
      status: 'unread',
      budgetId: b.id,
    });
  }
  return out;
}

// Goal milestone — 25 / 50 / 75 / 100
export function goalMilestoneNotifs(
  goals: Goal[], prefs: NotificationPrefs, existing: Notification[]
): Notification[] {
  if (!prefs.master || !prefs.goal_milestone) return [];
  const out: Notification[] = [];
  for (const g of goals) {
    if (g.target <= 0) continue;
    const pct = Math.floor((g.current / g.target) * 100);
    const tier = pct >= 100 ? 100 : pct >= 75 ? 75 : pct >= 50 ? 50 : pct >= 25 ? 25 : null;
    if (!tier) continue;
    const already = existing.find(n =>
      n.type === 'goal_milestone' && n.goalId === g.id && n.body.includes(`${tier}%`)
    );
    if (already) continue;
    out.push({
      id: uid(),
      type: 'goal_milestone',
      title: tier === 100 ? `🎉 Goal complete · ${g.name}` : `${tier}% milestone · ${g.name}`,
      body: tier === 100 ? `You did it. ${g.name} fully funded.` : `You hit ${tier}% of your target.`,
      createdAt: new Date().toISOString(),
      status: 'unread',
      goalId: g.id,
    });
  }
  return out;
}

// Web Push helper — delegates to the service worker
export async function showWebPush(title: string, body: string): Promise<void> {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: title,
    });
  } catch (e) {
    console.warn('Web Push failed:', e);
  }
}

export async function requestWebPushPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}
