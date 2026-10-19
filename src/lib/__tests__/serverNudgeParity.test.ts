// T5C-004..005 — v10.122.0 (T5c; audit XC-ARC-06, INT-PAR-05). WhatsApp's scheduled nudges read the APP's
// rules through the bundled engine, so one household gets one answer whichever way it is told:
// - the budget alert names the lines the bell names, at the bell's percentage (it kept its own 80% rule,
//   which never checked a single-category budget);
// - the stale-balance nudge counts the accounts the bell, push and "Reply UPDATE" count (its own 30-day cut
//   ignored a reconcile recorded only in the log, and relied on its query to leave other kinds out).
// WhatsApp's side runs the BUNDLE (engine.generated.js, through _shared/agent/engine.ts); the bell's runs
// the app's source.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationsOnServer, balancesToCheck, type HouseholdRows } from '../serverEngine';
import {
  budgetAlerts, staleBalanceNudge, type AccountRow, type BudgetRow, type AllocationRow, type TxnRow,
} from '../../../../supabase/functions/_shared/whatsapp-dispatch-rules';

const HID = '11111111-1111-4111-8111-111111111111';
const ACC = '22222222-2222-4222-8222-222222222222';
const B1 = '33333333-3333-4333-8333-333333333331';
const B2 = '33333333-3333-4333-8333-333333333332';
const TODAY = '2026-09-19';   // a 30-day month: a single-category budget's period ends on the 30th
const MEMBERS = [{ profile_id: 'alice', household_id: HID }];
const HH = { id: HID, base_currency: 'INR' };

const txn = (id: string, category: string, amount: number): TxnRow & Record<string, unknown> => ({
  id, household_id: HID, created_by: null, member_id: null, currency: 'INR', date: '2026-09-05', description: 'x',
  type: 'expense', amount, category, note: null, recurring: null, extras: {}, account_id: ACC, to_account_id: null,
  initiated_by: null, recurring_schedule_id: null, debt_id: null, payment_mode: null, asset_id: null,
  created_at: '2026-09-05T10:00:00Z', updated_at: '2026-09-05T10:00:00Z', deleted_at: null,
});
const budget = (id: string, p: Record<string, unknown>): BudgetRow => ({
  id, household_id: HID, currency: 'INR', period: 'monthly', color: null, category: null, monthly_limit: 0,
  period_start: null, period_end: null, scope: null, period_year: null, period_month: null,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', deleted_at: null, ...p,
});
const alloc = (budgetId: string, category: string, amount: number): AllocationRow =>
  ({ id: `${budgetId}-${category}`, budget_id: budgetId, household_id: HID, category, amount, updated_at: '2026-09-01T00:00:00Z' });
const account = (id: string, p: Record<string, unknown>): AccountRow => ({
  id, household_id: HID, name: id, currency: 'INR', opening_balance: 0, is_default: false, is_archived: false,
  reconciliation_offset: 0, reconciliation_log: [], payment_modes: [], last_reconciled_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: null, ...p,
});
const householdRows = (p: Partial<HouseholdRows>): HouseholdRows => ({
  transactions: [], budgets: [], budgetAllocations: [], goals: [], debts: [], assets: [], recurring: [], accounts: [],
  memberCount: 1, rates: [], email: 'rohan@example.com',
  profile: { display_name: 'Rohan Mehta', default_currency: 'INR', language: 'en', date_format: 'dmy' },
  household: { type: 'family', base_currency: 'INR', language: 'en', payoff_strategy: 'avalanche', extra_payment: 0, timezone: 'Asia/Kolkata' },
  ...p,
});

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(`${TODAY}T06:00:00Z`)); });
afterEach(() => { vi.useRealTimers(); });

