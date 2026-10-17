// Track E (owner decisions 13–14 Oct 2026) — one definition of spending, read by every screen, Pip and
// WhatsApp. E2 (v10.96.0): WhatsApp's alerts and digests read spending through the APP's rules over the
// APP's row mapping (the bundled engine); the hand-copied money port is deleted (audit XC-ARC-06).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  spendRows, spendByCategoryInRange, spendByCategory, monthlyData, countSpendEntries, spendEntryKey, isLoanPrincipalRow,
} from '../calculations';
import { txnsFromRows } from '../serverEngine';
import { computeAccountBalance } from '../accountBalance';
import { computeNetWorth } from '../netWorth';
import { budgetThresholdNotifs, DEFAULT_PREFS } from '../notifications';
import { listNet, matchesCategory, matchesType } from '../txnListTotals';
import { resolve as resolveIntent, type AssistantContext } from '../askVyactBackend';
import { buildSafeSummary } from '../aiSummary';
import type { IntentResult } from '../askVyactIntents';
import {
  rowToTxn, largeSpendAlerts, dailyDigest, monthClose, weeklySummary, type TxnRow,
} from '../../../../supabase/functions/_shared/whatsapp-dispatch-rules';
import type { Account, Budget, BudgetAllocation, Debt, Profile, Transaction } from '../../types';

const FUNCTIONS = resolve(__dirname, '../../../../supabase/functions');
const read = (p: string) => readFileSync(join(FUNCTIONS, p), 'utf8');

let n = 0;
const row = (p: Partial<TxnRow>): TxnRow => ({
  id: `r-${++n}`, household_id: 'h', created_by: 'alice', type: 'expense', amount: 100, currency: 'INR',
  date: '2026-10-14', category: 'food_dining', account_id: 'acc-1', extras: null, ...p,
});
const HH = { id: 'h', base_currency: 'INR' };
const MEMBERS = [{ profile_id: 'alice', household_id: 'h', first_name: 'Asha' }, { profile_id: 'bob', household_id: 'h', first_name: 'Bob' }];

