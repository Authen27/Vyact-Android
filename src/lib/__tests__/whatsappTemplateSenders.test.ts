// W6b (v10.47.0) — senders for the approved templates that had none, and the replies
// their buttons promise. Pinned: each rule's trigger and exact values, the INR/private
// honesty rules, and that the 50/50 split written from WhatsApp is the app's split
// (the app's own effectiveAmount then counts only your half).
import { describe, expect, it } from 'vitest';
import {
  splitSharedAlerts, recurringLoggedAlerts, paydayAlerts, dailyDigest, monthClose, budgetSetup, runwayAlerts, monthName,
  billsTomorrow, nextDay, NOTHING_LOGGED_LINE,
  type TxnRow,
} from '../../../../supabase/functions/_shared/whatsapp-dispatch-rules';
import {
  sharedCapture, evenSplit, splitDoneReply, keptAsYoursReply, recurringUndoneReply, pausedReply,
} from '../../../../supabase/functions/_shared/whatsapp-template-replies';
import { buttonQuestion } from '../../../../supabase/functions/_shared/whatsapp-prefs';
import { isQueryAttempt, parseWhatsAppMessage } from '../../../../supabase/functions/_shared/whatsapp-parser';
import { effectiveAmount } from '../calculations';
import { mapCloudRow } from '../supabaseAdapter';
import { runwaySnapshot, type HouseholdRows } from '../serverEngine';
import type { Transaction } from '../../types';

const HH = { id: 'h', base_currency: 'INR' };
const ME = { profile_id: 'me', household_id: 'h', first_name: 'Rohan' };
const PRIYA = { profile_id: 'priya', household_id: 'h', first_name: 'Priya' };
const row = (id: string, p: Partial<TxnRow>): TxnRow => ({
  id, household_id: 'h', created_by: 'me', type: 'expense', amount: 100, currency: 'INR', date: '2026-09-26',
  description: 'x', category: 'groceries', extras: {}, ...p,
});

