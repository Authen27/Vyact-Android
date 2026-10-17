// W3e (v10.69.0; owner decision D13) — ONE recurrence engine. The schedule's rule (its RRULE, or the
// one its columns describe) is the single source of every date: the engine's advance, the form's
// save, the bill calendar and the day projections. The month-end rule is the schedule's own.
import { describe, expect, it } from 'vitest';
import type { RecurringSchedule } from '../../types';
import {
  advanceSchedule, computeNextDueDate, dueSchedules, ruleOf, scheduleDatesAfterSave, scheduleFiresOnDate,
} from '../recurring';
import { billCalendar } from '../billCalendar';
import { addDaysISO } from '../format';
import { parseRRule } from '../rrule';

const sched = (p: Partial<RecurringSchedule>): RecurringSchedule => ({
  id: 's-1', frequency: 'monthly', startDate: '2026-01-31', nextDueDate: '2026-01-31', autoConfirm: true, active: true,
  transactionTemplate: { type: 'expense', amount: 100, currency: 'INR', description: 'Bill', category: 'utilities', accountId: 'bank' },
  ...p,
} as RecurringSchedule);

/** The engine's own sequence: advance from the pointer `n` times. */
function advanceDates(s: RecurringSchedule, n: number): string[] {
  const out: string[] = [];
  let cur = s;
  for (let i = 0; i < n && cur.active; i++) {
    cur = advanceSchedule(cur);
    if (cur.active) out.push(cur.nextDueDate);
  }
  return out;
}

