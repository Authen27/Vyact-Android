// v10.48.1 — "Can I afford …" is decided by the category's budget and the money free
// after card dues; the safety floor is a soft constraint, stated separately.
//
// Found on production (27 Sep): a household already below its three-month floor was
// told "₹5 would dip into the safety floor, shortfall ₹44,831" for a cup of tea, with
// a Food & Dining budget untouched. The same test pass found Pip's "what's my Groceries
// budget" answering "no budget set": both read `budget.category`, which a v9.1 budget
// (a period container with per-category allocations) does not have.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve, type AssistantContext } from '../askVyactBackend';
import { PHRASE_SYSTEM } from '../askVyactLlm';
import { buildSafeSummary } from '../aiSummary';
import { classifyIntent, type IntentResult } from '../askVyactIntents';
import { parse, matchCategory } from '../askVyactParser';
import { matchCategory as waMatchCategory } from '../../../../supabase/functions/_shared/whatsapp-parser';
import type { Transaction, Budget, BudgetAllocation, Account, Profile } from '../../types';

const profile = { baseCurrency: 'INR', household: 'family', language: 'en' } as unknown as Profile;
const rates = { INR: 1 };
let n = 0;
const txn = (over: Partial<Transaction>): Transaction => ({
  id: `t${++n}`, type: 'expense', amount: 100, currency: 'INR', date: '2026-09-10', description: '',
  category: 'other_expense', accountId: 'bank', ...over,
} as Transaction);

const SEPT: Budget = {
  id: 'sep', limit: 30_000, currency: 'INR', scope: 'month', periodYear: 2026, periodMonth: 9,
  periodStart: '2026-09-01', periodEnd: '2026-09-30',
} as Budget;
const ALLOCS: BudgetAllocation[] = [
  { id: 'a1', budgetId: 'sep', category: 'food_dining', amount: 5_000 },
  { id: 'a2', budgetId: 'sep', category: 'groceries', amount: 5_000 },
  { id: 'a3', budgetId: 'sep', category: 'rent_mortgage', amount: 19_200 },
];

/**
 * The owner's shape: rent is most of the essential spending, the card owes a lot, so the
 * money free after card dues is well below three months of essentials. Bank 90,000 −
 * three rents of 17,000 = 39,000 liquid; card owes 25,000 → 14,000 free; floor 51,000.
 */