describe('W6b senders', () => {
  it('CON-UNIT-W6B-001 · split_shared_with_you: each new INR share → the linked participant, owner named, amounts without ₹', () => {
    const sends = splitSharedAlerts([
      { share_id: 's1', share: 800, split_id: 'x', description: 'Dinner at Olive', currency: 'INR', total_amount: 2400,
        owner_user_id: 'priya', recipient_profile_id: 'me', recipient_household_id: 'h' },
      { share_id: 's2', share: 10, split_id: 'y', description: 'Taxi', currency: 'USD', total_amount: 30,
        owner_user_id: 'priya', recipient_profile_id: 'me', recipient_household_id: 'h' },
    ], { priya: 'Priya' });
    expect(sends).toEqual([{ template: 'split_shared_with_you', householdId: 'h', toProfileId: 'me',
      values: ['Priya', '2,400', 'Dinner at Olive', '800'], dedupeKey: 'share:s1' }]);
  });

  it('CON-UNIT-W6B-002 · recurring_auto_logged: only a self-posting schedule, to its owner, keyed by the entry for Undo', () => {
    const posted = [
      row('t1', { amount: 649, description: 'Netflix', date: '2026-09-01', recurring_schedule_id: 'auto' }),
      row('t2', { amount: 25000, description: 'Rent', recurring_schedule_id: 'approve' }),
      row('t3', { amount: 99, recurring_schedule_id: 'auto', extras: { excluded: true } }),
    ];
    const schedules = [
      { id: 'auto', auto_confirm: true, created_by: 'me', txn_template: { description: 'Netflix' } },
      { id: 'approve', auto_confirm: false, created_by: 'me', txn_template: { description: 'Rent' } },
    ];
    expect(recurringLoggedAlerts({ household: HH, posted, schedules, members: [ME] })).toEqual([
      { template: 'recurring_auto_logged', householdId: 'h', toProfileId: 'me', values: ['Netflix', '649', '1 Sep'], dedupeKey: 'rec:t1' },
    ]);
    expect(recurringLoggedAlerts({ household: { id: 'h', base_currency: 'USD' }, posted, schedules, members: [ME] })).toEqual([]);
  });

  it('CON-UNIT-W6B-003 · payday: steady pay → payday_headroom; 5%+ off the median → the variable one; no bills or no room → nothing', () => {
    const salary = row('s', { type: 'income', category: 'salary', amount: 92000, date: '2026-09-26' });
    const bills = { count: 5, total: 35100 };
    expect(paydayAlerts({ household: HH, today: '2026-09-26', salaries: [salary], earlier: [91000, 92500, 92000], bills, members: [ME] }))
      .toEqual([{ template: 'payday_headroom', householdId: 'h', toProfileId: 'me', dedupeKey: 'payday:s',
        values: ['Rohan', '92,000', '56,900', 'five', '35,100'] }]);
    expect(paydayAlerts({ household: HH, today: '2026-09-26', salaries: [salary], earlier: [83000, 84000, 83600], bills, members: [ME] })[0])
      .toEqual(expect.objectContaining({ template: 'payday_headroom_variable', values: ['Rohan', '92,000', '₹8,400 more', '56,900', 'five', '35,100'] }));
    expect(paydayAlerts({ household: HH, today: '2026-09-26', salaries: [salary], earlier: [], bills: { count: 0, total: 0 }, members: [ME] })).toEqual([]);
    expect(paydayAlerts({ household: HH, today: '2026-09-26', salaries: [salary], earlier: [], bills: { count: 2, total: 95000 }, members: [ME] })).toEqual([]);
    expect(paydayAlerts({ household: HH, today: '2026-09-27', salaries: [salary], earlier: [], bills, members: [ME] })).toEqual([]);
  });

  it('CON-UNIT-W6B-004 · digest: households of one or more (v10.58.0), today only, private and transfers out, split at your share, "you" for the reader', () => {
    const txns = [
      row('a', { created_by: 'priya', amount: 3200 }),
      row('b', { created_by: 'me', amount: 2000 }),
      row('c', { created_by: 'me', amount: 420, extras: { split: { isSplit: true, totalAmount: 420, yourShare: 210, paidBy: 'me', participants: [] } } }),
      row('d', { created_by: 'me', amount: 9999, extras: { excluded: true } }),
      row('e', { created_by: 'me', amount: 5000, type: 'transfer', category: null }),
      row('f', { created_by: 'me', amount: 70, date: '2026-09-25' }),
    ];
    const sends = dailyDigest({ household: HH, today: '2026-09-26', txns, members: [ME, PRIYA], names: { priya: 'Priya', me: 'Rohan' }, memberCount: 2 });
    expect(sends[0]).toEqual({ template: 'household_daily_digest', householdId: 'h', toProfileId: 'me',
      values: ['Rohan', '5,410', '3', 'Priya ₹3,200 · you ₹2,210'], dedupeKey: 'digest:2026-09-26' });
    expect(sends[1].values[3]).toBe('you ₹3,200 · Rohan ₹2,210');
    // v10.58.0 — a household of one gets its digest too.
    expect(dailyDigest({ household: HH, today: '2026-09-26', txns, members: [ME], names: {}, memberCount: 1 })[0].values)
      .toEqual(['Rohan', '5,410', '3', 'someone ₹3,200 · you ₹2,210']);
    expect(dailyDigest({ household: HH, today: '2026-09-26', txns, members: [ME], names: {}, memberCount: 0 })).toEqual([]);
  });

  it('CON-UNIT-W6B-019 · a day with nothing logged still gets the evening message: the new template once approved, the digest saying so until then', () => {
    const yesterday = [row('a', { date: '2026-09-25', amount: 900 })];
    const base = { household: HH, today: '2026-09-26', txns: yesterday, members: [ME, PRIYA], names: {}, memberCount: 2 };
    expect(dailyDigest({ ...base, nothingTemplateLive: true })).toEqual([
      { template: 'daily_nothing_logged', householdId: 'h', toProfileId: 'me', values: ['Rohan'], dedupeKey: 'digest:2026-09-26' },
      { template: 'daily_nothing_logged', householdId: 'h', toProfileId: 'priya', values: ['Priya'], dedupeKey: 'digest:2026-09-26' },
    ]);
    expect(dailyDigest({ ...base, nothingTemplateLive: false })[0]).toEqual({ template: 'household_daily_digest', householdId: 'h',
      toProfileId: 'me', values: ['Rohan', '0', '0', NOTHING_LOGGED_LINE], dedupeKey: 'digest:2026-09-26' });
    // The fallback says ₹, so it is INR only; the new template has no currency and suits anyone.
    const usd = { ...base, household: { id: 'h', base_currency: 'USD' } };
    expect(dailyDigest({ ...usd, nothingTemplateLive: false })).toEqual([]);
    expect(dailyDigest({ ...usd, nothingTemplateLive: true })).toHaveLength(2);
    // Only private entries today is not "nothing logged": nothing is sent.
    expect(dailyDigest({ ...base, txns: [row('p', { extras: { excluded: true } })], nothingTemplateLive: true })).toEqual([]);
    // No first name, no greeting to send.
    expect(dailyDigest({ ...base, members: [{ profile_id: 'x', household_id: 'h' }], nothingTemplateLive: true })).toEqual([]);
  });

  it('CON-UNIT-W6B-020 · a bill that posts itself is announced the day before (as the approved bill_due_reminder), to every linked member; nothing else is', () => {
    const sched = (id: string, p: Record<string, unknown>) => ({ id, household_id: 'h', next_due_date: '2026-10-02', auto_confirm: true, active: true,
      txn_template: { type: 'expense', amount: 25000, currency: 'INR', description: 'Rent', category: 'rent_mortgage' }, ...p });
    const schedules = [
      sched('rent', {}),
      sched('emi', { txn_template: { type: 'expense', amount: 18500, currency: 'INR', description: 'Home loan EMI', category: 'loan_emi', debtId: 'd' } }),
      sched('approval', { auto_confirm: false }),
      sched('salary', { txn_template: { type: 'income', amount: 92000, currency: 'INR', description: 'Salary' } }),
      sched('later', { next_due_date: '2026-10-05' }),
      sched('paused', { active: false }),
    ];
    const sends = billsTomorrow({ today: '2026-10-01', schedules: schedules as never, members: [ME, PRIYA] });
    expect(sends.map((x) => `${x.toProfileId}:${x.dedupeKey}`)).toEqual([
      'me:bill:rent:2026-10-02', 'priya:bill:rent:2026-10-02',
      'me:bill:emi:2026-10-02', 'priya:bill:emi:2026-10-02',
    ]);
    expect(sends[0]).toEqual(expect.objectContaining({ template: 'bill_due_reminder', values: ['Rent', '₹25,000', '2 Oct', 'Rent'] }));
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
  });

  it('CON-UNIT-W6B-005 · month close: on the 1st, last month vs the one before, biggest slice, days with an entry', () => {
    const txns = [
      row('a', { date: '2026-09-03', amount: 12400, category: 'food_dining' }),
      row('b', { date: '2026-09-10', amount: 51780, category: 'rent_mortgage' }),
      row('c', { date: '2026-08-05', amount: 67080, category: 'rent_mortgage' }),
      row('d', { date: '2026-09-10', amount: 500, extras: { excluded: true } }),
    ];
    const sends = monthClose({ household: HH, today: '2026-10-01', txns, members: [ME] });
    expect(sends).toEqual([{ template: 'month_close_summary', householdId: 'h', toProfileId: 'me', dedupeKey: 'month:2026-09',
      values: ['September', 'Rohan', '64,180', '₹2,900 less than August', 'Rent / Mortgage ₹51,780', '2 of 30'] }]);
    expect(monthClose({ household: HH, today: '2026-10-02', txns, members: [ME] })).toEqual([]);
    expect(monthClose({ household: HH, today: '2026-10-01', txns: txns.filter((t) => t.date >= '2026-09-01'), members: [ME] })[0].values[3])
      .toBe('nothing to compare with yet');
  });

  it('CON-UNIT-W6B-006 · budget set-up: exactly two days before a month with no budget, to owners/admins given', () => {
    const base = { household: HH, categoriesWithSpend: 7, hasNextMonthBudget: false, members: [ME] };
    expect(budgetSetup({ ...base, today: '2026-09-29' })).toEqual([{ template: 'budget_setup_reminder', householdId: 'h',
      toProfileId: 'me', values: ['Rohan', 'October', '7'], dedupeKey: 'setup:2026-10' }]);
    expect(budgetSetup({ ...base, today: '2026-09-28' })).toEqual([]);
    expect(budgetSetup({ ...base, today: '2026-09-29', hasNextMonthBudget: true })).toEqual([]);
    expect(budgetSetup({ ...base, today: '2026-02-27' })[0].values[1]).toBe('March');
    expect(monthName('2026-12')).toBe('December');
  });

  it('CON-UNIT-W6B-007 · runway: silent baseline, then only a 0.5-month change, at most once a month, the right variant', () => {
    const base = { household: HH, monthKey: '2026-10', quieterCategory: 'Food & Dining', members: [ME] };
    expect(runwayAlerts({ ...base, months: 5.1, state: null })).toEqual({ sends: [], state: { value: 5.1, detail: {} } });
    const small = runwayAlerts({ ...base, months: 4.8, state: { value: 5.1, detail: {} } });
    expect(small.sends).toEqual([]);
    const down = runwayAlerts({ ...base, months: 4.2, state: { value: 5.1, detail: {} } });
    expect(down.sends).toEqual([{ template: 'runway_shift_alert', householdId: 'h', toProfileId: 'me', values: ['Rohan', '4.2', '5.1'], dedupeKey: 'runway:2026-10' }]);
    expect(down.state).toEqual({ value: 4.2, detail: { lastSent: '2026-10' } });
    expect(runwayAlerts({ ...base, months: 3.0, state: down.state! }).sends).toEqual([]);          // once a month
    const up = runwayAlerts({ ...base, monthKey: '2026-11', months: 5.1, state: down.state! });
    expect(up.sends[0]).toEqual(expect.objectContaining({ template: 'runway_recovered_alert', values: ['Rohan', '5.1', '4.2', 'A quieter month on food & dining'] }));
    expect(runwayAlerts({ ...base, months: null, state: null })).toEqual({ sends: [], state: null });
  });
});

