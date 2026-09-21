import type { Account, BudgetAllocation, RecurringSchedule } from '../types';
import { buildInsightFeed, type FeedCard } from './insightsFeed';
import { evaluateRecommendations, type PlannerContext, type Recommendation, type Severity } from './plannerRules';
import { nowMonthKey, today } from './format';
import { reportableTxns } from './calculations';
import { computeNetWorth } from './netWorth';

export interface PersonalInsight {
  id: string;
  issue: string;
  period: string;
  title: string;
  body: string;
  basis: string[];
  evidence: string[];
  action?: { label: string; route: string };
  learnId?: string;
  tone: FeedCard['tone'];
  severity?: Severity;
  estimated: boolean;
  emoji: string;
  priority: number;
  forecast: boolean;
}

export interface PersonalInsightsInput extends PlannerContext {
  accounts: Account[];
  budgetAllocations: BudgetAllocation[];
  recurring: RecurringSchedule[];
}

const rank: Record<Severity, number> = { critical: 3, watch: 2, info: 1 };
const safeRoute = (route: string) => /^\/(transactions|reports|budgets|accounts|networth|debts|recurring)(\?|$)/.test(route);
const actionFor = (route: string) => ({ route, label: route.startsWith('/transactions') ? 'Review transactions'
  : route.startsWith('/budgets') ? 'Review budget' : route.startsWith('/debts') ? 'Review debt'
  : route.startsWith('/networth') ? 'Review assets and liabilities' : 'View details' });

export function mergePersonalInsights(feed: FeedCard[], recommendations: Recommendation[], month: string): PersonalInsight[] {
  const items: PersonalInsight[] = [];
  const aliases = new Map<string, PersonalInsight>();
  for (const rec of [...recommendations].filter(rec => rec.domain !== 'tax').sort((left, right) =>
    rank[right.severity] - rank[left.severity] || right.priority - left.priority || left.id.localeCompare(right.id))) {
    const issue = rec.issue ?? rec.id;
    const period = rec.period ?? month;
    const key = `${issue}|${period}`;
    if (aliases.has(key)) continue;
    const item: PersonalInsight = {
      id: key, issue, period, title: rec.title, body: rec.body,
      basis: [rec.basis ?? 'Rule applied to recorded household activity and terms. Check the underlying records before acting.'],
      evidence: [], action: rec.action && safeRoute(rec.action.route) ? rec.action : undefined,
      severity: rec.severity, priority: rec.priority, tone: rec.severity === 'info' ? 'neutral' : 'constructive',
      estimated: false, forecast: false, emoji: rec.domain === 'debt' ? '💳' : rec.domain === 'investments' ? '📈' : '📊',
    };
    items.push(item);
    aliases.set(key, item);
    for (const related of rec.relatedIssues ?? []) aliases.set(`${related.issue}|${related.period}`, item);
  }
  for (const card of feed.filter(card => card.type !== 'pulse').sort((left, right) => right.materiality - left.materiality || left.id.localeCompare(right.id))) {
    const issue = card.issue ?? card.id;
    const period = card.period ?? month;
    const key = `${issue}|${period}`;
    const existing = aliases.get(key);
    if (existing) {
      const evidence = `${card.big}. ${card.line}`;
      if (!existing.evidence.includes(evidence)) existing.evidence.push(evidence);
      if (card.basis && !existing.basis.includes(card.basis)) existing.basis.push(card.basis);
      existing.learnId ??= card.learnId;
      existing.estimated ||= !!card.estimated;
      continue;
    }
    const item: PersonalInsight = {
      id: key, issue, period, title: card.big, body: card.line,
      basis: [card.basis ?? 'Recorded household activity for the displayed period.'], evidence: [],
      action: card.to && safeRoute(card.to) ? actionFor(card.to) : undefined,
      learnId: card.learnId, tone: card.tone, estimated: !!card.estimated, priority: card.materiality,
      forecast: card.type === 'forecast', emoji: card.emoji,
    };
    items.push(item);
    aliases.set(key, item);
  }
  return items;
}

export function buildPersonalInsights(input: PersonalInsightsInput) {
  const asOf = today();
  const month = nowMonthKey();
  const transactions = input.transactions.filter(transaction => !transaction.excluded && transaction.date <= asOf);
  const position = computeNetWorth({ ...input, transactions: input.transactions.filter(transaction => transaction.date <= asOf) }, input.baseCurrency, input.rates);
  const context = { ...input, position, transactions, goals: [], debts: input.debts.filter(debt => debt.direction !== 'owed_to_me') };
  const hasActivity = reportableTxns(transactions).length > 0;
  const feed = hasActivity ? buildInsightFeed({ ...context, includePulse: false }, 50) : [];
  const recommendations = hasActivity ? evaluateRecommendations(context, 50).filter(rec => rec.domain !== 'tax') : [];
  const items = mergePersonalInsights(feed, recommendations, month);
  const hasEstimates = [...transactions, ...input.budgets, ...input.assets, ...input.debts].some(row => row.confidence && row.confidence !== 'confirmed');
  if (hasEstimates) for (const item of items) {
    item.estimated = true;
    item.basis.push('Some recorded inputs are unconfirmed estimates. Confirm them before relying on this review.');
  }
  const nextSteps = items.filter(item => item.action && item.severity).slice(0, 3);
  const remainder = items.filter(item => !nextSteps.includes(item));
  const changes = remainder.filter(item => !item.severity && !item.forecast);
  const watch = remainder.filter(item => !!item.severity || item.forecast);
  const highlights: FeedCard[] = [...nextSteps, ...changes, ...watch].slice(0, 5).map(item => ({
    id: item.id, type: item.forecast ? 'forecast' : 'mirror', tone: item.tone, emoji: item.emoji,
    big: item.title, line: item.body, to: item.action?.route, learnId: item.learnId, materiality: item.priority,
    estimated: item.estimated, basis: item.basis.join(' '), period: item.period,
  }));
  return { nextSteps, changes, watch, highlights, items, hasActivity, asOf, month };
}