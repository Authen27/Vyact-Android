// CON-UNIT-FACT-001..0xx — Ask Vyact FACTS: the figures resolve() hands the model.
//
// WHY THIS FILE EXISTS. The v10.37 validation session found ten defects and not one
// of them was a wording problem: every figure was real, present in the data, and
// correctly copied into the answer. What was wrong was the figure itself — computed
// two different ways, signed the wrong way, or labelled with a period it did not
// belong to. `assertNoInventedFigures` cannot see any of that, so these tests are
// the only guard against the whole class.
//
// The load-bearing one is the cross-seam agreement test: the same household must not
// have two liquidity figures or two debt totals depending on which question was asked.

import { describe, it, expect, vi } from 'vitest';
import { resolve, runAssistant, LlmBackend, type AssistantContext } from '../askVyactBackend';
import { resolvePeriod, parseDateEntity, matchAccountId } from '../askVyactParser';
import { buildSafeSummary, spendBasis } from '../aiSummary';
import { assertNoInventedFigures, InventedFigureError, type ModelCall } from '../askVyactLlm';
import type { IntentResult } from '../askVyactIntents';
import type { Transaction, Budget, Goal, Debt, Asset, Account, Profile } from '../../types';

const profile = { baseCurrency: 'INR', household: 'family', language: 'en' } as unknown as Profile;
const rates = { INR: 1 };
const monthKey = (offset: number): string => {
  const d = new Date();
  const m = new Date(d.getFullYear(), d.getMonth() - offset, 15);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
};
const dayIn = (offset: number, day = 15): string => `${monthKey(offset)}-${String(day).padStart(2, '0')}`;

const txn = (over: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36).slice(2), type: 'expense', amount: 100, currency: 'INR',
  date: dayIn(0), description: '', category: 'other_expense', ...over,
} as Transaction);

/**
 * A household with real shape: a bank account holding most of the liquidity, three
 * months of history, an essential and a discretionary category, and a mortgage.
 * The bank balance is the point — the old affordability path could not see it.
 */
function makeCtx(over: Partial<AssistantContext> = {}): AssistantContext {
  const transactions: Transaction[] = over.transactions ?? [
    txn({ type: 'income', amount: 300_000, category: 'salary', accountId: 'acc-bank', date: dayIn(0, 1) }),
    txn({ amount: 17_000, category: 'rent_mortgage', accountId: 'acc-bank' }),
    txn({ amount: 2_000, category: 'food_dining', accountId: 'acc-card' }),
    txn({ amount: 16_000, category: 'rent_mortgage', accountId: 'acc-bank', date: dayIn(1) }),
    txn({ amount: 3_000, category: 'food_dining', accountId: 'acc-card', date: dayIn(1) }),
    txn({ amount: 16_000, category: 'rent_mortgage', accountId: 'acc-bank', date: dayIn(2) }),
    txn({ amount: 1_000, category: 'food_dining', accountId: 'acc-card', date: dayIn(2) }),
  ];
  const accounts: Account[] = over.accounts as Account[] ?? ([
    { id: 'acc-bank', name: 'ICICI Bank', kind: 'bank', currency: 'INR', openingBalance: 900_000 },
    { id: 'acc-card', name: 'ICICI Card 3003', kind: 'credit_card', currency: 'INR', openingBalance: 0, creditLimit: 200_000 },
  ] as unknown as Account[]);
  const budgets: Budget[] = over.budgets ?? [];
  const goals: Goal[] = [];
  const debts: Debt[] = over.debts ?? ([
    { id: 'd1', type: 'mortgage', name: 'Home loan', principal: 2_545_000, currentBalance: 2_545_000, interestRate: 8.75, currency: 'INR', minimumPayment: 22_000 },
    { id: 'd2', type: 'credit_card', name: 'Card', principal: 28_288, currentBalance: 28_288, interestRate: 0, currency: 'INR', minimumPayment: 1_000 },
  ] as unknown as Debt[]);
  const assets: Asset[] = over.assets ?? ([
    { id: 'a1', type: 'cash', name: 'Emergency cash', value: 24_000, currency: 'INR', liquidity: 'liquid' },
  ] as Asset[]);
  const summary = buildSafeSummary(transactions, budgets, goals, debts, assets, profile, rates, accounts);
  return {
    summary, transactions, budgets, goals, debts, assets, accounts,
    profile, rates, baseCurrency: 'INR', ...over,
  };
}

