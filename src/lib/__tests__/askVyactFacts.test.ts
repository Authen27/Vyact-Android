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
import { resolve, runAssistant, LlmBackend, quickReply, CAPABILITIES, type AssistantContext } from '../askVyactBackend';
import {
  resolvePeriod, parseDateEntity, matchAccountId, resolveCategoryId,
  parseAmount, statedCurrency, amountLooksLikeIdentifier,
} from '../askVyactParser';
import { buildSafeSummary, spendBasis } from '../aiSummary';
import { computeNetWorth, cardDues } from '../netWorth';
import { assertNoInventedFigures, InventedFigureError, INTENT_IDS, CLASSIFY_SYSTEM, type ModelCall } from '../askVyactLlm';
import type { IntentResult } from '../askVyactIntents';
import type { Transaction, Budget, Goal, Debt, Asset, Account, Profile, RecurringSchedule } from '../../types';

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

  it('CON-UNIT-FACT-035 · a receivable is never listed among the household\'s debts', () => {
    // Found in production: a ₹1,245 loan the household had MADE was listed among
    // its debts, and advice was offered on clearing it. Net worth already excluded
    // it from liabilities; the assistant's list did not.
    const ctx = makeCtx({ debts: [
      { id: 'd1', type: 'mortgage', name: 'Home', principal: 100_000, currentBalance: 100_000, interestRate: 8.75, currency: 'INR', direction: 'owed_by_me' },
      { id: 'd2', type: 'other', name: 'Lent to a friend', principal: 1_245, currentBalance: 1_245, interestRate: 0, currency: 'INR', direction: 'owed_to_me' },
    ] as unknown as Debt[] });
    const facts = resolve(intent('interpret.debts'), ctx).facts as Record<string, unknown>;
    expect(JSON.stringify(facts.debts_highest_rate_first)).not.toContain('1,245');
    expect(ctx.summary.debts).toHaveLength(1);
  });

  it('CON-UNIT-FACT-002 · debts and status report the SAME total owed', () => {
    const ctx = makeCtx();
    const status = resolve(intent('interpret.status'), ctx).facts as Record<string, string>;
    const debts = resolve(intent('interpret.debts'), ctx).facts as Record<string, string>;
    expect(debts.total_owed).toBe(status.total_debt);
  });
});

// ── v10.38.1 — the Net Worth screen and the assistant quote the same figures ──
describe('one household, one cover figure (P1, P1b)', () => {
  it('CON-UNIT-FACT-026 · Net Worth\'s months-of-cover equals the assistant\'s, on the same baseline', () => {
    const ctx = makeCtx();
    const facts = resolve(intent('interpret.status'), ctx).facts as Record<string, string>;
    // What pages/NetWorth.tsx renders: canonical liquid ÷ the shared spend basis.
    const projection = computeNetWorth(
      { assets: ctx.assets, accounts: ctx.accounts as Account[], debts: ctx.debts, transactions: ctx.transactions },
      'INR', rates);
    const basis = spendBasis(ctx.transactions, 'INR', rates);
    const screenCover = basis.averageMonthly > 0 ? projection.liquidAssets / basis.averageMonthly : 0;
    expect(screenCover.toFixed(1)).toBe(facts.months_of_liquid_cover);
    expect(projection.liquidAssets).toBe(ctx.summary.netWorth.liquidAssets);
  });

  it('CON-UNIT-FACT-027 · a card that owes money never inflates the assistant\'s liquidity', () => {
    // The production case: ₹24,000 outstanding stored as a positive balance.
    // `assets: []` matters — the default fixture holds a ₹24,000 liquid asset, so
    // leaving it in would make ₹58,000 ambiguous between the asset and the card.
    const withOwing = makeCtx({ assets: [], accounts: [
      { id: 'acc-bank', name: 'ICICI Bank', kind: 'bank', currency: 'INR', openingBalance: 34_000 },
      { id: 'acc-card', name: 'Federal', kind: 'credit_card', currency: 'INR', openingBalance: 24_000 },
    ] as unknown as Account[], transactions: [] });
    const facts = resolve(intent('interpret.status'), withOwing).facts as Record<string, string>;
    expect(facts.liquid_savings).toBe('₹34,000');      // not ₹58,000
  });
});

