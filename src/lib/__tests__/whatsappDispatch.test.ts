// W2 (v10.42.0) — consent, STOP, and what the scheduler sends. The rules are pure
// and run here directly; the dispatcher handler is driven through the edge harness.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXPENSE_CATEGORIES } from '../../constants';
import { spendByCategoryInRange as clientSpend } from '../calculations';
import { TEMPLATES } from '../../../../supabase/functions/_shared/whatsapp-templates';
import {
  TOPICS, TEMPLATE_TOPIC, DEFAULT_PREFS, refusalFor, parsePrefCommand, applyPrefCommand, buttonReply, buttonQuestion, consentOf,
} from '../../../../supabase/functions/_shared/whatsapp-prefs';
import {
  EXPENSE_LABEL, largeSpendAlerts, budgetAlerts, splitSettledAlerts, weeklySummary, staleBalanceNudge,
  isoWeek, localDay, rowToTxn, billReminders, overdueBillReminders, parsePaidReply, reminderFromAudit, matchReminders,
  type TxnRow, type BillSchedule, type SentReminder,
} from '../../../../supabase/functions/_shared/whatsapp-dispatch-rules';
import type { Transaction as ClientTxn } from '../../types';
import { captureHandler, queryResult } from './helpers/edgeHarness';

const api = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } }));
vi.mock('https://esm.sh/@supabase/supabase-js@2.45.0', () => ({ createClient: () => api }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}'))); });
afterEach(() => vi.unstubAllGlobals());

let n = 0;
const txn = (p: Partial<TxnRow>): TxnRow => ({
  id: `t-${++n}`, household_id: 'h', created_by: 'alice', type: 'expense', amount: 100, currency: 'INR',
  date: '2026-09-20', category: 'food_dining', account_id: 'acc-1', extras: null, ...p,
});
const HH = { id: 'h', base_currency: 'INR' };
const MEMBERS = [{ profile_id: 'alice', household_id: 'h' }, { profile_id: 'bob', household_id: 'h' }];

describe('topics and consent', () => {
  it('CON-UNIT-WA-D-001 · the server’s category labels match constants.ts', () => {
    expect(EXPENSE_LABEL).toEqual(Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c.id, c.label])));
  });

  it('CON-UNIT-WA-D-002 · every template has a topic; bills and large-spend alerts can never be muted', () => {
    for (const name of Object.keys(TEMPLATES)) expect(TEMPLATE_TOPIC[name], name).toBeDefined();
    expect(TOPICS.bills.mutable).toBe(false);
    expect(TOPICS.large_spend.mutable).toBe(false);
    // Every STOP word a footer promises is understood.
    for (const def of Object.values(TEMPLATES)) {
      const word = /STOP ([A-Z]+)/.exec(def.footer ?? '')?.[1];
      if (word) expect(parsePrefCommand(`STOP ${word}`), def.name).toEqual({ kind: 'stop', topic: TEMPLATE_TOPIC[def.name] });
    }
  });

  it('CON-UNIT-WA-D-003 · marketing needs opt-in, insights needs opt-in, a muted topic is refused', () => {
    expect(refusalFor(TEMPLATES.weekly_summary, DEFAULT_PREFS)).toBe('marketing_consent_required');
    expect(refusalFor(TEMPLATES.payday_headroom, DEFAULT_PREFS)).toBe('insights_consent_required');
    expect(refusalFor(TEMPLATES.budget_threshold_alert, { ...DEFAULT_PREFS, muted_topics: ['budgets'] })).toBe('muted');
    // A marketing-classed template needs marketing even if its topic is utility-by-default.
    expect(consentOf(TEMPLATES.runway_shift_alert)).toBe('marketing');
    // Muting bills does nothing: the alert still goes.
    expect(refusalFor(TEMPLATES.large_transaction_alert, { ...DEFAULT_PREFS, muted_topics: ['large_spend', 'bills'] })).toBeNull();
  });

  it('CON-UNIT-WA-D-004 · STOP / START parsing and replies', () => {
    expect(parsePrefCommand('Stop.')).toEqual({ kind: 'stop_all' });
    expect(parsePrefCommand('stop payday')).toEqual({ kind: 'stop', topic: 'payday' });
    expect(parsePrefCommand('START BUDGETS')).toEqual({ kind: 'start', topic: 'budgets' });
    expect(parsePrefCommand('start')).toBeNull();                        // bare START is the menu
    expect(parsePrefCommand('stop 450 lunch')).toBeNull();
    expect(parsePrefCommand('stop bananas')).toEqual({ kind: 'unknown_topic', word: 'bananas' });
    const bills = applyPrefCommand(DEFAULT_PREFS, { kind: 'stop', topic: 'bills' });
    expect(bills.prefs).toEqual(DEFAULT_PREFS);
    expect(bills.reply).toContain("can't be switched off here");
    const weekly = applyPrefCommand(DEFAULT_PREFS, { kind: 'start', topic: 'weekly' });
    expect(weekly.reply).toContain('only come once you turn on');           // START never grants marketing consent
    expect(weekly.prefs.marketing_opt_in).toBe(false);
  });

  it('CON-UNIT-WA-D-005 · every quick reply in the manifest is answered, or is a named W3 button', () => {
    const W3 = new Set(['Undo', 'Pause this one', 'Split 50/50', "It's all mine", 'Not shared', 'Show the working',
      'Menu', 'Log a spend', 'What can I send?',   // the welcome's, answered in W1
      'Already paid',                             // bill_overdue_reminder: the webhook's approve path (W5)
      'Name them here', 'Update here']);          // start the W6 conversations in the webhook
    for (const def of Object.values(TEMPLATES)) {
      for (const b of def.buttons ?? []) {
        if (b.type !== 'quick_reply' || W3.has(b.text)) continue;
        // Answered with a reply, or (v10.46.0) a question Pip answers in the chat.
        const handled = buttonReply(def.name, b.text, 'https://vyact.app') ?? buttonQuestion(def.name, b.text, 'budget:b:food_dining:80');
        expect(handled, `${def.name} · ${b.text}`).not.toBeNull();
      }
    }
  });
});

