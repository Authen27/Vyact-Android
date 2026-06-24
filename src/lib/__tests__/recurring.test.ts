import { describe, expect, it } from 'vitest';
import type { RecurringSchedule } from '../../types';
import {
  computeNextDueDate,
  projectRecurringTransactionsForDate,
  scheduleFiresOnDate,
  recurringInstanceId,
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