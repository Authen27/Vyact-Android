// W3a (v10.65.0; audit INT-TZC-03/04/05, INT-PAR-04, FE-PIP-10; owner decision D12) — "today" is the
// LOCAL calendar day: the device's in the app, the household's on the server.
//
// The device's zone cannot be switched inside a vitest thread (process.env.TZ only takes effect in a
// forked worker), so the device tests build their instants from the HOST's own local midnight: on any
// machine east or west of UTC they fail if "today" goes back to the UTC day. CI runs in UTC, where the
// two coincide — which is exactly how the old bug passed every test. The named-zone tests (the
// server's path) do not depend on the host at all.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { today, nowMonthKey, dateKeyIn, wallClock, localDayUTC, addDaysISO, daysUntil } from '../format';
import { contextFromRows, notificationsOnServer, type HouseholdRows } from '../serverEngine';
import { zoneParts, localDayIn } from '../../../../supabase/functions/_shared/localTime';
import { localDay, inJobSlot } from '../../../../supabase/functions/_shared/whatsapp-dispatch-rules';

afterEach(() => { vi.useRealTimers(); });
const at = (instant: Date) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(instant); };

describe('the app reads the device’s calendar day (W3a)', () => {
  it('CON-UNIT-W3-D12-001 · today and this month are the device’s day, just after and just before its midnight', () => {
    at(new Date(2026, 10, 1, 0, 30));                     // 00:30 on 1 Nov, device time
    expect([today(), nowMonthKey()]).toEqual(['2026-11-01', '2026-11']);
    expect(addDaysISO(today(), -1)).toBe('2026-10-31');   // the form's "Yesterday" chip
    expect(daysUntil('2026-11-01')).toBe(0);
    expect(localDayUTC().toISOString().slice(0, 10)).toBe('2026-11-01');
    at(new Date(2026, 9, 31, 23, 30));                    // 23:30 on 31 Oct, device time
    expect([today(), nowMonthKey()]).toEqual(['2026-10-31', '2026-10']);
    expect(daysUntil('2026-11-01')).toBe(1);
    expect(dateKeyIn(new Date(2026, 9, 31, 23, 59))).toBe('2026-10-31');
  });

  it('CON-UNIT-W3-D12-002 · a named zone is read in that zone whatever the host clock; unknown zones fall back; date maths is plain', () => {
    at(new Date('2026-10-31T19:15:00Z'));                 // 00:45 on 1 Nov in India, 15:15 on 31 Oct in New York
    expect(today('Asia/Kolkata')).toBe('2026-11-01');
    expect(nowMonthKey('America/New_York')).toBe('2026-10');
    expect(today('UTC')).toBe('2026-10-31');
    const wall = wallClock('Asia/Kolkata');
    expect([wall.getFullYear(), wall.getMonth() + 1, wall.getDate(), wall.getHours(), wall.getMinutes()]).toEqual([2026, 11, 1, 0, 45]);
    expect(today('Not/AZone')).toBe(today());              // an unknown zone: the device's day, never a crash
    expect(dateKeyIn(new Date('2026-03-08T07:30:00Z'), 'America/Los_Angeles')).toBe('2026-03-07');
    expect(addDaysISO('2026-03-07', 1)).toBe('2026-03-08');   // across a DST change
    expect(addDaysISO('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysUntil('2026-11-03', 'Asia/Kolkata')).toBe(2);
  });
});

const HID = '11111111-1111-4111-8111-111111111111';
function rows(timezone: string): HouseholdRows {
  return {
    transactions: [], budgets: [], budgetAllocations: [], goals: [], debts: [], assets: [], accounts: [],
    recurring: [{
      id: 'sched-rent', household_id: HID, frequency: 'monthly', day_of_month: 1, weekday: null,
      start_date: '2026-10-01', next_due_date: '2026-11-01', last_generated: '2026-10-01',
      auto_confirm: false, active: true, reminder_lead_days: 0, rrule: null, owner_member_id: null, created_by: null,
      txn_template: { type: 'expense', amount: 25000, currency: 'INR', category: 'rent_mortgage', description: 'Rent', date: '2026-11-01' },
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', deleted_at: null,
    }],
    memberCount: 1, rates: [],
    profile: { display_name: 'Asha', default_currency: 'INR', language: 'en', date_format: 'dmy' },
    household: { type: 'family', base_currency: 'INR', language: 'en', payoff_strategy: 'avalanche', extra_payment: 0, timezone },
    email: '',
  };
}

describe('the server reads the household\'s calendar day (W3a)', () => {
  it('CON-UNIT-W3-D12-003 · Pip\'s month and the due-bill alert follow the household\'s zone, not the UTC host', () => {
    at(new Date('2026-10-31T19:15:00Z'));
    const india = contextFromRows(rows('Asia/Kolkata'));
    expect([india.tz, india.summary.asOf]).toEqual(['Asia/Kolkata', '2026-11-01']);
    const newYork = contextFromRows(rows('America/New_York'));
    expect([newYork.tz, newYork.summary.asOf]).toEqual(['America/New_York', '2026-10-31']);
    // The rent due on 1 Nov is due "today" in India at this instant, not yet in New York.
    expect(notificationsOnServer(rows('Asia/Kolkata'), [], HID).map(n => [n.type, n.title]))
      .toEqual([['recurring_due_confirm', expect.stringMatching(/due today$/)]]);
    expect(notificationsOnServer(rows('America/New_York'), [], HID).filter(n => n.type === 'recurring_due_confirm')).toEqual([]);
    // A household with no zone yet is read on India time (the database default).
    const legacy = rows('');
    expect(contextFromRows(legacy).summary.asOf).toBe('2026-11-01');
  });

  it('CON-UNIT-W3-D12-004 · WhatsApp and the scheduler: the household\'s day, and each job in its own local slot', () => {
    const t = new Date('2026-10-31T19:15:00Z');
    expect(localDayIn(t, 'Asia/Kolkata')).toBe('2026-11-01');
    expect(localDayIn(t, 'America/New_York')).toBe('2026-10-31');
    expect(localDayIn(t, null)).toBe('2026-11-01');                 // unset: India time
    expect(localDayIn(t, 'Nowhere/Real')).toBe('2026-11-01');       // unknown: India time
    expect(zoneParts(t, 'Asia/Kathmandu')).toEqual({ day: '2026-11-01', minutes: 60, weekday: 0 });
    expect(localDay(new Date('2026-09-25T20:00:00Z'))).toBe('2026-09-26');   // the old IST default still holds

    // Bills at 09:00 local: India's run is 03:30 UTC; New York's (EST) is 14:00 UTC; never the evening before.
    expect(inJobSlot('bills', new Date('2026-11-02T03:30:00Z'), 'Asia/Kolkata')).toBe(true);
    expect(inJobSlot('bills', new Date('2026-11-02T03:00:00Z'), 'Asia/Kolkata')).toBe(false);
    expect(inJobSlot('bills', new Date('2026-11-02T03:30:00Z'), 'America/New_York')).toBe(false);
    expect(inJobSlot('bills', new Date('2026-11-02T14:00:00Z'), 'America/New_York')).toBe(true);
    // Exactly one half-hourly run falls in each household's slot, quarter-hour zones included.
    for (const tz of ['Asia/Kolkata', 'Asia/Kathmandu', 'America/New_York', 'Australia/Adelaide']) {
      const hits = Array.from({ length: 48 }, (_, i) => new Date(Date.UTC(2026, 10, 2) + i * 30 * 60_000))
        .filter(d => inJobSlot('digest', d, tz));
      expect(hits, tz).toHaveLength(1);
    }
    // The weekly summary: Sunday 18:00 local only. 1 Nov 2026 is a Sunday.
    expect(inJobSlot('weekly', new Date('2026-11-01T12:30:00Z'), 'Asia/Kolkata')).toBe(true);
    expect(inJobSlot('weekly', new Date('2026-11-02T12:30:00Z'), 'Asia/Kolkata')).toBe(false);
    expect(inJobSlot('alerts', new Date('2026-11-02T12:30:00Z'), 'Asia/Kolkata')).toBe(true);
  });
});