describe('Track E · E2: WhatsApp reads the app\'s spending', () => {
  it('TE2-001 · a scheduler row becomes the app\'s own Transaction: loan-payment details, splits and privacy survive', () => {
    const split = { interest: 600, principal: 9400, debt_id: 'd1', kind: 'emi', operation_id: 'op1' };
    const t = rowToTxn(row({ type: 'transfer', category: null, amount: 9400, to_account_id: 'loan-acc', debt_id: 'd1',
      recurring_schedule_id: 's1', member_id: 'm1', extras: { emi_split: split, excluded: true, split: { isSplit: true, yourShare: 5 } } })) as unknown as Transaction;
    expect(t).toMatchObject({ type: 'transfer', amount: 9400, toAccountId: 'loan-acc', debtId: 'd1', recurringScheduleId: 's1',
      memberId: 'm1', excluded: true, created_by: 'alice', emiSplit: split, split: { isSplit: true, yourShare: 5 } });
    // The old port mapping dropped emi_split, so a change to what counts as spending (E3) never reached WhatsApp.
    expect(txnsFromRows([row({})])[0]).toEqual(rowToTxn(row({ id: 'r-' + n })));
  });

  it('TE2-002 · every spending rule counts exactly the app\'s spending rows', () => {
    const rows = [
      row({ id: 'food', amount: 18000, date: '2026-10-14' }),
      row({ id: 'private', amount: 50000, date: '2026-10-14', extras: { excluded: true } }),
      row({ id: 'move', type: 'transfer', category: null, amount: 30000, date: '2026-10-14', to_account_id: 'acc-2' }),
      row({ id: 'adjust', amount: 25000, date: '2026-10-14', category: 'balance_adjustment' }),
      row({ id: 'sept', amount: 4000, date: '2026-09-10', category: 'groceries' }),
    ];
    const app = spendRows(txnsFromRows(rows));
    expect(app.map(t => t.id)).toEqual(['food', 'sept']);
    // Large spend: only the app's spending rows can alert.
    const large = largeSpendAlerts({ household: HH, members: MEMBERS, thresholds: {}, accountNames: { 'acc-1': 'HDFC' }, txns: rows });
    expect(large.map(s => s.dedupeKey)).toEqual(['txn:food']);
    // The evening digest: today's spending rows only (the private one makes the day "logged", not counted).
    const digest = dailyDigest({ household: HH, today: '2026-10-14', txns: rows, members: MEMBERS, names: {}, memberCount: 2 });
    expect(digest[0].values.slice(1, 3)).toEqual(['18,000', '1']);
    // The weekly summary counts the same entries.
    expect(weeklySummary({ household: HH, today: '2026-10-14', txns: rows, member: MEMBERS[0], weekKey: 'w' })?.values.slice(1))
      .toEqual(['1', 'Food & Dining']);
    // Month close: September's total is the app's September spending.
    const close = monthClose({ household: HH, today: '2026-10-01', txns: rows, members: MEMBERS });
    const sept = spendByCategoryInRange(txnsFromRows(rows), '2026-09-01', '2026-09-30', 'INR', {});
    expect(close[0].values[2]).toBe('4,000');
    expect(sept).toEqual({ groceries: 4000 });
  });

  it('TE2-003 · no server code keeps its own money port; the scheduler loads the columns the app maps', () => {
    expect(existsSync(join(FUNCTIONS, '_shared/money'))).toBe(false);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith('.ts') || e.name.endsWith('.generated.js')) continue;
        if (/from ['"][^'"]*money\/calculations/.test(readFileSync(p, 'utf8'))) offenders.push(p);
      }
    };
    walk(FUNCTIONS);
    expect(offenders).toEqual([]);
    expect(read('_shared/whatsapp-dispatch-rules.ts')).toMatch(/import \{\s*txnsFromRows, spendRows, spendByCategoryInRange, effectiveAmount,[^}]*\} from '\.\/agent\/engine\.ts';/);
    expect(read('whatsapp-dispatch/index.ts')).toMatch(/const TXN_COLUMNS = '[^']*\bmember_id\b[^']*\bdebt_id\b[^']*\bextras\b/);
    expect(readFileSync(resolve(__dirname, '../serverEngine.ts'), 'utf8')).toMatch(/export \{ spendRows, spendByCategoryInRange, effectiveAmount, spendEntryKey, countSpendEntries \} from '\.\/calculations';/);
  });
});

// ── E3 (v10.97.0; owner decisions E-1, E-2, E-10) — full EMI = spend, everywhere ──────────────────────
// A household with a bank account and a loan. September: salary, groceries, one EMI (interest 4,000 +
// principal 11,000) and a 50,000 prepayment (all principal, no interest row). October: one EMI only.
const BANK: Account = { id: 'bank', kind: 'bank', name: 'HDFC', currency: 'INR', openingBalance: 100_000 } as Account;
const LOAN_ACC: Account = { id: 'loan-acc', kind: 'loan', name: 'Car loan', currency: 'INR', openingBalance: -500_000, debtId: 'd1' } as Account;
const DEBT: Debt = { id: 'd1', name: 'Car loan', type: 'car', currentBalance: 500_000, interestRate: 9.6, minimumPayment: 15_000, currency: 'INR' } as Debt;
const emi = (op: string, date: string, interest: number, principal: number, kind: 'emi' | 'prepayment' | 'payoff' = 'emi'): Transaction[] => {
  const emiSplit = { interest, principal, debt_id: 'd1', kind, operation_id: op };
  const rows: Transaction[] = [];
  if (interest > 0) rows.push({ id: `${op}-i`, type: 'expense', amount: interest, currency: 'INR', date, description: 'Car loan EMI', category: 'loan_emi', accountId: 'bank', debtId: 'd1', linkedDebtId: 'd1', emiSplit } as Transaction);
  rows.push({ id: `${op}-p`, type: 'transfer', amount: principal, currency: 'INR', date, description: 'Car loan EMI - principal', category: '', accountId: 'bank', toAccountId: 'loan-acc', debtId: 'd1', linkedDebtId: 'd1', linkedTxnId: interest > 0 ? `${op}-i` : undefined, emiSplit } as Transaction);
  return rows;
};
const LEDGER: Transaction[] = [
  { id: 'pay', type: 'income', amount: 80_000, currency: 'INR', date: '2026-09-01', description: 'Salary', category: 'salary', toAccountId: 'bank' } as Transaction,
  { id: 'food', type: 'expense', amount: 5_000, currency: 'INR', date: '2026-09-03', description: 'Groceries', category: 'groceries', accountId: 'bank' } as Transaction,
  ...emi('op1', '2026-09-05', 4_000, 11_000),
  ...emi('op2', '2026-09-20', 0, 50_000, 'prepayment'),
  ...emi('op3', '2026-10-05', 3_500, 11_500),
];
/** The same ledger as the app held it before Track E: the principal rows carry no split, so nothing reads them as spending. */
const WITHOUT_RULE = LEDGER.map(t => (t.type === 'transfer' ? { ...t, emiSplit: undefined } : t));

