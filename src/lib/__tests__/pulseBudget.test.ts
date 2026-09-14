import { describe, it, expect } from 'vitest';
import type { Transaction, Budget, BudgetAllocation, ExchangeRates } from '../../types';
import { computePulseScore } from '../calculations';

// CON-UNIT-125..127 — allocation-aware budget compliance (audit F5).
//
// THE BUGS THESE PIN:
//   • Pulse read RAW budgets. A container budget (a period budget with
//     per-category allocations) has no `category`, so `spend['']` was 0 and a
//     household spending at 190% of every allocation looked perfectly
//     compliant.
//   • The compliance formula was `100 − pct`: spending exactly the planned
//     budget scored 0. "On budget" now means ≤100% = full; only overspend
//     degrades.

const R: ExchangeRates = { USD: 1 };
const mk = new Date().toISOString().slice(0, 7);
const [y, m] = mk.split('-').map(Number);

function spendTxn(category: string, amount: number): Transaction {
  return { id: `t-${category}`, type: 'expense', amount, currency: 'USD', date: `${mk}-05`, description: '', category };
}

const CONTAINER: Budget = {
  id: 'b-cont', limit: 1000, currency: 'USD',
  scope: 'month', periodYear: y, periodMonth: m,
};
const ALLOCS: BudgetAllocation[] = [
  { id: 'al-food', budgetId: 'b-cont', category: 'food', amount: 400 },
  { id: 'al-trav', budgetId: 'b-cont', category: 'transport', amount: 200 },
];

describe('computePulseScore — budget component (audit F5)', () => {
  it('CON-UNIT-125 · a container budget is compliance-checked via its ALLOCATIONS (overspend now registers)', () => {
    // food at 200% of its 400 allocation, transport at 0.
    const txns = [spendTxn('food', 800)];
    // Without allocations the container has no category and scores a fake 100.
    const withAlloc = computePulseScore(txns, [CONTAINER], [], [], 'USD', R, ALLOCS);
    expect(withAlloc.applicable.budget).toBe(true);
    // food: pct 200 → 200−200 = 0; transport: pct 0 → 100. Mean = 50.
    expect(withAlloc.components.budget).toBe(50);
  });

  it('CON-UNIT-126 · on/under budget scores FULL; exactly-100% is not zero', () => {
    const txns = [spendTxn('food', 400), spendTxn('transport', 200)];   // exactly the allocations
    const p = computePulseScore(txns, [CONTAINER], [], [], 'USD', R, ALLOCS);
    expect(p.components.budget).toBe(100);   // was 0 under the old 100−pct rule
  });

  it('CON-UNIT-127 · a legacy category budget (no scope) still applies every month', () => {
    const legacy: Budget = { id: 'b-leg', category: 'food', limit: 400, currency: 'USD' };
    const under = computePulseScore([spendTxn('food', 200)], [legacy], [], [], 'USD', R, []);
    expect(under.applicable.budget).toBe(true);
    expect(under.components.budget).toBe(100);
    const over = computePulseScore([spendTxn('food', 800)], [legacy], [], [], 'USD', R, []);
    expect(over.components.budget).toBe(0);   // 200% → 200−200
  });
});
