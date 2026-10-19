// W7a (v10.80.0) — small app fixes from the 2026-10-04 audit (batch A). Each case is named after its
// finding. Vitest runs in node here (no DOM), so screen behaviour is pinned through the pure helpers
// it uses and, where a page must use them, through its source.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateRecommendations } from '../plannerRules';
import { buildBackup, BACKUP_FORMAT_VERSION } from '../backup';
import { txnAccountLabel } from '../accounts';
import { listNet, dayTotalsForMonth } from '../txnListTotals';
import { inviteAcceptMessage, nextHouseholdAfterExit } from '../householdTypes';
import { htmlLangFor } from '../htmlLang';
import { statedForReconcile } from '../accountsView';
import { FEATURES } from '../../config/features';
import type { Transaction } from '../../types';

const src = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('W7a · small app fixes', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('W7a-MNY14-001 · a steady salary is not "income varies" early in a month; real variance still is (FE-MNY-14)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 2, 12, 0, 0));               // 2 Oct 2026, before this month's salary
    const pay = (date: string, amount: number): Transaction => ({ id: date, type: 'income', amount, currency: 'INR', date, category: 'salary', description: 'Salary' } as Transaction);
    const steady = ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].map(d => pay(d, 1_00_000));
    const ctx = (transactions: Transaction[]) => ({ transactions, budgets: [], goals: [], debts: [], assets: [], baseCurrency: 'INR', rates: {} });
    // A tiny entry this month used to count as a near-zero income month and trip the rule.
    const thisMonth = [{ id: 'x', type: 'expense', amount: 50, currency: 'INR', date: '2026-10-01', category: 'food_dining', description: 'Tea', accountId: 'a' } as Transaction];
    expect(evaluateRecommendations(ctx([...steady, ...thisMonth]), 50).some(r => r.id === 'income.unstable')).toBe(false);
    const lumpy = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].map((d, i) => pay(d, [20_000, 1_50_000, 30_000, 1_20_000][i]));
    expect(evaluateRecommendations(ctx(lumpy), 50).some(r => r.id === 'income.unstable')).toBe(true);
  });
  it('W7a-MNY15-001 · the download carries accounts, recurring bills and net-worth history (FE-MNY-15, FE-UIS-06; since T4b, exactly the owner\'s list)', () => {
    const b = buildBackup({
      household: { name: 'Home', type: 'family', baseCurrency: 'INR' }, members: [],
      transactions: [], sharedSplitsOwned: [], sharedSplitsWithMe: [], debts: [], assets: [],
      accounts: [{ id: 'acc' } as never],
      recurringSchedules: [{ id: 'r' } as never], netWorthSnapshots: [{ month: '2026-09' } as never],
    }, '2026-10-08', '10.80.0');
    expect(b).toMatchObject({ version: BACKUP_FORMAT_VERSION, appVersion: '10.80.0', exported: '2026-10-08' });
    expect([b.accounts, b.recurringSchedules, b.netWorth.monthlyHistory].map(a => a.length)).toEqual([1, 1, 1]);
    expect(b).not.toHaveProperty('exchangeRates');
    expect(src('pages/Settings.tsx')).toMatch(/buildBackup\(\{[\s\S]*?accounts: s\.accounts, assets, netWorthSnapshots: s\.netWorthSnapshots,[\s\S]*?recurringSchedules: s\.recurringSchedules/);
  });
  it('W7a-UIC16-001 · a transaction row names its account from the accounts FK (FE-UIC-16)', () => {
    const accounts = [{ id: 'a1', name: 'HDFC Salary' }, { id: 'a2', name: 'ICICI Card' }];
    const lbl = (t: Partial<Transaction>) => txnAccountLabel({ type: 'expense', ...t } as Transaction, accounts, [], []);
    expect(lbl({ accountId: 'a1', paymentMethod: 'asset:gone' })).toBe('HDFC Salary');   // was "Linked account"
    expect(lbl({ paymentMethod: 'a2' })).toBe('ICICI Card');                              // account id stored as method
    expect(lbl({ type: 'transfer', accountId: 'a1', toAccountId: 'a2' })).toBe('HDFC Salary → ICICI Card');
    expect(lbl({ accountSplits: [{ accountId: 'a1', amount: 1 }, { accountId: 'a2', amount: 2 }] })).toBe('HDFC Salary + ICICI Card');
    expect(lbl({ type: 'investment', toAccountId: 'a1' })).toBe('HDFC Salary');
    expect(lbl({ paymentMethod: 'cash' })).toBe('Cash');                                  // legacy path kept
    expect(lbl({})).toBeNull();
    expect(src('components/transactions/TxnRow.tsx')).toMatch(/txnAccountLabel\(t, accounts, assets, debts2\)/);
  });
  it('W7a-UIC17-001 · list and calendar totals count reportable rows at your share (FE-UIC-17)', () => {
    const t = (o: Partial<Transaction>) => ({ id: Math.random().toString(), currency: 'INR', description: '', date: '2026-10-03', ...o } as Transaction);
    const rows = [
      t({ type: 'income', amount: 1000, category: 'salary' }),
      t({ type: 'expense', amount: 600, category: 'food_dining', split: { isSplit: true, yourShare: 200, participants: [] } as never }),
      t({ type: 'expense', amount: 300, category: 'transfer' }),             // paired transfer leg
      t({ type: 'expense', amount: 50, category: 'balance_adjustment' }),    // reconciliation correction
      t({ type: 'expense', amount: 80, category: 'shopping', excluded: true }),
      t({ type: 'transfer', amount: 999, category: 'transfer' }),
    ];
    expect(listNet(rows, 'INR')).toBe(800);                                    // 1000 − 200 (was 1000 − 600 − 300 − 50)
    const days = dayTotalsForMonth(rows, '2026-10', 'INR');
    expect(days.get('2026-10-03')).toEqual({ income: 1000, expense: 200 });
    expect(dayTotalsForMonth(rows, '2026-09', 'INR').size).toBe(0);
    expect(src('pages/Transactions.tsx')).not.toMatch(/effectiveAmount\(/);
    expect(src('components/transactions/TxnCalendar.tsx')).toMatch(/dayTotalsForMonth\(transactions, viewMonth, currency\)/);
  });
  it('W7a-UIS14-001 · controls carry labels and autocomplete hints (FE-UIS-14)', () => {
    const hh = src('pages/Households.tsx');
    expect(hh).toMatch(/aria-label=\{`Role for \$\{m\.display_name\}`\}/);
    expect(hh).toMatch(/htmlFor="activity-actor"[\s\S]{0,200}id="activity-actor"/);
    const ob = src('pages/Onboarding.tsx');
    expect(ob).toMatch(/htmlFor="ob-name"[\s\S]{0,120}id="ob-name" autoComplete="given-name"/);
    expect(ob).toMatch(/htmlFor="ob-income"/);
    expect(ob).toMatch(/id="ob-income"/);
    for (const g of ['ob-segment', 'ob-concerns', 'ob-schedule', 'ob-bills']) expect(ob).toContain(`aria-labelledby="${g}"`);
    expect(ob).toMatch(/aria-label=\{`\$\{chip\.label\} amount per month`\}/);
    expect(src('pages/auth/SignIn.tsx')).toMatch(/type="email" autoComplete="email"/);
    expect(src('pages/auth/SignUp.tsx')).toMatch(/autoComplete="new-password"/);
    expect(src('pages/auth/ResetPassword.tsx')).toMatch(/aria-label="New password"/);
  });
  it('W7a-UIS16-001 · Button is type="button" by default; invite refusals are words; dead modules gone (FE-UIS-16)', () => {
    expect(src('components/ui/Button.tsx')).toMatch(/type = 'button'[\s\S]*<button type=\{type\}/);
    expect(inviteAcceptMessage(new Error('HOUSEHOLD_FULL: a couple household has room for 2 members'))).toMatch(/already full/);
    expect(inviteAcceptMessage(new Error('HOUSEHOLD_FULL: x'))).not.toMatch(/HOUSEHOLD_FULL/);
    expect(inviteAcceptMessage(new Error('Invitation expired'))).toBe('Invitation expired');
    expect(src('pages/auth/AcceptInvite.tsx')).toMatch(/setError\(inviteAcceptMessage\(e\)\)/);
    expect(existsSync(resolve(__dirname, '../../components/education/WhyChip.tsx'))).toBe(false);
    expect(existsSync(resolve(__dirname, '../insightsApi.ts'))).toBe(false);
  });
  it('W7a-UIS15-001 · <html lang> follows the Language setting (FE-UIS-15)', () => {
    expect(htmlLangFor('hi')).toBe('hi');
    expect(htmlLangFor('ja')).toBe('ja');
    expect(htmlLangFor(undefined)).toBe('en');
    expect(htmlLangFor('xx')).toBe('en');
    expect(htmlLangFor('toString')).toBe('en');
    expect(src('hooks.ts')).toMatch(/document\.documentElement\.lang = htmlLangFor\(language\)/);
  });
  it('W7a-HH13-001 · leaving or deleting the open household lands on one the person is still in (INT-HH-13)', () => {
    expect(nextHouseholdAfterExit([{ id: 'h1' }, { id: 'h2' }], 'h1')).toBe('h2');
    expect(nextHouseholdAfterExit([{ id: 'h2' }], 'h1')).toBe('h2');
    expect(nextHouseholdAfterExit([{ id: 'h1' }], 'h1')).toBeNull();
    expect(nextHouseholdAfterExit([{ id: 'local' }], 'h1')).toBeNull();
    const ds = src('store/slices/dataSlice.ts');
    expect(ds).toMatch(/switchHousehold\(nextHouseholdAfterExit\(households, id\) \?\? 'local'\)/);
    const hh = src('pages/Households.tsx');
    expect(hh.match(/leaveActive\(active\)/g)?.length).toBe(2);
    expect(hh).toMatch(/if \(h\.id === currentHouseholdId && next\) await switchHousehold\(next\)/);
  });
  it('W7a-UIC14-001 · the Reconcile sheet reads a card\'s "-23,990" as owed and refuses negative cash (FE-UIC-14)', () => {
    expect(statedForReconcile(-23990, 'credit_card')).toBe(23990);
    expect(statedForReconcile(23990, 'credit_card')).toBe(23990);
    expect(statedForReconcile(-50, 'cash')).toBeNull();
    expect(statedForReconcile(50, 'cash')).toBe(50);
    expect(statedForReconcile(-1200, 'bank')).toBe(-1200);                // an overdraft keeps its sign
    expect(statedForReconcile(null, 'credit_card')).toBeNull();
    // Card owes 23,990 in Vyact; typing it negative is no drift (was a 47,980 "gap").
    const vyactSays = 23990;
    expect((statedForReconcile(-23990, 'credit_card') ?? 0) - vyactSays).toBe(0);
    const sheet = src('components/accounts/ReconcileSheet.tsx');
    expect(sheet).toMatch(/statedValue = statedForReconcile\(parseAmountInput\(stated\), account\.kind\)/);
    expect(sheet).toMatch(/const posted = await reconcileAccount[\s\S]*?fmt\(Math\.abs\(posted\)/);
  });
  it('W7a-UIS13-001 · changing the password in Settings needs the emailed code first (FE-UIS-13)', () => {
    const s = src('pages/Settings.tsx');
    const body = s.slice(s.indexOf('async function savePassword'), s.indexOf('async function saveProfile'));
    expect(body).toMatch(/if \(!\(await confirmWithEmailCode\('change your password'\)\)\) return;\s*await updatePassword\(pwNew\)/);
  });
  it('W7a-UIS08-001 · toasts and bottom banners sit above the phone tab bar and safe area (FE-UIS-08)', () => {
    const css = src('index.css');
    expect(css).toMatch(/\.bottom-above-tabbar \{ bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 84px\); \}/);
    expect(css).toMatch(/@media \(min-width: 640px\) \{ \.bottom-above-tabbar \{ bottom: 1rem; \} \}/);
    for (const f of ['components/onboarding/NudgeBanner.tsx', 'components/layout/InstallBanner.tsx', 'components/layout/UpdateBanner.tsx', 'components/ui/ToastHost.tsx']) {
      // The toast host builds its class with a template (Aurora 4.0 TS1 adds .toast-on-form on form pages).
      expect(src(f), f).toMatch(/className=(?:"|{`)fixed bottom-above-tabbar /);
    }
  });
  it('W7a-PIP18-001 · the dead askVyact `backend` flag is gone from the app and the engine bundle (FE-PIP-18)', () => {
    expect(FEATURES.askVyact).not.toHaveProperty('backend');
    expect(src('config/features.ts')).not.toMatch(/backend: 'rules'/);
    expect(readFileSync(resolve(__dirname, '../../../../supabase/functions/_shared/agent/engine.generated.js'), 'utf8')).not.toMatch(/backend: "rules"/);
  });
  it('W7a-PIP17-001 · the chat is keyed on the household, so a switch starts a fresh conversation (FE-PIP-17)', () => {
    const chat = src('pages/Chat.tsx');
    expect(chat).toMatch(/export default function Chat\(props[^)]*\) \{\s*const householdId = useStore\(s => s\.currentHouseholdId\);\s*return <ChatForHousehold key=\{householdId\} \{\.\.\.props\} \/>;/);
  });
});
