import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { LocalStorageAdapter } from '../dataAdapter';
import { computeNetWorth } from '../netWorth';
import { computeAccountBalance } from '../accountBalance';
import { LoanPaymentRefused, loanOutstanding } from '../loanSchedule';
import { clearFaults, getFaults } from '../faults';
import type { Debt } from '../../types';

// The loan-payment workflow through the store (W4f, v10.75.0; owner decision D19). Cloud: pay_loan
// decides and the store adopts what it wrote. Local-only: the same rules run in the store. The intent
// of the audit-F2 tests (CON-UNIT-900..910) is kept: no partial undo, no offline fallback in the cloud,
// a retry adopted once, net worth preserved by a principal payment.

vi.mock('../supabase', () => ({ isCloudEnabled: () => false, supabase: null }));

const loan = (p: Partial<Debt> = {}): Debt => ({
  id: crypto.randomUUID(), type: 'personal_loan', name: 'Loan', currency: 'USD', principal: 8000, currentBalance: 8000,
  interestRate: 0, minimumPayment: 500, instalmentsPaid: 0, dueDate: '2026-09-09', firstEmiDate: '2026-09-09',
  termsConfirmed: true, direction: 'owed_by_me', ...p,
});

beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true });
  useStore.setState({
    ...useStore.getInitialState(),
    currentHouseholdId: crypto.randomUUID(),
    adapter: new LocalStorageAdapter(),
    cloudEnabled: false,
    toast: vi.fn(),
    refreshNotifications: vi.fn().mockResolvedValue(undefined),
    accounts: [{ id: crypto.randomUUID(), kind: 'bank', name: 'Funding', currency: 'USD', openingBalance: 10000 }],
    debts: [loan()],
    transactions: [], assets: [],
  });
});
afterEach(() => vi.unstubAllGlobals());

const pay = (kind: 'emi' | 'prepayment' | 'payoff', amount: number, extra: Record<string, unknown> = {}) => {
  const s = useStore.getState();
  return s.payLoan({ debtId: s.debts[0].id, fundingAccountId: s.accounts[0].id, kind, amount, date: '2026-09-09', ...extra });
};