function ctxFor(opts: { bank?: number; card?: number; september?: Transaction[] } = {}): AssistantContext {
  const transactions = [
    txn({ amount: 17_000, category: 'rent_mortgage', date: '2026-06-05' }),
    txn({ amount: 17_000, category: 'rent_mortgage', date: '2026-07-05' }),
    txn({ amount: 17_000, category: 'rent_mortgage', date: '2026-08-05' }),
    ...(opts.september ?? []),
  ];
  const accounts = [
    { id: 'bank', name: 'HDFC Bank', kind: 'bank', currency: 'INR', openingBalance: opts.bank ?? 90_000 },
    { id: 'card', name: 'Axis card', kind: 'credit_card', currency: 'INR', openingBalance: -(opts.card ?? 25_000), creditLimit: 100_000 },
  ] as unknown as Account[];
  const summary = buildSafeSummary(transactions, [SEPT], [], [], [], profile, rates, accounts, ALLOCS);
  return {
    summary, transactions, budgets: [SEPT], budgetAllocations: ALLOCS, goals: [], debts: [], assets: [],
    accounts, profile, rates, baseCurrency: 'INR',
  };
}
const afford = (amount: number, text: string, category?: string): IntentResult => ({
  id: 'forecast.affordability', bucket: 'forecast', confidence: 0.9, entities: { amount, text, ...(category ? { category } : {}) },
});

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-27T06:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('affordability: budget first, the safety floor as a separate risk', () => {
  it('CON-UNIT-AFF-001 · ₹5 tea below the floor: YES, it fits the Food & Dining budget; the floor is a note, and the WhatsApp card is not sent', () => {
    const r = resolve(afford(5, 'can i afford to spend 5 rupees for tea'), ctxFor());
    const f = r.facts as Record<string, string>;
    expect(r.outcome).toBe('fits');
    expect(f.what_it_is_for).toBe('Food & Dining');
    expect(f.verdict).toBe('fits the Food & Dining budget this month');
    expect(f.verdict_rests_on).toBe('the Food & Dining budget and the money free after card dues');
    expect(f.budget_this_month).toBe('₹5,000');
    expect(f.budget_left_this_month).toBe('₹5,000 left');
    expect(f.budget_left_after_purchase).toBe('₹4,995 left');
    expect(f.free_to_spend_after_card_dues).toBe('₹14,000 free');
    // The floor is still stated — as a position and a risk, not a verdict.
    expect(f.safety_floor).toBe('₹51,000');
    expect(f.headroom_against_floor).toBe('₹37,000 below');
    expect(f.safety_floor_note).toBe('already below the safety floor, before this purchase');
    expect(f.safety_floor_is).toBe('a risk to know about, not the verdict');
    expect(f).not.toHaveProperty('shortfall');
    // The card's sentence ("…would still leave about ₹X above your safety floor") would be untrue.
    expect(r.amounts).toBeUndefined();
    expect(f).not.toHaveProperty('left_above_floor_after');
  });

  it('CON-UNIT-AFF-002 · more than the category has left, but covered by free money: over_budget, by how much', () => {
    const r = resolve(afford(6_000, 'can i afford a 6000 dinner'), ctxFor());
    const f = r.facts as Record<string, string>;
    expect(r.outcome).toBe('over_budget');
    expect(f.verdict).toBe('over the Food & Dining budget this month');
    expect(f.over_budget_by).toBe('₹1,000');
    expect(f.budget_left_after_purchase).toBe('₹1,000 over');
    expect(r.chips?.map(c => c.prompt)).toContain('where can I cut back');
  });

  it('CON-UNIT-AFF-003 · spending already in the month counts against the line', () => {
    const r = resolve(afford(500, 'can i afford 500 of snacks'), ctxFor({ september: [txn({ amount: 4_800, category: 'food_dining', date: '2026-09-12' })] }));
    const f = r.facts as Record<string, string>;
    expect(f.budget_left_this_month).toBe('₹200 left');
    expect(r.outcome).toBe('over_budget');
  });

  it('CON-UNIT-AFF-004 · more than the money free after card dues: tight, the shortfall is against free money (not the floor)', () => {
    const r = resolve(afford(20_000, 'can i afford a 20000 sofa'), ctxFor());
    const f = r.facts as Record<string, string>;
    expect(r.outcome).toBe('tight');
    expect(f.verdict).toBe('more than the money free after card dues');
    expect(f.shortfall).toBe('₹6,000');
    expect(f.verdict_rests_on).toBe('the money free after card dues');
    expect(f).not.toHaveProperty('what_it_is_for');
  });

  it('CON-UNIT-AFF-005 · comfortably above the floor, no budget line: fits, and the WhatsApp card figures are sent', () => {
    const r = resolve(afford(10_000, 'can i afford a 10000 sofa'), ctxFor({ bank: 400_000, card: 0 }));
    expect(r.outcome).toBe('fits');
    expect((r.facts as Record<string, string>).safety_floor_note).toBe('savings stay above the safety floor');
    expect(r.amounts).toEqual({ purchase: 10_000, cushion: 400_000 - 51_000 - 51_000 - 10_000, floor: 51_000, free_to_spend: 349_000 });
  });

  it('CON-UNIT-AFF-006 · a purchase that crosses the floor is still a yes when money and budget cover it', () => {
    // 52,000 free after dues, floor 51,000: ₹3,000 of groceries fits and takes savings below the floor.
    const r = resolve(afford(3_000, 'can i afford 3000 of groceries'), ctxFor({ bank: 103_000, card: 0 }));
    const f = r.facts as Record<string, string>;
    expect(r.outcome).toBe('fits');
    expect(f.safety_floor_note).toBe('this purchase would take savings below the safety floor');
    expect(r.amounts).toBeUndefined();
  });

  it('CON-UNIT-AFF-007 · Pip\'s contract: the floor is said last, in its own paragraph, and never decides the answer', () => {
    expect(PHRASE_SYSTEM).toContain('SAFETY FLOOR IS NOT THE VERDICT');
    expect(PHRASE_SYSTEM).toContain('own paragraph after a blank line');
    expect(PHRASE_SYSTEM).toContain('never turning a "yes" into a "no"');
  });

  it('CON-UNIT-AFF-008 · "tea", "chai", "snacks", "juice" are Food & Dining in the app AND the WhatsApp parser', () => {
    for (const w of ['tea', 'chai', 'snack', 'snacks', 'juice']) {
      expect(matchCategory(`${w} 50`), w).toBe('food_dining');
      expect(waMatchCategory(`${w} 50`), w).toBe('food_dining');
    }
  });
});

describe('a category budget is its allocation (TD-39 class, in Pip)', () => {
  it('CON-UNIT-AFF-009 · "how much on groceries this month" compares with the ₹5,000 Groceries allocation, not "no budget set"', () => {
    const ctx = ctxFor({ september: [txn({ amount: 1_250, category: 'groceries', date: '2026-09-14' })] });
    const r = resolve(classifyIntent(parse('how much on groceries this month')), ctx);
    const f = r.facts as Record<string, string>;
    expect(r.outcome).toBe('vs_budget');
    expect(f.budget).toBe('₹5,000');
    expect(f.share_of_budget).toBe('25%');
  });
});
