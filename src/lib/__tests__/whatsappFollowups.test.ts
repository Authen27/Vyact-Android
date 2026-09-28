// W6 (v10.47.0) — the WhatsApp follow-up conversations: "Name them here" and
// "Reply UPDATE", and the nudges that open them.
//
// Pinned here: (1) the naming parser only ever yields expense categories, never
// Loan / EMI; (2) the UPDATE list and every correction are the APP's figures —
// balancesToCheck/reconcileOnServer against computeAccountBalance/reconcileAccount on
// the same rows, source and bundle alike; a card is stated as what is OWED; a
// correction is an offset + dated log, never a transaction; (3) the nudge rule.
import { describe, expect, it } from 'vitest';
import {
  parseNamePicks, nameListReply, nameResultReply, statedAmount, isSame, isSkip, isNameTrigger, isUpdateTrigger,
  isStopWord, balancePrompt, reconcileLine, updateSummary, NAMEABLE, type UnnamedEntry,
} from '../../../../supabase/functions/_shared/whatsapp-followups';
import { reengagementNudge } from '../../../../supabase/functions/_shared/whatsapp-dispatch-rules';
import { balancesToCheck, reconcileOnServer, type HouseholdRows } from '../serverEngine';
import { computeAccountBalance, reconcileAccount } from '../accountBalance';
import { mapCloudRow } from '../supabaseAdapter';
import type { Account, Transaction } from '../../types';
import * as bundle from '../../../../supabase/functions/_shared/agent/engine.generated.js';

const NOW = Date.parse('2026-09-26T06:00:00Z');
const HID = '11111111-1111-4111-8111-111111111111';
const BANK = '22222222-2222-4222-8222-222222222222';
const CARD = '33333333-3333-4333-8333-333333333333';
const CASH = '44444444-4444-4444-8444-444444444444';
const LOAN = '55555555-5555-4555-8555-555555555555';
const OLD_BANK = '66666666-6666-4666-8666-666666666666';
const ASSET = '77777777-7777-4777-8777-777777777777';
const DEBT = '88888888-8888-4888-8888-888888888888';

