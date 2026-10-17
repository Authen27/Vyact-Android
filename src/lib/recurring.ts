// Vyact v7 — Recurring schedule engine
// Every date comes from the schedule's RRULE (W3e): daily, weekly by weekday, monthly by day or nth
// weekday, yearly, intervals, COUNT and UNTIL. Generates pending transactions when due.

import type { RecurringSchedule, RecurrenceFreq, Transaction } from '../types';
import { today, addDaysISO } from './format';
import { parseRRule, expandRRule, nextOccurrenceAfter, firstOccurrenceOnOrAfter, type RRule, type ShortMonthPolicy } from './rrule';

// ── ONE rule per schedule (W3e, v10.69.0; owner decision D13; audit FE-MNY-01, XC-ARC-01) ──────────
// Seven calculators used to disagree about a schedule's dates: the form's RRULE (never saved), the
// save-time clamp, the advance that overflowed month-ends (31 Jan → 3 Mar), the server's hand port,
// the projections, the bill calendar and the forecasts. Now every one of them reads the schedule's
// RRULE through `ruleOf`, with the schedule's own month-end rule, in UTC date-only maths.

type RuleSource = Pick<RecurringSchedule, 'frequency' | 'startDate'>
  & Partial<Pick<RecurringSchedule, 'rrule' | 'dayOfMonth' | 'weekday'>>;

/**
 * The schedule's rule: its RRULE, or one derived from its columns exactly as the database's
 * `recurrence_rrule_from_legacy` derives it (weekday 0 = Sunday).
 */
export function ruleOf(s: RuleSource): RRule {
  if (s.rrule && s.rrule.trim()) return parseRRule(s.rrule);
  const [y, m, d] = s.startDate.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  switch (s.frequency) {
    case 'daily':  return { freq: 'DAILY', interval: 1 };
    case 'weekly': return { freq: 'WEEKLY', interval: 1, byDay: [s.weekday ?? dow] };
    case 'yearly': return { freq: 'YEARLY', interval: 1, byMonth: [m], byMonthDay: [d] };
    default:       return { freq: 'MONTHLY', interval: 1, byMonthDay: [s.dayOfMonth ?? d] };
  }
}

/** The schedule's month-end rule (W3e). */
export const policyOf = (s: Partial<Pick<RecurringSchedule, 'shortMonthPolicy'>>): ShortMonthPolicy =>
  s.shortMonthPolicy ?? 'last_day';

/** The next occurrence strictly after `after`; null when the schedule's COUNT / UNTIL is used up. */
export function nextScheduleOccurrence(
  s: RuleSource & Partial<Pick<RecurringSchedule, 'shortMonthPolicy'>>, after: string,
): string | null {
  return nextOccurrenceAfter(ruleOf(s), s.startDate, after, { shortMonthPolicy: policyOf(s) });
}

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

/** Does this schedule fall due on `date`? Read from its rule (W3e) — weekdays, nth weekdays,
 *  intervals, COUNT and UNTIL included; it used to know only the simple frequencies. */
