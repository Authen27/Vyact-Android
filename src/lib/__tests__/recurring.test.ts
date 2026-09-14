import { describe, expect, it } from 'vitest';
import type { RecurringSchedule } from '../../types';
import {
  computeNextDueDate,
  projectRecurringTransactionsForDate,
  scheduleFiresOnDate,
  recurringInstanceId,
  firstDueOnOrAfter,
  nextDueAfterSave,
  isStaleOccurrence,
} from '../recurring';

function makeSchedule(overrides: Partial<RecurringSchedule> = {}): RecurringSchedule {
  return {
    id: 'sched-1',
    transactionTemplate: {
      type: 'expense',
      amount: 1250,
      currency: 'USD',
      description: 'Rent',
      category: 'rent',
      recurring: 'monthly',
    },
    frequency: 'monthly',
    dayOfMonth: 5,
    startDate: '2026-06-05',
    nextDueDate: '2026-07-05',
    autoConfirm: false,
    active: true,
    ...overrides,
  };
}

describe('scheduleFiresOnDate', () => {
  it('matches the configured monthly day after the schedule start date', () => {
    const schedule = makeSchedule();
    expect(scheduleFiresOnDate(schedule, '2026-07-05')).toBe(true);
    expect(scheduleFiresOnDate(schedule, '2026-07-04')).toBe(false);
  });

  it('matches weekly schedules on 7-day cadence from the start date', () => {
    const schedule = makeSchedule({
      frequency: 'weekly',
      startDate: '2026-06-03',
      nextDueDate: '2026-06-10',
      dayOfMonth: undefined,
      transactionTemplate: {
        type: 'income',
        amount: 800,
        currency: 'USD',
        description: 'Allowance',
        category: 'salary',
        recurring: 'weekly',
      },
    });

    expect(scheduleFiresOnDate(schedule, '2026-06-10')).toBe(true);
    expect(scheduleFiresOnDate(schedule, '2026-06-11')).toBe(false);
  });

  it('does not match inactive schedules or dates before the start date', () => {
    const inactive = makeSchedule({ active: false });
    expect(scheduleFiresOnDate(inactive, '2026-07-05')).toBe(false);

    const futureStart = makeSchedule({ startDate: '2026-07-01' });
    expect(scheduleFiresOnDate(futureStart, '2026-06-05')).toBe(false);
  });
});

describe('projectRecurringTransactionsForDate', () => {
  it('projects matching schedules into transaction-shaped rows for a selected future date', () => {
    const rows = projectRecurringTransactionsForDate([makeSchedule()], '2026-07-05');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'projected-sched-1-2026-07-05',
      date: '2026-07-05',
      description: 'Rent',
      amount: 1250,
      note: 'Projected recurring transaction · pending confirm',
      recurring: 'monthly',
    });
  });

  it('normalizes custom-day schedules to monthly recurring rows and respects auto-confirm copy', () => {
    const rows = projectRecurringTransactionsForDate([
      makeSchedule({
        id: 'sched-2',
        frequency: 'custom_day',
        autoConfirm: true,
        dayOfMonth: 18,
        startDate: '2026-06-18',
        nextDueDate: '2026-07-18',
        transactionTemplate: {
          type: 'expense',
          amount: 19.99,
          currency: 'USD',
          description: 'Streaming',
          category: 'subscriptions',
          recurring: 'monthly',
        },
      }),
    ], '2026-07-18');

    expect(rows[0]).toMatchObject({
      recurring: 'monthly',
      note: 'Projected recurring transaction',
    });
  });
});

describe('computeNextDueDate', () => {
  it('advances monthly schedules from the last generated date', () => {
    expect(computeNextDueDate('monthly', '2026-06-05', '2026-07-05', 5)).toBe('2026-08-05');
  });
});

describe('recurringInstanceId · R2 idempotency', () => {
  // CON-UNIT-064 pins the R2 sync fix: a materialised recurring instance gets a
  // deterministic id keyed on (schedule, occurrence-date), so two devices that
  // generate the same due occurrence upsert the SAME cloud row instead of
  // inserting a duplicate. Same seed → same UUID; different date → different id.
  it('CON-UNIT-064 · is deterministic per (schedule, date), distinct across dates, and a valid UUID', () => {
    const a1 = recurringInstanceId('sched-1', '2026-07-05');
    const a2 = recurringInstanceId('sched-1', '2026-07-05');
    const b  = recurringInstanceId('sched-1', '2026-08-05');
    const c  = recurringInstanceId('sched-2', '2026-07-05');
    expect(a1).toBe(a2);             // stable across calls / devices
    expect(a1).not.toBe(b);          // different occurrence-date → different id
    expect(a1).not.toBe(c);          // different schedule → different id
    expect(a1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

// CON-UNIT-092..096 — the occurrence calculus.
//
// Reported 2026-09-08: "the newly added recurring schedule for a different time
// now appears as transaction for current day". Root cause was NOT the engine —
// it was the date the form saved. Recurring.tsx called
// \`computeNextDueDate(freq, startDate, undefined, dom)\`, which always steps ONE
// period on from its base, so editing a schedule that started 2026-05-22 set
// nextDueDate to 2026-06-02 — three months in the PAST. dueSchedules then
// matched it and the engine materialised a back-dated transaction per refresh.
describe('occurrence calculus · a schedule must never be born overdue', () => {
  it('CON-UNIT-092 · CREATE on the 8th for the 20th falls due THIS month', () => {
    // The old computeNextDueDate returned 2026-10-20, silently skipping a month.
    expect(nextDueAfterSave('monthly', { startDate: '2026-09-08', dayOfMonth: 20 }, '2026-09-08'))
      .toBe('2026-09-20');
  });

  it('CON-UNIT-093 · CREATE on the 8th for the 2nd rolls to next month', () => {
    // The 2nd has already passed, so next month is correct here.
    expect(nextDueAfterSave('monthly', { startDate: '2026-09-08', dayOfMonth: 2 }, '2026-09-08'))
      .toBe('2026-10-02');
  });

  it('CON-UNIT-094 · EDIT never moves the due date into the past', () => {
    // THE REPORTED BUG. Original start months ago; the user edits day-of-month.
    const next = nextDueAfterSave(
      'monthly',
      { startDate: '2026-05-22', dayOfMonth: 2, lastGenerated: '2026-09-02' },
      '2026-09-08',
    );
    expect(next > "2026-09-08", next + " must be in the future").toBe(true);
    expect(next).toBe('2026-10-02');

    // And with no generation history it still must not reach backwards.
    const virgin = nextDueAfterSave(
      'monthly', { startDate: '2026-05-22', dayOfMonth: 2 }, '2026-09-08',
    );
    expect(virgin >= '2026-09-08').toBe(true);
  });

  it('CON-UNIT-095 · a 31st clamps to short months instead of rolling over', () => {
    // Feb has no 31st. Rolling into March would move the bill a whole month.
    expect(firstDueOnOrAfter('2026-02-01', 'monthly', { dayOfMonth: 31 })).toBe('2026-02-28');
    expect(firstDueOnOrAfter('2026-04-01', 'monthly', { dayOfMonth: 31 })).toBe('2026-04-30');
  });

  it('CON-UNIT-096 · the engine refuses to invent months of history', () => {
    // Defence in depth for schedules already carrying a corrupt date on device.
    expect(isStaleOccurrence('2026-06-02', '2026-09-08')).toBe(true);
    // A genuine offline gap still catches up.
    expect(isStaleOccurrence('2026-09-01', '2026-09-08')).toBe(false);
  });
});