describe('Track E · E3: a loan payment counts in full as Loan / EMI spending', () => {
  beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 9, 14, 12, 0), toFake: ['Date'] }); });
  afterEach(() => { vi.useRealTimers(); });

  it('TE3-001 · every loan payment counts: EMI interest + principal, and a prepayment (E-1)', () => {
    const sept = monthlyData(LEDGER, '2026-09', 'INR', {});
    expect(sept).toEqual({ income: 80_000, expense: 70_000, net: 10_000 });          // 5,000 + 4,000 + 11,000 + 50,000
    expect(spendByCategory(LEDGER, '2026-09', 'INR', {})).toEqual({ groceries: 5_000, loan_emi: 65_000 });
    expect(spendByCategory(LEDGER, '2026-10', 'INR', {})).toEqual({ loan_emi: 15_000 });   // the full EMI
    // Before Track E the same ledger counted only the interest.
    expect(monthlyData(WITHOUT_RULE, '2026-09', 'INR', {}).expense).toBe(9_000);
    // The principal is read as Loan / EMI; the row itself stays a transfer.
    const principal = LEDGER.find(t => t.id === 'op1-p')!;
    expect(isLoanPrincipalRow(principal)).toBe(true);
    expect(spendRows([principal])).toEqual([{ ...principal, type: 'expense', category: 'loan_emi' }]);
    expect(principal.type).toBe('transfer');
  });

  it('TE3-002 · the ledger is untouched: balances, the loan\'s outstanding and net worth are what they were', () => {
    for (const ledger of [LEDGER, WITHOUT_RULE]) {
      expect(computeAccountBalance(BANK, ledger, 'INR', {})).toBe(100_000 + 80_000 - 5_000 - 4_000 - 11_000 - 50_000 - 3_500 - 11_500);
      expect(computeAccountBalance(LOAN_ACC, ledger, 'INR', {})).toBe(-500_000 + 11_000 + 50_000 + 11_500);
    }
    const nw = (txns: Transaction[]) => computeNetWorth({ assets: [], accounts: [BANK, LOAN_ACC], debts: [DEBT], transactions: txns }, 'INR', {});
    expect(nw(LEDGER).netWorth).toBe(nw(WITHOUT_RULE).netWorth);
    expect(nw(LEDGER).liquidAssets).toBe(nw(WITHOUT_RULE).liquidAssets);
    expect(nw(LEDGER).totalLiabilities).toBe(nw(WITHOUT_RULE).totalLiabilities);
  });

  it('TE3-003 · a loan payment is ONE entry, though its interest and principal are two rows', () => {
    const [i, p] = emi('op9', '2026-10-01', 100, 900);
    expect(spendEntryKey(i)).toBe('op9');
    expect(spendEntryKey(p)).toBe('op9');
    // Older rows (record_loan_payment, Sept 2026) carry no operation id: the principal links to its interest row.
    const legacy = emi('x', '2026-10-01', 100, 900).map(t => ({ ...t, emiSplit: { ...t.emiSplit!, operation_id: undefined } }));
    expect(spendEntryKey(legacy[0])).toBe('x-i');
    expect(spendEntryKey(legacy[1])).toBe('x-i');
    expect(countSpendEntries(spendRows(LEDGER.filter(t => t.date.startsWith('2026-09'))))).toBe(3);   // groceries, the EMI, the prepayment
  });

  it('TE3-004 · the Loan / EMI budget line compares like with like, and still alerts at 100% (E-2)', () => {
    const budgets = [{ id: 'b', limit: 15_000, currency: 'INR', scope: 'month', periodYear: 2026, periodMonth: 10, periodStart: '2026-10-01', periodEnd: '2026-10-31' }] as Budget[];
    const allocations = [{ id: 'a', budgetId: 'b', category: 'loan_emi', amount: 15_000 }] as BudgetAllocation[];
    const cards = budgetThresholdNotifs(budgets, allocations, LEDGER, DEFAULT_PREFS, [], { householdId: 'h', baseCurrency: 'INR', rates: {} }, '2026-10-14');
    expect(cards.map(c => c.dedupeKey)).toEqual(['budget_threshold:b:loan_emi:2026-10-01:100']);
    expect(budgetThresholdNotifs(budgets, allocations, WITHOUT_RULE, DEFAULT_PREFS, [], { householdId: 'h', baseCurrency: 'INR', rates: {} }, '2026-10-14')).toEqual([]);
  });

  it('TE3-005 · Pip says the same: Loan / EMI spending in full, one entry per payment', () => {
    const profile = { baseCurrency: 'INR', household: 'family', language: 'en' } as unknown as Profile;
    const summary = buildSafeSummary(LEDGER, [], [], [DEBT], [], profile, { INR: 1 }, [BANK, LOAN_ACC]);
    const ctx = { summary, transactions: LEDGER, budgets: [], goals: [], debts: [DEBT], assets: [], accounts: [BANK, LOAN_ACC], profile, rates: { INR: 1 }, baseCurrency: 'INR' } as unknown as AssistantContext;
    const intent = (entities: Record<string, unknown>): IntentResult => ({ id: 'interpret.lookup', bucket: 'interpret', confidence: 0.9, entities: { text: 'q', ...entities } });
    const sept = resolveIntent(intent({ period: 'last month' }), ctx).facts as { total_spent: string; categories_in_period: Record<string, string>[] };
    expect(sept.total_spent).toBe('₹70,000');
    expect(sept.categories_in_period[0]).toEqual(expect.objectContaining({ category: 'Loan / EMI payment', spent: '₹65,000', entries: '2' }));
  });

  it('TE3-006 · WhatsApp says the same: one large-spend alert per payment at its full amount (E-10); the digest counts it once', () => {
    const rows: TxnRow[] = LEDGER.filter(t => t.date === '2026-10-05').map(t => ({
      id: t.id, household_id: 'h', created_by: 'alice', type: t.type, amount: t.amount, currency: 'INR', date: t.date,
      category: t.category || null, account_id: t.accountId, to_account_id: t.toAccountId ?? null, debt_id: 'd1',
      extras: { emi_split: t.emiSplit, linkedTxnId: t.linkedTxnId } as never,
    }));
    const large = largeSpendAlerts({ household: HH, members: MEMBERS, thresholds: {}, accountNames: { bank: 'HDFC' }, txns: rows });
    expect(large).toEqual([{ template: 'large_transaction_alert', householdId: 'h', toProfileId: 'bob', values: ['15,000', 'HDFC'], dedupeKey: 'txn:op3' }]);
    const digest = dailyDigest({ household: HH, today: '2026-10-05', txns: rows, members: MEMBERS, names: {}, memberCount: 2 });
    expect(digest[0].values.slice(1, 3)).toEqual(['15,000', '1']);
  });

  it('TE3-007 · Transactions: "Expense" and "Loan / EMI" list the principal row, and the list total matches', () => {
    const principal = LEDGER.find(t => t.id === 'op3-p')!;
    expect(matchesType(principal, 'expense')).toBe(true);
    expect(matchesType(principal, 'transfer')).toBe(true);
    expect(matchesCategory(principal, 'loan_emi')).toBe(true);
    const shown = LEDGER.filter(t => t.date === '2026-10-05' && matchesCategory(t, 'loan_emi'));
    expect(shown.map(t => t.id)).toEqual(['op3-i', 'op3-p']);
    expect(listNet(shown, 'INR')).toBe(-15_000);
    const row = readFileSync(resolve(__dirname, '../../components/transactions/TxnRow.tsx'), 'utf8');
    expect(row).toMatch(/loanSpend \? 'Loan principal · counted in Loan \/ EMI spending'/);
  });
});