describe('what the scheduler sends', () => {
  it('CON-UNIT-WA-D-006 · a large spend goes to the OTHER members over their threshold; private, scheduled and small ones do not', () => {
    const sends = largeSpendAlerts({
      household: HH, members: MEMBERS, thresholds: { bob: 15000 }, accountNames: { 'acc-1': 'HDFC card' },
      txns: [
        txn({ id: 'big', amount: 18000 }),
        txn({ id: 'private', amount: 50000, extras: { excluded: true } }),
        txn({ id: 'rent', amount: 25000, recurring_schedule_id: 's-1' }),
        txn({ id: 'small', amount: 12000 }),
        txn({ id: 'usd', amount: 20000, currency: 'USD' }),
      ],
    });
    expect(sends).toEqual([{ template: 'large_transaction_alert', householdId: 'h', toProfileId: 'bob',
      values: ['18,000', 'HDFC card'], dedupeKey: 'txn:big' }]);
    expect(largeSpendAlerts({ household: { id: 'h', base_currency: 'USD' }, members: MEMBERS, thresholds: {},
      accountNames: { 'acc-1': 'x' }, txns: [txn({ amount: 99999, created_by: 'zed' })] })).toEqual([]);   // ₹ in the text
  });

  it('CON-UNIT-WA-D-007 · a budget line at 80–99% alerts once per period, with the Budgets screen’s own spend figure', () => {
    const txns = [
      txn({ amount: 3000, date: '2026-09-05' }),
      txn({ amount: 1100, date: '2026-09-18', extras: { split: { isSplit: true, yourShare: 1000 } } as never }),   // only your share counts
      txn({ amount: 9999, date: '2026-09-10', extras: { excluded: true } }),       // private: not spend
      txn({ amount: 500, date: '2026-08-30' }),                                    // outside the period
      txn({ amount: 4000, date: '2026-09-12', category: 'groceries' }),
    ];
    const sends = budgetAlerts({
      household: HH, today: '2026-09-21', members: [MEMBERS[0]], txns,
      budgets: [{ id: 'b-9', currency: 'INR', period_start: '2026-09-01', period_end: '2026-09-30' }],
      allocations: [{ budget_id: 'b-9', category: 'food_dining', amount: 5000 }, { budget_id: 'b-9', category: 'groceries', amount: 4000 }],
    });
    // The client's own function over the same rows gives the same spend.
    const client = clientSpend(txns.map(rowToTxn) as unknown as ClientTxn[], '2026-09-01', '2026-09-30', 'INR', {});
    expect(client.food_dining).toBe(4000);
    expect(sends).toEqual([{ template: 'budget_threshold_alert', householdId: 'h', toProfileId: 'alice',
      values: ['Food & Dining', '80', '9', '1,000'], dedupeKey: 'budget:b-9:food_dining:80' }]);   // groceries is at 100%: no "still in the pot"
  });

  it('CON-UNIT-WA-D-008 · a household with any foreign-currency spend gets no budget alert (no rates on the server)', () => {
    expect(budgetAlerts({
      household: HH, today: '2026-09-21', members: MEMBERS,
      txns: [txn({ amount: 4500 }), txn({ amount: 10, currency: 'USD' })],
      budgets: [{ id: 'b', currency: 'INR', period_start: '2026-09-01', period_end: '2026-09-30' }],
      allocations: [{ budget_id: 'b', category: 'food_dining', amount: 5000 }],
    })).toEqual([]);
  });

  it('CON-UNIT-WA-D-009 · split settled, weekly summary and stale balances', () => {
    expect(splitSettledAlerts([{ share_id: 's1', share: 600, payer_name: 'Priya', split_description: 'Dinner at Olive',
      split_currency: 'INR', owner_profile_id: 'alice', owner_household_id: 'h' }])[0].values).toEqual(['Priya', '₹600', 'Dinner at Olive']);

    const week = weeklySummary({ household: HH, today: '2026-09-27', member: MEMBERS[0], weekKey: 'W',
      txns: [txn({ amount: 1200, date: '2026-09-21' }), txn({ amount: 800, date: '2026-09-26', category: 'groceries' }),
        txn({ amount: 5000, date: '2026-09-20' }), txn({ type: 'income', amount: 90000, date: '2026-09-25', category: 'salary' })] });
    expect(week?.values).toEqual(['₹2,000', '2', 'Food & Dining']);
    expect(weeklySummary({ household: HH, today: '2026-09-27', member: MEMBERS[0], weekKey: 'W', txns: [] })).toBeNull();

    const now = new Date('2026-09-27T12:00:00Z');
    const nudge = staleBalanceNudge({ household: HH, now, member: { ...MEMBERS[0], first_name: 'Rohan' }, weekKey: 'W',
      accounts: [{ id: 'a', created_at: '2026-01-01', last_reconciled_at: '2026-08-01T00:00:00Z' },
        { id: 'b', created_at: '2026-01-01', last_reconciled_at: null },
        { id: 'c', created_at: '2026-01-01', last_reconciled_at: '2026-09-20T00:00:00Z' }] });
    expect(nudge?.values).toEqual(['Rohan', 'two']);
  });

  it('CON-UNIT-WA-D-010 · local day and ISO week', () => {
    expect(localDay(new Date('2026-09-25T20:00:00Z'))).toBe('2026-09-26');    // 01:30 IST
    expect(isoWeek('2026-09-27')).toBe('2026-W39');
    expect(isoWeek('2026-01-01')).toBe('2026-W01');
  });
});

