// TE4-001..007 — Track E, E4 (v10.98.0; owner decisions 13–14 Oct 2026, E-5 and E-9): ONE spending
// baseline and two labelled cover figures, identical on every surface that shows them.
//
// Audit FE-MNY-10: Pip and Net Worth averaged up to 6 months that held ANY row, with the fixed
// need/want map and unmapped categories counted as essential; the Reports runway averaged 3 months
// with spending, with the live map. A stale database row (travel = want, CLAUDE.md) therefore gave
// one household two essential-spend figures. These tests pin the one rule and the one figure.
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildSafeSummary, spendBasis } from '../aiSummary';
import { essentialRunway } from '../essentialRunway';
import { classificationMap, monthsOfCover, spendBaseline } from '../spendBaseline';
import { computeNetWorth } from '../netWorth';
import { resolve, type AssistantContext } from '../askVyactBackend';
import { contextFromRows, DEFAULT_HOUSEHOLD_TZ, type HouseholdRows } from '../serverEngine';
import { mapCloudRow, profileFromRows } from '../supabaseAdapter';
import { DEFAULT_RATES } from '../../constants';
import type { IntentResult } from '../askVyactIntents';
import type { Account, Asset, Profile, Transaction } from '../../types';

const ROOT = resolvePath(__dirname, '../../../..');
const NOW = '2026-10-14';
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${NOW}T06:00:00Z`)); });
afterAll(() => { vi.useRealTimers(); });

const profile = { baseCurrency: 'INR', household: 'family', language: 'en' } as unknown as Profile;
const rates = { INR: 1 };
let n = 0;
const txn = (p: Partial<Transaction>): Transaction => ({
  id: `t${++n}`, type: 'expense', amount: 100, currency: 'INR', date: '2026-08-10', description: '', category: 'groceries', ...p,
} as Transaction);
const split = { interest: 1_000, principal: 9_000, debt_id: 'd1', kind: 'emi', operation_id: 'op-sep' };

/**
 * May, Jun, Aug and Sep have spending; July holds only a salary; October is the current month.
 * The baseline is therefore Jun, Aug and Sep (3 completed months WITH spending).
 */
const LEDGER: Transaction[] = [
  txn({ date: '2026-05-10', amount: 7_000 }),                                  // the 4th-oldest month: dropped
  txn({ date: '2026-06-10', amount: 5_000 }),
  txn({ date: '2026-07-01', type: 'income', category: 'salary', amount: 90_000 }), // income only: not a spending month
  txn({ date: '2026-08-10', amount: 10_000 }),
  txn({ date: '2026-08-12', category: 'shopping', amount: 4_000 }),           // a want
  txn({ date: '2026-08-14', category: 'zz_unmapped', amount: 2_000 }),        // unmapped: not essential (E-5)
  txn({ date: '2026-09-10', amount: 12_000 }),
  txn({ date: '2026-09-12', category: 'travel', amount: 6_000 }),             // built-in: need
  txn({ id: 'emi-int', date: '2026-09-05', category: 'loan_emi', amount: 1_000, debtId: 'd1', emiSplit: split } as Partial<Transaction>),
  txn({ id: 'emi-pri', date: '2026-09-05', type: 'transfer', category: '', amount: 9_000, debtId: 'd1', linkedTxnId: 'emi-int', emiSplit: split } as Partial<Transaction>),
  txn({ date: '2026-10-02', amount: 50_000 }),                                 // the current month: never in it
];
const ASSETS = [{ id: 'a1', type: 'cash', name: 'Savings', value: 200_000, currency: 'INR', liquidity: 'liquid' }] as Asset[];
/** The stale-row case CLAUDE.md describes: the database says travel is a want. */
const ROWS = [{ category: 'travel', classification: 'want' }];
const LIVE = classificationMap(ROWS);

const intent = (id: string, entities: Record<string, unknown> = {}): IntentResult => ({
  id: id as IntentResult['id'], bucket: 'interpret', confidence: 0.9, entities: { text: 'test question', ...entities },
});
function ctxWith(classifications?: ReturnType<typeof classificationMap>): AssistantContext {
  const summary = buildSafeSummary(LEDGER, [], [], [], ASSETS, profile, rates, [], [], undefined, classifications);
  return { summary, transactions: LEDGER, budgets: [], goals: [], debts: [], assets: ASSETS, accounts: [], profile, rates, baseCurrency: 'INR' };
}
const facts = (id: string, ctx: AssistantContext, e: Record<string, unknown> = {}) => resolve(intent(id, e), ctx).facts as Record<string, string>;

describe('one spending baseline (Track E, E4; owner E-5)', () => {
  it('TE4-001 · 3 completed months WITH spending; the current month, income-only months and older months never count', () => {
    const b = spendBaseline(LEDGER, { baseCurrency: 'INR', rates, now: NOW });
    expect(b.months).toEqual(['2026-06', '2026-08', '2026-09']);
    expect(b.partialMonthOnly).toBe(false);
    // Jun 5,000 + Aug 16,000 + Sep 28,000 (the loan payment in full, Track E) = 49,000 / 3.
    expect(b.averageMonthly).toBe(16_333.33);
    // Essential = need only: the want (shopping) and the UNMAPPED category are not essential.
    expect(b.averageEssential).toBe(14_333.33);
    expect(b.averageDiscretionary).toBe(2_000);
    // spendBasis (Pip, Net Worth) is the same baseline, and names its months.
    const basis = spendBasis(LEDGER, 'INR', rates);
    expect(basis).toMatchObject({ monthsConsidered: 3, baselineMonths: b.months, averageMonthly: b.averageMonthly, averageEssential: b.averageEssential });
  });

  it('TE4-002 · the LIVE map applies: a database row overrides the built-in need/want default', () => {
    expect(LIVE.travel).toBe('want');
    expect(LIVE.groceries).toBe('need');                                     // the defaults stay under it
    expect(spendBaseline(LEDGER, { classifications: LIVE, baseCurrency: 'INR', rates, now: NOW }).averageEssential).toBe(12_333.33);
    expect(ctxWith(LIVE).summary.spendBasis.averageEssential).toBe(12_333.33);
    // Rows that are not need/want are ignored; no rows = the built-in map.
    expect(classificationMap([{ category: 'groceries', classification: 'maybe' }]).groceries).toBe('need');
    expect(classificationMap(null).travel).toBe('need');
  });
});

describe('two labelled figures, one per surface (Track E, E4; owner E-9)', () => {
  it('TE4-003 · the Reports runway equals Pip\'s "on essentials only", with the database override in force', () => {
    const ctx = ctxWith(LIVE);
    const projection = computeNetWorth({ assets: ASSETS, accounts: [], debts: [], transactions: LEDGER }, 'INR', rates);
    // What pages/Reports.tsx renders.
    const reports = essentialRunway({ transactions: LEDGER, classifications: LIVE, liquidAssets: projection.liquidAssets, baseCurrency: 'INR', rates });
    expect(reports.status).toBe('ready');
    expect(reports.months).toBe(16.2);                                        // 200,000 / 12,333.33
    expect(ctx.summary.netWorth.essentialMonths).toBe(reports.months);
    expect(facts('interpret.status', ctx).months_of_cover_on_essentials_only).toBe(reports.months!.toFixed(1));
    expect(facts('forecast.runway', ctx).months_on_essentials_only).toBe(reports.months!.toFixed(1));
    expect(reports.baselineMonths).toEqual(ctx.summary.spendBasis.baselineMonths);
    // And it is NOT the figure the built-in map gives: the override is what makes them agree.
    expect(ctxWith().summary.netWorth.essentialMonths).toBe(14);
  });

  it('TE4-004 · Net Worth\'s tile equals Pip\'s "at your usual spending" (status, runway and the WhatsApp runway key)', () => {
    const ctx = ctxWith(LIVE);
    const projection = computeNetWorth({ assets: ASSETS, accounts: [], debts: [], transactions: LEDGER }, 'INR', rates);
    // What pages/NetWorth.tsx renders: the usual-spending figure does not depend on the need/want map.
    const screen = monthsOfCover(projection.liquidAssets, spendBasis(LEDGER, 'INR', rates).averageMonthly);
    expect(screen).toBe(12.2);                                                // 200,000 / 16,333.33
    expect(ctx.summary.netWorth.liquidityMonths).toBe(screen);
    expect(facts('interpret.status', ctx).months_of_cover_at_usual_spending).toBe('12.2');
    expect(facts('forecast.runway', ctx).months_money_would_last).toBe('12.2');
  });

  it('TE4-005 · Pip names which figure it states, and the months it rests on', () => {
    const ctx = ctxWith(LIVE);
    const status = facts('interpret.status', ctx);
    expect(status.cover_basis).toMatch(/all spending/);
    expect(status.cover_basis).toMatch(/essentials only/);
    expect(status.cover_basis).toContain('3 completed months with spending (Jun–Sep 2026)');
    expect(facts('forecast.runway', ctx).which_figure).toMatch(/usual spending.*essential/);
    // The safety floor is three months of the SAME essential average (the live map).
    const afford = facts('forecast.affordability', ctx, { amount: 1_000, text: 'can i afford 1000' });
    expect(afford.safety_floor).toBe('₹37,000');                               // 3 × 12,333.33
  });

  it('TE4-006 · the server builds the same summary as the app, with the live map read from the database', () => {
    const HID = '11111111-1111-4111-8111-111111111111';
    const row = (id: string, p: Record<string, unknown>) => ({
      id, household_id: HID, created_by: null, member_id: null, currency: 'INR', description: 'x', note: null, recurring: null,
      extras: {}, account_id: null, to_account_id: null, initiated_by: null, recurring_schedule_id: null, debt_id: null,
      payment_mode: null, asset_id: null, created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-01T10:00:00Z', deleted_at: null, ...p,
    });
    const rows: HouseholdRows = {
      transactions: [
        row('s1', { type: 'expense', amount: 10_000, category: 'groceries', date: '2026-08-10' }),
        row('s2', { type: 'expense', amount: 6_000, category: 'travel', date: '2026-09-12' }),
        row('s3', { type: 'expense', amount: 4_000, category: 'groceries', date: '2026-09-14' }),
      ],
      budgets: [], budgetAllocations: [], goals: [], debts: [], recurring: [], accounts: [],
      assets: [{ id: 'a1', household_id: HID, type: 'cash', name: 'Savings', value: 200_000, currency: 'INR', liquidity: 'liquid',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: null }],
      memberCount: 1, rates: [], email: '',
      profile: { display_name: 'R', default_currency: 'INR', language: 'en', date_format: 'dmy' },
      household: { type: 'family', base_currency: 'INR', language: 'en', payoff_strategy: 'avalanche', extra_payment: 0 },
      classifications: ROWS,
    };
    const server = contextFromRows(rows).summary;
    const app = buildSafeSummary(
      rows.transactions.map((r) => mapCloudRow('transactions', r) as Transaction), [], [], [],
      rows.assets.map((r) => mapCloudRow('assets', r) as Asset), profileFromRows(rows.profile, rows.household, ''),
      { ...DEFAULT_RATES }, [] as Account[], [], DEFAULT_HOUSEHOLD_TZ, LIVE);
    app.household.members = 1;
    expect(server).toEqual(app);
    expect(server.spendBasis.averageEssential).toBe(7_000);                   // (10,000 + 4,000) / 2: travel is a want
    // Without the rows the built-in map applies (travel = need).
    expect(contextFromRows({ ...rows, classifications: undefined }).summary.spendBasis.averageEssential).toBe(10_000);
  });

  it('TE4-007 · the server loader reads the live map, and the app\'s Pip passes it', () => {
    const loader = readFileSync(resolvePath(ROOT, 'supabase/functions/_shared/agent/householdLoader.ts'), 'utf8');
    expect(loader).toMatch(/from\('category_classifications'\)\.select\('category, classification'\)/);
    expect(loader).toMatch(/classifications: \(classified\.data \?\? \[\]\)/);
    const chat = readFileSync(resolvePath(ROOT, 'react/src/pages/Chat.tsx'), 'utf8');
    expect(chat).toMatch(/const classifications = useCategoryClassifications\(\);/);
    expect(chat).toMatch(/buildSafeSummary\([^)]*, undefined, classifications\)/);
  });
});
