// TE5-001..008 — Track E, E5 (v10.99.0; owner decisions 13–14 Oct 2026: E-6 and its follow-ups): ONE
// budget-progress basis, identical on the Budgets page, the Dashboard, Reports and Pip.
//
// Audit FE-UIC-08 / FE-MNY-06: one budget had three "left" figures — the Budgets hero subtracted only
// ALLOCATED spending from the full total, the Dashboard pace used all spending, Reports compared the sum of
// allocations with allocated spending — and the Dashboard panel measured an annual line against one month.
//
// The owner's example (14 Oct 2026): October ₹50,000 (Food ₹10k, Rent ₹20k); Annual 2026 ₹6,00,000
// (Travel ₹1,20,000); October spending Food ₹9k, Rent ₹20k, Shopping ₹8k and a ₹40k trip.
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { budgetLinesNow, budgetPace, budgetProgress, budgetsForMonth } from '../budgetProgress';
import { budgetTrends } from '../budgetTrends';
import { buildSafeSummary } from '../aiSummary';
import { resolve, type AssistantContext } from '../askVyactBackend';
import { computePulseScore, cumulativeSpendSeries } from '../calculations';
import { DEFAULT_PREFS, budgetThresholdNotifs } from '../notifications';
import type { IntentResult } from '../askVyactIntents';
import type { Budget, BudgetAllocation, Profile, Transaction } from '../../types';

const ROOT = resolvePath(__dirname, '../../../..');
const NOW = '2026-10-15';
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${NOW}T06:00:00Z`)); });
afterAll(() => { vi.useRealTimers(); });

const opts = { baseCurrency: 'INR', rates: { INR: 1 }, now: NOW };
let n = 0;
const txn = (date: string, category: string, amount: number, p: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`, type: 'expense', amount, currency: 'INR', date, description: '', category, ...p,
} as Transaction);
const budget = (p: Partial<Budget>): Budget => ({ currency: 'INR', ...p } as Budget);
const alloc = (budgetId: string, category: string, amount: number): BudgetAllocation => ({ id: `${budgetId}-${category}`, budgetId, category, amount });

const OCT = budget({ id: 'oct', scope: 'month', periodYear: 2026, periodMonth: 10, periodStart: '2026-10-01', periodEnd: '2026-10-31', limit: 50_000 });
const SEP = budget({ id: 'sep', scope: 'month', periodYear: 2026, periodMonth: 9, periodStart: '2026-09-01', periodEnd: '2026-09-30', limit: 40_000 });
const Y26 = budget({ id: 'y26', scope: 'annual', periodYear: 2026, periodStart: '2026-01-01', periodEnd: '2026-12-31', limit: 600_000 });
const BUDGETS = [OCT, SEP, Y26];
const ALLOCS = [
  alloc('oct', 'food_dining', 10_000), alloc('oct', 'rent_mortgage', 20_000),
  alloc('oct', 'travel', 0),                                                   // a 0 row: nothing planned
  alloc('sep', 'food_dining', 10_000),
  alloc('y26', 'travel', 120_000),
];
const LEDGER: Transaction[] = [
  txn('2026-03-12', 'travel', 70_000),
  txn('2026-09-05', 'food_dining', 12_000), txn('2026-09-01', 'rent_mortgage', 20_000),
  txn('2026-10-03', 'food_dining', 9_000), txn('2026-10-01', 'rent_mortgage', 20_000),
  txn('2026-10-08', 'shopping', 8_000), txn('2026-10-10', 'travel', 40_000),
  txn('2026-10-11', 'shopping', 999, { excluded: true }),                    // private: never counts
  txn('2026-10-12', 'salary', 90_000, { type: 'income' }),                   // income: never spending
];