describe('bill reminders and "paid X" (W2b)', () => {
  const sched = (p: Partial<BillSchedule> = {}): BillSchedule => ({
    id: '44444444-4444-4444-8444-444444444444', household_id: 'h', next_due_date: '2026-09-25', auto_confirm: false, active: true,
    txn_template: { type: 'expense', amount: 25000, currency: 'INR', description: 'Rent', category: 'rent_mortgage' }, ...p,
  });

  it('CON-UNIT-WA-B-001 · only approval bills due TODAY, to approvers; never auto-posting, EMI, income or future ones', () => {
    const sends = billReminders({ today: '2026-09-25', approvers: [MEMBERS[0]], schedules: [
      sched(),
      sched({ id: 'auto', auto_confirm: true }),
      sched({ id: 'emi', txn_template: { type: 'expense', amount: 9000, currency: 'INR', description: 'Car EMI', category: 'loan_emi' } }),
      sched({ id: 'pay', txn_template: { type: 'income', amount: 92000, currency: 'INR', description: 'Salary', category: 'salary' } }),
      sched({ id: 'later', next_due_date: '2026-09-26' }),
    ] });
    expect(sends).toEqual([{ template: 'bill_due_reminder', householdId: 'h', toProfileId: 'alice',
      values: ['Rent', '₹25,000', '25 Sep', 'Rent'], dedupeKey: 'bill:44444444-4444-4444-8444-444444444444:2026-09-25' }]);
  });

  it('CON-UNIT-W5-012 · the overdue reminder goes once, three days after an approval bill fell due, with a relative date', () => {
    const sends = overdueBillReminders({ today: '2026-09-28', approvers: [MEMBERS[0]], schedules: [
      sched({ next_due_date: '2026-09-25' }),                          // 3 days overdue
      sched({ id: 'fresh', next_due_date: '2026-09-27' }),             // 1 day: not yet
      sched({ id: 'auto', next_due_date: '2026-09-25', auto_confirm: true }),
    ] });
    expect(sends).toEqual([{ template: 'bill_overdue_reminder', householdId: 'h', toProfileId: 'alice',
      values: ['Rent', 'three days ago', '₹25,000', 'Rent'], dedupeKey: 'bill:44444444-4444-4444-8444-444444444444:2026-09-25' }]);
    // The same occurrence's due-day reminder and overdue reminder are different events, so both can go.
    expect(billReminders({ today: '2026-09-25', approvers: [MEMBERS[0]], schedules: [sched({ next_due_date: '2026-09-25' })] })[0].dedupeKey)
      .toBe(sends[0].dedupeKey);
  });

  it('CON-UNIT-WA-B-002 · "paid" replies parse, and match only a reminder of that name that was sent', () => {
    expect(parsePaidReply('paid Rent')).toEqual({ name: 'Rent' });
    expect(parsePaidReply('Paid rent 25,000.')).toEqual({ name: 'rent', amount: 25000 });
    expect(parsePaidReply('paid 450 lunch')).toEqual({ name: '450 lunch' });   // no reminder by that name → an ordinary entry
    expect(parsePaidReply('450 lunch')).toBeNull();
    const sent = [
      reminderFromAudit({ wa_message_id: 'out:bill_due_reminder:alice:bill:44444444-4444-4444-8444-444444444444:2026-09-25', payload: { params: ['Rent', '₹25,000', '25 Sep', 'Rent'] } }),
      reminderFromAudit({ wa_message_id: 'out:bill_due_reminder:alice:bill:44444444-4444-4444-8444-444444444444:2026-08-25', payload: { params: ['Rent', '₹25,000', '25 Aug', 'Rent'] } }),
      reminderFromAudit({ wa_message_id: 'out:split_settled:alice:split:s1', payload: { params: ['x'] } }),
    ].filter(Boolean) as SentReminder[];
    expect(sent).toHaveLength(2);
    expect(matchReminders('RENT', sent)).toEqual([{ scheduleId: '44444444-4444-4444-8444-444444444444', occurrence: '2026-09-25', replyWord: 'Rent' }]);
    expect(matchReminders('Netflix', sent)).toEqual([]);
  });
});

