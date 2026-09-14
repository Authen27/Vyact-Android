import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, Asset, Budget, BudgetAllocation, RecurringSchedule, Transaction } from '../../types';
import { buildPersonalInsights, mergePersonalInsights, type PersonalInsightsInput } from '../personalInsights';
import { evaluateRecommendations } from '../plannerRules';
import type { FeedCard } from '../insightsFeed';

const transaction = (patch: Partial<Transaction> = {}): Transaction => ({ id: 'expense', type: 'expense', category: 'groceries', amount: 850, currency: 'USD', date: '2026-09-08', description: 'Groceries', accountId: 'bank', ...patch });
const income = transaction({ id: 'income', type: 'income', category: 'salary', amount: 1000, accountId: undefined, toAccountId: 'bank' });
const base = (patch: Partial<PersonalInsightsInput> = {}): PersonalInsightsInput => ({ transactions: [income, transaction()], budgets: [], budgetAllocations: [], goals: [], debts: [], assets: [], recurring: [], accounts: [], rates: { USD: 1, EUR: 0.8 }, baseCurrency: 'USD', ...patch });
const card = (patch: Partial<FeedCard> = {}): FeedCard => ({ id: 'category-spend', type: 'mirror', tone: 'neutral', emoji: '', big: 'Groceries', line: 'Recorded category spending.', materiality: 70, issue: 'category:groceries', period: '2026-09', to: '/transactions?cat=groceries', ...patch });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-11T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('Merged personal Insights', () => {
  it('does not claim a healthy household or offer financial recommendations without reportable activity', () => {
    const result = buildPersonalInsights(base({ transactions: [transaction({ type: 'transfer', category: '' })] }));
    expect(result.hasActivity).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.highlights).toEqual([]);
  });

  it('merges the same issue and period while preserving the action, evidence and related lesson', () => {
    const result = mergePersonalInsights([card({ issue: 'cash-flow', learnId: 'saving-lesson' })], [{ id: 'expenses.high_consumption', domain: 'expenses', severity: 'critical', priority: 5,
      title: 'Review spending', body: 'Review remaining commitments.', issue: 'cash-flow', period: '2026-09', action: { label: 'Review budgets', route: '/budgets' } }], '2026-09');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ action: { route: '/budgets' }, learnId: 'saving-lesson', severity: 'critical' });
    expect(result[0].evidence).toEqual(['Groceries. Recorded category spending.']);
  });

  it('deduplicates by category and period, not matching titles or unrelated entities', () => {
    const result = mergePersonalInsights([card(), card({ id: 'older', period: '2026-08' }), card({ id: 'other', issue: 'category:travel' })], [{ id: 'budget', domain: 'expenses', severity: 'watch', priority: 4,
      title: 'Groceries', body: 'Budget warning.', issue: 'budget-pressure', relatedIssues: [{ issue: 'category:groceries', period: '2026-09' }], action: { label: 'Review budgets', route: '/budgets' } }], '2026-09');
    expect(result).toHaveLength(3);
    expect(result[0].evidence).toHaveLength(1);
    expect(result.some(item => item.period === '2026-08')).toBe(true);
    expect(result.some(item => item.issue === 'category:travel')).toBe(true);
  });

  it('compares allocation-based budgets using central FX and each budget period', () => {
    const budgets = [
      { id: 'monthly', scope: 'month', periodYear: 2026, periodMonth: 9, limit: 200, currency: 'EUR' },
      { id: 'annual', scope: 'annual', periodYear: 2026, limit: 300, currency: 'USD' },
      { id: 'old', scope: 'month', periodYear: 2026, periodMonth: 8, limit: 1, currency: 'USD' },
    ] as Budget[];
    const budgetAllocations = [
      { id: 'month-line', budgetId: 'monthly', category: 'groceries', amount: 80 },
      { id: 'year-line', budgetId: 'annual', category: 'travel', amount: 300 },
      { id: 'old-line', budgetId: 'old', category: 'groceries', amount: 1 },
    ] as BudgetAllocation[];
    const input = base({ budgets, budgetAllocations, transactions: [income, transaction({ amount: 90 }), transaction({ id: 'annual-spend', category: 'travel', amount: 350, date: '2026-02-01' })] });
    const warning = evaluateRecommendations(input, 50).find(rec => rec.id === 'expenses.budget_exceeded');
    expect(warning?.title).toBe('1 category limit exceeded');
    expect(warning?.body).toContain('Travel');
    expect(warning?.body).not.toContain('Groceries');
    expect(warning?.relatedIssues).toEqual([]);
  });

  it('uses live account-aware investment values once, including private balance movements', () => {
    const accounts = [{ id: 'bank', kind: 'bank', name: 'Bank', currency: 'USD', openingBalance: 1000 }] as Account[];
    const assets = [{ id: 'fund', type: 'investment', name: 'Fund', liquidity: 'short', value: 0, currency: 'USD' }] as Asset[];
    const result = buildPersonalInsights(base({ accounts, assets, transactions: [transaction({ amount: 10 }), transaction({ id: 'buy', type: 'investment', assetId: 'fund', category: '', amount: 800, excluded: true })] }));
    const concentration = result.items.find(item => item.issue === 'investments.asset_concentration');
    expect(concentration?.title).toBe('81% of recorded assets are in investment');
    expect(result.items.some(item => item.title.includes('75%'))).toBe(false);
  });

  it('excludes withdrawals and private investment rows from the contribution rate', () => {
    const result = evaluateRecommendations(base({ transactions: [income, transaction({ type: 'investment', assetId: 'fund', accountId: undefined, toAccountId: 'bank', category: '', amount: 500 }), transaction({ id: 'private-buy', type: 'investment', assetId: 'fund', amount: 500, category: '', excluded: true })] }), 50);
    expect(result.find(rec => rec.id === 'investments.low_rate')?.title).toBe('You invest 0% of monthly income');
  });

  it('uses active schedules rather than summing already-posted recurring entries as a monthly cost', () => {
    const recurring = [{ id: 'rent', active: true, nextDueDate: '2026-09-15', transactionTemplate: { type: 'expense', amount: 100, category: 'housing' } },
      { id: 'inactive', active: false, transactionTemplate: { type: 'expense' } }] as RecurringSchedule[];
    const result = evaluateRecommendations(base({ recurring }), 50).find(rec => rec.id === 'expenses.subscription_leak');
    expect(result?.title).toBe('1 repeating expense to review');
    expect(result?.body).not.toContain('/mo');
  });

  it('caps next steps at three and keeps the remaining evidence in other sections without duplication', () => {
    const input = base({ transactions: [income, transaction({ amount: 990 })] });
    const review = buildPersonalInsights(input);
    expect(review.nextSteps.length).toBeLessThanOrEqual(3);
    expect(review.nextSteps[0].issue).toBe('cash-flow');
    const all = [...review.nextSteps, ...review.changes, ...review.watch];
    expect(all).toHaveLength(review.items.length);
    expect(new Set(all.map(item => item.id)).size).toBe(all.length);
    expect(buildPersonalInsights(input)).toEqual(review);
  });

  it('marks projections and unconfirmed inputs, including highlight cards', () => {
    const review = buildPersonalInsights(base({ transactions: [income, transaction({ confidence: 'estimated' })] }));
    expect(review.items.every(item => item.estimated)).toBe(true);
    expect(review.highlights.every(item => item.estimated)).toBe(true);
    expect(review.watch.some(item => item.forecast && item.basis.some(text => text.includes('elapsed calendar days')))).toBe(true);
  });

  it('omits tax, goals and Pulse and ignores future/excluded spending without mutating inputs', () => {
    const input = base({ baseCurrency: 'GBP', rates: { GBP: 1 }, householdType: 'business', transactions: [income, transaction(), transaction({ id: 'future', date: '2027-01-01', amount: 99999 }), transaction({ id: 'hidden', excluded: true, amount: 99999 })] });
    const before = JSON.stringify(input);
    const review = buildPersonalInsights(input);
    expect(review.items.some(item => /tax|pulse|goal/i.test(item.issue))).toBe(false);
    expect(review.items.filter(item => item.issue === 'cash-flow')).toHaveLength(1);
    expect(review.highlights.some(item => item.type === 'pulse')).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
  });
});