describe('W3e · one recurrence engine', () => {
  it('W3-D13-004 · a 31st in a shorter month follows the schedule’s month-end rule, in every calculator', () => {
    const lastDay = sched({ dayOfMonth: 31 });
    expect(advanceDates(lastDay, 12)).toEqual([
      '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31',
      '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31',
    ]);
    // The old advance stepped Jan 31 → "Feb 31" = Mar 3 → Mar 31, so February was never billed.
    expect(computeNextDueDate('monthly', '2026-01-31', '2026-01-31', 31)).toBe('2026-02-28');

    const firstOfNext = sched({ dayOfMonth: 31, shortMonthPolicy: 'next_month_first' });
    expect(advanceDates(firstOfNext, 11)).toEqual([
      '2026-03-01', '2026-03-31', '2026-05-01', '2026-05-31', '2026-07-01', '2026-07-31',
      '2026-08-31', '2026-10-01', '2026-10-31', '2026-12-01', '2026-12-31',
    ]);

    // An annual 29 Feb.
    const leap = sched({ frequency: 'yearly', startDate: '2024-02-29', nextDueDate: '2024-02-29', dayOfMonth: undefined });
    expect(advanceDates(leap, 4)).toEqual(['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
    expect(advanceDates({ ...leap, shortMonthPolicy: 'next_month_first' }, 4))
      .toEqual(['2025-03-01', '2026-03-01', '2027-03-01', '2028-02-29']);
  });

  it('W3-D13-005 · weekdays, nth weekday, intervals, daily and legacy weekly schedules advance by their rule', () => {
    const weekdays = sched({ frequency: 'weekly', rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR', startDate: '2026-10-02', nextDueDate: '2026-10-02' });
    expect(advanceDates(weekdays, 6)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12']);

    const lastFriday = sched({ rrule: 'FREQ=MONTHLY;INTERVAL=1;BYDAY=FR;BYSETPOS=-1', startDate: '2026-10-30', nextDueDate: '2026-10-30' });
    expect(advanceDates(lastFriday, 2)).toEqual(['2026-11-27', '2026-12-25']);
    const secondTuesday = sched({ rrule: 'FREQ=MONTHLY;INTERVAL=1;BYDAY=TU;BYSETPOS=2', startDate: '2026-10-13', nextDueDate: '2026-10-13' });
    expect(advanceDates(secondTuesday, 2)).toEqual(['2026-11-10', '2026-12-08']);

    const quarterly = sched({ rrule: 'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=5', startDate: '2026-01-05', nextDueDate: '2026-04-05' });
    expect(advanceDates(quarterly, 2)).toEqual(['2026-07-05', '2026-10-05']);

    const daily = sched({ frequency: 'daily', startDate: '2026-02-27', nextDueDate: '2026-02-28', dayOfMonth: undefined });
    expect(advanceDates(daily, 2)).toEqual(['2026-03-01', '2026-03-02']);
    // A years-old daily schedule still finds tomorrow (it is not mistaken for a finished one).
    expect(advanceDates({ ...daily, startDate: '1995-01-01', nextDueDate: '2026-10-07' }, 1)).toEqual(['2026-10-08']);

    // A schedule saved before W3e has no RRULE: its columns describe one, as the database derives it.
    const legacyWeekly = sched({ frequency: 'weekly', weekday: 1, startDate: '2026-09-07', nextDueDate: '2026-09-07', dayOfMonth: undefined });
    expect(ruleOf(legacyWeekly)).toEqual({ freq: 'WEEKLY', interval: 1, byDay: [1] });
    expect(advanceDates(legacyWeekly, 1)).toEqual(['2026-09-14']);
    expect(ruleOf(sched({ frequency: 'custom_day', dayOfMonth: 20, startDate: '2026-01-08' })))
      .toEqual({ freq: 'MONTHLY', interval: 1, byMonthDay: [20] });
  });

  it('W3-D13-006 · when COUNT or UNTIL runs out the schedule closes on its last date — it never posts again', () => {
    const three = sched({ rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=10;COUNT=3', startDate: '2026-08-10', nextDueDate: '2026-09-10' });
    const third = advanceSchedule(three);
    expect(third).toMatchObject({ nextDueDate: '2026-10-10', lastGenerated: '2026-09-10', active: true });
    const closed = advanceSchedule(third);
    expect(closed).toMatchObject({ nextDueDate: '2026-10-10', lastGenerated: '2026-10-10', active: false });
    expect(dueSchedules([closed], '2026-12-31')).toEqual([]);

    const untilMonday = sched({ frequency: 'weekly', rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;UNTIL=20261019', startDate: '2026-10-05', nextDueDate: '2026-10-12' });
    expect(advanceSchedule(untilMonday)).toMatchObject({ nextDueDate: '2026-10-19', active: true });
    expect(advanceSchedule(advanceSchedule(untilMonday))).toMatchObject({ nextDueDate: '2026-10-19', active: false });
    expect(scheduleFiresOnDate(untilMonday, '2026-10-19')).toBe(true);
    expect(scheduleFiresOnDate(untilMonday, '2026-10-26')).toBe(false);
  });

  it('W3-D13-007 · saving picks the rule’s next date on or after today, and an edit restarts "N times" there', () => {
    const now = '2026-10-08';
    expect(scheduleDatesAfterSave(parseRRule('FREQ=MONTHLY;BYMONTHDAY=20'), 'last_day', null, now))
      .toEqual({ startDate: '2026-10-20', nextDueDate: '2026-10-20' });
    expect(scheduleDatesAfterSave(parseRRule('FREQ=MONTHLY;BYMONTHDAY=5'), 'last_day', null, now)?.nextDueDate).toBe('2026-11-05');
    expect(scheduleDatesAfterSave(parseRRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'), 'last_day', null, '2026-10-10')?.nextDueDate).toBe('2026-10-12');
    expect(scheduleDatesAfterSave(parseRRule('FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1'), 'last_day', null, now)?.nextDueDate).toBe('2026-10-30');

    // Owner decision: "N restarts at the edit". COUNT=3 counted from January would already be used
    // up; re-anchored at the next due date it means three more: 10 Oct, 10 Nov, 10 Dec.
    const rule = parseRRule('FREQ=MONTHLY;BYMONTHDAY=10;COUNT=3');
    const dates = scheduleDatesAfterSave(rule, 'last_day', { startDate: '2026-01-10', lastGenerated: '2026-09-10' }, now)!;
    expect(dates).toEqual({ startDate: '2026-10-10', nextDueDate: '2026-10-10' });
    const edited = sched({ rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=10;COUNT=3', ...dates });
    expect(advanceDates(edited, 5)).toEqual(['2026-11-10', '2026-12-10']);

    // Never on or before an occurrence already generated; the old start keeps an interval's phase.
    expect(scheduleDatesAfterSave(parseRRule('FREQ=MONTHLY;BYMONTHDAY=20'), 'last_day', { startDate: '2026-09-01', lastGenerated: '2026-10-20' }, now)?.nextDueDate).toBe('2026-11-20');
    expect(scheduleDatesAfterSave(parseRRule('FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=5'), 'last_day', { startDate: '2026-01-05' }, '2026-02-10')?.nextDueDate).toBe('2026-04-05');
    // An end date already behind us leaves nothing to schedule.
    expect(scheduleDatesAfterSave(parseRRule('FREQ=MONTHLY;BYMONTHDAY=20;UNTIL=20261001'), 'last_day', null, now)).toBeNull();

    // A 31st under "1st of the next month", saved in a 30-day month, starts on that 1st and continues.
    const moved = scheduleDatesAfterSave(parseRRule('FREQ=MONTHLY;BYMONTHDAY=31'), 'next_month_first', null, '2026-04-15')!;
    expect(moved.nextDueDate).toBe('2026-05-01');
    const fromMoved = sched({ rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31', shortMonthPolicy: 'next_month_first', ...moved });
    expect(scheduleFiresOnDate(fromMoved, '2026-05-01')).toBe(true);
    expect(advanceDates(fromMoved, 2)).toEqual(['2026-05-31', '2026-07-01']);
  });

  it('W3-D13-008 · the engine, the bill calendar and the day projection agree on every date', () => {
    const now = '2026-10-01';
    const to = '2027-03-31';
    const schedules = [
      sched({ id: 'a', dayOfMonth: 31, startDate: '2026-01-31', nextDueDate: '2026-10-31' }),
      sched({ id: 'b', dayOfMonth: 31, shortMonthPolicy: 'next_month_first', startDate: '2026-01-31', nextDueDate: '2026-10-31' }),
      sched({ id: 'c', rrule: 'FREQ=MONTHLY;INTERVAL=1;BYDAY=FR;BYSETPOS=-1', startDate: '2026-10-30', nextDueDate: '2026-10-30' }),
      sched({ id: 'd', frequency: 'weekly', rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR;COUNT=20', startDate: '2026-10-02', nextDueDate: '2026-10-02' }),
      sched({ id: 'e', frequency: 'yearly', startDate: '2024-02-29', nextDueDate: '2027-02-28', dayOfMonth: undefined }),
    ];
    const horizonDays = (Date.parse(to) - Date.parse(now)) / 86_400_000 + 1;
    const calendar = billCalendar({ schedules, transactions: [], baseCurrency: 'INR', rates: {}, horizonDays, now });
    for (const s of schedules) {
      const engine = [s.nextDueDate, ...advanceDates(s, 200)].filter(d => d <= to);
      const shown = calendar.days.flatMap(day => day.items.filter(i => i.scheduleId === s.id).map(() => day.date));
      const projected: string[] = [];
      for (let d = s.nextDueDate; d <= to; d = addDaysISO(d, 1)) if (scheduleFiresOnDate(s, d)) projected.push(d);
      expect(shown, s.id).toEqual(engine);
      expect(projected, s.id).toEqual(engine);
    }
    expect(calendar.days.some(day => day.date === '2027-02-28' && day.items.some(i => i.scheduleId === 'a'))).toBe(true);
  });
});
