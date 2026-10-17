// W5 (v10.46.0) — Pip's response contract and the Wave-1 engine facts (#63, #65, #66,
// day windows, counts and shares, bills this week). The clock is pinned to Sunday
// 20 September 2026 so "same point", "this week", pace and streaks are exact.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve, runAssistant, LlmBackend, quickReply, CAPABILITIES, type AssistantContext } from '../askVyactBackend';
import { resolveDayWindow } from '../askVyactParser';
import { buildSafeSummary } from '../aiSummary';
import { PHRASE_SYSTEM, type ModelCall } from '../askVyactLlm';
import type { IntentResult } from '../askVyactIntents';
import type { Transaction, Budget, Account, Profile, RecurringSchedule } from '../../types';
import { buttonQuestion } from '../../../../supabase/functions/_shared/whatsapp-prefs';

beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 8, 20, 12, 0), toFake: ['Date'] }); });
afterEach(() => { vi.useRealTimers(); });

const profile = { baseCurrency: 'INR', household: 'family', language: 'en' } as unknown as Profile;
const rates = { INR: 1 };
let n = 0;
const txn = (over: Partial<Transaction>): Transaction => ({
  id: `t${++n}`, type: 'expense', amount: 100, currency: 'INR', date: '2026-09-20', description: '',
  category: 'food_dining', accountId: 'acc-bank', ...over,
} as Transaction);
const accounts = [{ id: 'acc-bank', name: 'HDFC Bank', kind: 'bank', currency: 'INR', openingBalance: 100_000 }] as unknown as Account[];

function ctxOf(transactions: Transaction[], over: Partial<AssistantContext> = {}): AssistantContext {
  const budgets = (over.budgets ?? []) as Budget[];
  const summary = buildSafeSummary(transactions, budgets, [], [], [], profile, rates, accounts);
  return { summary, transactions, budgets, goals: [], debts: [], assets: [], accounts, profile, rates, baseCurrency: 'INR', ...over };
}
const intent = (id: string, entities: Record<string, unknown> = {}): IntentResult => ({
  id: id as IntentResult['id'], bucket: 'interpret', confidence: 0.9, entities: { text: 'q', ...entities },
});