export function scheduleFiresOnDate(schedule: RecurringSchedule, date: string): boolean {
  if (schedule.active === false) return false;
  if (schedule.startDate && date < schedule.startDate) return false;
  return expandRRule(ruleOf(schedule), schedule.startDate, date, date, { shortMonthPolicy: policyOf(schedule) }).length > 0;
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

/**
 * The occurrence after `lastGenerated` (or the start) for a schedule described by its columns.
 * W3e: read from the derived rule, with the default month-end rule — it used to step with local-time
 * setters on a UTC-parsed date, so a 31st overflowed into the next month and skipped one (INT-TXN-04,
 * INT-PAR-02). Kept for callers that only hold the columns.
 */
export function computeNextDueDate(
  freq: RecurrenceFreq,
  startDate: string,
  lastGenerated?: string,
  dayOfMonth?: number,
  weekday?: number,
): string {
  const base = lastGenerated || startDate;
  return nextScheduleOccurrence({ frequency: freq, startDate, dayOfMonth, weekday }, base) ?? base;
}

/**
 * W4a (v10.70.0; owner decision D16) — does the SERVER post this schedule's occurrences?
 *
 * In cloud mode an auto-approved bill is posted by the `recurring-post` job, from the database's
 * own copy of the schedule, so a device with a stale cache can no longer post a bill that was
 * paused, edited or deleted elsewhere (audit INT-TXN-06, FE-SYN-02). It posts exactly the row the
 * app's engine would (`generateTransaction` → `txnToRow`, deterministic id).
 *
 * A loan EMI is not posted by the server: an EMI is an interest expense plus a principal transfer,
 * not one row, and the loan model that will post it (D19) is not built yet. Those schedules keep
 * the app's existing behaviour until then.
 */
export function serverPostsSchedule(s: Pick<RecurringSchedule, 'autoConfirm' | 'transactionTemplate'>): boolean {
  const t = s.transactionTemplate ?? ({} as RecurringSchedule['transactionTemplate']);
  return !!s.autoConfirm
    && (t.type === 'expense' || t.type === 'income' || t.type === 'transfer' || t.type === 'investment')
    && !isLoanEmiSchedule(s);
}

/**
 * W4f (v10.75.0; owner decision D19) — a schedule that pays a loan. An EMI is paid by `pay_loan` (an
 * interest expense + a principal transfer, split by the server), never posted as one expense, so the
 * engine leaves these alone; the Recurring form no longer offers Loan / EMI; the loan's own EMI date
 * reminds you (and a later release records it automatically, by the loan).
 */
export function isLoanEmiSchedule(s: Pick<RecurringSchedule, 'transactionTemplate'>): boolean {
  const t = s.transactionTemplate ?? ({} as RecurringSchedule['transactionTemplate']);
  return t.category === 'loan_emi' || !!t.debtId || !!t.linkedDebtId;
}

// Returns schedules that are due now or in the past — they need transactions generated
export function dueSchedules(schedules: RecurringSchedule[], now = today()): RecurringSchedule[] {
  return schedules.filter(s => s.active && s.nextDueDate <= now);
}

// Returns schedules upcoming within `leadDays` — for upcoming-bill notifications
export function upcomingSchedules(schedules: RecurringSchedule[], leadDays = 3, now = today()): RecurringSchedule[] {
  const cutoffISO = addDaysISO(now, leadDays);   // W3a: string arithmetic, not a UTC parse stepped locally
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

/**
 * After an occurrence is generated (or approved, or skipped), move the schedule to its next one.
 * W3e: the next occurrence of its RULE strictly after the pointer, so a pointer that is not itself a
 * rule date still moves forward. When COUNT or UNTIL is used up the schedule is finished: it stays on
 * its last date and becomes inactive — it used to keep posting forever.
 */
export function advanceSchedule(schedule: RecurringSchedule): RecurringSchedule {
  const lastGenerated = schedule.nextDueDate;
  const next = nextScheduleOccurrence(schedule, lastGenerated);
  if (!next) return { ...schedule, lastGenerated, active: false };
  return { ...schedule, lastGenerated, nextDueDate: next };
}

// ── Retired writers (v10.22.2) ──────────────────────────────────────────────
//
// `backfillSchedulesFromTransactions` (v7.3) and `rekeyLegacyRecurringIds`
// (v10.20.5) were DELETED here, not merely unwired.
//
// The backfill recreated a schedule from any transaction carrying a legacy
// `recurring` field, which meant it could not tell a deliberate deletion from
// a legacy gap: deleting a recurring schedule and reloading brought it back,
// for roughly two years. It was unwired in v10.20.7 and its tests were removed
// on 2026-09-09 — but it stayed exported, so nothing stopped a future caller
// from importing a resurrection writer that no longer had a single test
// holding it to its contract. An exported writer with no tests and no callers
// is worse than either keeping it tested or deleting it.
//
// The re-key is retired for the same reason: it rewrote primary keys, and
// shipping it without eviction is what produced the v10.20.5 duplicate rows.
// Both migrations have long since run on every live device.
//
// A delete is final. Do not reintroduce either function, and never add a
// migration that RECREATES rows from other rows.

// ── Occurrence calculus (v10.20.6) ──────────────────────────────────────────
//
// `computeNextDueDate` answers a different question than the UI needs: it always
// steps ONE period on from its base. That is right after generating an
// occurrence, and wrong everywhere else:
//
//   • CREATE — picking "the 20th" on the 8th gave 2026-10-20. The 20th of THIS
//     month had not happened yet, so the first bill silently skipped a month.
//
//   • EDIT — Recurring.tsx passed `lastGenerated: undefined`, so the base was
//     the schedule's ORIGINAL startDate. Editing a schedule that began
//     2026-05-22 produced nextDueDate 2026-06-02 — three months in the PAST.
//     `dueSchedules` then saw it as due and the engine materialised a
//     back-dated transaction, advancing one month per page refresh:
//     2026-06-02, 2026-07-02, 2026-08-02, 2026-09-02. That is the reported
//     "recurring schedule appears as a transaction for the current day".
//
// The question both paths actually ask is "when does this NEXT fall due, on or
// after some anchor date?" — which is what this function answers. All maths is
// in UTC: the app stores plain YYYY-MM-DD, and local-time `setDate`/`setMonth`
// on a UTC-parsed date drifts a day either side of the date line. Since W3e both
// read the schedule's rule (`ruleOf`), so a weekday, nth-weekday, COUNT or UNTIL
// rule saves exactly the date the engine will post.

// The one implementation lives in format.ts (W3a); re-exported for the existing importers.
export { addDaysISO };

/** The later of two ISO dates. */
export const maxISO = (a: string, b: string): string => (a >= b ? a : b);

/**
 * The first occurrence of this recurrence on or after `from` (inclusive).
 *
 * Pure and total: it never returns a date before `from`, which is the property
 * that stops a schedule from being born overdue.
 */
export function firstDueOnOrAfter(
  from: string,
  freq: RecurrenceFreq,
  opts: { startDate?: string; dayOfMonth?: number; weekday?: number; rrule?: string; shortMonthPolicy?: ShortMonthPolicy } = {},
): string {
  // A schedule cannot fire before it starts. W3e: read from the rule, with its month-end policy.
  const startDate = opts.startDate ?? from;
  const anchor = maxISO(from, startDate);
  const rule = ruleOf({ frequency: freq, startDate, dayOfMonth: opts.dayOfMonth, weekday: opts.weekday, rrule: opts.rrule });
  return firstOccurrenceOnOrAfter(rule, startDate, anchor, { shortMonthPolicy: opts.shortMonthPolicy ?? 'last_day' }) ?? anchor;
}

/**
 * The nextDueDate a schedule should carry after the user saves the form.
 *
 * Never in the past, and never on or before an occurrence already generated —
 * so editing a schedule cannot re-materialise history.
 */
export function nextDueAfterSave(
  freq: RecurrenceFreq,
  opts: { startDate: string; dayOfMonth?: number; weekday?: number; lastGenerated?: string; rrule?: string; shortMonthPolicy?: ShortMonthPolicy },
  now: string = today(),
): string {
  const floor = opts.lastGenerated
    ? maxISO(now, addDaysISO(opts.lastGenerated, 1))
    : now;
  return firstDueOnOrAfter(maxISO(floor, opts.startDate), freq, opts);
}

/**
 * W3e (owner decision D13) — the dates a schedule carries after the form is saved.
 *
 * The next due date is the rule's first occurrence on or after the floor (today, and never on or
 * before an occurrence already generated), with the rule's month-end policy; an edit keeps the old
 * start as the phase, so "every 3 months" stays on its months. The schedule is then RE-ANCHORED
 * there: `startDate` becomes that next due date, so "Ends after N times" means N more from the
 * next one (owner: "N restarts at the edit"). COUNT is therefore left out of the search — it is
 * counted from the new start. Null when UNTIL leaves no date at all.
 */
export function scheduleDatesAfterSave(
  rule: RRule,
  shortMonthPolicy: ShortMonthPolicy,
  editing: Pick<RecurringSchedule, 'startDate' | 'lastGenerated'> | null,
  now: string = today(),
): { startDate: string; nextDueDate: string } | null {
  const floor = editing?.lastGenerated ? maxISO(now, addDaysISO(editing.lastGenerated, 1)) : now;
  const phase = editing?.startDate ?? floor;
  const next = firstOccurrenceOnOrAfter({ ...rule, count: undefined }, phase, floor, { shortMonthPolicy });
  return next ? { startDate: next, nextDueDate: next } : null;
}

/**
 * How far back the engine will still materialise a missed occurrence.
 *
 * A device offline for a few weeks SHOULD catch up — that is the feature. But a
 * schedule carrying a nextDueDate months in the past is corrupt data, not a
 * backlog, and silently inventing half a year of expenses would misstate every
 * month it touches. Past this horizon the engine fast-forwards WITHOUT writing.
 */
export const MAX_CATCHUP_DAYS = 45;

/** True when this occurrence is too old to materialise honestly. */
export function isStaleOccurrence(
  occurrence: string,
  now: string = today(),
  maxDays: number = MAX_CATCHUP_DAYS,
): boolean {
  return (Date.parse(now) - Date.parse(occurrence)) / DAY_MS > maxDays;
}