const intent = (id: string, entities: Record<string, unknown> = {}): IntentResult => ({
  id: id as IntentResult['id'], bucket: 'interpret', confidence: 0.9,
  entities: { text: 'test question', ...entities },
});

// ── F2 / F10 — one household, one set of figures ─────────────────────────────
describe('cross-seam agreement (F2, F10)', () => {
  it('CON-UNIT-FACT-001 · every seam reports the SAME liquid savings and months of cover', () => {
    const ctx = makeCtx();
    const status = resolve(intent('interpret.status'), ctx).facts as Record<string, string>;
    const afford = resolve(intent('forecast.affordability', { amount: 1_200 }), ctx).facts as Record<string, string>;
    const runway = resolve(intent('forecast.runway'), ctx).facts as Record<string, string>;

    expect(afford.liquid_savings).toBe(status.liquid_savings);
    expect(runway.liquid_savings).toBe(status.liquid_savings);
    // Cover and runway divide the same numerator by the same denominator.
    expect(runway.months_money_would_last).toBe(status.months_of_liquid_cover);
    // And the figure includes the bank balance, not just the assets array —
    // the whole point of F2: the old path saw ₹24,000 and reported 1.2 months.
    expect(status.liquid_savings).not.toBe('₹24,000');
  });

  it('CON-UNIT-FACT-002 · debts and status report the SAME total owed', () => {
    const ctx = makeCtx();
    const status = resolve(intent('interpret.status'), ctx).facts as Record<string, string>;
    const debts = resolve(intent('interpret.debts'), ctx).facts as Record<string, string>;
    expect(debts.total_owed).toBe(status.total_debt);
  });
});

// ── F3 — a negative fact must never read as positive ─────────────────────────
describe('signed figures (F3)', () => {
  it('CON-UNIT-FACT-003 · being below the safety floor is stated as "below", never as a bare amount', () => {
    // A household living close to the line: ₹16,000 of essentials a month (so a
    // ₹48,000 floor) against ₹28,000 left in the bank. No income row and no card,
    // both of which would add to the liquid side and mask the deficit.
    const ctx = makeCtx({
      assets: [],
      transactions: [
        txn({ amount: 16_000, category: 'rent_mortgage', accountId: 'acc-bank', date: dayIn(1) }),
        txn({ amount: 16_000, category: 'rent_mortgage', accountId: 'acc-bank', date: dayIn(2) }),
      ],
      accounts: [
        { id: 'acc-bank', name: 'ICICI Bank', kind: 'bank', currency: 'INR', openingBalance: 60_000 },
      ] as unknown as Account[],
    });
    const facts = resolve(intent('forecast.affordability', { amount: 1_200 }), ctx).facts as Record<string, string>;
    expect(facts.headroom_against_floor).toMatch(/below$/);
    expect(facts).not.toHaveProperty('available_above_floor');
  });

  it('CON-UNIT-FACT-004 · headroom above the floor says "above"', () => {
    const facts = resolve(intent('forecast.affordability', { amount: 1_200 }), makeCtx()).facts as Record<string, string>;
    expect(facts.headroom_against_floor).toMatch(/above$/);
    expect(facts.verdict).toBe('fits');
  });
});