describe('loan payment workflow', () => {
  it('a fresh cloud success adopts authoritative interest and principal rows', async () => {
    const state = useStore.getState();
    const account = { id: 'cloud-loan', kind: 'loan' as const, name: 'Loan', currency: 'USD', debtId: state.debts[0].id, openingBalance: -8000 };
    const transactions = [
      { id: 'interest', type: 'expense' as const, amount: 80, category: 'loan_emi', currency: 'USD', date: '2026-09-09', description: 'Interest', accountId: state.accounts[0].id },
      { id: 'principal', type: 'transfer' as const, amount: 420, category: '', currency: 'USD', date: '2026-09-09', description: 'Principal', accountId: state.accounts[0].id, toAccountId: account.id },
    ];
    const command = vi.fn().mockResolvedValue({ status: 'success', operationId: 'operation', interest: 80, principal: 420,
      instalmentNo: 1, closesInstalment: true, paidOff: false, outstandingAfter: 7580, nextDueDate: '2026-10-09', emiAfter: 500,
      loanAccount: account, debt: { ...state.debts[0], currentBalance: 7580 }, transactions });
    state.adapter.payLoan = command;
    useStore.setState({ cloudEnabled: true });
    await pay('emi', 500, { operationId: 'operation' });
    const after = useStore.getState();
    expect(command).toHaveBeenCalledOnce();
    expect(command.mock.calls[0][1]).toMatchObject({ operationId: 'operation', kind: 'emi', amount: 500, fundingAccountId: state.accounts[0].id });
    expect(after.transactions).toEqual(transactions);
    expect(computeAccountBalance(account, after.transactions, 'USD', { USD: 1 })).toBe(-7580);
    expect(computeAccountBalance(after.accounts[0], after.transactions, 'USD', { USD: 1 })).toBe(9500);
  });

  it('final payoff leaves zero liability and survives an adapter reload', async () => {
    await pay('payoff', 8000);
    const after = useStore.getState();
    expect(after.debts[0]).toMatchObject({ currentBalance: 0, dueDate: undefined });
    expect(after.debts[0].paidOffAt).toBeTruthy();
    expect(computeNetWorth(after, 'USD', { USD: 1 }).totalLiabilities).toBe(0);
    expect(computeNetWorth(after, 'USD', { USD: 1 }).netWorth).toBe(2000);
    expect(await new LocalStorageAdapter().list('debts', after.currentHouseholdId)).toEqual(after.debts);
  });

  it('an interest-bearing local payment spends only interest and preserves the principal transfer', async () => {
    useStore.setState({ debts: [{ ...useStore.getState().debts[0], interestRate: 12 }] });
    await pay('emi', 500);
    const after = useStore.getState();
    expect(after.debts[0].currentBalance).toBe(7580);
    expect(after.transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'expense', amount: 80, category: 'loan_emi' }), expect.objectContaining({ type: 'transfer', amount: 420 }),
    ]));
    expect(computeNetWorth(after, 'USD', { USD: 1 }).netWorth).toBe(1920);
    expect(after.debts[0]).toMatchObject({ instalmentsPaid: 1, dueDate: '2026-10-09' });
  });

  it('CON-UNIT-910 - generic CRUD cannot partially undo a system-split payment', async () => {
    await pay('emi', 500);
    const leg = useStore.getState().transactions[0];
    await expect(useStore.getState().removeTransaction(leg.id)).rejects.toThrow('atomic reversal');
    await expect(useStore.getState().upsertTransaction({ ...leg, amount: 600 })).rejects.toThrow('atomic reversal');
    expect(useStore.getState().debts[0].currentBalance).toBe(7500);
    expect(useStore.getState().transactions[0].amount).toBe(500);
  });

  it('CON-UNIT-906 - cloud mode never falls back to sequential local loan writes', async () => {
    useStore.setState({ cloudEnabled: true });
    await expect(pay('emi', 500)).rejects.toThrow('online');
    expect(useStore.getState().transactions).toHaveLength(0);
    expect(useStore.getState().debts[0].currentBalance).toBe(8000);
  });

  it('CON-UNIT-907 - a retry adopts server rows once and preserves the server account balance', async () => {
    const state = useStore.getState();
    const account = { id: 'server-loan', kind: 'loan' as const, name: 'Loan', currency: 'USD',
      debtId: state.debts[0].id, openingBalance: -8000, reconciliationOffset: 25, updated_at: 'server-revision' };
    const transaction = { id: 'server-txn', type: 'transfer' as const, amount: 500, currency: 'USD',
      date: '2026-09-09', category: '', description: 'Principal', accountId: state.accounts[0].id, toAccountId: account.id };
    const payLoan = vi.fn().mockResolvedValue({ status: 'duplicate', operationId: 'op', interest: 0, principal: 500, instalmentNo: 1,
      closesInstalment: true, paidOff: false, outstandingAfter: 7475, nextDueDate: '2026-10-09', emiAfter: 500,
      loanAccount: account, debt: { ...state.debts[0], currentBalance: 7500 }, transactions: [transaction] });
    state.adapter.payLoan = payLoan;
    useStore.setState({ cloudEnabled: true });
    const operationId = crypto.randomUUID();
    await pay('emi', 500, { operationId });
    await pay('emi', 500, { operationId });
    expect(useStore.getState().transactions).toEqual([transaction]);
    expect(useStore.getState().accounts).toContainEqual(account);
    expect(payLoan.mock.calls.map(call => call[1].operationId)).toEqual([operationId, operationId]);
  });

  it('CON-UNIT-900 - first principal payment preserves net worth and leaves the real outstanding balance', async () => {
    const before = useStore.getState();
    const initialWorth = computeNetWorth(before, 'USD', { USD: 1 }).netWorth;
    await pay('emi', 500);
    const after = useStore.getState();
    const account = after.accounts.find(a => a.debtId === before.debts[0].id)!;
    expect(account.openingBalance).toBe(-8000);
    expect(computeAccountBalance(account, after.transactions, 'USD', { USD: 1 })).toBe(-7500);
    expect(after.debts[0].currentBalance).toBe(7500);
    expect(computeNetWorth(after, 'USD', { USD: 1 }).netWorth).toBe(initialWorth);
    const persisted = await after.adapter.list('accounts', after.currentHouseholdId);
    expect(persisted).toContainEqual(expect.objectContaining({ id: account.id, openingBalance: -8000 }));
  });

  it('CON-UNIT-901 - a second payment and metadata edit retain the opening liability', async () => {
    await pay('emi', 500);
    await useStore.getState().payLoan({ debtId: useStore.getState().debts[0].id, fundingAccountId: useStore.getState().accounts[0].id,
      kind: 'emi', amount: 500, date: '2026-10-09' });
    const account = useStore.getState().accounts.find(a => a.kind === 'loan')!;
    await useStore.getState().upsertAccount({ id: account.id, name: 'Renamed loan' });
    const after = useStore.getState();
    expect(after.accounts.find(a => a.id === account.id)?.openingBalance).toBe(-8000);
    expect(computeNetWorth(after, 'USD', { USD: 1 }).totalLiabilities).toBe(7000);
  });

  it('W4-D19-012 · locally, the same rules: more than due is refused, short keeps the instalment open, a prepayment waits for it', async () => {
    useStore.setState({ debts: [loan({ interestRate: 12 })] });
    const refused = await pay('emi', 501).catch(e => e);
    expect(refused).toBeInstanceOf(LoanPaymentRefused);
    expect(refused).toMatchObject({ code: 'more_than_due', figure: 500 });
    const part = await pay('emi', 200);
    expect(part).toMatchObject({ interest: 80, principal: 120, closesInstalment: false, instalmentNo: 1 });
    expect(await pay('prepayment', 100).catch(e => e)).toMatchObject({ code: 'instalment_open', figure: 300 });
    const due = await useStore.getState().loanDue(useStore.getState().debts[0].id);
    expect(due).toMatchObject({ instalmentNo: 1, interest: 80, paid: 200, remaining: 300, started: true });
    const rest = await pay('emi', 300);
    expect(rest).toMatchObject({ interest: 0, principal: 300, closesInstalment: true, nextDueDate: '2026-10-09' });
    expect(useStore.getState().debts[0]).toMatchObject({ currentBalance: 7580, instalmentsPaid: 1 });
  });

  it('W4-D19-013 · locally: only the latest payment is undone; a loan with money owed is not deleted; paid off reconciles, never posts', async () => {
    const first = await pay('emi', 500);
    const second = await pay('emi', 500, { date: '2026-10-09' });
    const debtId = useStore.getState().debts[0].id;
    expect(await useStore.getState().reverseLoanPayment(debtId, first.operationId).catch(e => e)).toMatchObject({ code: 'not_latest_payment' });
    await useStore.getState().reverseLoanPayment(debtId, second.operationId);
    expect(useStore.getState().debts[0]).toMatchObject({ currentBalance: 7500, instalmentsPaid: 1, dueDate: '2026-10-09' });
    expect(useStore.getState().transactions).toHaveLength(1);

    expect(await useStore.getState().deleteDebt(debtId).catch(e => e)).toMatchObject({ code: 'debt_not_paid_off', figure: 7500 });
    const entries = useStore.getState().transactions.length;
    await useStore.getState().markLoanPaidOff(debtId, 'Closed at the bank');
    const after = useStore.getState();
    expect(after.transactions).toHaveLength(entries);
    const account = after.accounts.find(a => a.kind === 'loan')!;
    expect(account).toMatchObject({ isArchived: true, reconciliationOffset: 7500 });
    expect(account.reconciliationLog?.at(-1)).toMatchObject({ kind: 'loan', delta: 7500, stated_value: 0 });
    expect(loanOutstanding(after.debts[0], after.accounts, after.transactions)).toBe(0);
    expect(computeNetWorth(after, 'USD', { USD: 1 }).totalLiabilities).toBe(0);
    await useStore.getState().deleteDebt(debtId);
    expect(useStore.getState().debts).toHaveLength(0);
  });

  it('W4-D19-014 · a new Loan / EMI entry from any other path is paid through the loan, never stored as one expense', async () => {
    const s = useStore.getState();
    useStore.setState({ debts: [loan({ id: s.debts[0].id, interestRate: 12 })] });
    const leg = await useStore.getState().upsertTransaction({ id: crypto.randomUUID(), type: 'expense', amount: 500, currency: 'USD',
      date: '2026-09-09', description: 'EMI', category: 'loan_emi', linkedDebtId: s.debts[0].id, accountId: s.accounts[0].id });
    expect(leg).toMatchObject({ type: 'expense', amount: 80, category: 'loan_emi' });
    expect(useStore.getState().transactions.map(t => [t.type, t.amount])).toEqual([['expense', 80], ['transfer', 420]]);
  });
});