describe('W6b replies', () => {
  it('CON-UNIT-W6B-008 · "shared" on a capture is recognised as a whole word and removed before parsing', () => {
    expect(sharedCapture('1200 dinner shared')).toEqual({ shared: true, text: '1200 dinner' });
    expect(sharedCapture('shared 450 cab hdfc')).toEqual({ shared: true, text: '450 cab hdfc' });
    expect(sharedCapture('1200 sharedspace rent')).toEqual({ shared: false, text: '1200 sharedspace rent' });
  });

  it('CON-UNIT-W6B-009 · the 50/50 split is the app\'s split: only your half counts, the shares add to the total', () => {
    const even = evenSplit(1200.01, { email: 'Priya@Example.com', name: 'Priya' });
    expect(even.yourShare + even.partnerShare).toBeCloseTo(1200.01, 2);
    expect(even.split.participants).toEqual([
      { name: 'You', isYou: true, share: 1200, paid: true, paidOn: null },
      { name: 'Priya', share: 600.01, paid: false, paidOn: null, email: 'priya@example.com' },
    ].map((p, i) => i === 0 ? { ...p, share: even.yourShare } : { ...p, share: even.partnerShare }));
    // The row the RPC writes, read back through the app's own mapper and money rule.
    const txn = mapCloudRow('transactions', {
      id: 't', household_id: 'h', type: 'expense', amount: 1200.01, currency: 'INR', date: '2026-09-26', description: 'Dinner',
      category: 'food_dining', extras: { split: even.split }, created_by: 'me', member_id: null, note: null, recurring: null,
      account_id: null, to_account_id: null, created_at: '', updated_at: '', deleted_at: null,
    }) as Transaction;
    expect(effectiveAmount(txn, 'INR', {})).toBe(even.yourShare);
    expect(splitDoneReply('Dinner at Olive', 600, 600, 'Priya', 'INR')).toBe("Split. Your share of Dinner at Olive is ₹600, and so is Priya's. It's under Splits in Vyact.");
    expect(keptAsYoursReply(1200, 'Dinner at Olive', 'INR')).toBe('Kept as yours: ₹1,200 for Dinner at Olive.');
  });

  it('CON-UNIT-W6B-010 · recurring Undo / Pause replies read as the board; "Show the working" asks Pip about that amount', () => {
    expect(recurringUndoneReply('Netflix', 649, 'INR', '2026-08-01')).toBe('Undone. Netflix ₹649 for 1 Aug is removed. The schedule stays on for next month.');
    expect(pausedReply('Netflix', false)).toBe('Paused Netflix. Nothing more will post until you turn it back on in Recurring.');
    expect(buttonQuestion('affordability_reply', 'Show the working', 'aff:40000:kx1')).toBe('can I afford 40000? show me the working');
  });

  it('CON-UNIT-W6B-011 · the runway snapshot is the engine\'s own forecast, and names the category that fell most', () => {
    const acc = 'a0000000-0000-4000-8000-000000000001';
    const t = (id: string, date: string, amount: number, category: string) => ({ id, household_id: 'h', created_by: null, member_id: null,
      type: 'expense', amount, currency: 'INR', date, description: 'x', category, note: null, recurring: null, extras: {},
      account_id: acc, to_account_id: null, created_at: `${date}T09:00:00Z`, updated_at: `${date}T09:00:00Z`, deleted_at: null });
    const rows: HouseholdRows = {
      transactions: [t('1', '2026-08-05', 20000, 'food_dining'), t('2', '2026-08-06', 10000, 'rent_mortgage'),
        t('3', '2026-09-05', 8000, 'food_dining'), t('4', '2026-09-06', 10000, 'rent_mortgage')],
      budgets: [], budgetAllocations: [], goals: [], debts: [], assets: [], recurring: [],
      accounts: [{ id: acc, household_id: 'h', kind: 'bank', name: 'HDFC', currency: 'INR', opening_balance: 200000,
        is_default: true, is_archived: false, reconciliation_offset: 0, reconciliation_log: [], payment_modes: [],
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: null }],
      memberCount: 1, rates: [], profile: { display_name: 'Rohan' },
      household: { type: 'family', base_currency: 'INR', language: 'en', payoff_strategy: 'avalanche', extra_payment: 0 }, email: '',
    };
    const snap = runwaySnapshot(rows, new Date('2026-10-02T06:00:00Z'));
    expect(snap.quieterCategory).toBe('Food & Dining');
    expect(snap.months).not.toBeNull();
    expect(snap.months!).toBeGreaterThan(0);
  });
});