describe('Pip — the name and the response contract', () => {
  it('CON-UNIT-W5-001 · the assistant is Pip, in its own words and in the phrasing prompt', () => {
    expect(quickReply('what do I call you')?.reply).toMatch(/^I'm Pip, the assistant built into Vyact\./);
    expect(resolve(intent('meta.assistant'), ctxOf([])).facts).toEqual(expect.objectContaining({ assistant_name: 'Pip', ...CAPABILITIES }));
    expect(PHRASE_SYSTEM).toMatch(/^You are Pip, Vyact's household-finance assistant\./);
    for (const rule of ['Never list follow-up options', 'ALWAYS states what it', 'do not have enough history yet',
      'No exclamation marks. No apologies. Never praise', 'never with other people', '`channel: "whatsapp"`: at most four short sentences, plain text, no links']) {
      expect(PHRASE_SYSTEM, rule).toContain(rule);
    }
  });

  it('CON-UNIT-W5-002 · the channel reaches the phrase step (WhatsApp answers differ; the app is the default)', async () => {
    const seen: string[] = [];
    const call: ModelCall = async ({ system, user }) => {
      if (system.includes('classify')) return JSON.stringify({ id: 'interpret.status', entities: {}, confidence: 0.9 });
      seen.push(JSON.parse(user).channel);
      return 'Your position is steady.';
    };
    await runAssistant('how am I doing', ctxOf([txn({})]), new LlmBackend(call), 0);
    await runAssistant('how am I doing', ctxOf([txn({})], { channel: 'whatsapp' }), new LlmBackend(call), 0);
    expect(seen).toEqual(['app', 'whatsapp']);
  });
});

describe('Wave 1 engine facts', () => {
  it('CON-UNIT-W5-003 · #63 this month is compared with the SAME point last month, not the whole month', () => {
    const ctx = ctxOf([
      txn({ amount: 3000, date: '2026-09-05' }), txn({ amount: 2000, date: '2026-09-18' }),          // this month: 5,000
      txn({ amount: 1000, date: '2026-08-10' }), txn({ amount: 1500, date: '2026-08-20' }),          // to 20 Aug: 2,500
      txn({ amount: 9000, date: '2026-08-28' }),                                                      // after the same point
    ]);
    const facts = resolve(intent('interpret.lookup'), ctx).facts as Record<string, unknown>;
    expect(facts.total_spent).toBe('₹5,000');
    expect(facts.same_point_last_month).toBe('₹2,500');
    expect(facts.same_point_is).toBe('the same point in August');
    expect(facts.compared_with_same_point).toBe('₹2,500 more');
    const food = resolve(intent('interpret.lookup', { category: 'food' }), ctx).facts as Record<string, unknown>;
    expect(food.compared_with_same_point).toBe('₹2,500 more');
    const empty = resolve(intent('interpret.lookup'), ctxOf([txn({ amount: 500 })])).facts as Record<string, unknown>;
    expect(empty.same_point_last_month).toBe('nothing recorded at that point last month');
  });

  it('CON-UNIT-W5-004 · day windows: today and this week are answered over their own dates, private rows excluded', () => {
    expect(resolveDayWindow('today')).toEqual({ start: '2026-09-20', end: '2026-09-20', label: 'today' });
    expect(resolveDayWindow('this week')).toEqual({ start: '2026-09-14', end: '2026-09-20', label: 'this week' });   // Mon–Sun
    expect(resolveDayWindow('last week')).toEqual({ start: '2026-09-07', end: '2026-09-13', label: 'last week' });
    expect(resolveDayWindow('last 7 days')).toEqual({ start: '2026-09-14', end: '2026-09-20', label: 'the last 7 days' });
    expect(resolveDayWindow('august')).toBeNull();                                                  // a month is resolvePeriod's
    const ctx = ctxOf([
      txn({ amount: 450, date: '2026-09-20' }), txn({ amount: 1200, date: '2026-09-20', category: 'groceries' }),
      txn({ amount: 999, date: '2026-09-20', excluded: true }),                                     // private
      txn({ amount: 800, date: '2026-09-15' }), txn({ amount: 5000, date: '2026-09-10' }),
    ]);
    const today = resolve(intent('interpret.lookup', { period: 'today' }), ctx);
    expect(today.facts).toEqual(expect.objectContaining({ period: 'today', total_spent: '₹1,650', entries: '2' }));
    const week = resolve(intent('interpret.lookup', { period: 'this week', category: 'food' }), ctx);
    expect(week.facts).toEqual(expect.objectContaining({ period: 'this week', spent: '₹1,250', entries_in_category: '2' }));
  });

  it('CON-UNIT-W5-005 · counts and shares per category; spend by account counts only what the totals count', () => {
    const ctx = ctxOf([
      txn({ amount: 600, date: '2026-09-02' }), txn({ amount: 400, date: '2026-09-03' }),
      txn({ amount: 1000, date: '2026-09-04', category: 'groceries' }),
      txn({ amount: 50_000, date: '2026-09-05', excluded: true }),                                  // private: not counted anywhere
      txn({ amount: 2000, date: '2026-09-06', split: { isSplit: true, totalAmount: 2000, yourShare: 1000, paidBy: 'me', participants: [] } }),
    ]);
    const facts = resolve(intent('interpret.lookup'), ctx).facts as { categories_in_period: Record<string, string>[]; spend_by_account: Record<string, string>[]; total_spent: string };
    expect(facts.total_spent).toBe('₹3,000');
    expect(facts.categories_in_period[0]).toEqual(expect.objectContaining({ category: 'Food & Dining', spent: '₹2,000', entries: '3', share_of_period: '67%' }));
    expect(facts.spend_by_account).toEqual([{ paid_from: 'HDFC Bank', spent: '₹3,000' }]);           // was ₹53,000 + the split in full
  });

  it('CON-UNIT-W5-006 · #66 budgets on pace: used faster than the month has gone is "ahead of pace"', () => {
    const budgets = [
      { id: 'b1', category: 'food_dining', limit: 10_000, currency: 'INR', period: 'monthly', scope: 'month' },
      { id: 'b2', category: 'groceries', limit: 10_000, currency: 'INR', period: 'monthly', scope: 'month' },
    ] as unknown as Budget[];
    const ctx = ctxOf([txn({ amount: 4000, date: '2026-09-05' }), txn({ amount: 9000, date: '2026-09-06', category: 'groceries' })], { budgets });
    const facts = resolve(intent('interpret.budgets'), ctx).facts as { budgets_most_used_first: Record<string, string>[]; within_pace: string; month_gone: string };
    expect(facts.month_gone).toBe('67%');                                                             // 20 of 30 days
    expect(facts.within_pace).toBe('1 of 2');
    expect(facts.budgets_most_used_first.map(b => [b.category, b.pace])).toEqual([['Groceries', 'ahead of pace'], ['Food & Dining', 'within pace']]);
  });

  it('CON-UNIT-W5-007 · #65 logging streak survives a day not yet over; days recorded this month', () => {
    const days = ['2026-09-19', '2026-09-18', '2026-09-17', '2026-09-15'];
    const facts = resolve(intent('interpret.status'), ctxOf(days.map(date => txn({ date })))).facts as Record<string, string>;
    expect(facts.logging_streak).toBe('3 days running');                                             // today empty, still alive
    expect(facts.days_recorded_this_month).toBe('4 of 20');
    const none = resolve(intent('interpret.status'), ctxOf([txn({ date: '2026-09-10' })])).facts as Record<string, string>;
    expect(none.logging_streak).toBe('nothing recorded yesterday or today');
  });

  it('CON-UNIT-W5-008 · bills: due this week with a total, approvals waiting, salary is not a bill', () => {
    const sched = (over: Partial<RecurringSchedule>, tpl: Partial<Transaction>) => ({
      id: `s${++n}`, frequency: 'monthly', startDate: '2026-01-01', autoConfirm: false, active: true,
      transactionTemplate: { type: 'expense', amount: 1000, currency: 'INR', category: 'utilities', description: 'x', ...tpl }, ...over,
    }) as RecurringSchedule;
    const recurring = [
      sched({ nextDueDate: '2026-09-20' }, { amount: 25_000, category: 'rent_mortgage' }),          // today
      sched({ nextDueDate: '2026-09-26', autoConfirm: true }, { amount: 649, category: 'entertainment' }),   // day 7
      sched({ nextDueDate: '2026-09-27' }, { amount: 3000 }),                                       // next week
      sched({ nextDueDate: '2026-09-22' }, { type: 'income', amount: 90_000, category: 'salary' }),  // not a bill
      sched({ nextDueDate: '2026-09-12' }, { amount: 1200, category: 'insurance' }),                  // overdue, awaits approval
    ];
    const facts = resolve(intent('interpret.bills'), ctxOf([txn({})], { recurring })).facts as Record<string, unknown>;
    expect(facts.due_this_week_count).toBe('2');
    expect(facts.total_due_this_week).toBe('₹25,649');
    expect((facts.overdue_waiting_for_your_approval as { category: string }[]).map(b => b.category)).toEqual(['Insurance']);
    expect(JSON.stringify(facts)).not.toContain('Salary');
  });

  it('CON-UNIT-W5-009 · a question-shaped WhatsApp button becomes the question Pip answers', () => {
    expect(buttonQuestion('budget_threshold_alert', "What's driving it?", 'budget:b-9:food_dining:80')).toBe('why is my food & dining spending so high');
    expect(buttonQuestion('runway_shift_alert', 'What moved?', 'x')).toMatch(/how long will my savings last/);
    expect(buttonQuestion('large_transaction_alert', 'Flag it', 'txn:1')).toBeNull();                  // an action, not a question
  });
});