// ── the shared spend baseline ────────────────────────────────────────────────
describe('spendBasis — the one denominator', () => {
  it('CON-UNIT-FACT-005 · averages over completed months only, and says how many', () => {
    const ctx = makeCtx();
    const basis = ctx.summary.spendBasis;
    expect(basis.monthsConsidered).toBe(2);           // two completed months in the fixture
    expect(basis.partialMonthOnly).toBe(false);
    // needs + wants add up to the total, so an answer cannot double-count.
    expect(basis.averageEssential + basis.averageDiscretionary).toBeCloseTo(basis.averageMonthly, 2);
    expect(basis.averageEssential).toBeGreaterThan(basis.averageDiscretionary);
  });

  it('CON-UNIT-FACT-006 · with no completed month it falls back and SAYS it is partial', () => {
    const onlyThisMonth = [txn({ amount: 500, category: 'food_dining' })];
    const basis = spendBasis(onlyThisMonth, 'INR', rates);
    expect(basis.monthsConsidered).toBe(0);
    expect(basis.partialMonthOnly).toBe(true);
    expect(basis.averageMonthly).toBe(500);
  });

  it('CON-UNIT-FACT-007 · the affordability answer states the history it rests on', () => {
    const facts = resolve(intent('forecast.affordability', { amount: 1_200 }), makeCtx()).facts as Record<string, string>;
    expect(facts.months_considered).toContain('completed months');
    expect(facts.typical_essential_monthly).toBeTruthy();
    expect(facts.typical_discretionary_monthly).toBeTruthy();
    expect(facts.safety_floor_basis).toContain('essential');
  });
});

// ── F1 / F5 — periods ────────────────────────────────────────────────────────
describe('periods (F1, F5)', () => {
  it('CON-UNIT-FACT-008 · resolvePeriod places named months, relative months and ISO — and refuses the rest', () => {
    const now = new Date(2026, 8, 16);                 // September 2026
    expect(resolvePeriod('August', now)?.monthKey).toBe('2026-08');
    expect(resolvePeriod('aug', now)?.monthKey).toBe('2026-08');
    expect(resolvePeriod('October', now)?.monthKey).toBe('2025-10');   // most recent PAST October
    expect(resolvePeriod('August 2025', now)?.monthKey).toBe('2025-08');
    expect(resolvePeriod('last month', now)?.monthKey).toBe('2026-08');
    expect(resolvePeriod('this month', now)?.monthKey).toBe('2026-09');
    expect(resolvePeriod('2026-07', now)?.monthKey).toBe('2026-07');
    expect(resolvePeriod('the last 60 days', now)).toBeNull();
    expect(resolvePeriod('', now)).toBeNull();
  });

  it('CON-UNIT-FACT-009 · a named past month is honoured, not silently swapped for this month', () => {
    const ctx = makeCtx();
    const last = monthKey(1);
    const result = resolve(intent('interpret.lookup', { category: 'rent_mortgage', period: 'last month' }), ctx);
    const facts = result.facts as Record<string, string>;
    expect(facts.period).toBe('last month');
    // Last month's rent was ₹16,000; this month's is ₹17,000.
    expect(facts.spent).toBe('₹16,000');
    expect(last).toBeTruthy();
  });

  it('CON-UNIT-FACT-010 · an unplaceable period ASKS instead of answering', () => {
    const result = resolve(intent('interpret.lookup', { category: 'food_dining', period: 'the last 60 days' }), makeCtx());
    expect(result.outcome).toBe('needs_period');
    const facts = result.facts as Record<string, string>;
    expect(facts.requested_period).toBe('the last 60 days');
    // No figure at all: a wrong-window number is worse than no number.
    expect(JSON.stringify(facts)).not.toMatch(/₹/);
  });

  it('CON-UNIT-FACT-011 · no category named → the PERIOD TOTAL, not the biggest category', () => {
    const result = resolve(intent('interpret.lookup', { period: 'this month' }), makeCtx());
    const facts = result.facts as Record<string, string>;
    expect(result.outcome).toBe('period_total');
    expect(facts.total_spent).toBe('₹19,000');          // 17,000 rent + 2,000 dining
    expect(facts.categories_in_period).toBeTruthy();
    expect(facts).not.toHaveProperty('asked_about');
  });
});

