import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction, RecurringSchedule } from '../../types';
import { spendByCategoryInRange, cumulativeSpendSeries } from '../calculations';
import { evaluateRecommendations, recsByDomain } from '../plannerRules';
import { buildInsightFeed } from '../insightsFeed';
import { DEFAULT_PREFS, recurringDueNotifs, budgetThresholdNotifs } from '../notifications';
import { fmt } from '../format';
import { getCat } from '../../constants';

const expense = (overrides: Partial<Transaction> = {}): Transaction => ({ id: crypto.randomUUID(), type: 'expense', amount: 100,
  date: '2026-09-09', category: 'groceries', currency: 'USD', accountId: 'bank', description: 'Food', ...overrides });
const context = (transactions: Transaction[]) => ({ transactions, budgets: [], goals: [], assets: [], debts: [], baseCurrency: 'USD', rates: { USD: 1, GBP: 0.8 } });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-09T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('Reports, Planner, Insights and notification outputs', () => {
  it('reports inclusive period boundaries, face value and exclusions without counting transfers as spend', () => {
    // W3b (owner decision D14): one currency per household — an old label counts at face value.
    const transactions = [expense({ date: '2026-09-01', amount: 10 }), expense({ date: '2026-09-30', amount: 8, currency: 'GBP' }),
      expense({ date: '2026-08-31' }), expense({ date: '2026-10-01' }), expense({ excluded: true }),
      expense({ type: 'transfer', toAccountId: 'savings', category: '', amount: 500 })];
    expect(spendByCategoryInRange(transactions, '2026-09-01', '2026-09-30', 'USD', { USD: 1, GBP: 0.8 })).toEqual({ groceries: 18 });
    const series = cumulativeSpendSeries(transactions, new Set(['groceries']), '2026-09-01', '2026-09-30', 'USD', { USD: 1, GBP: 0.8 });
    expect(series).toHaveLength(30);
    expect(series[0]).toEqual({ date: '2026-09-01', cumulative: 10 });
    expect(series[29]).toEqual({ date: '2026-09-30', cumulative: 18 });
  });

  it('Planner explains 85 percent consumption and groups the recommendation under expenses', () => {
    const input = context([expense({ amount: 850 }), expense({ type: 'income', category: 'salary', amount: 1000, accountId: undefined, toAccountId: 'bank' })]);
    const recommendations = evaluateRecommendations(input, 50);
    const recommendation = recommendations.find(row => row.id === 'expenses.high_consumption');
    expect(recommendation).toMatchObject({ title: 'You spend 85% of your income', severity: 'watch', domain: 'expenses',
      action: { route: '/budgets' } });
    expect(recsByDomain(recommendations).expenses).toContainEqual(recommendation);
    expect(evaluateRecommendations(input, 2)).toEqual(recommendations.slice(0, 2));
  });

  it('Insights shows the independently calculated savings win and stable category links', () => {
    const input = context([expense({ amount: 250 }), expense({ type: 'income', amount: 1000, category: 'salary' }),
      expense({ type: 'investment', amount: 600, category: '', toAccountId: 'investment' })]);
    const feed = buildInsightFeed(input, 20);
    expect(feed).toContainEqual(expect.objectContaining({ id: 'win-savings-2026-09', big: '75% retained', tone: 'positive' }));
    expect(feed).toContainEqual(expect.objectContaining({ id: 'mirror-topcat-2026-09', to: '/transactions?type=expense&cat=groceries&month=2026-09' }));
    expect(buildInsightFeed(input, 20)).toEqual(feed);
    expect(new Set(feed.map(card => card.id)).size).toBe(feed.length);
    expect(feed.filter(card => card.tone === 'constructive').length).toBeLessThanOrEqual(1);
    expect(buildInsightFeed(input, 2)).toHaveLength(2);
  });

  it('creates one actionable recurring notification per due occurrence and does not repeat it', () => {
    const schedule: RecurringSchedule = { id: 'schedule', frequency: 'monthly', startDate: '2026-09-09', nextDueDate: '2026-09-09',
      active: true, autoConfirm: false, transactionTemplate: { type: 'expense', amount: 100, currency: 'USD', category: 'utilities', description: 'Bill', accountId: 'bank' } };
    const ctx = { householdId: 'household', baseCurrency: 'USD', rates: { USD: 1 } };
    const notifications = recurringDueNotifs([schedule], DEFAULT_PREFS, [], ctx);
    expect(notifications).toEqual([expect.objectContaining({ type: 'recurring_due_confirm', householdId: 'household', amountRef: 100,
      dueAt: '2026-09-09', scheduleId: 'schedule', actions: expect.arrayContaining([expect.objectContaining({ id: 'approve' })]) })]);
    expect(recurringDueNotifs([schedule], DEFAULT_PREFS, notifications, ctx)).toEqual([]);
    expect(recurringDueNotifs([{ ...schedule, autoConfirm: true }], DEFAULT_PREFS, [], ctx)).toEqual([]);
  });

  it('budget notifications progress from 80 percent to 100 percent without repeating the earlier threshold', () => {
    const budgets = [{ id: 'budget', category: 'groceries', limit: 100, currency: 'USD' }];
    const ctx = { householdId: 'household', baseCurrency: 'USD', rates: { USD: 1 } };
    const first = budgetThresholdNotifs(budgets, [], [expense({ amount: 80 })], DEFAULT_PREFS, [], ctx);
    expect(first).toEqual([expect.objectContaining({ amountRef: 20, title: 'Groceries at 80% of the September budget' })]);
    expect(budgetThresholdNotifs(budgets, [], [expense({ amount: 80 })], DEFAULT_PREFS, first, ctx)).toEqual([]);
    expect(budgetThresholdNotifs(budgets, [], [expense()], DEFAULT_PREFS, first, ctx))
      .toEqual([expect.objectContaining({ amountRef: 0, title: 'Groceries at 100% of the September budget' })]);
  });

  it('CON-UNIT-TD39-001 · a v9.1 container budget (no category, per-category allocations) fires per LINE over its own period', () => {
    // The production shape: the budget has no category. Before v10.48.0 this never fired.
    const budgets = [{ id: 'sep', limit: 1000, currency: 'USD', scope: 'month' as const, periodYear: 2026, periodMonth: 9,
      periodStart: '2026-09-01', periodEnd: '2026-09-30' }];
    const allocations = [
      { id: 'a1', budgetId: 'sep', category: 'groceries', amount: 200 },
      { id: 'a2', budgetId: 'sep', category: 'food_dining', amount: 100 },
      { id: 'a3', budgetId: 'sep', category: 'shopping', amount: 300 },
    ];
    const ctx = { householdId: 'household', baseCurrency: 'USD', rates: { USD: 1 } };
    const txns = [
      expense({ amount: 170, category: 'groceries' }),                       // 85% → 80 alert
      expense({ amount: 130, category: 'food_dining' }),                     // 130% → 100 alert, 30 over
      expense({ amount: 100, category: 'shopping' }),                        // 33% → nothing
      expense({ amount: 500, category: 'shopping', date: '2026-08-20' }),    // outside the period
    ];
    const got = budgetThresholdNotifs(budgets, allocations, txns, DEFAULT_PREFS, [], ctx);
    expect(got.map(n => [n.title, n.body])).toEqual([
      ['Groceries at 85% of the September budget', `${fmt(30, 'USD')} left`],
      ['Food & Dining at 130% of the September budget', `${fmt(30, 'USD')} over`],
    ].map(([t, b]) => [t.replace('Food & Dining', getCat('food_dining').label), b]));
    expect(got.every(n => n.budgetId === 'sep' && n.priority === 'P1')).toBe(true);
    // Once per line per threshold: a second refresh raises nothing new.
    expect(budgetThresholdNotifs(budgets, allocations, txns, DEFAULT_PREFS, got, ctx)).toEqual([]);
    // A budget for another month is not checked today.
    expect(budgetThresholdNotifs([{ ...budgets[0], id: 'aug', periodStart: '2026-08-01', periodEnd: '2026-08-31' }],
      allocations.map(a => ({ ...a, budgetId: 'aug' })), txns, DEFAULT_PREFS, [], ctx)).toEqual([]);
    // The per-type switch is honoured.
    expect(budgetThresholdNotifs(budgets, allocations, txns, { ...DEFAULT_PREFS, perType: { budget_threshold: false } }, [], ctx)).toEqual([]);
  });
});