describe('the question that was logged as a spend (found by the 26 Sep validation)', () => {
  it('CON-UNIT-W6B-015 · "can I afford 40000 for a phone?" is a question, never a ₹40,000 entry; a leading amount is still a log', () => {
    for (const q of ['can i afford 40000 for a phone?', 'should i buy a 5000 watch', 'could we afford a 2 lakh trip', 'is 450 too much for lunch?']) {
      expect(isQueryAttempt(q), q).toBe(true);
    }
    for (const l of ['1200 lunch?', '450 lunch hdfc', 'spent 450 on lunch', 'paid 1200 total groceries']) expect(isQueryAttempt(l), l).toBe(false);
    expect(parseWhatsAppMessage('can I afford 40000 for a phone?', [], 'INR', new Date('2026-09-26T00:00:00Z'))).toEqual({ ok: false, reason: 'query' });
  });
});

describe('affordability asks in any wording (found on production 27 Sep)', () => {
  const ASKS = [
    'Can I afford to spend 5 rupees for tea',
    'can i afford to spend 5 rupees for tea',
    'pip, can I afford a 2000 dinner',
    'hey can we afford a 50k trip',
    '5k on shoes, can I afford it',
    'is it ok to spend 800 on a movie',
    'would it be wise to buy a 30000 phone',
    'do I have enough for a 1500 dinner',
    'can I spend 300 on snacks',
    'is 20000 affordable for a tv',
  ];
  const LOGS = ['5 tea', '5 rupees tea cash', 'spent 5 on tea', 'paid 1200 total groceries', 'tea 5', 'bought shoes 5000'];
  it('CON-UNIT-W6B-017 · every affordability wording is a question, never an entry; plain captures still log', () => {
    const d = new Date('2026-09-27T00:00:00Z');
    for (const q of ASKS) expect(parseWhatsAppMessage(q, [], 'INR', d), q).toEqual({ ok: false, reason: 'query' });
    for (const l of LOGS) expect(parseWhatsAppMessage(l, [], 'INR', d).ok, l).toBe(true);
    expect(isQueryAttempt('1200 lunch?')).toBe(false);
  });
});

describe('a line that opens like a question is one (found on production 27 Sep)', () => {
  it('CON-UNIT-W6B-018 · "Why can\'t I spend 5 rupees although…" is a question, never a ₹5 entry; entries still log', () => {
    const d = new Date('2026-09-27T00:00:00Z');
    const ASKS = [
      "Why can't I spend 5 rupees although I have 80% of groceries budget and nearly 90% of food and dining budget",
      "why can’t i spend 5 on tea",
      'how come I spent 4000 on food',
      "what's my budget for groceries",
      'is 450 too much for lunch',
      "can't I buy a 500 shirt",
      'do I have 2000 left for groceries',
      'show me 500 spends',
    ];
    const LOGS = ['spent 5 on tea', 'tea 5', 'paid 1200 total groceries', '450 lunch hdfc', 'may rent 25000', 'lunch 450 food budget', 'uber 300'];
    for (const q of ASKS) expect(parseWhatsAppMessage(q, [], 'INR', d), q).toEqual({ ok: false, reason: 'query' });
    for (const l of LOGS) expect(parseWhatsAppMessage(l, [], 'INR', d).ok, l).toBe(true);
  });
});
