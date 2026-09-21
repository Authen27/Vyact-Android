import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction, RecurringSchedule } from '../../types';
import { spendByCategoryInRange, cumulativeSpendSeries } from '../calculations';
import { evaluateRecommendations, recsByDomain } from '../plannerRules';
import { buildInsightFeed } from '../insightsFeed';
import { DEFAULT_PREFS, recurringDueNotifs, budgetThresholdNotifs } from '../notifications';

const expense = (overrides: Partial<Transaction> = {}): Transaction => ({ id: crypto.randomUUID(), type: 'expense', amount: 100,
  date: '2026-09-09', category: 'groceries', currency: 'USD', accountId: 'bank', description: 'Food', ...overrides });
const context = (transactions: Transaction[]) => ({ transactions, budgets: [], goals: [], assets: [], debts: [], baseCurrency: 'USD', rates: { USD: 1, GBP: 0.8 } });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-09T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('Reports, Planner, Insights and notification outputs', () => {
  it('reports inclusive period boundaries, FX and exclusions without counting transfers as spend', () => {
    const transactions = [expense({ date: '2026-09-01', amount: 10 }), expense({ date: '2026-09-30', amount: 8, currency: 'GBP' }),
      expense({ date: '2026-08-31' }), expense({ date: '2026-10-01' }), expense({ excluded: true }),
      expense({ type: 'transfer', toAccountId: 'savings', category: '', amount: 500 })];
    expect(spendByCategoryInRange(transactions, '2026-09-01', '2026-09-30', 'USD', { USD: 1, GBP: 0.8 })).toEqual({ groceries: 20 });
    const series = cumulativeSpendSeries(transactions, new Set(['groceries']), '2026-09-01', '2026-09-30', 'USD', { USD: 1, GBP: 0.8 });
    expect(series).toHaveLength(30);
    expect(series[0]).toEqual({ date: '2026-09-01', cumulative: 10 });
    expect(series[29]).toEqual({ date: '2026-09-30', cumulative: 20 });
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
    const first = budgetThresholdNotifs(budgets, [expense({ amount: 80 })], DEFAULT_PREFS, [], ctx);
    expect(first).toEqual([expect.objectContaining({ amountRef: 20, title: 'groceries at 80% of 2026-09 budget' })]);
    expect(budgetThresholdNotifs(budgets, [expense({ amount: 80 })], DEFAULT_PREFS, first, ctx)).toEqual([]);
    expect(budgetThresholdNotifs(budgets, [expense()], DEFAULT_PREFS, first, ctx))
      .toEqual([expect.objectContaining({ amountRef: 0, title: 'groceries at 100% of 2026-09 budget' })]);
  });
});