describe('WhatsApp\'s scheduled nudges say what the bell says (T5c)', () => {
  it('T5C-004 · the budget alert names the bell\'s lines at the bell\'s percentage; the single-category budget is checked too', () => {
    const budgets = [
      budget(B1, { scope: 'month', period_year: 2026, period_month: 9, period_start: '2026-09-01', period_end: '2026-09-30', monthly_limit: 17000 }),
      budget(B2, { category: 'utilities', monthly_limit: 1000 }),   // a pre-v9.1 single-category budget: no period of its own
    ];
    const allocations = [alloc(B1, 'food_dining', 10000), alloc(B1, 'groceries', 5000), alloc(B1, 'travel', 2000)];
    const transactions = [
      txn('t1', 'food_dining', 8600),   // 86%: both alert
      txn('t2', 'groceries', 5300),     // 106%: the bell says over; WhatsApp's template speaks of what is left, so not
      txn('t3', 'travel', 500),         // 25%: neither
      txn('t4', 'utilities', 920),      // 92% of the single-category budget: the old WhatsApp rule never looked
    ];

    const bell = notificationsOnServer(householdRows({ budgets, budgetAllocations: allocations, transactions }), [], HID)
      .filter(n => n.type === 'budget_threshold')
      .map(n => [n.title, n.dedupe_key]);
    expect(bell).toEqual([
      ['Food & Dining at 86% of the September budget', `budget_threshold:${B1}:food_dining:2026-09-01:80`],
      ['Groceries at 106% of the September budget', `budget_threshold:${B1}:groceries:2026-09-01:100`],
      ['Utilities at 92% of the September budget', `budget_threshold:${B2}:utilities:2026-09-01:80`],
    ]);

    const whatsapp = budgetAlerts({ household: HH, today: TODAY, budgets, allocations, txns: transactions, members: MEMBERS });
    expect(whatsapp.map(s => [s.values, s.dedupeKey])).toEqual([
      [['Food & Dining', '86', '11', '1,400'], `budget:${B1}:food_dining:80`],
      [['Utilities', '92', '11', '80'], `budget:${B2}:utilities:80`],   // 11 days to the 30th, the month's real end
    ]);
    // Every WhatsApp alert is a line the bell raised, at the same percentage.
    for (const s of whatsapp) {
      expect(bell.some(([title]) => title.startsWith(`${s.values[0]} at ${s.values[1]}%`))).toBe(true);
    }
  });

  it('T5C-005 · the stale-balance nudge counts the accounts the bell, push and "Reply UPDATE" count', () => {
    const accounts = [
      account('bank-old', { kind: 'bank', last_reconciled_at: '2026-07-01T00:00:00Z' }),            // stale
      account('cash-never', { kind: 'cash' }),                                                       // stale (created in January)
      account('card-fresh', { kind: 'credit_card', last_reconciled_at: '2026-09-10T00:00:00Z' }),    // checked 9 days ago
      account('bank-log', { kind: 'bank', reconciliation_log: [{ at: '2026-09-15T00:00:00Z', delta: 0, stated_value: 100 }] }), // checked by the log
      account('bank-new', { kind: 'bank', created_at: '2026-09-18T00:00:00Z' }),                     // added yesterday
      account('invest-old', { kind: 'investment' }),                                                 // not a balance to check
      account('bank-archived', { kind: 'bank', is_archived: true }),                                 // archived
    ];
    const rows = householdRows({ accounts });

    const replyUpdate = balancesToCheck(rows, Date.now()).map(b => b.id).sort();
    expect(replyUpdate).toEqual(['bank-old', 'cash-never']);
    const bell = notificationsOnServer(rows, [], HID).filter(n => n.type === 'stale_balance').map(n => n.title);
    expect(bell).toEqual(['2 balances may be out of date']);
    const nudge = staleBalanceNudge({ household: HH, now: new Date(), accounts, member: { ...MEMBERS[0], first_name: 'Rohan' }, weekKey: 'W' });
    expect(nudge?.values).toEqual(['Rohan', 'two']);   // its own cut counted bank-log too (and any row it was given)
  });
});
