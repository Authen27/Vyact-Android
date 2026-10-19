import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { LocalStorageAdapter } from '../dataAdapter';
import { hasDependencies, loansRecordingFrom, localAccountDependencies } from '../accountsView';
import type { Debt } from '../../types';

// LPA-001..005 — v10.119.0 (owner decisions, 19 Oct 2026). A loan that records its EMIs automatically always
// has an account to pay from: the account can't be deleted or archived while it does (a payment from it would
// be refused, and the EMI would go unrecorded without a word); moving the account's history carries the loan.
// The app side, in local-only mode, mirroring the database (loanPayingAccountSql.test.ts).

vi.mock('../supabase', () => ({ isCloudEnabled: () => false, supabase: null }));

const loan = (over: Partial<Debt> = {}): Debt => ({
  id: crypto.randomUUID(), type: 'car_loan', name: 'Car loan', principal: 500000, currentBalance: 400000, interestRate: 9,
  minimumPayment: 15000, currency: 'INR', direction: 'owed_by_me', autoRecord: true, fundingAccountId: 'hdfc', ...over,
} as Debt);

beforeEach(() => {
  useStore.setState({ ...useStore.getInitialState(), adapter: new LocalStorageAdapter(),
    currentHouseholdId: crypto.randomUUID(), cloudEnabled: false, myRole: 'owner',
    accounts: [
      { id: 'hdfc', kind: 'bank', name: 'HDFC', currency: 'INR', openingBalance: 1000 },
      { id: 'icici', kind: 'bank', name: 'ICICI', currency: 'INR', openingBalance: 0 },
    ] as never,
    transactions: [], budgets: [], budgetAllocations: [], recurringSchedules: [], assets: [], debts: [],
    refreshNotifications: vi.fn().mockResolvedValue(undefined), toast: vi.fn() });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('a loan\'s paying account', () => {
  it('LPA-001 · only live loans that record automatically count, and they make the account "in use"', () => {
    const debts = [
      loan({ id: 'car', name: 'Car loan' }),
      loan({ id: 'manual', name: 'Home loan', autoRecord: false }),
      loan({ id: 'done', name: 'Old loan', paidOffAt: '2026-01-01' }),
      loan({ id: 'lent', name: 'Lent to Ravi', direction: 'owed_to_me' }),
      loan({ id: 'other', name: 'Bike loan', fundingAccountId: 'icici' }),
    ];
    expect(loansRecordingFrom('hdfc', debts).map(d => d.id)).toEqual(['car']);
    const deps = localAccountDependencies('hdfc', [], [], debts);
    expect(deps.loans).toEqual([{ id: 'car', name: 'Car loan' }]);
    expect(hasDependencies(deps)).toBe(true);
    expect(hasDependencies(localAccountDependencies('hdfc', [], [], debts.slice(1)))).toBe(false);
    // An answer from an older server without `loans` still reads.
    const { loans: _l, ...older } = deps;
    expect(hasDependencies({ ...older, loans: undefined as never })).toBe(false);
  });

  it('LPA-002 · archiving an account a loan records from is refused, saying which loan; nothing is written', async () => {
    useStore.setState({ debts: [loan({ name: 'Car loan' })] });
    await expect(useStore.getState().upsertAccount({ id: 'hdfc', isArchived: true }))
      .rejects.toThrow('Car loan records its EMIs from this account. Change its paying account first.');
    expect(useStore.getState().accounts.find(a => a.id === 'hdfc')?.isArchived).toBeFalsy();
    useStore.setState({ debts: [loan({ name: 'Car loan' }), loan({ name: 'Home loan' })] });
    await expect(useStore.getState().upsertAccount({ id: 'hdfc', isArchived: true }))
      .rejects.toThrow('Car loan, Home loan record their EMIs from this account. Change their paying account first.');
    // A loan that pays by hand, or pays from another account, doesn't stop it; nor does an edit that isn't an archive.
    useStore.setState({ debts: [loan({ autoRecord: false }), loan({ fundingAccountId: 'icici' })] });
    await useStore.getState().upsertAccount({ id: 'hdfc', name: 'HDFC Savings' });
    await useStore.getState().upsertAccount({ id: 'hdfc', isArchived: true });
    expect(useStore.getState().accounts.find(a => a.id === 'hdfc')?.isArchived).toBe(true);
  });

  it('LPA-003 · deleting it is refused while a loan records from it; a loan that pays by hand loses only its default', async () => {
    const car = loan({ id: 'car' });
    const home = loan({ id: 'home', name: 'Home loan', autoRecord: false });
    useStore.setState({ debts: [car, home] });
    await expect(useStore.getState().deleteAccountPermanently('hdfc')).rejects.toThrow(/history attached/);
    expect(useStore.getState().accounts.some(a => a.id === 'hdfc')).toBe(true);
    // The car loan moves to ICICI; now only the hand-paid home loan named HDFC, as a default.
    await useStore.getState().upsertDebt({ ...car, fundingAccountId: 'icici' });
    await useStore.getState().deleteAccountPermanently('hdfc');
    expect(useStore.getState().accounts.some(a => a.id === 'hdfc')).toBe(false);
    expect(useStore.getState().debts.find(d => d.id === 'home')?.fundingAccountId).toBeUndefined();
    expect(useStore.getState().debts.find(d => d.id === 'car')?.fundingAccountId).toBe('icici');
  });

  it('LPA-004 · moving the account\'s history carries every loan paid from it to the destination', async () => {
    useStore.setState({ debts: [loan({ id: 'car' }), loan({ id: 'home', name: 'Home loan', autoRecord: false }), loan({ id: 'bike', fundingAccountId: 'icici' })] });
    await useStore.getState().moveAccountAndDelete('hdfc', 'icici');
    const by = (id: string) => useStore.getState().debts.find(d => d.id === id)?.fundingAccountId;
    expect([by('car'), by('home'), by('bike')]).toEqual(['icici', 'icici', 'icici']);
    expect(useStore.getState().accounts.some(a => a.id === 'hdfc')).toBe(false);
    // It stuck: a refresh reads the same from the store's own database.
    await useStore.getState().refresh();
    expect(useStore.getState().debts.find(d => d.id === 'car')?.fundingAccountId).toBe('icici');
  });
});
