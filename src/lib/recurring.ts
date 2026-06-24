// Vyact v7 — Recurring schedule engine
// Handles weekly / monthly / yearly / custom-day-of-month schedules.
// Computes next-due-date and generates pending transactions when due.

import type { RecurringSchedule, RecurrenceFreq, Transaction } from '../types';
import { today } from './format';

const DAY_MS = 86_400_000;

// R2 (sync fix): deterministic instance id.
// A materialised recurring instance must get the SAME id on every device for a
// given (schedule, occurrence-date) so that two devices generating the same due
// occurrence upsert the SAME cloud row instead of inserting two — the multi-
// device "duplicate transaction" bug. We derive a stable UUIDv8 from the seed
// via cyrb128, so no randomness and no DB round-trip is needed.
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
/** Stable UUIDv8 (RFC 9562) derived from a seed string. Same seed → same id. */
export function deterministicUuid(seed: string): string {
  const [a, b, c, d] = cyrb128(seed);
  const h = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  let hex = h(a) + h(b) + h(c) + h(d);
  // version 8 (custom) in the 13th nibble; RFC-4122 variant in the 17th.
  hex = hex.slice(0, 12) + '8' + hex.slice(13);
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  hex = hex.slice(0, 16) + variant + hex.slice(17);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
/** The deterministic id a given schedule occurrence will always materialise as. */
export function recurringInstanceId(scheduleId: string, occurrenceDate: string): string {
  return deterministicUuid(`vyact:recur:${scheduleId}:${occurrenceDate}`);
}

export function scheduleFiresOnDate(schedule: RecurringSchedule, date: string): boolean {
  if (schedule.active === false) return false;
  if (schedule.startDate && date < schedule.startDate) return false;

  const [, startMonth, startDay] = (schedule.startDate || date).split('-').map(Number);
  const [, viewMonth] = date.split('-').map(Number);
  const dayOfMonth = Number(date.slice(-2));

  switch (schedule.frequency) {
    case 'daily': {
      const diff = Math.round((Date.parse(date) - Date.parse(schedule.startDate)) / DAY_MS);
      return diff >= 0;
    }
    case 'weekly': {
      const diff = Math.round((Date.parse(date) - Date.parse(schedule.startDate)) / DAY_MS);
      return diff >= 0 && diff % 7 === 0;
    }
    case 'monthly':
    case 'custom_day':
      return dayOfMonth === (schedule.dayOfMonth || startDay);
    case 'yearly':
      return viewMonth === startMonth && dayOfMonth === startDay;
    default:
      return false;
  }
}

export function projectRecurringTransactionsForDate(
  schedules: RecurringSchedule[],
  date: string,
): Transaction[] {
  return schedules
    .filter(schedule => scheduleFiresOnDate(schedule, date))
    .map((schedule) => {
      const recurring = schedule.frequency === 'custom_day' ? 'monthly' : schedule.frequency;
      return {
        ...schedule.transactionTemplate,
        id: `projected-${schedule.id}-${date}`,
        date,
        note: schedule.autoConfirm
          ? 'Projected recurring transaction'
          : 'Projected recurring transaction · pending confirm',
        recurring,
      };
    });
}

export function computeNextDueDate(
  freq: RecurrenceFreq,
  startDate: string,
  lastGenerated?: string,
  dayOfMonth?: number,
  weekday?: number,
): string {
  const base = new Date(lastGenerated || startDate);
  const next = new Date(base);
  if (freq === 'daily') {
    next.setDate(next.getDate() + 1);
  } else if (freq === 'weekly') {
    next.setDate(next.getDate() + 7);
    if (weekday !== undefined) {
      const diff = (weekday - next.getDay() + 7) % 7;
      next.setDate(next.getDate() + diff);
    }
  } else if (freq === 'monthly') {
    next.setMonth(next.getMonth() + 1);
    if (dayOfMonth) next.setDate(dayOfMonth);
  } else if (freq === 'yearly') {
    next.setFullYear(next.getFullYear() + 1);
  } else if (freq === 'custom_day') {
    next.setMonth(next.getMonth() + 1);
    if (dayOfMonth) next.setDate(dayOfMonth);
  }
  return next.toISOString().split('T')[0];
}

// Returns schedules that are due now or in the past — they need transactions generated
export function dueSchedules(schedules: RecurringSchedule[], now = today()): RecurringSchedule[] {
  return schedules.filter(s => s.active && s.nextDueDate <= now);
}

// Returns schedules upcoming within `leadDays` — for upcoming-bill notifications
export function upcomingSchedules(schedules: RecurringSchedule[], leadDays = 3, now = today()): RecurringSchedule[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + leadDays);
  const cutoffISO = cutoff.toISOString().split('T')[0];
  return schedules.filter(s => s.active && s.nextDueDate <= cutoffISO && s.nextDueDate > now);
}