// ── F4 — advice sees the position ────────────────────────────────────────────
describe('advice facts (F4)', () => {
  it('CON-UNIT-FACT-012 · prescriptive carries income, savings rate, cover and debts', () => {
    const facts = resolve(intent('forecast.prescriptive'), makeCtx()).facts as Record<string, unknown>;
    expect(facts.income_this_month).toBeTruthy();
    expect(facts.savings_rate_this_month).toBeTruthy();
    expect(facts.months_of_liquid_cover).toBeTruthy();
    expect(facts.debts_highest_rate_first).toBeTruthy();
    // The mortgage rate must be visible — it is the biggest lever in the fixture.
    expect(JSON.stringify(facts.debts_highest_rate_first)).toContain('8.75%');
  });
});

// ── F6 / F7 — capture ────────────────────────────────────────────────────────
describe('capture seeding (F6, F7)', () => {
  it('CON-UNIT-FACT-013 · a merchant implies a category when the user named none', () => {
    const result = resolve(intent('capture.expense', { amount: 653, merchant: 'SWIGGY PVT LTD' }), makeCtx());
    expect(result.seed?.category).toBe('food_dining');   // not other_expense
  });

  it('CON-UNIT-FACT-014 · a stated date and account reach the form seed', () => {
    const result = resolve(intent('capture.expense', {
      amount: 653, merchant: 'SWIGGY PVT LTD', date: dayIn(0, 10), account: 'ICICI Card 3003',
    }), makeCtx());
    expect(result.seed?.date).toBe(dayIn(0, 10));
    expect(result.seed?.accountId).toBe('acc-card');
  });

  it('CON-UNIT-FACT-015 · parseDateEntity reads bank formats and refuses the future', () => {
    const now = new Date(2026, 8, 16);
    expect(parseDateEntity('15-Sep-26', now)).toBe('2026-09-15');
    expect(parseDateEntity('13-Sep-26', now)).toBe('2026-09-13');
    expect(parseDateEntity('2026-09-15', now)).toBe('2026-09-15');
    expect(parseDateEntity('15/09/2026', now)).toBe('2026-09-15');
    expect(parseDateEntity('today', now)).toBe('2026-09-16');
    expect(parseDateEntity('30-Sep-26', now)).toBeNull();    // future
    expect(parseDateEntity('31-Feb-26', now)).toBeNull();    // not a date
    expect(parseDateEntity('sometime', now)).toBeNull();
  });

  it('CON-UNIT-FACT-016 · matchAccountId matches by name, by masked tail, then by kind', () => {
    const accounts = [
      { id: 'acc-bank', name: 'ICICI Bank', kind: 'bank' },
      { id: 'acc-card', name: 'ICICI Card 3003', kind: 'credit_card' },
    ];
    expect(matchAccountId('ICICI Card 3003', accounts)).toBe('acc-card');
    expect(matchAccountId('card xx3003', accounts)).toBe('acc-card');
    expect(matchAccountId('my credit card', accounts)).toBe('acc-card');
    expect(matchAccountId('HSBC', accounts)).toBeNull();
    expect(matchAccountId(undefined, accounts)).toBeNull();
  });

  it('CON-UNIT-FACT-017 · a seeded capture is acknowledged WITHOUT a model call', async () => {
    const call = vi.fn<ModelCall>(async ({ system }) =>
      system.includes('classify')
        ? JSON.stringify({ id: 'capture.expense', entities: { amount: 45, category: 'groceries' }, confidence: 0.95 })
        : 'this phrase call should never happen');
    const turn = await runAssistant('spent 45 on groceries today', makeCtx(), new LlmBackend(call), 0);
    expect(call).toHaveBeenCalledTimes(1);              // classify only
    expect(turn.reply).toContain('nothing is recorded until you do');
    expect(turn.seed?.amount).toBe(45);
    expect(turn.clarify).toBe(false);
  });
});

