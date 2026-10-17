// Vyact v10.32.0 — the approval-aware bill calendar
// (docs/INSIGHTS_ASK_REPORTS_UX.md, "Further Product Work").
//
// Contract: a read-only projection of what active recurring schedules will do
// over the next N days, told in the recurring engine's own terms.
//   • Occurrence dates come from the schedule's rule (`ruleOf` → `expandRRule`) with
//     its month-end policy, so multiple weekdays, nth weekdays, a 31st in a short month
//     and "ends after N times / on a date" hold. W3e: the same rule the engine advances
//     by, so the calendar can never show a date the engine will not post (it used to
//     skip short months while the engine overflowed them).
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
import type { Account, Debt, ExchangeRates, RecurringSchedule, Transaction } from '../types';
import { loanView } from './loanSchedule';
import { convert, today } from './format';
import { addDaysISO, isLoanEmiSchedule, isStaleOccurrence, recurringInstanceId, ruleOf, policyOf } from './recurring';
import { expandRRule } from './rrule';

export type BillStatus = 'posted' | 'awaiting-approval' | 'auto' | 'approval-when-due';

export interface BillOccurrence {
  /** The schedule's id; for a loan EMI, `loan:<debt id>` (see `debtId`). */
  scheduleId: string;
  /** W4g — set when this is a loan's EMI: it is paid from the loan, never approved as a schedule. */
  debtId?: string;
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
  return expandRRule(ruleOf(schedule), schedule.startDate, from, to, { shortMonthPolicy: policyOf(schedule) });
}

export function billCalendar(input: {
  schedules: RecurringSchedule[];
  transactions: Transaction[];
  baseCurrency: string;
  rates: ExchangeRates;
  horizonDays: number;
  now?: string;
  /** W4g (D19) — the loans whose EMIs belong on the calendar, read from each loan's own schedule. */
  debts?: Debt[];
  accounts?: Account[];
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
    // Track E, E6a (owner, E-3) — a leftover EMI schedule never posts (the loan pays its EMI); the loan's
    // own EMI is listed below, so the schedule would show the same EMI twice.
    if (isLoanEmiSchedule(schedule)) continue;
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

  // W4g (D19) — each loan's EMIs from its own schedule (loanView): the due one (what is left of it, when
  // part-paid; overdue if its date has passed) and the next ones in the window. An auto-recorded loan's
  // EMI "posts automatically" (the server records it on the day); any other is paid from the loan.
  for (const debt of input.debts ?? []) {
    if ((debt.direction ?? 'owed_by_me') === 'owed_to_me' || debt.paidOffAt || !debt.dueDate) continue;
    const view = loanView(debt, input.accounts ?? [], input.transactions, input.baseCurrency, now);
    if (view.paidOff || isStaleOccurrence(debt.dueDate, now)) continue;
    for (const row of view.schedule) {
      if (!row.date || row.date > to) break;
      const due = row.no === view.state.no;
      if (!due && row.date < now) continue;
      const status: BillStatus = debt.autoRecord ? 'auto' : due && row.date <= now ? 'awaiting-approval' : 'approval-when-due';
      items.push({
        scheduleId: `loan:${debt.id}`, debtId: debt.id, date: row.date,
        description: `${debt.name} EMI #${row.no}`, type: 'expense', category: 'loan_emi',
        amount: row.payment, currency: input.baseCurrency, baseAmount: round2(row.payment),
        status, actionable: due && !debt.autoRecord && row.date <= now, overdue: row.date < now,
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
