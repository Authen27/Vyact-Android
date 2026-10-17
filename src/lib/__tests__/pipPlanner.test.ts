// v10.107.0 — Pip, the household's planner (owner, 16 Oct 2026). The authoring session could not run tests,
// so these cover the cases its PR listed:
//  · scope: off-topic is declined with no phrase call; an unsure classification asks which job was meant;
//    a general concept points to Learn (never the model's own knowledge); code, links and over-long replies
//    are discarded like an invented figure;
//  · the planner intents compute every figure in resolve();
//  · Pip's nudges stay within one a day and three a week, and follow the settings switch.
import { describe, expect, it } from 'vitest';
import { resolve, runAssistant, LlmBackend, type AssistantContext } from '../askVyactBackend';
import { assertReplyInScope, OffScopeReplyError, MAX_REPLY_CHARS, CLASSIFY_SYSTEM, PHRASE_SYSTEM, phraseRetryInstruction, type ModelCall } from '../askVyactLlm';
import { MAX_MESSAGE_CHARS } from '../../../../supabase/functions/_shared/agent/router';
import { buildSafeSummary } from '../aiSummary';
import { DEFAULT_PREFS, pipNudgeNotifs, pipNudgeRoom, PIP_NUDGE_WEEKLY_CAP } from '../notifications';
import type { IntentResult } from '../askVyactIntents';
import type { Account, Notification, Profile, RecurringSchedule, Transaction } from '../../types';