// ── F8 — the guard ───────────────────────────────────────────────────────────
describe('invented-figure guard (F8)', () => {
  const vars = { amount: '₹17,000' };

  it('CON-UNIT-FACT-018 · still refuses money no tool produced', () => {
    expect(() => assertNoInventedFigures('You spent ₹42,000 on rent.', vars))
      .toThrow(InventedFigureError);
  });

  it('CON-UNIT-FACT-019 · accepts a figure the USER typed', () => {
    expect(() => assertNoInventedFigures('I have set up ₹45 for groceries.', vars,
      { question: 'spent 45 on groceries today' })).not.toThrow();
  });

  it('CON-UNIT-FACT-020 · accepts a date, and still refuses the same number as money', () => {
    expect(() => assertNoInventedFigures('Dated 13 September, filed under other.', vars)).not.toThrow();
    expect(() => assertNoInventedFigures('That is ₹13 of spending.', vars)).toThrow(InventedFigureError);
  });

  it('CON-UNIT-FACT-021 · accepts a figure from the PREVIOUS turn when challenged', () => {
    expect(() => assertNoInventedFigures('The ₹1,200 purchase is comfortably affordable.', vars,
      { alsoAllowed: ['1,200'] })).not.toThrow();
    expect(() => assertNoInventedFigures('The ₹1,200 purchase is comfortably affordable.', vars))
      .toThrow(InventedFigureError);
  });

  it('CON-UNIT-FACT-022 · one retry, told which figures were rejected, before giving up', async () => {
    let phraseCalls = 0;
    const call: ModelCall = async ({ system, user }) => {
      if (system.includes('classify')) {
        return JSON.stringify({ id: 'interpret.status', entities: {}, confidence: 0.9 });
      }
      phraseCalls += 1;
      if (phraseCalls === 1) return 'Your net worth is ₹99,99,999.';   // invented
      // The rejected figure is named back to the model (comma-stripped, as the
      // guard normalises it) so it knows precisely what to drop.
      expect(system).toContain('9999999');
      expect(user).toBeTruthy();
      return 'Your position is strong.';
    };
    const turn = await runAssistant('how am I doing', makeCtx(), new LlmBackend(call), 0);
    expect(phraseCalls).toBe(2);
    expect(turn.reply).toBe('Your position is strong.');
  });

  it('CON-UNIT-FACT-023 · a second invented reply is still discarded', async () => {
    const call: ModelCall = async ({ system }) =>
      system.includes('classify')
        ? JSON.stringify({ id: 'interpret.status', entities: {}, confidence: 0.9 })
        : 'Your net worth is ₹99,99,999.';
    const turn = await runAssistant('how am I doing', makeCtx(), new LlmBackend(call), 0);
    expect(turn.intentId).toBe('unavailable');
  });
});

// ── F9 — meta questions read no household data ───────────────────────────────
describe('meta.assistant (F9)', () => {
  it('CON-UNIT-FACT-024 · answers about the assistant with NO financial facts', () => {
    const result = resolve(intent('meta.assistant'), makeCtx());
    const json = JSON.stringify(result.facts);
    expect(result.outcome).toBe('about_me');
    expect(json).toContain('can_answer');
    expect(json).not.toMatch(/₹/);           // no money reached the model
    expect(json).not.toContain('net_worth');
  });

  it('CON-UNIT-FACT-025 · an unplaceable question offers what CAN be answered', () => {
    const result = resolve(intent('fallback'), makeCtx());
    const facts = result.facts as Record<string, unknown>;
    expect(facts.cannot_answer_yet).toBeTruthy();
    expect(facts.can_answer).toBeTruthy();
    expect(JSON.stringify(facts)).not.toMatch(/₹/);
  });
});
