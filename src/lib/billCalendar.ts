// Vyact v10.32.0 — the approval-aware bill calendar
// (docs/INSIGHTS_ASK_REPORTS_UX.md, "Further Product Work").
//
// Contract: a read-only projection of what active recurring schedules will do
// over the next N days, told in the recurring engine's own terms.
//   • Occurrence dates come from the schedule's RRULE (`expandRRule`), so multiple
//     weekdays, nth weekdays, month-end skips and "ends after N times" hold.
//     Schedules without an RRULE fall back to `scheduleFiresOnDate`.
//   • The engine's pointer is `nextDueDate`: anything before it has already been
//     posted, approved or skipped, and is never shown as due again.
//   • Status follows the approval setting:
//       auto-approve on  → "posts automatically" (or "posted" once the
//                          deterministic occurrence transaction exists);
//       auto-approve off → the occurrence at the pointer, once due, is
//                          "awaiting approval" (the only actionable state —
//                          `approveRecurring` refuses any other date);
//                          later ones are "needs approval when due".
//   • A pointer older than the engine's catch-up horizon is not shown: the engine
//     fast-forwards it without posting, so it will never become a transaction.
//   • Nothing here posts, approves or skips. Totals are a commitment preview in the
//     household currency, not a forecast of the account balance.
import type { ExchangeRates, RecurringSchedule, Transaction } from '../types';
import { convert, today } from './format';
import { addDaysISO, isStaleOccurrence, recurringInstanceId, scheduleFiresOnDate } from './recurring';
import { expandRRule, parseRRule } from './rrule';

export type BillStatus = 'posted' | 'awaiting-approval' | 'auto' | 'approval-when-due';

export interface BillOccurrence {
  scheduleId: string;
  date: string;
  description: string;
  type: 'expense' | 'income' | 'investment' | 'transfer';
  category: string;
  amount: number;
  currency: string;
  /** Amount in the household base currency. */
  baseAmount: number;
  status: BillStatus;
  /** True only for the one occurrence `approveRecurring` / skip-once can act on. */
  actionable: boolean;
  /** Before today (still awaiting approval). */
  overdue: boolean;
}

export interface BillCalendarDay { date: string; items: BillOccurrence[] }

export interface BillCalendar {
  from: string;
  to: string;
  days: BillCalendarDay[];
  awaitingApproval: number;
  /** Household-currency totals of everything in the window not yet posted. */
  outgoing: number;
  incoming: number;
  investing: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function occurrenceDates(schedule: RecurringSchedule, from: string, to: string): string[] {
  if (schedule.rrule) {
    try {
      return expandRRule(parseRRule(schedule.rrule), schedule.startDate, from, to);
    } catch { /* malformed rule: fall back to the frequency fields below */ }
  }
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDaysISO(date, 1)) {
    if (scheduleFiresOnDate(schedule, date)) dates.push(date);
  }
  return dates;
}

export function billCalendar(input: {
  schedules: RecurringSchedule[];
  transactions: Transaction[];
  baseCurrency: string;
  rates: ExchangeRates;
  horizonDays: number;
  now?: string;
}): BillCalendar {
  const now = input.now ?? today();
  const to = addDaysISO(now, Math.max(0, input.horizonDays - 1));
  const posted = new Set(input.transactions
    .filter(transaction => transaction.recurringScheduleId)
    .map(transaction => `${transaction.recurringScheduleId}|${transaction.date}`));
  const postedIds = new Set(input.transactions.map(transaction => transaction.id));
  const items: BillOccurrence[] = [];

  for (const schedule of input.schedules) {
    if (schedule.active === false || !schedule.nextDueDate) continue;
    const pointer = schedule.nextDueDate;
    if (isStaleOccurrence(pointer, now)) continue;
    const template = schedule.transactionTemplate;
    const type = (template.type ?? 'expense') as BillOccurrence['type'];
    const currency = template.currency || input.baseCurrency;
    const amount = template.amount ?? 0;
    // An overdue manual occurrence sits before today; include it so it can be approved.
    const from = pointer < now ? pointer : now;
    for (const date of occurrenceDates(schedule, from, to)) {
      if (date < pointer) continue;
      const isPosted = posted.has(`${schedule.id}|${date}`) || postedIds.has(recurringInstanceId(schedule.id, date));
      const status: BillStatus = isPosted ? 'posted'
        : schedule.autoConfirm ? 'auto'
        : date === pointer && date <= now ? 'awaiting-approval'
        : 'approval-when-due';
      if (date < now && status !== 'awaiting-approval') continue;
      items.push({
        scheduleId: schedule.id, date, description: template.description ?? '', type, category: template.category ?? '',
        amount, currency, baseAmount: round2(convert(amount, currency, input.baseCurrency, input.rates)),
        status, actionable: status === 'awaiting-approval', overdue: date < now,
      });
    }
  }

  items.sort((left, right) => left.date.localeCompare(right.date) || left.description.localeCompare(right.description));
  const days: BillCalendarDay[] = [];
  for (const item of items) {
    const last = days[days.length - 1];
    if (last && last.date === item.date) last.items.push(item);
    else days.push({ date: item.date, items: [item] });
  }
  const open = items.filter(item => item.status !== 'posted');
  const total = (kind: BillOccurrence['type'][]) => round2(open.filter(item => kind.includes(item.type)).reduce((sum, item) => sum + item.baseAmount, 0));
  return {
    from: now, to, days,
    awaitingApproval: items.filter(item => item.status === 'awaiting-approval').length,
    outgoing: total(['expense']), incoming: total(['income']), investing: total(['investment']),
  };
}