const profile = { baseCurrency: 'INR', household: 'family', language: 'en' } as unknown as Profile;
const rates = { INR: 1 };
const day = (offset: number) => {
  const d = new Date(); d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
let n = 0;
const txn = (p: Partial<Transaction>): Transaction => ({ id: `t${++n}`, type: 'expense', amount: 100, currency: 'INR',
  date: day(2), description: 'test', category: 'groceries', accountId: 'bank', ...p } as Transaction);

function ctxFor(over: Partial<AssistantContext> = {}): AssistantContext {
  const transactions = [
    txn({ category: 'groceries', amount: 6000, date: day(5) }), txn({ category: 'groceries', amount: 6000, date: day(35) }),
    txn({ category: 'groceries', amount: 6000, date: day(65) }),
    txn({ type: 'income', amount: 90000, category: 'salary', date: day(10) }),
    txn({ type: 'income', amount: 90000, category: 'salary', date: day(40) }),
    txn({ type: 'income', amount: 90000, category: 'salary', date: day(70) }),
    txn({ amount: 20000, category: 'rent_mortgage', date: day(35) }), txn({ amount: 20000, category: 'rent_mortgage', date: day(65) }),
  ];
  const accounts = [
    { id: 'bank', name: 'HDFC Salary', kind: 'bank', currency: 'INR', openingBalance: 200000 },
  ] as unknown as Account[];
  const recurring = [
    { id: 'r1', frequency: 'monthly', startDate: day(60), nextDueDate: day(-3), autoConfirm: false, active: true,
      transactionTemplate: { type: 'expense', amount: 649, currency: 'INR', description: 'Netflix', category: 'subscriptions' } },
    { id: 'r2', frequency: 'monthly', startDate: day(60), nextDueDate: day(-5), autoConfirm: true, active: true,
      transactionTemplate: { type: 'expense', amount: 15000, currency: 'INR', description: 'Car EMI', category: 'loan_emi' } },
  ] as unknown as RecurringSchedule[];
  const summary = buildSafeSummary(transactions, [], [], [], [], profile, rates, accounts);
  return { summary, transactions, budgets: [], goals: [], debts: [], assets: [], accounts, recurring, profile, rates,
    baseCurrency: 'INR', ...over };
}
const ask = (id: string, entities: Record<string, unknown> = {}): IntentResult =>
  ({ id: id as IntentResult['id'], bucket: id.split('.')[0] as IntentResult['bucket'], confidence: 0.9, entities: { text: 'test', ...entities } });

/** A fake model: classify answers `classified`; phrase answers `phrase` and is counted. */
function fakeModel(classified: Record<string, unknown>, phrase = 'You spent less than usual.') {
  const calls = { phrase: 0 };
  const call: ModelCall = async ({ op }) => {
    if (op === 'classify') return JSON.stringify(classified);
    calls.phrase += 1;
    return phrase;
  };
  return { backend: new LlmBackend(call), calls };
}

describe('Pip scope (v10.107.0)', () => {
  it('PIP-PLAN-001 · off-topic is declined in one line with chips, and the phrase model is never called', async () => {
    const { backend, calls } = fakeModel({ id: 'off_topic', entities: {}, confidence: 0.95 });
    const turn = await runAssistant('write me a poem about the sea', ctxFor(), backend, 0);
    expect(turn.intentId).toBe('off_topic');
    expect(turn.reply).toMatch(/^I only help with your household's money/);
    expect(turn.chips?.length).toBeGreaterThan(0);
    expect(turn.allowedFigures).toEqual([]);
    expect(calls.phrase).toBe(0);
  });

  it('PIP-PLAN-002 · a classification the model was unsure of asks which job was meant; no phrase call', async () => {
    const { backend, calls } = fakeModel({ id: 'interpret.lookup', entities: {}, confidence: 0.2 });
    const turn = await runAssistant('the thing from before', ctxFor(), backend, 0);
    expect(turn.intentId).toBe('fallback');
    expect(turn.clarify).toBe(true);
    expect(turn.reply).toMatch(/Did you mean one of these\?/);
    expect(turn.chips?.length).toBeGreaterThan(0);
    expect(calls.phrase).toBe(0);
    // A confident classification still answers.
    const sure = fakeModel({ id: 'interpret.lookup', entities: { category: 'groceries' }, confidence: 0.9 }, 'Groceries are on track.');
    expect((await runAssistant('groceries this month', ctxFor(), sure.backend, 0)).intentId).toBe('interpret.lookup');
    expect(sure.calls.phrase).toBe(1);
  });

  it('PIP-PLAN-003 · a general concept points to Learn, searched for the topic; an unsafe topic is dropped; WhatsApp gets no link', async () => {
    const sip = fakeModel({ id: 'learn.concept', entities: { topic: 'SIP' }, confidence: 0.9 });
    const turn = await runAssistant('what is an SIP?', ctxFor(), sip.backend, 0);
    expect(turn.intentId).toBe('learn.concept');
    expect(turn.link).toEqual({ label: 'Lessons on SIP', to: '/insights?tab=learn&q=SIP' });
    expect(sip.calls.phrase).toBe(0);

    const unsafe = fakeModel({ id: 'learn.concept', entities: { topic: 'SIP<script>alert(1)</script>' }, confidence: 0.9 });
    const dropped = await runAssistant('what is an SIP?', ctxFor(), unsafe.backend, 0);
    expect(dropped.link).toEqual({ label: 'Lessons on money basics', to: '/insights?tab=learn' });
    expect(dropped.reply).not.toMatch(/script/);

    const wa = fakeModel({ id: 'learn.concept', entities: { topic: 'compound interest' }, confidence: 0.9 });
    const onWhatsApp = await runAssistant('how does compound interest work', ctxFor({ channel: 'whatsapp' }), wa.backend, 0);
    expect(onWhatsApp.link).toBeUndefined();
    expect(onWhatsApp.reply).toMatch(/search "compound interest"/);
  });

  it('PIP-PLAN-004 · code, a web address or an over-long reply is rejected; prose (even in a bare fence) is accepted', () => {
    expect(() => assertReplyInScope('Here you go:\nprint(1)', 'app', '```python\nprint(1)\n```')).toThrow(OffScopeReplyError);
    expect(() => assertReplyInScope('def total(x):\n  return x')).toThrow(/code/);
    expect(() => assertReplyInScope('Read more at https://example.com about budgets.')).toThrow(/web address/);
    expect(() => assertReplyInScope('See www.example.com for that.')).toThrow(/web address/);
    expect(() => assertReplyInScope('a'.repeat(MAX_REPLY_CHARS.app + 1))).toThrow(/too long/);
    expect(() => assertReplyInScope('a'.repeat(MAX_REPLY_CHARS.whatsapp + 1), 'whatsapp')).toThrow(/too long/);
    expect(() => assertReplyInScope('a'.repeat(MAX_REPLY_CHARS.whatsapp + 1), 'app')).not.toThrow();
    // Capitalised prose that starts like a keyword is not code.
    expect(() => assertReplyInScope('Class fees rose this month.\nImport duties added to it.')).not.toThrow();
    expect(() => assertReplyInScope('You spent less on groceries.', 'app', '```\nYou spent less on groceries.\n```')).not.toThrow();
  });

  it('PIP-PLAN-006 · every server prompt fits the router per-message cap, retry included, so none is ever cut off', () => {
    // The worst retry names 12 figures (MAX_RETRY_FIGURES), each up to 15 digits plus 4 decimals.
    const worstRetry = PHRASE_SYSTEM + phraseRetryInstruction(Array(12).fill('123456789012345.6789'));
    expect(worstRetry.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    expect(CLASSIFY_SYSTEM.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
  });

  it('PIP-PLAN-005 · an off-scope phrase reply is never shown: the turn is unavailable', async () => {
    const { backend } = fakeModel({ id: 'interpret.lookup', entities: { category: 'groceries' }, confidence: 0.9 },
      'Sure! ```python\nprint("hi")\n```');
    const turn = await runAssistant('groceries this month', ctxFor(), backend, 0);
    expect(turn.intentId).toBe('unavailable');
    expect(turn.reply).not.toMatch(/print/);
  });
});

describe('Pip planner intents compute their figures (v10.107.0)', () => {
  it('PIP-PLAN-010 · month review: last completed month by default; this month is "so far" against the same point', () => {
    const last = resolve(ask('interpret.review'), ctxFor());
    expect(['ok', 'no_activity']).toContain(last.outcome);
    expect(String(last.facts?.review_month)).not.toMatch(/so far/);
    const current = resolve(ask('interpret.review', { period: 'this month' }), ctxFor());
    expect(String(current.facts?.review_month)).toMatch(/so far$/);
    if (current.outcome === 'ok') expect(current.facts?.month_in_progress).toMatch(/^yes/);
  });

  it('PIP-PLAN-011 · bills review: 12-month cost from each schedule; loan EMIs are left out', () => {
    const r = resolve(ask('interpret.subscriptions'), ctxFor());
    expect(r.outcome).toBe('ok');
    expect(r.facts?.bills_counted).toBe('1');                     // Netflix only; the car EMI is excluded
    expect(r.facts?.left_out).toMatch(/loan EMIs/);
    const rows = r.facts?.bills_by_cost_over_next_12_months as { amount_each_time: string; times_in_next_12_months: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_each_time).toMatch(/649/);
    expect(Number(rows[0].times_in_next_12_months)).toBeGreaterThanOrEqual(11);
    expect(resolve(ask('interpret.subscriptions'), ctxFor({ recurring: [] })).outcome).toBe('none');
  });

  it('PIP-PLAN-012 · emergency fund: the target is three months of essentials, with the gap and how long it takes', () => {
    const r = resolve(ask('forecast.emergency_fund'), ctxFor());
    expect(['building', 'reached']).toContain(r.outcome);
    expect(r.facts?.target_is).toMatch(/^three months of your typical essential spending/);
    if (r.outcome === 'building') expect(r.facts?.still_to_put_aside).toBeDefined();
    else expect(r.facts?.above_target_by).toBeDefined();
    const empty = resolve(ask('forecast.emergency_fund'), ctxFor({ transactions: [], summary: buildSafeSummary([], [], [], [], [], profile, rates, []) }));
    expect(empty.outcome).toBe('no_history');
  });

  it('PIP-PLAN-013 · spare money: a fixed five-step order with no products, and the first open step named', () => {
    const r = resolve(ask('forecast.surplus'), ctxFor());
    expect(r.outcome).toBe('plan');
    const steps = r.facts?.plan_in_order as { step: string; what: string; status: string }[];
    expect(steps.map(s => s.step)).toEqual(['1', '2', '3', '4', '5']);
    expect(steps[0].what).toMatch(/credit card dues/);
    expect(steps[2].what).toMatch(/12% interest or more/);
    expect(steps[4].what).toMatch(/I do not pick funds, stocks or policies/);
    const firstOpen = steps.find(s => s.status === 'to do') ?? steps[4];
    expect(r.facts?.next_step).toBe(firstOpen.what);
  });

  it('PIP-PLAN-014 · saving for something: a price is required; a small one is ready now; a large one is planned or has no surplus', () => {
    expect(resolve(ask('forecast.save_for'), ctxFor()).outcome).toBe('missing_amount');
    // An amount the user did not type is dropped, so it asks for the price.
    expect(resolve(ask('forecast.save_for', { amount: 1000, text: 'when can I afford a phone' }), ctxFor()).outcome).toBe('missing_amount');
    const small = resolve(ask('forecast.save_for', { amount: 1000, text: 'when can I afford a 1000 phone' }), ctxFor());
    expect(small.outcome).toBe('ready');
    expect(small.facts?.months_to_save).toMatch(/^none/);
    const big = resolve(ask('forecast.save_for', { amount: 5_000_000, text: 'how long to save 5000000 for a house' }), ctxFor());
    expect(['plan', 'no_surplus']).toContain(big.outcome);
    expect(big.facts?.assumes).toMatch(/cushion stays untouched/);
  });
});

describe("Pip's nudges (v10.107.0)", () => {
  const ctx = { householdId: 'h', baseCurrency: 'INR', rates: { INR: 1 } };
  const nudge = (createdAt: string, i: number): Notification => ({ id: `n${i}`, type: 'trend_alert', priority: 'P2', status: 'unread',
    createdAt, householdId: 'h', dedupeKey: `pip:trend:x${i}:2026-10`, title: '', body: '' } as unknown as Notification);

  it('PIP-PLAN-020 · at most one a day and three a week', () => {
    const now = Date.parse('2026-10-16T12:00:00');
    expect(pipNudgeRoom([], now)).toBe(1);
    expect(pipNudgeRoom([nudge(new Date(now - 3_600_000).toISOString(), 1)], now)).toBe(0);
    const week = [2, 3, 4].map((d, i) => nudge(new Date(now - d * 86_400_000).toISOString(), i));
    expect(week).toHaveLength(PIP_NUDGE_WEEKLY_CAP);
    expect(pipNudgeRoom(week, now)).toBe(0);
    expect(pipNudgeRoom(week.slice(0, 2), now)).toBe(1);
  });

  it('PIP-PLAN-021 · the month review nudge comes in the first five days only, once, and follows the settings switch', () => {
    const txns = [txn({ date: '2026-09-12', amount: 500 })];
    const on = pipNudgeNotifs(txns, DEFAULT_PREFS, [], ctx, '2026-10-03', Date.parse('2026-10-03T09:00:00'));
    expect(on).toHaveLength(1);
    expect(on[0].type).toBe('insight_fresh');
    expect(on[0].deepLink).toMatch(/^\/chat\?ask=/);
    expect(pipNudgeNotifs(txns, DEFAULT_PREFS, [], ctx, '2026-10-09', Date.parse('2026-10-09T09:00:00'))).toEqual([]);
    expect(pipNudgeNotifs(txns, DEFAULT_PREFS, on, ctx, '2026-10-03', Date.parse('2026-10-04T09:00:00'))).toEqual([]);
    const off = { ...DEFAULT_PREFS, perType: { insight_fresh: false, trend_alert: false } };
    expect(pipNudgeNotifs(txns, off, [], ctx, '2026-10-03', Date.parse('2026-10-03T09:00:00'))).toEqual([]);
  });

  it('PIP-PLAN-022 · a category already past a whole usual month raises a trend nudge; loan EMIs never do', () => {
    const hist = ['2026-07-10', '2026-08-10', '2026-09-10'].flatMap(d => [
      txn({ date: d, amount: 4000, category: 'dining' }), txn({ date: d, amount: 15000, category: 'loan_emi' })]);
    const now = [txn({ date: '2026-10-12', amount: 6000, category: 'dining' }), txn({ date: '2026-10-12', amount: 60000, category: 'loan_emi' })];
    const out = pipNudgeNotifs([...hist, ...now], DEFAULT_PREFS, [], ctx, '2026-10-14', Date.parse('2026-10-14T09:00:00'));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('trend_alert');
    expect(out[0].dedupeKey).toBe('pip:trend:dining:2026-10');
  });
});
