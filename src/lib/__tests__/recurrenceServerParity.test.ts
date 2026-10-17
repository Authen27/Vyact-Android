// W3e (v10.69.0) — "paid Rent" on WhatsApp runs the APP's Approve on the server. Until W3e a hand
// port (`_shared/recurring.ts`) re-implemented the posting step, and its parity test pinned the
// month-end skip both copies shared. The port is gone: the webhook calls the bundled engine's
// `approveOccurrenceOnServer`, and this file holds it — source and generated bundle — to the app.
// (Successor of recurringPort.test.ts, CON-UNIT-REC-P-001..003.)
import { describe, expect, it } from 'vitest';
import { generateTransaction, advanceSchedule, recurringInstanceId } from '../recurring';
import { txnToRow } from '../supabaseAdapter';
import { approveOccurrenceOnServer } from '../serverEngine';
import { approveOccurrenceOnServer as bundled } from '../../../../supabase/functions/_shared/agent/engine';
import type { RecurringSchedule } from '../../types';

const HID = '11111111-1111-4111-8111-111111111111';
const ACC = '22222222-2222-4222-8222-222222222222';
const MEM = '33333333-3333-4333-8333-333333333333';

/** The same schedule, as the client holds it and as the database row the server reads. */
function pair(p: Partial<RecurringSchedule>): { client: RecurringSchedule; row: Record<string, unknown> } {
  const client = {
    id: '44444444-4444-4444-8444-444444444444', frequency: 'monthly', startDate: '2026-01-05', nextDueDate: '2026-09-05',
    dayOfMonth: 5, autoConfirm: false, active: true, shortMonthPolicy: 'last_day',
    transactionTemplate: { type: 'expense', amount: 25000, currency: 'INR', description: 'Rent', category: 'rent_mortgage', accountId: ACC, memberId: MEM, recurring: 'monthly' },
    ...p,
  } as RecurringSchedule;
  const row = {
    id: client.id, household_id: HID, created_by: null, frequency: client.frequency, start_date: client.startDate,
    next_due_date: client.nextDueDate, last_generated: client.lastGenerated ?? null, day_of_month: client.dayOfMonth ?? null,
    weekday: client.weekday ?? null, auto_confirm: client.autoConfirm, active: client.active, reminder_lead_days: null,
    rrule: client.rrule ?? null, short_month_policy: client.shortMonthPolicy ?? 'last_day',
    owner_member_id: client.ownerMemberId ?? null, txn_template: client.transactionTemplate as unknown as Record<string, unknown>,
    updated_at: '2026-09-01T00:00:00Z',
  };
  return { client, row };
}
/** What the client's upsert actually sends: JSON drops undefined. */
const wire = (o: unknown) => JSON.parse(JSON.stringify(o));

describe('"paid X" runs the app’s Approve (W3e)', () => {
  it('W3-D13-009 · the next date matches advanceSchedule — month ends, weekdays, nth weekday, daily, annual — and the last one closes', () => {
    const cases: Partial<RecurringSchedule>[] = [
      { frequency: 'monthly', dayOfMonth: 5, nextDueDate: '2026-09-05' },
      { frequency: 'monthly', dayOfMonth: 31, startDate: '2026-01-31', nextDueDate: '2026-01-31' },
      { frequency: 'monthly', dayOfMonth: 31, startDate: '2026-01-31', nextDueDate: '2026-01-31', shortMonthPolicy: 'next_month_first' },
      { frequency: 'custom_day', dayOfMonth: 28, nextDueDate: '2026-12-28' },
      { frequency: 'weekly', weekday: 1, startDate: '2026-09-07', nextDueDate: '2026-09-07', dayOfMonth: undefined },
      { frequency: 'weekly', rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR', startDate: '2026-10-02', nextDueDate: '2026-10-02' },
      { rrule: 'FREQ=MONTHLY;INTERVAL=1;BYDAY=FR;BYSETPOS=-1', startDate: '2026-10-30', nextDueDate: '2026-10-30' },
      { frequency: 'daily', startDate: '2026-02-27', nextDueDate: '2026-02-28', dayOfMonth: undefined },
      { frequency: 'yearly', startDate: '2024-02-29', nextDueDate: '2027-02-28', dayOfMonth: undefined },
      { rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=10;COUNT=3', startDate: '2026-08-10', nextDueDate: '2026-10-10' },
    ];
    for (const c of cases) {
      const { client, row } = pair(c);
      const advanced = advanceSchedule(client);
      const expected = { nextDue: advanced.active ? advanced.nextDueDate : null, exhausted: !advanced.active };
      for (const plan of [approveOccurrenceOnServer(row, HID), bundled(row, HID)]) {
        expect({ nextDue: plan.nextDue, exhausted: plan.exhausted }, JSON.stringify(c)).toEqual(expected);
      }
    }
    const last = approveOccurrenceOnServer(pair(cases[cases.length - 1]).row, HID);
    expect(last).toMatchObject({ nextDue: null, exhausted: true });
    expect(approveOccurrenceOnServer(pair(cases[1]).row, HID).nextDue).toBe('2026-02-28');
  });

  it('W3-D13-010 · the row is what the app’s generateTransaction → txnToRow writes, under the app’s id', () => {
    const variants: Partial<RecurringSchedule>[] = [
      {},
      { ownerMemberId: '55555555-5555-4555-8555-555555555555', frequency: 'custom_day' },
      { frequency: 'daily', dayOfMonth: undefined },
      { transactionTemplate: { type: 'income', amount: 92000, currency: 'INR', description: 'Salary', category: 'salary', accountId: ACC } as never },
      { transactionTemplate: { type: 'expense', amount: 649, currency: 'INR', description: 'Netflix', category: 'entertainment', accountId: ACC,
        paymentMode: 'card', paymentMethod: 'card', note: 'family plan', confidence: 'estimated', source: 'onboarding', estimatedAt: '2026-09-01T00:00:00Z' } as never },
      { transactionTemplate: { type: 'expense', amount: 1200, currency: 'INR', description: 'Dinner', category: 'food_dining', accountId: 'not-a-uuid',
        split: { isSplit: true, totalAmount: 1200, yourShare: 600, paidBy: 'me', participants: [] } } as never },
    ];
    for (const v of variants) {
      const { client, row } = pair(v);
      const app = wire(txnToRow(generateTransaction(client), HID));
      expect(approveOccurrenceOnServer(row, HID).row, JSON.stringify(v)).toEqual(app);
      expect(bundled(row, HID).row, JSON.stringify(v)).toEqual(app);
      expect(app.id).toBe(recurringInstanceId(client.id, client.nextDueDate));
    }
  });
});