describe('the dispatcher', () => {
  it('CON-UNIT-WA-D-011 · refuses without its secret or the service key, and is inert when neither is set', async () => {
    let handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-dispatch/index'), { WHATSAPP_DISPATCH_SECRET: 's3cret' });
    const call = (h: typeof handler, headers: Record<string, string>) =>
      h(new Request('https://edge.example.com/dispatch?job=alerts', { method: 'POST', headers }));
    expect((await call(handler, { 'x-dispatch-secret': 'wrong' })).status).toBe(403);
    expect((await call(handler, {})).status).toBe(403);
    vi.resetModules();
    handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-dispatch/index'));
    expect((await call(handler, { 'x-dispatch-secret': '' })).status).toBe(403);
    expect(api.from).not.toHaveBeenCalled();
  });

  it('CON-UNIT-WA-D-012 · a large spend flows through the guarded send (gated off: recorded, not sent)', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-dispatch/index'), { WHATSAPP_DISPATCH_SECRET: 's3cret' });
    const audits: Record<string, unknown>[] = [];
    api.from.mockImplementation((table: string) => {
      if (table === 'whatsapp_identities') {
        const q = queryResult([{ profile_id: 'alice', household_id: 'h' }, { profile_id: 'bob', household_id: 'h' }]);
        q.maybeSingle.mockReturnValue(queryResult({ phone_number: '222', household_id: 'h' }));
        return q;
      }
      if (table === 'households') return queryResult({ id: 'h', base_currency: 'INR' });
      if (table === 'transactions') return queryResult([txn({ id: 'big', amount: 18000 })]);
      if (table === 'accounts') return queryResult([{ id: 'acc-1', name: 'HDFC card' }]);
      if (table === 'budgets') return queryResult([]);
      if (table === 'whatsapp_preferences') return queryResult(null);
      if (table === 'shared_split_shares') return queryResult([]);
      if (table === 'whatsapp_inbound_messages') {
        const q = queryResult(null);
        q.insert.mockImplementation((row: Record<string, unknown>) => { audits.push(row); return q; });
        return q;
      }
      throw new Error(`Unexpected table ${table}`);
    });
    api.rpc.mockResolvedValue({ data: [], error: null });   // W6b: no new shared splits
    const res = await handler(new Request('https://edge.example.com/dispatch?job=alerts', { method: 'POST', headers: { 'x-dispatch-secret': 's3cret' } }));
    const out = await res.json();
    expect(out).toEqual(expect.objectContaining({ status: 'ok', job: 'alerts', planned: 1, results: { 'skipped:outbound_disabled': 1 }, problems: [] }));
    expect(audits[0]).toEqual(expect.objectContaining({ profile_id: 'bob', status: 'skipped', direction: 'outbound' }));
    expect(fetch).not.toHaveBeenCalled();
  });
});