const account = (id: string, p: Record<string, unknown>) => ({
  id, household_id: HID, kind: 'bank', name: 'x', currency: 'INR', opening_balance: 0, is_default: false,
  is_archived: false, reconciliation_offset: 0, reconciliation_log: [], payment_modes: [], asset_id: null, debt_id: null,
  last_reconciled_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: null, ...p,
});
const txn = (id: string, p: Record<string, unknown>) => ({
  id, household_id: HID, created_by: null, member_id: null, currency: 'INR', date: '2026-09-10', description: 'x',
  note: null, recurring: null, extras: {}, account_id: null, to_account_id: null, initiated_by: null,
  recurring_schedule_id: null, debt_id: null, payment_mode: null, asset_id: null, category: 'groceries', type: 'expense',
  created_at: '2026-09-10T10:00:00Z', updated_at: '2026-09-10T10:00:00Z', deleted_at: null, ...p,
});
function rows(p: Partial<HouseholdRows> = {}): HouseholdRows {
  return {
    transactions: [
      txn('t-1', { amount: 1800, account_id: BANK }),
      txn('t-2', { amount: 900, account_id: CARD }),
      txn('t-3', { amount: 200, account_id: CASH }),
    ],
    budgets: [], budgetAllocations: [], goals: [], recurring: [],
    debts: [{ id: DEBT, household_id: HID, type: 'credit_card', name: 'Axis', current_balance: 12000, currency: 'INR',
      principal: 12000, interest_rate: 36, minimum_payment: 600, extras: {}, created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z', deleted_at: null }],
    assets: [{ id: ASSET, household_id: HID, type: 'savings', name: 'HDFC', value: 50000, currency: 'INR', liquidity: 'liquid',
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: null }],
    accounts: [
      // Checked 34 days ago: stale.
      account(BANK, { name: 'HDFC Savings', opening_balance: 50000, asset_id: ASSET, last_reconciled_at: '2026-08-23T06:00:00Z' }),
      // Never checked, created in January: stale, and OLDER than the bank's check.
      account(CARD, { kind: 'credit_card', name: 'Axis card', opening_balance: -12000, asset_id: DEBT, credit_limit: 100000 }),
      // Checked last week: not stale.
      account(CASH, { kind: 'cash', name: 'Cash in Hand', opening_balance: 3600, last_reconciled_at: '2026-09-20T00:00:00Z' }),
      // Loans live in Debts; archived accounts are gone.
      account(LOAN, { kind: 'loan', name: 'Home loan', opening_balance: -900000 }),
      account(OLD_BANK, { name: 'Closed', is_archived: true }),
    ],
    memberCount: 2, rates: [],
    profile: { display_name: 'Rohan Mehta', default_currency: 'INR', language: 'en', date_format: 'dmy' },
    household: { type: 'family', base_currency: 'INR', language: 'en', payoff_strategy: 'avalanche', extra_payment: 0 },
    email: '',
    ...p,
  };
}

describe('"Name them here" (W6)', () => {
  it('CON-UNIT-W6-001 · picks name expense categories only; income, EMI and unknown words are refused, never guessed', () => {
    expect(parseNamePicks('1 groceries')).toEqual([{ n: 1, category: 'groceries' }]);
    expect(parseNamePicks('2 travel, 3 dining')).toEqual([{ n: 2, category: 'travel' }, { n: 3, category: 'food_dining' }]);
    expect(parseNamePicks('2 personal care and 4 Food & Dining')).toEqual([{ n: 2, category: 'personal_care' }, { n: 4, category: 'food_dining' }]);
    expect(parseNamePicks('1 salary')).toEqual([{ n: 1, notAllowed: 'income', word: 'salary' }]);
    expect(parseNamePicks('1 emi')).toEqual([{ n: 1, notAllowed: 'emi', word: 'emi' }]);
    expect(parseNamePicks('1 zzzq')).toEqual([{ n: 1, unknown: 'zzzq' }]);
    // Not a naming reply at all: read as a normal message.
    for (const t of ['450 lunch hdfc', 'hi', 'groceries 1', '']) expect(parseNamePicks(t)).toBeNull();
    expect(NAMEABLE).not.toContain('Other');
    expect(NAMEABLE).not.toContain('Loan / EMI payment');
    expect(isNameTrigger('Name them here')).toBe(true);
    expect(isNameTrigger('name them')).toBe(true);
    // "stop" is the marketing STOP, handled first; the conversations end on DONE.
    expect(isStopWord('stop')).toBe(false);
    expect(isStopWord('done')).toBe(true);
  });

  it('CON-UNIT-W6-002 · the list shows amount, day and account (never a description); results say what changed and what is left', () => {
    const e: UnnamedEntry[] = [
      { n: 1, id: 'a', amount: 2400, currency: 'INR', date: '2026-09-12', account: 'HDFC' },
      { n: 2, id: 'b', amount: 1850, currency: 'INR', date: '2026-09-18', account: 'Cash in Hand' },
    ];
    expect(nameListReply(e)).toBe('Two entries this month have no category. Biggest first:\n1. ₹2,400 · 12 Sep · HDFC\n2. ₹1,850 · 18 Sep · Cash in Hand\n\nReply with the number and a category, like 1 groceries. Several at once works too: 2 travel, 1 dining.');
    expect(nameListReply([])).toBe('Everything logged this month has a category. Nothing to name.');
    expect(nameResultReply([{ n: 1, status: 'named', category: 'groceries' }], [], [e[1]]))
      .toBe('Done. 1 is now Groceries. One left, ₹1,850 · 18 Sep · Cash in Hand: reply 2 and a category, or DONE.');
    expect(nameResultReply([{ n: 2, status: 'private', category: 'travel' }], [{ n: 3, unknown: 'zzz' }], []))
      .toMatch(/^2 is someone else's private entry, so I left it\. I don't have "zzz" as a category\. Reply 3 with one of: Food & Dining, Groceries/);
  });
});

describe('"Reply UPDATE" — the app\'s reconcile on the server (W6)', () => {
  const appBalance = (r: HouseholdRows, id: string) => {
    const txns = r.transactions.map((x) => mapCloudRow('transactions', x) as Transaction);
    const acc = r.accounts.map((x) => mapCloudRow('accounts', x) as Account).find((a) => a.id === id)!;
    return { acc, txns, balance: computeAccountBalance(acc, txns, 'INR', {}) };
  };

  it('CON-UNIT-W6-003 · the list is the stale bank, card and cash accounts, oldest check first, with the app\'s balances', () => {
    const r = rows();
    const list = balancesToCheck(r, NOW);
    expect(list.map((b) => b.name)).toEqual(['Axis card', 'HDFC Savings']);            // no cash (fresh), loan, archived
    expect(list[0]).toEqual(expect.objectContaining({ kind: 'credit_card', balance: appBalance(r, CARD).balance, owed: 12900 }));
    expect(list[1]).toEqual(expect.objectContaining({ kind: 'bank', balance: appBalance(r, BANK).balance }));
    expect(list[1].balance).toBe(48200);
    // The bundle the server runs gives the same list.
    expect((bundle as unknown as { balancesToCheck: typeof balancesToCheck }).balancesToCheck(r, NOW)).toEqual(list);
  });

  it('CON-UNIT-W6-004 · a bank correction is the app\'s: offset + dated log, bridged to the linked asset, never a transaction', () => {
    const r = rows();
    const at = '2026-09-26T06:00:00.000Z';
    const plan = reconcileOnServer(r, BANK, 51300, at)!;
    const { acc, balance } = appBalance(r, BANK);
    const app = reconcileAccount(acc, balance, 51300, 'bank');
    expect(plan).toEqual(expect.objectContaining({ before: 48200, after: 51300, delta: 3100, expectedOffset: 0, offset: app.patch.reconciliationOffset, at }));
    expect(plan.log).toHaveLength(1);
    expect(plan.log[0]).toEqual(expect.objectContaining({ delta: 3100, kind: 'bank', stated_value: 51300 }));
    expect(plan.bridge).toEqual({ asset_id: ASSET, value: 51300 });
    expect(plan).not.toHaveProperty('transaction');
    expect((bundle as unknown as { reconcileOnServer: typeof reconcileOnServer }).reconcileOnServer(r, BANK, 51300, at))
      .toEqual(expect.objectContaining({ delta: 3100, offset: plan.offset, bridge: plan.bridge }));
  });

  it('CON-UNIT-W6-005 · a card is stated as what is OWED (INV-10/11): 12,450 owed moves the balance to −12,450', () => {
    const plan = reconcileOnServer(rows(), CARD, 12450, '2026-09-26T06:00:00.000Z')!;
    expect(plan).toEqual(expect.objectContaining({ before: -12900, after: -12450, delta: 450, offset: 450 }));
    expect(plan.log[0]).toEqual(expect.objectContaining({ kind: 'credit_card', stated_value: 12450 }));
    expect(plan.bridge).toEqual({ debt_id: DEBT, current_balance: 12450 });
    expect(reconcileLine(plan, 'INR')).toBe('Axis card now shows ₹12,450 owed.');
  });

  it('CON-UNIT-W6-006 · SAME books nothing and bridges nothing, but is still a check; a loan or archived account is refused', () => {
    const plan = reconcileOnServer(rows(), BANK, 'same', '2026-09-26T06:00:00.000Z')!;
    expect(plan).toEqual(expect.objectContaining({ delta: 0, offset: 0, bridge: null }));
    expect(plan.log).toEqual([]);
    expect(reconcileLine(plan, 'INR')).toBe('HDFC Savings matches. Marked as checked today.');
    expect(reconcileOnServer(rows(), LOAN, 1, 'x')).toBeNull();
    expect(reconcileOnServer(rows(), OLD_BANK, 1, 'x')).toBeNull();
  });

  it('CON-UNIT-W6-007 · the prompts ask a card what is owed; amounts, SAME and SKIP are read; the summary adds the corrections', () => {
    const card = { id: CARD, name: 'Axis card', kind: 'credit_card', balance: -12900, owed: 12900, lastChecked: '2026-08-23T06:00:00Z' };
    expect(balancePrompt(card, 1, 4, 'INR', NOW)).toBe('2 of 4 · Axis card\nVyact has ₹12,900 owed, last checked 34 days ago. What does the card say you owe now?');
    expect(statedAmount('₹51,300')).toBe(51300);
    expect(statedAmount('0')).toBe(0);
    expect(statedAmount('-2,000')).toBe(-2000);
    expect(statedAmount('51300 hdfc')).toBeNull();
    expect(isSame('same')).toBe(true);
    expect(isSkip('skip')).toBe(true);
    expect(isUpdateTrigger('UPDATE')).toBe(true);
    expect(isUpdateTrigger('update balances')).toBe(true);
    expect(reconcileLine({ name: 'HDFC Savings', kind: 'bank', after: 51300, delta: 3100 }, 'INR'))
      .toBe("HDFC Savings is now ₹51,300. The ₹3,100 gap is recorded as a balance correction dated today, not as income, so this month's figures don't move.");
    expect(updateSummary(2, ['ICICI Savings'], 3550, 'INR')).toBe('Left ICICI Savings as it is. Two checked. Your net worth rose by ₹3,550 from the corrections.');
  });
});

describe('the nudges that open these conversations (W6)', () => {
  const HH = { id: 'h', base_currency: 'INR' };
  const member = { profile_id: 'alice', household_id: 'h', first_name: 'Rohan' };
  const row = (amount: number, p: Partial<{ created_by: string; excluded: boolean; currency: string }> = {}) =>
    ({ amount, currency: p.currency ?? 'INR', created_by: p.created_by ?? 'bob', extras: p.excluded ? { excluded: true } : {} });

  it('CON-UNIT-W6-008 · quiet for 7+ days → the quiet nudge; else unnamed spending ≥ 2 entries and ₹500 → "Name them here"', () => {
    const base = { household: HH, member, weekKey: '2026-W39', today: '2026-09-26' };
    expect(reengagementNudge({ ...base, lastLoggedDay: '2026-09-15', unnamed: [] }))
      .toEqual({ template: 'reengagement_nudge_quiet', householdId: 'h', toProfileId: 'alice', values: ['Rohan', '11'], dedupeKey: 'nudge:2026-W39' });
    const unnamed = [row(2400), row(1850), row(50000, { excluded: true }), row(900, { excluded: true, created_by: 'alice' })];
    expect(reengagementNudge({ ...base, lastLoggedDay: '2026-09-25', unnamed }))
      .toEqual({ template: 'reengagement_nudge', householdId: 'h', toProfileId: 'alice', values: ['Rohan', '5,150', 'three'], dedupeKey: 'nudge:2026-W39' });
    expect(reengagementNudge({ ...base, lastLoggedDay: '2026-09-25', unnamed: [row(2400)] })).toBeNull();          // one entry
    expect(reengagementNudge({ ...base, lastLoggedDay: '2026-09-25', unnamed: [row(200), row(250)] })).toBeNull(); // under ₹500
    expect(reengagementNudge({ ...base, household: { id: 'h', base_currency: 'USD' }, lastLoggedDay: '2026-09-25', unnamed })).toBeNull();
    expect(reengagementNudge({ ...base, member: { ...member, first_name: null }, lastLoggedDay: '2026-09-01', unnamed })).toBeNull();
  });
});
