import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { LocalStorageAdapter } from '../dataAdapter';
import { computeAccountBalance, computeAssetValue } from '../accountBalance';
import { computeNetWorth } from '../netWorth';
import { budgetLinesForMonth, computePulseScore, monthlyData } from '../calculations';
import type { Transaction } from '../../types';
import { buildSafeSummary } from '../aiSummary';

vi.mock('../supabase', () => ({ isCloudEnabled: () => false, supabase: null }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-09T12:00:00Z'));
  useStore.setState({ ...useStore.getInitialState(), adapter: new LocalStorageAdapter(),
    currentHouseholdId: crypto.randomUUID(), cloudEnabled: false, myRole: 'owner',
    accounts: [{ id: 'bank', kind: 'bank', name: 'Bank', currency: 'USD', openingBalance: 1000 },
      { id: 'investment', kind: 'investment', name: 'Investment', currency: 'USD', openingBalance: 200 }],
    transactions: [], budgets: [], budgetAllocations: [], recurringSchedules: [], assets: [], debts: [],
    refreshNotifications: vi.fn().mockResolvedValue(undefined), toast: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function balance(id: string) {
  const state = useStore.getState();
  return computeAccountBalance(state.accounts.find(account => account.id === id)!, state.transactions, 'USD', { USD: 1 });
}

describe('ledger persisted happy paths', () => {
  it('deleting a schedule remains final after refresh even when its historical transaction survives', async () => {
    const state = useStore.getState();
    const schedule = await state.upsertRecurring({ frequency: 'monthly', startDate: '2026-09-09', nextDueDate: '2026-10-09', autoConfirm: false,
      transactionTemplate: { type: 'expense', amount: 100, currency: 'USD', category: 'utilities', description: 'Bill', accountId: 'bank' } });
    const transaction = await useStore.getState().upsertTransaction({ ...schedule.transactionTemplate, date: '2026-09-09',
      recurring: 'monthly', recurringScheduleId: schedule.id });
    await useStore.getState().removeRecurring(schedule.id);
    await useStore.getState().refresh();
    await useStore.getState().refresh();
    expect(useStore.getState().recurringSchedules).toEqual([]);
    expect(useStore.getState().transactions).toEqual([transaction]);
    expect(await state.adapter.list('recurring', state.currentHouseholdId)).toEqual([]);
  });

  it('profile and household currency/type changes persist and reload together', async () => {
    const adapter = useStore.getState().adapter;
    const household = await adapter.createHousehold('Family', 'family', 'USD');
    useStore.setState({ currentHouseholdId: household.id, households: [household] });
    await useStore.getState().updateProfile({ name: 'Test User', baseCurrency: 'GBP', household: 'personal', language: 'en' });
    const reloaded = new LocalStorageAdapter();
    expect(await reloaded.getProfile(household.id)).toMatchObject({ name: 'Test User', baseCurrency: 'GBP', household: 'personal' });
    expect(await reloaded.listHouseholds()).toContainEqual(expect.objectContaining({ id: household.id, baseCurrency: 'GBP', type: 'personal' }));
    expect(useStore.getState().households[0]).toMatchObject({ baseCurrency: 'GBP', type: 'personal' });
  });

  it('reconciliation persists the stated balance and linked asset without inventing a transaction', async () => {
    const state = useStore.getState();
    useStore.setState({ profile: { ...state.profile, baseCurrency: 'USD' }, rates: { USD: 1 },
      accounts: [{ ...state.accounts[0], assetId: 'asset' }],
      assets: [{ id: 'asset', name: 'Bank', type: 'bank', currency: 'USD', value: 1000, liquidity: 'liquid' }] });
    expect(await useStore.getState().reconcileAccount(useStore.getState().accounts[0], 1200)).toBe(200);
    expect(balance('bank')).toBe(1200);
    const after = useStore.getState();
    expect(after.transactions).toEqual([]);
    expect(after.assets[0]).toMatchObject({ value: 1200, confidence: 'confirmed' });
    expect(after.accounts[0].reconciliationLog).toEqual([expect.objectContaining({ delta: 200, stated_value: 1200 })]);
    expect(await new LocalStorageAdapter().list('accounts', after.currentHouseholdId)).toEqual(after.accounts);
    expect(await new LocalStorageAdapter().list('assets', after.currentHouseholdId)).toEqual(after.assets);
  });

  it.each([
    { type: 'expense', category: 'groceries', accountId: 'bank', toAccountId: undefined, bank: 900, income: 0, expenses: 100 },
    { type: 'income', category: 'salary', accountId: undefined, toAccountId: 'bank', bank: 1100, income: 100, expenses: 0 },
    { type: 'transfer', category: '', accountId: 'bank', toAccountId: 'investment', bank: 900, income: 0, expenses: 0 },
    { type: 'investment', category: '', accountId: 'bank', toAccountId: 'investment', bank: 900, income: 0, expenses: 0 },
  ] as const)('$type create, edit and delete persist correct account effects and reporting', async (scenario) => {
    const state = useStore.getState();
    const saved = await state.upsertTransaction({ type: scenario.type, category: scenario.category,
      accountId: scenario.accountId, toAccountId: scenario.toAccountId, amount: 100,
      currency: 'USD', date: '2026-09-09', description: 'Happy path' });
    expect(balance('bank')).toBe(scenario.bank);
    expect(balance('investment')).toBe(scenario.toAccountId === 'investment' ? 300 : 200);
    expect(monthlyData(useStore.getState().transactions, '2026-09', 'USD', { USD: 1 }))
      .toMatchObject({ income: scenario.income, expense: scenario.expenses });
    await useStore.getState().upsertTransaction({ ...saved, amount: 150 });
    const reloaded = await new LocalStorageAdapter().list('transactions', state.currentHouseholdId) as Transaction[];
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]).toMatchObject({ id: saved.id, amount: 150 });
    useStore.setState({ transactions: reloaded });
    expect(balance('bank')).toBe(scenario.type === 'income' ? 1150 : 850);
    await useStore.getState().removeTransaction(saved.id);
    expect(balance('bank')).toBe(1000);
    expect(balance('investment')).toBe(200);
    expect(await state.adapter.list('transactions', state.currentHouseholdId)).toEqual([]);
  });

  it.each(['month', 'annual'] as const)('%s budget create and replace retain identity and replace allocations', async scope => {
    const state = useStore.getState();
    const created = await state.saveBudgetWithAllocations({ scope, periodYear: 2026,
      ...(scope === 'month' ? { periodMonth: 9 } : {}), currency: 'USD', limit: 500 },
    [{ category: 'groceries', amount: 300 }, { category: 'utilities', amount: 200 }]);
    expect(created.budget.id).toBeTruthy();
    expect(created.allocations).toHaveLength(2);
    const edited = await useStore.getState().saveBudgetWithAllocations({ ...created.budget, limit: 600 },
      [{ category: 'groceries', amount: 600 }]);
    expect(edited.budget.id).toBe(created.budget.id);
    expect(useStore.getState().budgets).toHaveLength(1);
    expect(useStore.getState().budgetAllocations).toEqual(edited.allocations);
    expect(edited.allocations).toEqual([expect.objectContaining({ budgetId: created.budget.id, category: 'groceries', amount: 600 })]);
    const adapter = new LocalStorageAdapter();
    expect(await adapter.list('budgets', state.currentHouseholdId)).toEqual([edited.budget]);
    expect(await adapter.list('budgetAllocations', state.currentHouseholdId)).toEqual(edited.allocations);
    expect(budgetLinesForMonth([edited.budget], edited.allocations, '2026-09'))
      .toEqual([expect.objectContaining({ category: 'groceries', limit: 600 })]);
    expect(computePulseScore([], [edited.budget], [], [], 'USD', { USD: 1 }, edited.allocations).components.budget).toBe(100);
    expect(buildSafeSummary([], [edited.budget], [], [], [], { ...state.profile, baseCurrency: 'USD' }, { USD: 1 }, state.accounts, edited.allocations).budgets)
      .toEqual([{ category: 'groceries', limit: 600, spentPct: 0 }]);
  });

  it.each(['expense', 'income', 'investment'] as const)('due %s schedule posts once, advances and survives reload', async type => {
    const state = useStore.getState();
    const template = { type, amount: 100, currency: 'USD', description: 'Scheduled',
      category: type === 'expense' ? 'groceries' : type === 'income' ? 'salary' : '',
      accountId: type === 'income' ? undefined : 'bank', toAccountId: type === 'income' ? 'bank' : type === 'investment' ? 'investment' : undefined };
    const saved = await state.upsertRecurring({ frequency: 'monthly', dayOfMonth: 9,
      startDate: '2026-09-09', nextDueDate: '2026-09-09', autoConfirm: true, transactionTemplate: template });
    expect(useStore.getState().transactions).toEqual([]);
    await useStore.getState().runRecurringEngine();
    expect(useStore.getState().transactions).toEqual([expect.objectContaining({ type, amount: 100,
      date: '2026-09-09', recurringScheduleId: saved.id })]);
    expect(balance('bank')).toBe(type === 'income' ? 1100 : 900);
    const adapter = new LocalStorageAdapter();
    useStore.setState({ recurringSchedules: await adapter.list('recurring', state.currentHouseholdId),
      transactions: await adapter.list('transactions', state.currentHouseholdId) });
    expect(useStore.getState().recurringSchedules[0].nextDueDate).toBe('2026-10-09');
    await useStore.getState().runRecurringEngine();
    expect(useStore.getState().transactions).toHaveLength(1);
  });

  it('paused schedule posts nothing and resumes on its due date', async () => {
    const saved = await useStore.getState().upsertRecurring({ frequency: 'monthly', dayOfMonth: 9,
      startDate: '2026-09-09', nextDueDate: '2026-09-09', active: false, autoConfirm: true,
      transactionTemplate: { type: 'expense', amount: 100, currency: 'USD', category: 'groceries', accountId: 'bank', description: 'Bill' } });
    await useStore.getState().runRecurringEngine();
    expect(useStore.getState().transactions).toEqual([]);
    await useStore.getState().upsertRecurring({ ...saved, active: true });
    await useStore.getState().runRecurringEngine();
    expect(useStore.getState().transactions).toHaveLength(1);
  });
});
describe('Accounts R1 — one Cash in Hand per household, currency from the household', () => {
  it('local-only: creates exactly one Cash in Hand, idempotently, and refuses a second', async () => {
    await useStore.getState().ensureDefaultCashAccount();
    await useStore.getState().ensureDefaultCashAccount();
    expect(useStore.getState().accounts.filter(a => a.kind === 'cash')).toHaveLength(1);
    await expect(useStore.getState().upsertAccount({ id: crypto.randomUUID(), kind: 'cash', name: 'Second cash' }))
      .rejects.toThrow(/already has a Cash account/);
    expect(useStore.getState().accounts.filter(a => a.kind === 'cash')).toHaveLength(1);
  });

  it('Cash in Hand cannot be archived either — it would vanish from every picker', async () => {
    await useStore.getState().ensureDefaultCashAccount();
    const cash = useStore.getState().accounts.find(a => a.kind === 'cash')!;
    await expect(useStore.getState().upsertAccount({ id: cash.id, isArchived: true })).rejects.toThrow(/cannot be archived/);
    expect(useStore.getState().accounts.find(a => a.id === cash.id)?.isArchived).toBeFalsy();
  });

  it('Cash in Hand cannot be deleted, and the refusal changes nothing', async () => {
    await useStore.getState().ensureDefaultCashAccount();
    const cash = useStore.getState().accounts.find(a => a.kind === 'cash')!;
    await expect(useStore.getState().removeAccount(cash.id)).rejects.toThrow(/cannot be deleted/);
    expect(useStore.getState().accounts.some(a => a.id === cash.id)).toBe(true);
  });

  it('every account write carries the household currency, whatever the caller sent', async () => {
    useStore.setState({ profile: { ...useStore.getState().profile, baseCurrency: 'INR' } });
    const created = await useStore.getState().upsertAccount({ id: crypto.randomUUID(), kind: 'bank', name: 'HDFC', currency: 'USD' });
    expect(created.currency).toBe('INR');
    const renamed = await useStore.getState().upsertAccount({ id: 'bank', name: 'Renamed' });
    expect(renamed.currency).toBe('INR');
    expect(renamed.openingBalance).toBe(1000);
  });

  it('cloud mode asks the server for the cash account and never inserts one — even against an empty, unhydrated store', async () => {
    const hid = crypto.randomUUID();
    const serverCash = { id: crypto.randomUUID(), kind: 'cash' as const, name: 'Cash', currency: 'INR', openingBalance: 0, isDefault: true };
    const upsert = vi.fn();
    const ensureCashAccount = vi.fn().mockResolvedValue(serverCash);
    useStore.setState({ cloudEnabled: true, currentHouseholdId: hid, accounts: [],
      adapter: { upsert, ensureCashAccount } as never });
    await useStore.getState().ensureDefaultCashAccount();
    expect(ensureCashAccount).toHaveBeenCalledWith(hid);
    expect(upsert).not.toHaveBeenCalled();
    expect(useStore.getState().accounts).toEqual([serverCash]);
  });

  it('cloud mode replaces a stale cached cash row with the server one, so nothing double-counts', async () => {
    const hid = crypto.randomUUID();
    const serverCash = { id: crypto.randomUUID(), kind: 'cash' as const, name: 'Cash', currency: 'INR', openingBalance: 0 };
    const staleDuplicate = { id: crypto.randomUUID(), kind: 'cash' as const, name: 'Cash in Hand', currency: 'USD', openingBalance: 0 };
    useStore.setState({ cloudEnabled: true, currentHouseholdId: hid,
      accounts: [useStore.getState().accounts[0], staleDuplicate],
      adapter: { upsert: vi.fn(), ensureCashAccount: vi.fn().mockResolvedValue(serverCash) } as never });
    await useStore.getState().ensureDefaultCashAccount();
    const cash = useStore.getState().accounts.filter(a => a.kind === 'cash');
    expect(cash).toEqual([serverCash]);
    expect(useStore.getState().accounts.some(a => a.id === 'bank')).toBe(true);
  });

  it('a household switch during the server call does not leak the previous household cash into the new one', async () => {
    const serverCash = { id: crypto.randomUUID(), kind: 'cash' as const, name: 'Cash', currency: 'INR', openingBalance: 0 };
    let release!: (value: unknown) => void;
    const ensureCashAccount = vi.fn(() => new Promise(resolve => { release = resolve; }));
    useStore.setState({ cloudEnabled: true, currentHouseholdId: 'household-old', accounts: [],
      adapter: { upsert: vi.fn(), ensureCashAccount } as never });
    const pending = useStore.getState().ensureDefaultCashAccount();
    useStore.setState({ currentHouseholdId: 'household-new' });
    release(serverCash);
    await pending;
    expect(useStore.getState().accounts).toEqual([]);
  });

  it('local-only: Cash never becomes a second default beside an existing one', async () => {
    const hid = useStore.getState().currentHouseholdId;
    const bank = await useStore.getState().upsertAccount({ id: crypto.randomUUID(), kind: 'bank', name: 'HDFC', isDefault: true });
    await useStore.getState().ensureDefaultCashAccount();
    const stored = await useStore.getState().adapter.list('accounts', hid);
    expect(stored.filter(a => a.isDefault).map(a => a.id)).toEqual([bank.id]);
    expect(useStore.getState().accounts.find(a => a.kind === 'cash')?.isDefault).toBe(false);
  });

  it('local-only: marking a new default demotes the old one, in the store and in storage', async () => {
    const hid = useStore.getState().currentHouseholdId;
    const first = await useStore.getState().upsertAccount({ id: crypto.randomUUID(), kind: 'bank', name: 'HDFC', isDefault: true, openingBalance: 500 });
    const second = await useStore.getState().upsertAccount({ id: crypto.randomUUID(), kind: 'bank', name: 'ICICI', isDefault: true });
    expect(useStore.getState().accounts.filter(a => a.isDefault).map(a => a.id)).toEqual([second.id]);
    const stored = await useStore.getState().adapter.list('accounts', hid);
    expect(stored.filter(a => a.isDefault).map(a => a.id)).toEqual([second.id]);
    // Demoting touches only the flag — the old default keeps its money.
    expect(stored.find(a => a.id === first.id)?.openingBalance).toBe(500);
  });

  it('cloud mode mirrors the single-default trigger in the cache without writing the demoted row', async () => {
    const hid = crypto.randomUUID();
    const oldDefault = { id: crypto.randomUUID(), kind: 'bank' as const, name: 'HDFC', currency: 'INR', isDefault: true };
    const upsert = vi.fn(async (_t: string, _h: string, row: object) => row);
    useStore.setState({ cloudEnabled: true, currentHouseholdId: hid, accounts: [oldDefault],
      adapter: { upsert } as never });
    const saved = await useStore.getState().upsertAccount({ id: crypto.randomUUID(), kind: 'bank', name: 'ICICI', isDefault: true });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(useStore.getState().accounts.filter(a => a.isDefault).map(a => a.id)).toEqual([saved.id]);
  });
});

describe('Transactions R3 — the payment mode is one the paying account uses, and moves no number', () => {
  const spend = { type: 'expense' as const, amount: 250, currency: 'USD', date: '2026-09-05',
    description: 'Groceries', category: 'groceries', accountId: 'bank' };
  beforeEach(() => {
    useStore.setState({ accounts: useStore.getState().accounts.map(a =>
      a.id === 'bank' ? { ...a, paymentModes: ['upi', 'debit_card'] } : a) });
  });

  it('a mode the account uses is kept, and the balance moves exactly as without one', async () => {
    const saved = await useStore.getState().upsertTransaction({ ...spend, id: crypto.randomUUID(), paymentMode: 'upi' });
    expect(saved.paymentMode).toBe('upi');
    const withMode = balance('bank');
    await useStore.getState().removeTransaction(saved.id);
    await useStore.getState().upsertTransaction({ ...spend, id: crypto.randomUUID() });
    expect(balance('bank')).toBe(withMode);
    expect(withMode).toBe(750);
  });

  it('a mode the account does not use is dropped, and the money still posts', async () => {
    // e.g. a recurring schedule saved with a mode later removed from its account.
    const saved = await useStore.getState().upsertTransaction({ ...spend, id: crypto.randomUUID(), paymentMode: 'swipe' });
    expect(saved.paymentMode ?? null).toBeNull();
    expect(useStore.getState().transactions).toHaveLength(1);
    expect(balance('bank')).toBe(750);
  });

  it('an investment never carries a mode', async () => {
    const saved = await useStore.getState().upsertTransaction({ type: 'investment', amount: 100, currency: 'USD',
      date: '2026-09-05', description: 'SIP', category: '', id: crypto.randomUUID(),
      accountId: 'bank', toAccountId: 'investment', paymentMode: 'upi' });
    expect(saved.paymentMode ?? null).toBeNull();
  });
});

describe('Investments R4 — money moves between an account and a Net Worth asset, and net worth does not move', () => {
  const FUND = { id: 'fund', type: 'investment', name: 'Index fund', value: 0, currency: 'USD', liquidity: 'short' as const };
  const worth = () => {
    const s = useStore.getState();
    return computeNetWorth({ assets: s.assets, accounts: s.accounts, debts: s.debts, transactions: s.transactions }, 'USD', { USD: 1 }).netWorth;
  };
  const fundValue = () => {
    const s = useStore.getState();
    return computeAssetValue(s.assets.find(a => a.id === 'fund')!, s.transactions, { USD: 1 });
  };
  const invest = { type: 'investment' as const, currency: 'USD', date: '2026-09-05', description: 'SIP', category: '' };
  beforeEach(() => {
    useStore.setState({ profile: { ...useStore.getState().profile, baseCurrency: 'USD' }, rates: { USD: 1 },
      accounts: useStore.getState().accounts.filter(a => a.kind !== 'investment'), assets: [FUND] });
  });

  it('a buy lowers the paying account and raises the asset by the same amount; spend and net worth are untouched', async () => {
    const before = worth();
    const saved = await useStore.getState().upsertTransaction({ ...invest, id: crypto.randomUUID(), amount: 300, accountId: 'bank', assetId: 'fund' });
    expect(saved.accountId).toBe('bank');
    expect(saved.toAccountId).toBeUndefined();
    expect(balance('bank')).toBe(700);
    expect(fundValue()).toBe(300);
    expect(worth()).toBe(before);
  });

  it('a withdrawal lowers the asset and raises the receiving account; net worth is untouched', async () => {
    await useStore.getState().upsertTransaction({ ...invest, id: crypto.randomUUID(), amount: 300, accountId: 'bank', assetId: 'fund' });
    const before = worth();
    const saved = await useStore.getState().upsertTransaction({ ...invest, id: crypto.randomUUID(), amount: 120, toAccountId: 'bank', assetId: 'fund' });
    expect(saved.accountId).toBeUndefined();
    expect(saved.toAccountId).toBe('bank');
    expect(fundValue()).toBe(180);
    expect(balance('bank')).toBe(820);
    expect(worth()).toBe(before);
  });

  it('a local-only build: a buy paid from a legacy encoded picker value still saves and folds', async () => {
    // Money Map off lists 'cash' / 'asset:<id>' values that may not resolve to an
    // account uuid. The encoded value folds through debitAccountOf, like transfers.
    const saved = await useStore.getState().upsertTransaction({ ...invest, id: crypto.randomUUID(), amount: 40, paymentMethod: 'asset:legacy-only', assetId: 'fund' });
    expect(saved.assetId).toBe('fund');
    expect(saved.accountId).toBeUndefined();
    expect(saved.paymentMethod).toBe('asset:legacy-only');
    expect(fundValue()).toBe(40);
  });

  it('an investment naming no paying account at all is still refused', async () => {
    await expect(useStore.getState().upsertTransaction({ ...invest, id: crypto.randomUUID(), amount: 40, assetId: 'fund' }))
      .rejects.toThrow(/paid from/);
    expect(useStore.getState().transactions).toHaveLength(0);
  });

  it('an investment naming no known asset is refused and writes nothing', async () => {
    await expect(useStore.getState().upsertTransaction({ ...invest, id: crypto.randomUUID(), amount: 50, accountId: 'bank', assetId: 'missing' }))
      .rejects.toThrow(/investment this money moves/);
    expect(useStore.getState().transactions).toHaveLength(0);
  });

  it('Update value moves only the valuation offset — the opening value, the account and spend stay put', async () => {
    await useStore.getState().upsertTransaction({ ...invest, id: crypto.randomUUID(), amount: 300, accountId: 'bank', assetId: 'fund' });
    const delta = await useStore.getState().updateAssetValue(useStore.getState().assets.find(a => a.id === 'fund')!, 350);
    expect(delta).toBe(50);
    const fund = useStore.getState().assets.find(a => a.id === 'fund')!;
    expect(fund.value).toBe(0);
    expect(fund.valuationOffset).toBe(50);
    expect(fund.valuationLog).toHaveLength(1);
    expect(fundValue()).toBe(350);
    expect(balance('bank')).toBe(700);
    expect(useStore.getState().transactions).toHaveLength(1);
  });
});

describe('Accounts R2 — delete, move, archive and reconcile change no number that should not move', () => {
  const R = { USD: 1 };
  function seed() {
    useStore.setState({
      profile: { ...useStore.getState().profile, baseCurrency: 'USD' }, rates: R,
      accounts: [
        { id: 'hdfc', kind: 'bank', name: 'HDFC', currency: 'USD', openingBalance: 500, reconciliationOffset: 25 },
        { id: 'icici', kind: 'bank', name: 'ICICI', currency: 'USD', openingBalance: 100 },
        { id: 'unused', kind: 'bank', name: 'Never used', currency: 'USD', openingBalance: 0 },
        { id: 'card', kind: 'credit_card', name: 'Card', currency: 'USD', openingBalance: -50 },
      ],
      transactions: [
        { id: 't1', type: 'expense', amount: 120, currency: 'USD', date: '2026-09-02', description: 'Rent', category: 'rent_mortgage', accountId: 'hdfc' },
        { id: 't2', type: 'income', amount: 900, currency: 'USD', date: '2026-09-03', description: 'Salary', category: 'salary', toAccountId: 'hdfc' },
        { id: 't3', type: 'expense', amount: 40, currency: 'USD', date: '2026-09-04', description: 'Food', category: 'food_dining', accountId: 'icici' },
      ],
      recurringSchedules: [],
    });
  }
  const bal = (id: string) => {
    const s = useStore.getState();
    const a = s.accounts.find(x => x.id === id);
    return a ? computeAccountBalance(a, s.transactions, 'USD', R) : null;
  };
  const householdTotal = () => {
    const s = useStore.getState();
    return s.accounts.reduce((sum, a) => sum + computeAccountBalance(a, s.transactions, 'USD', R), 0);
  };
  const categoryTotals = () => useStore.getState().transactions.reduce<Record<string, number>>(
    (acc, t) => ({ ...acc, [t.category]: (acc[t.category] ?? 0) + t.amount }), {});

  it('moving an account into another keeps every balance total, category total and the month intact', async () => {
    seed();
    const hdfcBefore = bal('hdfc')!;
    const iciciBefore = bal('icici')!;
    const total = householdTotal();
    const cats = categoryTotals();
    const month = monthlyData(useStore.getState().transactions, '2026-09', 'USD', R);

    const result = await useStore.getState().moveAccountAndDelete('hdfc', 'icici');

    expect(result).toMatchObject({ status: 'moved', transactions: 2, folded: 525 });
    expect(bal('hdfc')).toBeNull();
    expect(bal('icici')).toBe(hdfcBefore + iciciBefore);
    expect(householdTotal()).toBe(total);
    expect(categoryTotals()).toEqual(cats);
    expect(monthlyData(useStore.getState().transactions, '2026-09', 'USD', R)).toEqual(month);
    const log = useStore.getState().accounts.find(a => a.id === 'icici')!.reconciliationLog!;
    expect(log.at(-1)).toMatchObject({ kind: 'merge', delta: 525, note: 'Moved from HDFC' });
  });

  it('history never crosses groups, and Cash in Hand is never the source', async () => {
    seed();
    await expect(useStore.getState().moveAccountAndDelete('hdfc', 'card')).rejects.toThrow(/same type/);
    useStore.setState({ accounts: [...useStore.getState().accounts, { id: 'cash', kind: 'cash', name: 'Cash', currency: 'USD' }] });
    await expect(useStore.getState().moveAccountAndDelete('cash', 'icici')).rejects.toThrow(/cannot be deleted/);
    expect(bal('hdfc')).not.toBeNull();
  });

  it('permanent delete is refused while history is attached, and changes nothing when refused', async () => {
    seed();
    const total = householdTotal();
    await expect(useStore.getState().deleteAccountPermanently('hdfc')).rejects.toThrow(/history attached/);
    expect(bal('hdfc')).not.toBeNull();
    expect(householdTotal()).toBe(total);
  });

  it('deleting an account nothing refers to changes no number anywhere', async () => {
    seed();
    const total = householdTotal();
    const cats = categoryTotals();
    await useStore.getState().deleteAccountPermanently('unused');
    expect(bal('unused')).toBeNull();
    expect(householdTotal()).toBe(total);
    expect(categoryTotals()).toEqual(cats);
  });

  it('archiving alters no report', async () => {
    seed();
    const month = monthlyData(useStore.getState().transactions, '2026-09', 'USD', R);
    const cats = categoryTotals();
    await useStore.getState().upsertAccount({ id: 'icici', isArchived: true });
    expect(monthlyData(useStore.getState().transactions, '2026-09', 'USD', R)).toEqual(month);
    expect(categoryTotals()).toEqual(cats);
    expect(useStore.getState().transactions).toHaveLength(3);
  });

  it('confirming a balance that already matches stamps the check and writes nothing else', async () => {
    seed();
    const account = useStore.getState().accounts.find(a => a.id === 'icici')!;
    const delta = await useStore.getState().reconcileAccount(account, bal('icici')!);
    const after = useStore.getState().accounts.find(a => a.id === 'icici')!;
    expect(delta).toBe(0);
    expect(after.lastReconciledAt).toBeTruthy();
    expect(after.reconciliationLog ?? []).toHaveLength(0);
    expect(after.reconciliationOffset ?? 0).toBe(0);
    expect(useStore.getState().transactions).toHaveLength(3);
  });

  it('a card reconciled against a higher statement outstanding moves its balance down by the gap, and no spend appears', async () => {
    seed();
    const card = useStore.getState().accounts.find(a => a.id === 'card')!;
    const month = monthlyData(useStore.getState().transactions, '2026-09', 'USD', R);
    // Vyact says 50 owed; the statement says 80 owed.
    const delta = await useStore.getState().reconcileAccount(card, -80);
    expect(delta).toBe(-30);
    expect(bal('card')).toBe(-80);
    expect(useStore.getState().accounts.find(a => a.id === 'card')!.reconciliationLog!.at(-1)).toMatchObject({ kind: 'credit_card', delta: -30 });
    expect(monthlyData(useStore.getState().transactions, '2026-09', 'USD', R)).toEqual(month);
  });
});
