// W8a (v10.82.0) — app fixes from the 2026-10-04 audit's open low/medium items. Each case is named after
// its finding. Vitest runs in node (no DOM): behaviour is pinned through pure helpers and, where a page
// must use them, through its source.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FULLY_TRANSLATED, languageOptionLabel } from '../i18n';
import { LOCALES } from '../../constants';
import { getInsights, recurringForecastByCategory, type ForecastSchedule } from '../calculations';
import { editSeedAccount } from '../accounts';
import { parseAmount } from '../amountInput';
import { accountLedgerRows } from '../accountLedger';
import { parseAmountInput, staleAccounts } from '../accountsView';
import { sanitizeAmount } from '../../components/ui/NumericKeypad';
import type { Account, Budget, BudgetAllocation, Transaction } from '../../types';

const src = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('W8a · app fixes', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('W8a-MNY06-001 · Dashboard chips read this month\'s budget lines and the net-worth projection (FE-MNY-06)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 15, 12));
    const txns = [
      { id: 'i', type: 'income', amount: 1000, currency: 'INR', date: '2026-10-01', category: 'salary', description: '' },
      { id: 'e', type: 'expense', amount: 150, currency: 'INR', date: '2026-10-05', category: 'food_dining', description: '' },
    ] as Transaction[];
    // A v9.1 container budget: no category of its own, the food limit lives in an allocation.
    const budgets = [{ id: 'b', limit: 500, currency: 'INR', scope: 'month', periodYear: 2026, periodMonth: 10 }] as Budget[];
    const allocations = [{ id: 'a', budgetId: 'b', category: 'food_dining', amount: 100 }] as BudgetAllocation[];
    // The old call saw no category on the container and reported nothing over.
    expect(getInsights(txns, budgets, [], [], [], 'INR', {}).some(c => /exceeded/.test(c.text))).toBe(false);
    const withCtx = getInsights(txns, budgets, [], [], [], 'INR', {}, { allocations, netWorth: 2500 });
    expect(withCtx.find(c => /exceeded/.test(c.text))?.text).toBe('1 budget exceeded');
    // Net worth comes from the projection (live accounts), not the empty static asset array.
    expect(withCtx.some(c => c.text === 'Net worth building')).toBe(true);
    expect(getInsights(txns, budgets, [], [], [], 'INR', {}, { allocations, netWorth: -10 }).some(c => /focus on payoff/.test(c.text))).toBe(true);
    expect(getInsights(txns, budgets, [], [], [], 'INR', {}, { allocations, netWorth: null }).some(c => /Net worth/.test(c.text))).toBe(false);
    // An annual line's limit is not a month's: never "exceeded" against one month of spending.
    const annual = [{ id: 'y', limit: 1200, currency: 'INR', scope: 'annual', periodYear: 2026 }] as Budget[];
    const annualAlloc = [{ id: 'ya', budgetId: 'y', category: 'food_dining', amount: 120 }] as BudgetAllocation[];
    expect(getInsights(txns, annual, [], [], [], 'INR', {}, { allocations: annualAlloc, netWorth: null }).some(c => /exceeded/.test(c.text))).toBe(false);
    expect(src('lib/selectors.ts')).toMatch(/getInsights\(transactions, budgets, goals, debts, assets, base, rates, \{ allocations, netWorth \}\)/);
  });

  it('W8a-MNY16-001 · the budget forecast skips paused schedules and loan EMIs (FE-MNY-16)', () => {
    // v10.91.0: the server copy is gone (the forecast reads the recurrence rule; never hand-ported).
    const sched: ForecastSchedule[] = [
      { transactionTemplate: { type: 'expense', amount: 300, currency: 'INR', category: 'utilities' }, frequency: 'monthly', startDate: '2026-01-05' },
      { transactionTemplate: { type: 'expense', amount: 999, currency: 'INR', category: 'subscriptions' }, frequency: 'monthly', startDate: '2026-01-05', active: false },
      { transactionTemplate: { type: 'expense', amount: 16000, currency: 'INR', category: 'loan_emi' }, frequency: 'monthly', startDate: '2026-01-05' },
      { transactionTemplate: { type: 'expense', amount: 5000, currency: 'INR', category: 'other_expense', linkedDebtId: 'd' }, frequency: 'monthly', startDate: '2026-01-05' },
    ];
    const f = recurringForecastByCategory(sched, '2026-10-01', '2026-10-31', 'INR', {});
    expect(f).toEqual({ utilities: 300 });
  });

  it('W8a-UIC05-001 · an edit opens on the account the ledger uses (the FK), not a stale paymentMethod (FE-UIC-05)', () => {
    const accounts = [
      { id: 'acc-hdfc', kind: 'bank', name: 'HDFC', currency: 'INR' },
      { id: 'acc-card', kind: 'credit_card', name: 'Card', currency: 'INR' },
      { id: 'acc-cash', kind: 'cash', name: 'Cash', currency: 'INR' },
    ] as Account[];
    // Moved to the card elsewhere; paymentMethod still names the bank.
    expect(editSeedAccount({ type: 'expense', accountId: 'acc-card', paymentMethod: 'asset:acc-hdfc' }, accounts)).toBe('debt:acc-card');
    expect(editSeedAccount({ type: 'income', toAccountId: 'acc-hdfc', paymentMethod: 'cash' }, accounts)).toBe('asset:acc-hdfc');
    expect(editSeedAccount({ type: 'expense', accountId: 'acc-cash' }, accounts)).toBe('cash');
    // Legacy rows with no FK keep their stored method.
    expect(editSeedAccount({ type: 'expense', paymentMethod: 'visa' }, accounts)).toBe('visa');
    expect(editSeedAccount({ type: 'expense', accountId: 'gone' }, accounts)).toBe('gone');
    expect(editSeedAccount({ type: 'expense' }, accounts)).toBe('');
    expect(src('components/transactions/TransactionFormModal.tsx')).toMatch(/: editSeedAccount\(initial, accountsState\)/);
  });

  it('W8a-UIC09-001 · editing a non-folding asset patches the row it opened (FE-UIC-09)', () => {
    const s = src('components/assets/AssetFormModal.tsx');
    const elseBranch = s.slice(s.indexOf('} else {', s.indexOf('if (initial && folds)')));
    expect(elseBranch).toMatch(/const asset: Partial<Asset> = \{\s*\.\.\.\(initial \?\? \{\}\),\s*id: initial\?\.id \?\? uid\(\),/);
  });

  it('W8a-UIC10-001 · a decimal comma is read as one; grouping commas still work (FE-UIC-10)', () => {
    expect(parseAmount('12,50')).toBe(12.5);
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount('1,50,000')).toBe(150000);
    expect(parseAmount('150,000')).toBe(150000);
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('46.')).toBe(46);
    expect(parseAmount('-1200')).toBe(-1200);           // a reconcile overdraft keeps its sign
    expect(parseAmount('')).toBeNaN();
    expect(parseAmount('abc')).toBeNaN();
    expect(parseAmountInput('12,50')).toBe(12.5);
    expect(parseAmountInput('')).toBeNull();
    expect(sanitizeAmount('12,50')).toBe('12,50');       // kept as typed (used to become "1250")
    expect(sanitizeAmount('₹ 1,50,000')).toBe('1,50,000');
    for (const f of ['components/transactions/TransactionFormModal.tsx', 'components/splits/SplitFormModal.tsx', 'pages/Recurring.tsx', 'components/budgets/BudgetFormModal.tsx']) {
      expect(src(f), f).not.toMatch(/parseFloat\((form\.amount|form\.limit|amount|r\.amount)\)/);
    }
    expect(src('components/debts/LoanPaymentSheet.tsx')).toMatch(/: parseAmount\(amount\)/);
  });

  it('W8a-UIC15-001 · the ledger running balance undoes a reconcile adjustment when walking back past it (FE-UIC-15)', () => {
    // Opening 1,000; spend 100 on the 2nd; reconcile +50 on the 5th; spend 200 on the 8th.
    const account = {
      id: 'acc', kind: 'bank', name: 'HDFC', currency: 'INR', openingBalance: 1000, reconciliationOffset: 50,
      reconciliationLog: [{ at: '2026-10-05T10:00:00.000Z', delta: 50, kind: 'bank', stated_value: 950 }],
    } as Account;
    const txns = [
      { id: 'a', type: 'expense', amount: 100, currency: 'INR', date: '2026-10-02', category: 'food_dining', description: 'A', accountId: 'acc' },
      { id: 'b', type: 'expense', amount: 200, currency: 'INR', date: '2026-10-08', category: 'shopping', description: 'B', accountId: 'acc' },
    ] as Transaction[];
    const rows = accountLedgerRows(account, txns, 'INR', {});
    expect(rows.map(r => [r.t.id, r.impact, r.runningAfter])).toEqual([
      ['b', -200, 750],    // today's balance: 1000 − 100 + 50 − 200
      ['a', -100, 900],    // was 950: the +50 reconcile on the 5th came after this row
    ]);
    expect(src('pages/Accounts.tsx')).toMatch(/accountLedgerRows\(account, txns, baseCur, rates\)/);
  });

  it('W8a-PIP16-003 · the chat gives each turn an abort signal; Stop, New chat and unmount abort it (FE-PIP-16)', () => {
    const chat = src('pages/Chat.tsx');
    expect(chat).toMatch(/useEffect\(\(\) => \(\) => \{ turnAbort\.current\?\.abort\(\); \}, \[\]\);/);
    expect(chat).toMatch(/cancel: \(\) => \{ cancelledTurns\.current\.add\(turnId\); abort\.abort\(\); \}/);
    // v10.106.3: the backend is built from the model call (timed per stage); the signal still reaches it.
    expect(chat).toMatch(/selectModelCall\(householdId, abort\.signal\)/);
  });

  it('W8a-SYN12-001 · a failed device-storage read is not "empty": strict reads throw, writes are refused (FE-SYN-12)', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', { open() {
      const req: { error?: Error; onerror?: () => void } = {};
      queueMicrotask(() => { req.error = new Error('disk unavailable'); req.onerror?.(); });
      return req;
    } });
    try {
      const kv = await import('../kvStore');
      expect(await kv.kvGet('h_transactions')).toBeNull();                       // plain read: tolerant
      await expect(kv.kvGetStrict('h_transactions')).rejects.toBeInstanceOf(kv.KvReadError);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
    const adapter = src('lib/dataAdapter.ts');
    // v10.111.0 (F1b): the row writes run under the list's lock through putRow / removeRow / updateList,
    // which hold the strict read; upsert, put and remove reach it through them.
    for (const m of ['async putRow<', 'async removeRow(', 'async updateList<', 'async createBudgetChecked(', 'async recordNetWorthSnapshot(']) {
      const body = adapter.slice(adapter.indexOf(m), adapter.indexOf(m) + 900);
      expect(body, m).toMatch(/this\.readForWrite</);
    }
    for (const [m, via] of [['async upsert<', 'this.putRow('], ['async put<', 'this.putRow('], ['async remove(', 'this.removeRow(']]) {
      expect(adapter.slice(adapter.indexOf(m), adapter.indexOf(m) + 900), m).toContain(via);
    }
    expect(adapter).toMatch(/const v = await kvGetStrict<T>\(key\);/);
  });

  it('W8a-PLT07-001 · a signed-in visit to an invite link asks before joining (FE-PLT-07)', () => {
    const page = src('pages/auth/AcceptInvite.tsx');
    // The load effect only decides between sign-in and the confirm step; it never accepts.
    const effect = page.slice(page.indexOf('useEffect(() => {'), page.indexOf('async function join()'));
    expect(effect).not.toMatch(/acceptInvitation\(/);
    expect(effect).toMatch(/setStatus\('confirm'\)/);
    // Only the Join button runs the accept.
    expect(page).toMatch(/async function join\(\) \{\s*setStatus\('joining'\);\s*try \{\s*const result = await acceptInvitation\(token\);/);
    expect(page).toMatch(/<Button full onClick=\{join\}>Join household<\/Button>/);
    expect(page).toMatch(/title="Join this household\?"/);
  });

  it('W8a-PRV09-001 · consent records the version the pages show, failures are reported, Google on sign-in records it (XC-PRV-09)', async () => {
    const { POLICY_ACCEPTANCE_VERSION } = await import('../auth');
    const { POLICY_VERSION } = await import('../policyVersion');
    expect(POLICY_ACCEPTANCE_VERSION).toBe(POLICY_VERSION);          // was '2026-07-01' vs '2026-10-07'
    expect(src('pages/Privacy.tsx')).toMatch(/import \{ POLICY_VERSION \} from '\.\.\/lib\/policyVersion';\s*export \{ POLICY_VERSION \};/);
    // An existing acceptance of this version is not re-stamped.
    expect(src('lib/auth.ts')).toMatch(/\.or\(`privacy_version\.is\.null,privacy_version\.neq\.\$\{POLICY_ACCEPTANCE_VERSION\}`\)/);
    for (const f of ['pages/auth/SignUp.tsx', 'components/auth/AuthGate.tsx']) {
      expect(src(f), f).not.toMatch(/acceptPolicies\([^)]*\)\.catch\(\(\) => \{\}\)/);
      expect(src(f), f).toMatch(/unexpected\(e, 'consent:record'\)/);
    }
    // The pending flag is cleared only after the write succeeds.
    expect(src('components/auth/AuthGate.tsx')).toMatch(/await acceptPolicies\(session\.user\.id\);\s*sessionStorage\.removeItem\('pending_policy_accept'\);/);
    expect(src('pages/auth/SignIn.tsx')).toMatch(/<GoogleButton consentByContinuing \/>/);
    const g = src('components/auth/GoogleButton.tsx');
    expect(g).toMatch(/if \(requireAgreement \|\| consentByContinuing\) sessionStorage\.setItem\('pending_policy_accept', '1'\);/);
    expect(g).toMatch(/By continuing with Google you confirm you are 18 or older and agree to the/);   // 18+ since T4b
  });

  it('W8a-PAR05-001 · one stale-balance rule: a new account is fresh; push and Reply UPDATE agree (INT-PAR-05)', () => {
    const now = new Date('2026-10-08T12:00:00Z');
    const old = '2026-08-01T00:00:00Z';
    const accounts = [
      { id: 'cash-new', kind: 'cash', name: 'Cash', currency: 'INR', createdAt: '2026-10-08T09:00:00Z' },      // added today
      { id: 'bank-old', kind: 'bank', name: 'HDFC', currency: 'INR', createdAt: old },                          // never checked, 68 days
      { id: 'card-old', kind: 'credit_card', name: 'Card', currency: 'INR', createdAt: old },                   // cards count
      { id: 'bank-rec', kind: 'bank', name: 'SBI', currency: 'INR', createdAt: old, lastReconciledAt: '2026-10-01T00:00:00Z' },
      { id: 'inv-old', kind: 'investment', name: 'MF', currency: 'INR', createdAt: old },                        // not checked against a statement
      { id: 'bank-arch', kind: 'bank', name: 'Old', currency: 'INR', createdAt: old, isArchived: true },
    ] as Account[];
    expect(staleAccounts(accounts, now).map(a => a.id)).toEqual(['bank-old', 'card-old']);
    // The bell/push rule counts the same two (it used to say every never-stamped account, incl. today's cash).
    expect(src('lib/notifications.ts')).toMatch(/const stale = staleAccounts\(accounts, new Date\(\)\);/);
    expect(src('lib/serverEngine.ts')).toMatch(/return staleAccounts\(accounts, new Date\(nowMs\)\)/);
  });

  it('W8a-UIS15-001 · the Language select labels the partly translated languages "Preview" (FE-UIS-15)', () => {
    expect(languageOptionLabel('en')).toBe('English');
    for (const code of Object.keys(LOCALES).filter(c => c !== 'en')) {
      expect(languageOptionLabel(code)).toBe(`${LOCALES[code].name} — Preview: navigation only`);
    }
    expect([...FULLY_TRANSLATED]).toEqual(['en']);
    const s = src('pages/Settings.tsx');
    expect(s).toMatch(/<option key=\{k\} value=\{k\}>\{languageOptionLabel\(k\)\}<\/option>/);
    expect(s).toMatch(/!FULLY_TRANSLATED\.has\(profile\.language\)/);
  });
});
