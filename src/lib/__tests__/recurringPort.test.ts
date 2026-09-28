// W2b (v10.43.0) — the server port of the recurring POSTING step against the client
// originals. "paid Rent" on WhatsApp must write the row the app's Approve writes,
// under the same id, and move the schedule to the same next date.
import { describe, expect, it } from 'vitest';
import { recurringInstanceId as clientId, generateTransaction, advanceSchedule } from '../recurring';
import { txnToRow } from '../supabaseAdapter';
import type { RecurringSchedule } from '../../types';
import {
  recurringInstanceId, computeNextDueDate, occurrenceRow, advancedDueDate, type ScheduleRow,
} from '../../../../supabase/functions/_shared/recurring';

const HID = '11111111-1111-4111-8111-111111111111';
const ACC = '22222222-2222-4222-8222-222222222222';
const MEM = '33333333-3333-4333-8333-333333333333';

/** The same schedule, as the client holds it and as the database row the server reads. */
function pair(p: Partial<RecurringSchedule>): { client: RecurringSchedule; row: ScheduleRow } {
  const client = {
    id: '44444444-4444-4444-8444-444444444444', frequency: 'monthly', startDate: '2026-01-05', nextDueDate: '2026-09-05',
    dayOfMonth: 5, autoConfirm: false, active: true,
    transactionTemplate: { type: 'expense', amount: 25000, currency: 'INR', description: 'Rent', category: 'rent_mortgage', accountId: ACC, memberId: MEM, recurring: 'monthly' },
    ...p,
  } as RecurringSchedule;
  const row: ScheduleRow = {
    id: client.id, household_id: HID, frequency: client.frequency as ScheduleRow['frequency'], start_date: client.startDate,
    next_due_date: client.nextDueDate, last_generated: client.lastGenerated ?? null, day_of_month: client.dayOfMonth ?? null,
    weekday: client.weekday ?? null, auto_confirm: client.autoConfirm, active: client.active,
    owner_member_id: client.ownerMemberId ?? null, txn_template: client.transactionTemplate as unknown as Record<string, unknown>,
  };
  return { client, row };
}
/** What the client's upsert actually sends: JSON drops undefined. */
const wire = (o: unknown) => JSON.parse(JSON.stringify(o));

describe('recurring posting parity', () => {
  it('CON-UNIT-REC-P-001 · the occurrence id is the app’s deterministic id', () => {
    for (const [s, d] of [['a', '2026-09-05'], ['44444444-4444-4444-8444-444444444444', '2027-02-28']]) {
      expect(recurringInstanceId(s, d)).toBe(clientId(s, d));
    }
  });

  it('CON-UNIT-REC-P-002 · the next due date matches advanceSchedule across frequencies and month ends', () => {
    const cases: Partial<RecurringSchedule>[] = [
      { frequency: 'monthly', dayOfMonth: 5, nextDueDate: '2026-09-05' },
      { frequency: 'monthly', dayOfMonth: 31, startDate: '2026-01-31', nextDueDate: '2026-01-31' },
      { frequency: 'custom_day', dayOfMonth: 28, nextDueDate: '2026-12-28' },
      { frequency: 'weekly', weekday: 1, startDate: '2026-09-07', nextDueDate: '2026-09-07' },
      { frequency: 'daily', startDate: '2026-02-27', nextDueDate: '2026-02-28' },
      { frequency: 'yearly', startDate: '2024-02-29', nextDueDate: '2028-02-29' },
    ];
    for (const c of cases) {
      const { client, row } = pair(c);
      expect(advancedDueDate(row), JSON.stringify(c)).toBe(advanceSchedule(client).nextDueDate);
    }
    expect(computeNextDueDate('monthly', '2026-01-05', '2026-09-05', 5)).toBe('2026-10-05');
  });

  it('CON-UNIT-REC-P-003 · the row is what the app’s generateTransaction → txnToRow writes', () => {
    const variants: Partial<RecurringSchedule>[] = [
      {},
      { ownerMemberId: '55555555-5555-4555-8555-555555555555', frequency: 'custom_day' },
      { transactionTemplate: { type: 'income', amount: 92000, currency: 'INR', description: 'Salary', category: 'salary', accountId: ACC } as never },
      { transactionTemplate: { type: 'expense', amount: 649, currency: 'INR', description: 'Netflix', category: 'entertainment', accountId: ACC,
        paymentMode: 'card', paymentMethod: 'card', note: 'family plan', confidence: 'estimated', source: 'onboarding', estimatedAt: '2026-09-01T00:00:00Z' } as never },
      { transactionTemplate: { type: 'expense', amount: 1200, currency: 'INR', description: 'Dinner', category: 'food_dining', accountId: 'not-a-uuid',
        split: { isSplit: true, totalAmount: 1200, yourShare: 600, paidBy: 'me', participants: [] } } as never },
    ];
    for (const v of variants) {
      const { client, row } = pair(v);
      expect(wire(occurrenceRow(row)), JSON.stringify(v)).toEqual(wire(txnToRow(generateTransaction(client), HID)));
    }
  });
});
