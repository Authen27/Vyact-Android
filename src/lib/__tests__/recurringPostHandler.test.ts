// W4a (v10.70.0; owner decision D16) — the `recurring-post` job: pg_cron (Vault secret) → every
// due auto-approved bill, judged in its HOUSEHOLD's zone, planned by the app's own engine and
// applied by post_recurring_occurrence; a missed run catches up; loan EMIs stay with the app.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureHandler, queryResult } from './helpers/edgeHarness';
import { generateTransaction, advanceSchedule, isStaleOccurrence } from '../recurring';
import { txnToRow, mapCloudRow } from '../supabaseAdapter';
import { recurringPostPlan } from '../serverEngine';
import { recurringPostPlan as bundled } from '../../../../supabase/functions/_shared/agent/engine';
import type { RecurringSchedule } from '../../types';

const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('https://esm.sh/@supabase/supabase-js@2.45.0', () => ({ createClient: () => api }));
vi.mock('../../../../supabase/functions/_shared/agent/engine.ts', async () => {
  const { recurringPostPlan: real } = await import('../serverEngine');
  return { recurringPostPlan: real };
});

const SECRET = 'cron-secret-of-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const IN = '20000000-0000-4000-8000-0000000000a1';
const NY = '20000000-0000-4000-8000-0000000000a2';
const ACC = '40000000-0000-4000-8000-0000000000a1';
const scheduleRow = (id: string, hid: string, tz: string, p: Record<string, unknown>) => ({
  id, household_id: hid, created_by: null, frequency: 'monthly', day_of_month: null, weekday: null, start_date: '2026-01-01',
  next_due_date: '2026-10-21', last_generated: null, auto_confirm: true, active: true, reminder_lead_days: null, rrule: null,
  short_month_policy: 'last_day', owner_member_id: null, updated_at: '2026-10-01T00:00:00Z',
  txn_template: { type: 'expense', amount: 999, currency: 'INR', description: 'Bill', category: 'utilities', accountId: ACC },
  households: { timezone: tz }, ...p,
});

describe('recurring-post job (W4a)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T20:00:00Z'));   // 21 Oct 01:30 in India; 20 Oct 16:00 in New York
    api.rpc.mockReset(); api.from.mockReset();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const post = (h: (r: Request) => Promise<Response>, headers: Record<string, string> = {}) =>
    h(new Request('https://fn.example.com/recurring-post', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' }));

  it('W4-D16-004 · posts what is due in each household’s zone, catches up a missed run, leaves EMIs to the app', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/recurring-post/index'));
    const rows = [
      scheduleRow('30000000-0000-4000-8000-0000000000a1', IN, 'Asia/Kolkata', { day_of_month: 21 }),                      // due today in India
      scheduleRow('30000000-0000-4000-8000-0000000000a2', NY, 'America/New_York', { day_of_month: 21 }),                  // still the 20th there
      scheduleRow('30000000-0000-4000-8000-0000000000a3', IN, 'Asia/Kolkata', { frequency: 'daily', next_due_date: '2026-10-19' }),   // two runs missed
      scheduleRow('30000000-0000-4000-8000-0000000000a4', IN, 'Asia/Kolkata', { day_of_month: 21,
        txn_template: { type: 'expense', amount: 15000, currency: 'INR', description: 'EMI', category: 'loan_emi', accountId: ACC } }),
    ];
    const listing = queryResult(rows);
    api.from.mockImplementation((table: string) => {
      if (table !== 'recurring_schedules') throw new Error(`Unexpected table ${table}`);
      return listing;
    });
    api.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'recurring_post_cron_ok') return { data: args.p === SECRET, error: null };
      if (name === 'post_recurring_occurrence') return { data: { status: 'posted', already_posted: false }, error: null };
      return { data: null, error: null };
    });

    // No secret, no service key: refused before anything is read.
    expect((await post(handler)).status).toBe(403);
    expect(api.from).not.toHaveBeenCalled();

    const res = await post(handler, { 'x-cron-secret': SECRET });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schedules: 4, posted: 4, alreadyPosted: 0, fastForwarded: 0, finished: 0, errors: 0 });
    expect(listing.eq).toHaveBeenCalledWith('auto_confirm', true);
    expect(listing.lte).toHaveBeenCalledWith('next_due_date', '2026-10-21');   // the latest day anywhere (UTC+14)
    const calls = api.rpc.mock.calls.filter(([n]) => n === 'post_recurring_occurrence').map(([, a]) => a as Record<string, unknown>);
    expect(calls.map(a => [a.p_schedule_id, a.p_occurrence, a.p_next_due])).toEqual([
      ['30000000-0000-4000-8000-0000000000a1', '2026-10-21', '2026-11-21'],
      ['30000000-0000-4000-8000-0000000000a3', '2026-10-19', '2026-10-20'],
      ['30000000-0000-4000-8000-0000000000a3', '2026-10-20', '2026-10-21'],
      ['30000000-0000-4000-8000-0000000000a3', '2026-10-21', '2026-10-22'],
    ]);
    // The row is the app's: generateTransaction → txnToRow, under the deterministic id.
    const app = mapCloudRow('recurring', rows[0]) as RecurringSchedule;
    expect(calls[0].p_row).toEqual(JSON.parse(JSON.stringify(txnToRow(generateTransaction(app), IN))));
  });

  it('W4-D16-005 · the plan is the app engine’s: the same row and next date, null where the app would do nothing, fast-forward past the horizon', () => {
    const today = '2026-10-21';
    const base = scheduleRow('30000000-0000-4000-8000-0000000000b1', IN, 'Asia/Kolkata', { day_of_month: 31, next_due_date: '2026-10-31', start_date: '2026-01-31' });
    // Not due yet; approval-gated; paused; an EMI → nothing to do.
    for (const p of [{}, { next_due_date: '2026-10-21', auto_confirm: false }, { next_due_date: '2026-10-21', active: false },
      { next_due_date: '2026-10-21', txn_template: { type: 'expense', amount: 1, category: 'loan_emi', accountId: ACC } }]) {
      expect(recurringPostPlan({ ...base, ...p }, IN, today)).toBeNull();
    }
    // Due: the row and the next date from the schedule's rule (31 Oct → 30 Nov, its month-end rule).
    const due = { ...base, next_due_date: '2026-10-21', rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=21;COUNT=10' };
    const s = mapCloudRow('recurring', due) as RecurringSchedule;
    const plan = recurringPostPlan(due, IN, today)!;
    expect(plan).toEqual({ occurrence: '2026-10-21', post: true, lastGenerated: '2026-10-21',
      row: JSON.parse(JSON.stringify(txnToRow(generateTransaction(s), IN))), nextDue: advanceSchedule(s).nextDueDate, exhausted: false });
    expect(plan.nextDue).toBe('2026-11-21');
    expect(bundled(due, IN, today)).toEqual(plan);
    // The last one closes the schedule.
    const last = { ...due, rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=21;COUNT=10', start_date: '2026-01-21' };
    expect(recurringPostPlan(last, IN, today)).toMatchObject({ post: true, nextDue: null, exhausted: true });
    // Months behind (corrupt pointer): moved on without posting, to the first date inside the horizon.
    const stale = { ...due, next_due_date: '2026-03-21' };
    const ff = recurringPostPlan(stale, IN, today)!;
    expect(ff).toMatchObject({ occurrence: '2026-03-21', post: false, row: null, nextDue: '2026-09-21', lastGenerated: '2026-08-21', exhausted: false });
    expect(isStaleOccurrence(ff.nextDue!, today)).toBe(false);
  });
});