// Generate a transaction draft from a schedule on its due date
export function generateTransaction(schedule: RecurringSchedule): Transaction {
  return {
    ...schedule.transactionTemplate,
    // R2 (sync fix): deterministic id keyed on (schedule, occurrence-date) so a
    // concurrent generation on another device upserts the same row, not a dupe.
    id: recurringInstanceId(schedule.id, schedule.nextDueDate),
    date: schedule.nextDueDate,
    recurring: schedule.frequency === 'custom_day' ? 'monthly' : schedule.frequency,
    // v9.1 §5 — materialised instances link back to their template and are
    // attributed to the schedule's owner member.
    recurringScheduleId: schedule.id,
    memberId: schedule.ownerMemberId ?? schedule.transactionTemplate.memberId,
    initiatedBy: schedule.ownerMemberId ?? schedule.transactionTemplate.initiatedBy,
  } as Transaction;
}

// v9.1 §5.2 — compose an RFC-5545 RRULE string from the form's simple inputs.
// quarterly is encoded as monthly-interval-3 (the standard). COUNT and UNTIL are
// mutually exclusive; 'never' yields an open-ended rule.
export function buildRRule(
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly',
  ends: { kind: 'never' } | { kind: 'count'; count: number } | { kind: 'until'; date: string },
): string {
  const base =
    frequency === 'daily'     ? 'FREQ=DAILY;INTERVAL=1' :
    frequency === 'weekly'    ? 'FREQ=WEEKLY;INTERVAL=1' :
    frequency === 'quarterly' ? 'FREQ=MONTHLY;INTERVAL=3' :
    frequency === 'yearly'    ? 'FREQ=YEARLY;INTERVAL=1' :
                                'FREQ=MONTHLY;INTERVAL=1';
  if (ends.kind === 'count') return `${base};COUNT=${ends.count}`;
  if (ends.kind === 'until') return `${base};UNTIL=${ends.date.replace(/-/g, '')}`;
  return base;
}

// After generating, advance the schedule
export function advanceSchedule(schedule: RecurringSchedule): RecurringSchedule {
  const lastGenerated = schedule.nextDueDate;
  return {
    ...schedule,
    lastGenerated,
    nextDueDate: computeNextDueDate(
      schedule.frequency,
      schedule.startDate,
      lastGenerated,
      schedule.dayOfMonth,
      schedule.weekday,
    ),
  };
}

// v7.3 — Backfill RecurringSchedule rows from legacy transactions whose
// `recurring` field is set but never produced a schedule (e.g. txns added
// before v7.0 mirrored every recurring row into a schedule, or rows
// imported from another tool). The Recurring page and the Transactions
// calendar both read from `recurringSchedules`, not `transaction.recurring`,
// so without this backfill those legacy rows show up nowhere as future cost.
export interface BackfillResult {
  schedules: RecurringSchedule[];
  added: number;
}

export function backfillSchedulesFromTransactions(
  transactions: Transaction[],
  existing: RecurringSchedule[],
  now = today(),
): BackfillResult {
  const sigOf = (t: { type?: string; description?: string; recurring?: string; currency?: string }) =>
    `${t.type ?? ''}|${(t.description ?? '').trim().toLowerCase()}|${t.recurring ?? ''}|${t.currency ?? ''}`;

  const seen = new Set<string>();
  for (const s of existing) {
    seen.add(sigOf({
      type: s.transactionTemplate.type,
      description: s.transactionTemplate.description,
      recurring: s.frequency === 'custom_day' ? 'monthly' : s.frequency,
      currency: s.transactionTemplate.currency,
    }));
  }

  const buckets = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!t.recurring) continue;
    if (t.split?.isSplit) continue;
    if (t.category === 'transfer') continue;
    const sig = sigOf(t);
    if (seen.has(sig)) continue;
    const arr = buckets.get(sig) ?? [];
    arr.push(t);
    buckets.set(sig, arr);
  }

  const added: RecurringSchedule[] = [];
  for (const [, group] of buckets) {
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    const earliest = sorted[0];
    const latest = sorted[sorted.length - 1];
    const freq = earliest.recurring as RecurrenceFreq;
    if (freq !== 'weekly' && freq !== 'monthly' && freq !== 'yearly') continue;

    const [, , dd] = earliest.date.split('-').map(Number);
    const dayOfMonth = freq === 'monthly' ? dd : undefined;
    let nextDue = computeNextDueDate(freq, earliest.date, latest.date, dayOfMonth);
    while (nextDue <= now) {
      nextDue = computeNextDueDate(freq, earliest.date, nextDue, dayOfMonth);
    }

    const { id: _id, date: _date, ...template } = earliest;
    void _id; void _date;
    added.push({
      id: `bf-${earliest.id}`,
      transactionTemplate: template,
      frequency: freq,
      dayOfMonth,
      startDate: earliest.date,
      nextDueDate: nextDue,
      lastGenerated: latest.date,
      autoConfirm: true,
      active: true,
      reminderLeadDays: 3,
    });
  }

  return { schedules: [...existing, ...added], added: added.length };
}