// ── P4 (v10.39) — the account and asset dimension ───────────────────────────
//
// Three questions in one validation session died for want of this: "₹58k or ₹33k?",
// "which account am I spending from?", "what should I sell?". The breakdown's whole
// job is to make a total checkable, so the first test is that the parts add up.
describe('where the money sits (P4)', () => {
  it('CON-UNIT-FACT-036 · the liquidity breakdown sums EXACTLY to the total it decomposes', () => {
    const ctx = makeCtx();
    const facts = resolve(intent('interpret.status'), ctx).facts as Record<string, unknown>;
    const parts = facts.liquid_by_source as { held_in: string; amount: string }[];
    expect(parts.length).toBeGreaterThan(0);
    const sum = parts.reduce((s, p) => s + Number(p.amount.replace(/[^\d.-]/g, '')), 0);
    expect(sum).toBe(Math.round(ctx.summary.netWorth.liquidAssets));
    expect(facts.liquid_savings).toBe(`₹${Math.round(ctx.summary.netWorth.liquidAssets).toLocaleString('en-IN')}`);
  });

  it('CON-UNIT-FACT-037 · a card never appears among the liquid sources (P1 holds here too)', () => {
    const ctx = makeCtx({ assets: [], accounts: [
      { id: 'acc-bank', name: 'ICICI Bank', kind: 'bank', currency: 'INR', openingBalance: 34_000 },
      { id: 'acc-card', name: 'Federal', kind: 'credit_card', currency: 'INR', openingBalance: 24_000 },
    ] as unknown as Account[], transactions: [] });
    const facts = resolve(intent('interpret.status'), ctx).facts as Record<string, unknown>;
    const parts = facts.liquid_by_source as { held_in: string }[];
    expect(parts.map(p => p.held_in)).toEqual(['ICICI Bank']);
  });

  it('CON-UNIT-FACT-038 · spending is grouped by the account it left', () => {
    const facts = resolve(intent('interpret.lookup', { period: 'this month' }), makeCtx()).facts as Record<string, unknown>;
    const rows = facts.spend_by_account as { paid_from: string; spent: string }[];
    // The fixture spends ₹17,000 from the bank and ₹2,000 on the card this month.
    expect(rows).toEqual([
      { paid_from: 'ICICI Bank', spent: '₹17,000' },
      { paid_from: 'ICICI Card 3003', spent: '₹2,000' },
    ]);
  });

  it('CON-UNIT-FACT-039 · spending with no account recorded is reported, never dropped', () => {
    const ctx = makeCtx({ transactions: [
      txn({ amount: 500, category: 'food_dining', accountId: 'acc-bank' }),
      txn({ amount: 300, category: 'food_dining' }),          // no accountId
    ] });
    const rows = (resolve(intent('interpret.lookup', { period: 'this month' }), ctx).facts as Record<string, unknown>)
      .spend_by_account as { paid_from: string; spent: string }[];
    expect(rows).toContainEqual({ paid_from: 'no account recorded', spent: '₹300' });
    // …and the parts still account for the whole period total.
    const sum = rows.reduce((s, r) => s + Number(r.spent.replace(/[^\d.-]/g, '')), 0);
    expect(sum).toBe(800);
  });

  it('CON-UNIT-FACT-040 · advice can see what is owned, grouped by how soon it is reachable', () => {
    const facts = resolve(intent('forecast.prescriptive'), makeCtx()).facts as Record<string, unknown>;
    const owned = facts.what_you_own as { holding: string; how_soon: string }[];
    expect(owned.some(o => o.holding === 'Emergency cash' && o.how_soon === 'reachable now')).toBe(true);
  });

  it('CON-UNIT-FACT-041 · the breakdown carries NAMES and amounts only — no ids, no account numbers', () => {
    const ctx = makeCtx();
    const json = JSON.stringify((resolve(intent('interpret.status'), ctx).facts as Record<string, unknown>).liquid_by_source);
    expect(json).not.toContain('acc-bank');        // no internal ids
    expect(json).not.toMatch(/\bXX\d|\d{4,}\d{4,}/); // no masked or full card digits
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

// ── P6 — a category NAME is resolved to the ledger's category ID ─────────────
describe('category resolution (P6)', () => {
  it('CON-UNIT-FACT-030 · resolveCategoryId maps names, aliases and keywords to ids', () => {
    expect(resolveCategoryId('food_dining')).toBe('food_dining');   // already an id
    expect(resolveCategoryId('food')).toBe('food_dining');          // legacy alias
    expect(resolveCategoryId('dining')).toBe('food_dining');        // keyword
    expect(resolveCategoryId('petrol')).toBe('travel');
    expect(resolveCategoryId('Rent')).toBe('rent_mortgage');
    expect(resolveCategoryId('sdfkjh')).toBeUndefined();            // unknown ⇒ ask
    expect(resolveCategoryId(undefined)).toBeUndefined();
  });

  it('CON-UNIT-FACT-031 · "food" reports the real figure, never ₹0 beside a breakdown that shows it', () => {
    // The production case: classify returned "food", the ledger key is food_dining,
    // and the lookup reported ₹0 next to a breakdown listing ₹616.
    const facts = resolve(intent('interpret.lookup',
      { category: 'food', period: 'last month' }), makeCtx()).facts as Record<string, string>;
    expect(facts.asked_about).toBe('Food & Dining');
    expect(facts.spent).toBe('₹3,000');          // last month's dining in the fixture
    expect(facts.spent).not.toBe('₹0');
  });

  it('CON-UNIT-FACT-032 · an unplaceable category asks instead of reporting zero', () => {
    const result = resolve(intent('interpret.lookup', { category: 'qwertyuiop' }), makeCtx());
    const facts = result.facts as Record<string, unknown>;
    expect(result.outcome).toBe('needs_category');
    // No figure is attributed to the category we could not place…
    expect(facts.spent).toBeUndefined();
    expect(facts.asked_about).toBeUndefined();
    // …but the real categories travel, so the answer can offer them back.
    expect(facts.categories_in_period).toBeTruthy();
  });
});

// ── P3 — a negative cash balance is raised, never silently corrected ─────────
describe('data quality (P3)', () => {
  it('CON-UNIT-FACT-033 · negative recorded cash surfaces as a warning in the facts', () => {
    const ctx = makeCtx({
      accounts: [{ id: 'acc-cash', name: 'Cash', kind: 'cash', currency: 'INR', openingBalance: 0 }] as unknown as Account[],
      transactions: [txn({ amount: 500, category: 'food_dining', accountId: 'acc-cash' })],
    });
    const facts = resolve(intent('interpret.status'), ctx).facts as Record<string, string>;
    expect(facts.data_warning).toContain('below zero');
    // …and the figure is NOT clamped: clamping would fabricate money.
    expect(ctx.summary.dataQuality.cashBalanceNegative).toBe(true);
  });

  it('CON-UNIT-FACT-034 · a healthy household carries no warning', () => {
    const facts = resolve(intent('interpret.status'), makeCtx()).facts as Record<string, string>;
    expect(facts.data_warning).toBeUndefined();
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

// ── P5 — the SEAM: one turn's figures reach the next turn's guard ────────────
//
// v10.38 tested the guard directly with `alsoAllowed` and passed, while production
// still rejected a follow-up quoting the previous answer. The unit test proved the
// function; nothing proved the JOIN. This drives two real turns and asserts the
// second may cite the first — the same lesson as the cross-seam liquidity test.
describe('challenging a figure across turns (P5)', () => {
  it('CON-UNIT-FACT-028 · turn 2 may quote turn 1\'s figure, and is not discarded', async () => {
    const ctx = makeCtx();
    const first = await runAssistant('how am I doing', ctx, new LlmBackend(async ({ system, user }) => {
      if (system.includes('classify')) return JSON.stringify({ id: 'interpret.status', entities: {}, confidence: 0.9 });
      const facts = JSON.parse(user).facts as Record<string, string>;
      return `Your net worth is ${facts.net_worth}.`;
    }), 0);
    expect(first.allowedFigures?.length).toBeGreaterThan(0);

    // The follow-up's own facts are a DIFFERENT intent, so the challenged figure
    // is absent from this turn's data — exactly the production case.
    const challenged = (ctx.summary.netWorth.liquidAssets).toString();
    const second = await runAssistant(
      'that does not sound right', ctx,
      new LlmBackend(async ({ system }) => {
        if (system.includes('classify')) return JSON.stringify({ id: 'interpret.debts', entities: {}, confidence: 0.9 });
        return `You said ₹${challenged} before; here is the debt picture.`;
      }),
      0, undefined,
      first.allowedFigures,          // what Chat.tsx now passes from its ref
    );
    expect(second.intentId).toBe('interpret.debts');      // not 'unavailable'
    expect(second.reply).toContain(challenged);
  });

  it('CON-UNIT-FACT-029 · without the previous turn\'s figures, the same reply is refused', async () => {
    const ctx = makeCtx();
    const challenged = (ctx.summary.netWorth.liquidAssets).toString();
    const turn = await runAssistant(
      'that does not sound right', ctx,
      new LlmBackend(async ({ system }) => {
        if (system.includes('classify')) return JSON.stringify({ id: 'interpret.debts', entities: {}, confidence: 0.9 });
        return `You said ₹${challenged} before; here is the debt picture.`;
      }),
      0, undefined, [],
    );
    // Retried once, refused twice, so the turn degrades honestly.
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

// ── v10.39.1 — P20 · a stated currency is converted before anything is computed ──
describe('foreign amounts (P20)', () => {
  const fx = { USD: 1, INR: 83.2 };

  it('CON-UNIT-FACT-042 · "$150 dinner" is checked as ₹12,480, not ₹150', () => {
    const ctx = makeCtx({ rates: fx });
    const r = resolve(intent('forecast.affordability', { amount: 150, text: 'can i afford a $150 dinner' }), ctx);
    const f = r.facts as Record<string, string>;
    expect(f.purchase).toBe('₹12,480');
    expect(f.amount_as_stated).toBe('150 USD');
    expect(f.converted_at).toContain('1 USD = 83.20 INR');
  });

  it('CON-UNIT-FACT-043 · a foreign capture seeds the converted amount and says so, with no phrase call', async () => {
    const call = vi.fn<ModelCall>(async () =>
      JSON.stringify({ id: 'capture.expense', entities: { amount: 150, currency: 'USD', category: 'food_dining' }, confidence: 0.9 }));
    const turn = await runAssistant('spent $150 on dinner', makeCtx({ rates: fx }), new LlmBackend(call), 0);
    expect(call).toHaveBeenCalledTimes(1);
    expect(turn.seed?.amount).toBe(12480);
    expect(turn.reply).toContain("150 USD at the app's exchange rate");
  });

  it('CON-UNIT-FACT-044 · with no rate for the currency, NO figure is produced', () => {
    const r = resolve(intent('forecast.affordability', { amount: 40, currency: 'EUR', text: 'can i afford €40' }),
      makeCtx({ rates: fx }));
    expect(r.outcome).toBe('needs_rate');
    expect(JSON.stringify(r.facts)).not.toMatch(/₹/);
  });

  it('CON-UNIT-FACT-045 · statedCurrency reads entities, symbols and words, and $ against the base', () => {
    expect(statedCurrency(undefined, '$150 dinner', 'INR', '₹')).toBe('USD');
    expect(statedCurrency(undefined, '$150 dinner', 'AUD', 'A$')).toBe('AUD');
    expect(statedCurrency(undefined, '₹500 lunch', 'INR', '₹')).toBe('INR');
    expect(statedCurrency('gbp', '150 dinner', 'INR', '₹')).toBe('GBP');
    expect(statedCurrency(undefined, '40 euros', 'INR', '₹')).toBe('EUR');
    expect(statedCurrency(undefined, 'spent 150 on dinner', 'INR', '₹')).toBeUndefined();
  });

  it('CON-UNIT-FACT-046 · the base currency stated explicitly is not converted', () => {
    const r = resolve(intent('forecast.affordability', { amount: 1500, text: 'can i afford ₹1500 shoes' }), makeCtx({ rates: fx }));
    expect((r.facts as Record<string, string>).purchase).toBe('₹1,500');
    expect((r.facts as Record<string, string>).amount_as_stated).toBeUndefined();
  });
});

// ── v10.39.1 — P8 · an identifier is never an amount ────────────────────────────
describe('identifier-shaped numbers (P8)', () => {
  it('CON-UNIT-FACT-047 · the client parser skips phone, card and reference numbers', () => {
    expect(parseAmount('send from 8897882803')).toBeUndefined();
    expect(parseAmount('card xx3003 debited rs 1,250')).toBe(1250);
    expect(parseAmount('spent 500 on lunch')).toBe(500);
  });

  it('CON-UNIT-FACT-048 · a model-extracted phone number asks for the amount instead of seeding it', () => {
    const text = 'This message is from test number. Send from 8897882803';
    const r = resolve({ ...intent('capture.expense', { amount: 8_897_882_803, text }), bucket: 'capture' }, makeCtx());
    expect(r.outcome).toBe('missing_amount');
    expect(r.seed).toBeUndefined();
    expect(amountLooksLikeIdentifier(text.toLowerCase(), 8_897_882_803)).toBe(true);
    expect(amountLooksLikeIdentifier('spent 500 on lunch', 500)).toBe(false);
  });
});

// ── v10.39.1 — P19 · free to spend is cash less what the cards owe ─────────────
describe('card dues (P19)', () => {
  it('CON-UNIT-FACT-049 · cardDues is the card account outstanding, read from the projection', () => {
    const ctx = makeCtx();
    // The card account carries ₹6,000 of spend with no repayment.
    expect(ctx.summary.netWorth.cardDues).toBe(6000);
    const nw = computeNetWorth({ assets: ctx.assets, accounts: ctx.accounts as Account[], debts: ctx.debts, transactions: ctx.transactions }, 'INR', rates);
    expect(cardDues(nw)).toBe(ctx.summary.netWorth.cardDues);
  });

  it('CON-UNIT-FACT-050 · status and affordability state free-to-spend, and headroom subtracts the dues', () => {
    const ctx = makeCtx();
    const liquid = ctx.summary.netWorth.liquidAssets;
    const status = resolve(intent('interpret.status'), ctx).facts as Record<string, string>;
    expect(status.card_dues_to_pay).toBe('₹6,000');
    expect(status.free_to_spend_after_card_dues).toBe(`₹${Math.round(liquid - 6000).toLocaleString('en-IN')} free`);
    const afford = resolve(intent('forecast.affordability', { amount: 1000 }), ctx).facts as Record<string, string>;
    const floor = ctx.summary.spendBasis.averageEssential * 3;
    const headroom = Math.round(liquid - 6000 - floor);
    expect(afford.headroom_against_floor).toBe(`₹${Math.abs(headroom).toLocaleString('en-IN')} ${headroom < 0 ? 'below' : 'above'}`);
  });
});

// ── v10.39.1 — P7 · Pulse is not a verdict on the cushion ──────────────────────
describe('Pulse beside a thin cushion (P7)', () => {
  it('CON-UNIT-FACT-051 · a strong score with under three months of cover does not say "Strong"', () => {
    const base = makeCtx();
    const ctx = { ...base, summary: { ...base.summary,
      pulseScore: { total: 100, components: {} },
      netWorth: { ...base.summary.netWorth, liquidityMonths: 1.7 } } };
    const r = resolve(intent('interpret.status', { text: 'how am i doing' }), ctx);
    expect(String(r.vars.detail)).not.toContain('Strong');
    expect(String(r.vars.detail)).toContain('1.7 months');
    const f = r.facts as Record<string, string>;
    expect(f.pulse_measures).toContain('not how long your savings would last');
    expect(f.cushion_note).toContain('1.7 months');
  });

  it('CON-UNIT-FACT-052 · a healthy cushion carries no cushion note', () => {
    const base = makeCtx();
    const ctx = { ...base, summary: { ...base.summary, netWorth: { ...base.summary.netWorth, liquidityMonths: 8 } } };
    expect((resolve(intent('interpret.status'), ctx).facts as Record<string, string>).cushion_note).toBeUndefined();
  });
});

// ── v10.39.1 — P17 · greetings and questions about me need no model ────────────
describe('instant replies (P17)', () => {
  it('CON-UNIT-FACT-053 · a greeting is answered with ZERO model calls, even with no model at all', async () => {
    const call = vi.fn<ModelCall>(async () => 'never');
    const turn = await runAssistant('Hi!', makeCtx(), new LlmBackend(call), 0);
    expect(call).not.toHaveBeenCalled();
    expect(turn.reply).toMatch(/^Hi\. What would you like to do\?/);   // no exclamation marks (deck rule)
    expect(turn.chips?.length).toBeGreaterThan(0);
    const offline = await runAssistant('thanks', makeCtx(), null, 0);
    expect(offline.intentId).toBe('meta.assistant');
  });

  it('CON-UNIT-FACT-054 · a greeting WITH a question still goes to the model', () => {
    expect(quickReply('hi, how much did I spend this month?')).toBeNull();
    expect(quickReply('what can you do?')?.reply).toMatch(/^Record — .*\nCheck — .*\nPlan — /);
    expect(quickReply('What do I call you')?.reply).toContain('Pip');
  });

  it('CON-UNIT-FACT-055 · a classified meta question costs one call (classify), no phrase call', async () => {
    const call = vi.fn<ModelCall>(async () => JSON.stringify({ id: 'meta.assistant', entities: {}, confidence: 0.9 }));
    const turn = await runAssistant('why are you so slow today', makeCtx(), new LlmBackend(call), 0);
    expect(call).toHaveBeenCalledTimes(1);
    expect(turn.reply).toContain('two steps');
    expect(turn.reply).not.toMatch(/₹/);
  });
});

// ── v10.39.1 — P21 · set up a recurring bill from chat ─────────────────────────
describe('recurring drafts (P21)', () => {
  it('CON-UNIT-FACT-056 · "add Netflix 649 every month on the 5th" drafts a schedule, never saves one', async () => {
    const call = vi.fn<ModelCall>(async () => JSON.stringify({
      id: 'capture.recurring', entities: { amount: 649, merchant: 'netflix', frequency: 'monthly' }, confidence: 0.9 }));
    const turn = await runAssistant('add Netflix 649 every month on the 5th', makeCtx(), new LlmBackend(call), 0);
    expect(call).toHaveBeenCalledTimes(1);
    expect(turn.recurringSeed).toEqual({
      name: 'Netflix', type: 'expense', amount: 649, category: 'entertainment', frequency: 'monthly', dayOfMonth: 5 });
    expect(turn.seed).toBeUndefined();
    expect(turn.reply).toContain('nothing is set up until you do');
  });

  it('CON-UNIT-FACT-057 · a bare number is never taken as the day; frequency and income are read', () => {
    const r = resolve(intent('capture.recurring', { amount: 50000, text: 'set up my salary 50000 weekly' }), makeCtx());
    expect(r.recurringSeed).toMatchObject({ type: 'income', frequency: 'weekly', category: 'salary' });
    expect(r.recurringSeed?.dayOfMonth).toBeUndefined();
  });

  it('CON-UNIT-FACT-058 · a recurring bill with no amount asks for one', () => {
    expect(resolve(intent('capture.recurring', { text: 'add my rent every month' }), makeCtx()).outcome).toBe('missing_amount');
  });
});

// ── v10.39.1 — P22 · "I can't do that" is a route, not a misclassification ──────
describe('unsupported requests (P22)', () => {
  it('CON-UNIT-FACT-059 · an unsupported request reads no household data and says what does work', () => {
    const r = resolve(intent('unsupported', { text: 'pay my card bill' }), makeCtx());
    expect(r.outcome).toBe('unsupported');
    const json = JSON.stringify(r.facts);
    expect(json).not.toMatch(/₹/);
    expect(json).toContain('paying, sending or moving real money');
  });

  it('CON-UNIT-FACT-060 · the capability list no longer implies bills can be managed', () => {
    expect(CAPABILITIES.can_answer).not.toContain('upcoming and recurring bills');
    expect(CAPABILITIES.can_answer.join(' ')).toContain('set up as recurring schedules');
    expect(INTENT_IDS).toEqual(expect.arrayContaining(['capture.recurring', 'unsupported']));
    expect(CLASSIFY_SYSTEM).toContain('unsupported');
  });
});

// ── v10.41.0 — the receptionist: a greeting is the entry point ─────────────────
describe('receptionist (greeting entry point)', () => {
  const iso = (offsetDays: number) => {
    const d = new Date(); d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const bill = { active: true, nextDueDate: iso(2),
    transactionTemplate: { type: 'expense', amount: 1840, description: 'Electricity', category: 'utilities' } } as unknown as RecurringSchedule;
  const withAttention = () => {
    const base = makeCtx({ profile: { ...profile, name: 'Rohan Mehta' } as Profile, recurring: [bill] });
    return { ...base, summary: { ...base.summary, budgets: [{ category: 'food_dining', limit: 5000, spentPct: 92 }] } };
  };

  it('CON-UNIT-FACT-061 · something due and a budget at risk: both named, and the chips follow them', () => {
    const q = quickReply('hi', withAttention())!;
    expect(q.reply).toMatch(/^Hi, Rohan\. What would you like to do\?\nElectricity, ₹1,840, is due \w+, and Food & Dining is at 92% of its budget with \d+ days? to go\.$/);
    expect(q.chips?.map(c => c.label)).toEqual(['Log an expense', "What's due this week", 'Why is Food & Dining high?']);
  });

  it('CON-UNIT-FACT-062 · nothing pending: says so plainly, and offers the everyday checks', () => {
    const q = quickReply('good morning', makeCtx({ recurring: [] }))!;
    expect(q.reply).toBe("Morning. What would you like to do?\nNothing's due this week and your budgets are on track.");
    expect(q.chips?.map(c => c.label)).toEqual(['Log an expense', 'Spend this month', 'How am I doing?']);
  });

  it('CON-UNIT-FACT-063 · a new household is welcomed and pointed at its first action', () => {
    const q = quickReply('hello', makeCtx({ transactions: [] }))!;
    expect(q.reply).toContain("Nothing's recorded yet");
    expect(q.chips?.map(c => c.label)).toEqual(['Log an expense', 'Add an account', 'What can you do?']);
  });

  it('CON-UNIT-FACT-064 · the receptionist chips lead somewhere real, with no model call', async () => {
    const call = vi.fn<ModelCall>(async () => 'never');
    const log = await runAssistant('log an expense', makeCtx(), new LlmBackend(call), 0);
    expect(log.reply).toContain('450 lunch');
    const account = await runAssistant('add an account', makeCtx(), new LlmBackend(call), 0);
    expect(account.reply).toContain('Accounts');
    expect(call).not.toHaveBeenCalled();
  });

  it('CON-UNIT-FACT-065 · thanks closes without new chips; a bill beyond 7 days is not "due this week"', () => {
    expect(quickReply('thanks')).toEqual({ reply: "Any time. I'm here when you need me." });
    const far = { ...bill, nextDueDate: iso(12) } as RecurringSchedule;
    expect(quickReply('hi', makeCtx({ recurring: [far] }))!.reply).toContain("Nothing's due this week");
  });
});