describe('one budget-progress basis (Track E, E5; owner E-6)', () => {
  it('TE5-001 · a month total counts ALL its spending; lines are its allocations; nothing-allocated spending is "not planned"', () => {
    const p = budgetProgress(OCT, ALLOCS, LEDGER, opts);
    expect(p).toMatchObject({ start: '2026-10-01', end: '2026-10-31', annual: false, limit: 50_000, spent: 77_000, left: -27_000, unallocated: 20_000 });
    // Planned lines, most used first.
    expect(p.lines.map(l => [l.category, l.spent, l.limit, Math.round(l.pct!)])).toEqual([['rent_mortgage', 20_000, 20_000, 100], ['food_dining', 9_000, 10_000, 90]]);
    // Spending with nothing allocated (no row, or a 0 row): always over, largest first.
    expect(p.notPlanned.map(l => [l.category, l.spent, l.left, l.planned])).toEqual([['travel', 40_000, -40_000, false], ['shopping', 8_000, -8_000, false]]);
  });

  it('TE5-002 · an annual total is the aggregation of its months; its line is measured over the year; the same rule lists not-planned spending', () => {
    const y = budgetProgress(Y26, ALLOCS, LEDGER, opts);
    const months = ['2026-03', '2026-09', '2026-10'].map(m => {
      const [yy, mm] = m.split('-').map(Number);
      return budgetProgress(budget({ id: m, scope: 'month', periodYear: yy, periodMonth: mm, limit: 1 }), [], LEDGER, opts).spent;
    });
    expect(y).toMatchObject({ annual: true, start: '2026-01-01', end: '2026-12-31', limit: 600_000, spent: 179_000 });
    expect(y.spent).toBe(months.reduce((s, v) => s + v, 0));                   // each expense once in its month, once in its year
    expect(y.lines).toEqual([expect.objectContaining({ category: 'travel', spent: 110_000, limit: 120_000 })]);
    expect(y.notPlanned.map(l => [l.category, l.spent])).toEqual([['rent_mortgage', 40_000], ['food_dining', 21_000], ['shopping', 8_000]]);
  });

  it('TE5-003 · Reports\' budget vs actual is the Budgets page\'s figure (total against all spending), every budget with a total compared', () => {
    const trends = budgetTrends({ budgets: BUDGETS, allocations: ALLOCS, transactions: LEDGER, baseCurrency: 'INR', rates: { INR: 1 }, range: { from: '2026-01-01', to: NOW }, now: NOW });
    const oct = budgetProgress(OCT, ALLOCS, LEDGER, opts);
    expect(trends.monthly.map(r => [r.label, r.budgeted, r.actual, r.difference, r.status])).toEqual([
      ['Sep 2026', 40_000, 32_000, 8_000, 'under'],
      ['Oct 2026', oct.limit, oct.spent, oct.left, 'in-progress'],
    ]);
    expect(trends.annual.map(r => [r.label, r.budgeted, r.actual])).toEqual([['2026', 600_000, 179_000]]);
  });

  it('TE5-004 · the Dashboard: lines over their own period (the annual Travel line over the year), not-planned after them, pace on all spending', () => {
    const now = budgetLinesNow(BUDGETS, ALLOCS, LEDGER, opts);
    expect(budgetsForMonth(BUDGETS, '2026-10').map(b => b.id)).toEqual(['oct', 'y26']);
    expect(now.month?.budget.id).toBe('oct');
    expect(now.lines.map(l => [l.category, l.spent, l.annual])).toEqual([
      ['rent_mortgage', 20_000, false], ['travel', 110_000, true], ['food_dining', 9_000, false],
    ]);
    expect(now.notPlanned.map(l => l.category)).toEqual(['travel', 'shopping']);   // October's own, not the year's
    // 50,000 × 15/31 expected by the 15th, against 77,000 spent.
    expect(budgetPace(now.month, NOW)).toEqual({ under: false, amount: 52_806.45 });
    // The Budgets hero's pace chart runs over ALL spending, so it ends on the total.
    const series = cumulativeSpendSeries(LEDGER, null, '2026-10-01', NOW, 'INR', { INR: 1 });
    expect(series[series.length - 1].cumulative).toBe(now.month!.spent);
  });

  it('TE5-005 · Pip states the month total, its lines and the not-planned spending, from the same figures', () => {
    const profile = { baseCurrency: 'INR', household: 'family', language: 'en' } as unknown as Profile;
    const summary = buildSafeSummary(LEDGER, BUDGETS, [], [], [], profile, { INR: 1 }, [], ALLOCS);
    expect(summary.monthBudget).toEqual({ limit: 50_000, spent: 77_000, left: -27_000 });
    expect(summary.budgetsNotPlanned).toEqual([{ category: 'travel', spent: 40_000 }, { category: 'shopping', spent: 8_000 }]);
    expect(summary.budgets).toContainEqual({ category: 'travel', limit: 120_000, spentPct: 91.67, annual: true });
    const ctx = { summary, transactions: LEDGER, budgets: BUDGETS, budgetAllocations: ALLOCS, goals: [], debts: [], assets: [], accounts: [],
      profile, rates: { INR: 1 }, baseCurrency: 'INR' } as unknown as AssistantContext;
    const r = resolve({ id: 'interpret.budgets', bucket: 'interpret', confidence: 0.9, entities: { text: 'how are my budgets' } } as IntentResult, ctx);
    const facts = r.facts as Record<string, unknown>;
    expect(facts.month_budget).toMatchObject({ total: '₹50,000', spent_on_everything: '₹77,000', left: '₹27,000 over' });
    expect(facts.not_planned_this_month).toEqual([
      expect.objectContaining({ category: 'Travel', spent: '₹40,000' }),
      expect.objectContaining({ category: 'Shopping', spent: '₹8,000' }),
    ]);
    expect(r.vars.headline).toBe('Some budgets need attention.');
  });

  it('TE5-006 · a loan payment counts in full in the total and in the Loan / EMI line (Track E)', () => {
    const split = { interest: 3_000, principal: 12_000, debt_id: 'd1', kind: 'emi', operation_id: 'op1' };
    const ledger = [
      txn('2026-10-05', 'loan_emi', 3_000, { id: 'i1', debtId: 'd1', emiSplit: split } as Partial<Transaction>),
      txn('2026-10-05', '', 12_000, { id: 'p1', type: 'transfer', debtId: 'd1', linkedTxnId: 'i1', emiSplit: split } as Partial<Transaction>),
    ];
    const p = budgetProgress(OCT, [alloc('oct', 'loan_emi', 15_000)], ledger, opts);
    expect(p.spent).toBe(15_000);
    expect(p.lines).toEqual([expect.objectContaining({ category: 'loan_emi', spent: 15_000, pct: 100, left: 0 })]);
    expect(p.notPlanned).toEqual([]);
  });

  it('TE5-007 · a legacy category budget stays one line; not-planned spending raises no alert and leaves Pulse unchanged (owner)', () => {
    const legacy = budget({ id: 'legacy', category: 'food_dining', limit: 5_000 });
    const l = budgetProgress(legacy, [], LEDGER, opts);
    expect(l).toMatchObject({ start: '2026-10-01', end: '2026-10-31', limit: 5_000, spent: 9_000, notPlanned: [] });
    // The same with a scope and period but still no allocations — as budgetLines has always read it.
    const scoped = budgetProgress(budget({ id: 'cat', scope: 'month', periodYear: 2026, periodMonth: 10, category: 'food_dining', limit: 5_000 }), [], LEDGER, opts);
    expect(scoped).toMatchObject({ spent: 9_000, notPlanned: [], lines: [expect.objectContaining({ category: 'food_dining', limit: 5_000 })] });
    // Bell alerts read allocations with a limit only: Travel (a 0 row) and Shopping (no row) raise nothing.
    const alerts = budgetThresholdNotifs([OCT], ALLOCS, LEDGER, DEFAULT_PREFS, [], { householdId: 'h', baseCurrency: 'INR', rates: { INR: 1 } }, NOW);
    expect(alerts.map(a => a.title)).toEqual(expect.arrayContaining([expect.stringMatching(/ at 100% /), expect.stringMatching(/ at 90% /)]));
    expect(alerts).toHaveLength(2);                                              // Rent at 100%, Food at 90%
    expect(alerts.some(a => /Travel|Shopping/.test(a.title))).toBe(false);
    // Pulse's budget score reads the allocated lines only: unplanned Shopping does not move it.
    const pulse = (txns: Transaction[]) => computePulseScore(txns, BUDGETS, [], [], 'INR', { INR: 1 }, ALLOCS).components.budget;
    expect(pulse(LEDGER)).toBe(pulse(LEDGER.filter(t => t.category !== 'shopping')));
  });

  it('TE5-008 · every surface reads lib/budgetProgress, and the Budgets hero no longer sums allocated spending', () => {
    const read = (p: string) => readFileSync(resolvePath(ROOT, p), 'utf8');
    const budgets = read('react/src/pages/Budgets.tsx');
    expect(budgets).toMatch(/budgetProgress\(b, allocations, transactions, \{ baseCurrency: cur, rates \}\)/);
    expect(budgets).not.toMatch(/allocs\.reduce\(\(s, a\) => s \+ a\.spent/);
    expect(budgets).toMatch(/cumulativeSpendSeries\(transactions, null,/);
    expect(read('react/src/pages/Dashboard.tsx')).toMatch(/budgetLinesNow\(budgets, budgetAllocations, transactions,/);
    expect(read('react/src/pages/Dashboard.tsx')).toMatch(/budgetPace\(budgetNow\.month\)/);
    expect(read('react/src/lib/budgetTrends.ts')).toMatch(/budgetProgress\(budget, input\.allocations, input\.transactions,/);
    expect(read('react/src/lib/aiSummary.ts')).toMatch(/budgetLinesNow\(budgets, allocations, txns,/);
  });
});

// TE5-009 — a stored legacy category id (e.g. 'food') spends against its current category (food_dining),
// the rule the budget form uses to save an allocation. It is one planned line, never a second "not planned"
// row under the same name.
describe('TE5-009 · legacy category ids fold into their current budget line', () => {
  it('counts the legacy and the current id against one planned line', () => {
    const p = budgetProgress(OCT, [alloc('oct', 'food_dining', 10_000)], [
      txn('2026-10-05', 'food_dining', 9_000),
      txn('2026-10-06', 'food', 1_000),
    ], opts);
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]).toMatchObject({ category: 'food_dining', spent: 10_000, limit: 10_000 });
    expect(p.notPlanned).toHaveLength(0);
  });
});