// Track E, E7 (v10.102.0) — spec INV-7 (TD-31) for a local-only household: "force-fail any leg of an EMI —
// the ENTIRE event rolls back, zero state change". In the cloud, pay_loan is one Postgres transaction
// (W4-D19-006, loanModelSql). Locally the legs are written in sequence, so a later failure undoes them.
describe('INV-7 locally — a loan payment is one event (Track E, E7)', () => {
  /** Make the adapter's own writes fail for the rows `fails` picks; everything else goes through. */
  function failWrites(fails: (entity: string, row: { type?: string }) => boolean) {
    const adapter = useStore.getState().adapter;
    const real = adapter.upsert.bind(adapter);
    vi.spyOn(adapter, 'upsert').mockImplementation(((entity: string, hid: string, row: { type?: string }, at?: string) =>
      fails(entity, row) ? Promise.reject(new Error('storage write failed')) : real(entity as never, hid, row, at)) as typeof adapter.upsert);
  }
  const snapshot = async () => {
    const s = useStore.getState();
    return {
      transactions: s.transactions, accounts: s.accounts, debt: s.debts[0],
      stored: await s.adapter.list('transactions', s.currentHouseholdId),
      storedLoanAccounts: (await s.adapter.list<{ kind: string }>('accounts', s.currentHouseholdId)).filter(a => a.kind === 'loan'),
      netWorth: computeNetWorth(s, 'USD', { USD: 1 }).netWorth,
    };
  };

  it('TE7-001 · the principal leg fails: the interest leg and the loan account it opened are undone; nothing moved', async () => {
    useStore.setState({ debts: [loan({ interestRate: 12 })] });           // interest 80 + principal 420
    const before = await snapshot();
    failWrites((entity, row) => entity === 'transactions' && row.type === 'transfer');
    await expect(pay('emi', 500)).rejects.toThrow('storage write failed');
    expect(await snapshot()).toEqual(before);
  });

  it('TE7-002 · the loan update fails after both legs: both legs and the loan account are undone; the loan is as it was', async () => {
    useStore.setState({ debts: [loan({ interestRate: 12 })] });
    const before = await snapshot();
    failWrites(entity => entity === 'debts');
    await expect(pay('emi', 500)).rejects.toThrow('storage write failed');
    expect(await snapshot()).toEqual(before);
  });

  it('TE7-003 · an undo step that fails is reported as an unexpected fault, never swallowed, and the payment still fails', async () => {
    clearFaults();
    useStore.setState({ debts: [loan({ interestRate: 12 })] });
    failWrites((entity, row) => entity === 'transactions' && row.type === 'transfer');
    vi.spyOn(useStore.getState().adapter, 'remove').mockRejectedValue(new Error('remove failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(pay('emi', 500)).rejects.toThrow('storage write failed');
    expect(getFaults().map(f => [f.kind, f.context.split(' ')[0]])).toEqual([
      ['unexpected', 'payLoan:rollback'], ['unexpected', 'payLoan:rollback'],    // the interest leg, then the account
    ]);
  });
});
