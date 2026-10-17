// Aurora 4.0 · A6 forms and onboarding (v10.105.0) — F1, F2, CAT1–CAT3, FRM1, FRM2, FS1, FS2, FL1, FL2,
// FA1, AF1, RC1, RC2, RE1–RE3, OB1, OB2, ON1, ON2. Each case is named after its change code.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import CategoryPicker from '../../components/ui/CategoryPicker';
import { recentCategories, suggestCategory } from '../categorySuggest';
import { groupDigits, groupedValue } from '../groupDigits';
import { cardCycle } from '../cardCycle';
import { cadence, scheduleSummary } from '../scheduleSummary';
import type { TxnType } from '../../types';

vi.stubGlobal('React', React);
const src = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(src, p), 'utf8').replace(/\r\n/g, '\n');

describe('A6 · forms and onboarding', () => {
  it('A6-CAT2-001 · the description suggests a category of the entry\'s own type, never Loan / EMI', () => {
    expect(suggestCategory('Swiggy order', 'expense')).toEqual({ category: 'food_dining', word: 'Swiggy' });
    expect(suggestCategory('Paid the rent', 'expense')).toEqual({ category: 'rent_mortgage', word: 'rent' });
    expect(suggestCategory('eating out with Sam', 'expense')).toEqual({ category: 'food_dining', word: 'eating out' });
    expect(suggestCategory('July salary', 'income')).toEqual({ category: 'salary', word: 'salary' });
    expect(suggestCategory('Salary', 'expense')).toBeNull();                 // an income word on an expense
    expect(suggestCategory('car loan EMI', 'expense')).toBeNull();           // an EMI pays a loan; the form asks which
    expect(suggestCategory('Move savings', 'transfer')).toBeNull();
    expect(suggestCategory('   ', 'expense')).toBeNull();
  });

  it('A6-CAT1-CAT2-001 · the transaction form starts an expense on "Choose category" and asks for a pick', () => {
    const s = read('components/transactions/TransactionFormModal.tsx');
    expect(s).toMatch(/const DEFAULT_CAT_BY_TYPE: Record<TxnType, string> = \{\n\s*expense:\s*'',\n\s*income:\s*'salary',/);
    // A7 PIP2 moved the check into the shared builder; the form marks the field when it refuses.
    expect(read('lib/txnBuild.ts')).toMatch(/if \(!isTransfer && !isInvestment && !form\.category\) return \{ ok: false, error: 'Choose a category', field: 'category' \};/);
    expect(s).toMatch(/if \(built\.field === 'category'\) setCatMissing\(true\);/);
    expect(s).toMatch(/Suggested from “\$\{suggestion\.word\}” · change it if that’s wrong/);
    // The orphan reset never turns "Choose category" into the first option.
    expect(s).toMatch(/if \(form\.category && !cats\.find\(c => c\.id === form\.category\)\)/);
    expect(s).not.toMatch(/cats\[0\]\?\.id/);
  });

  it('A6-CAT3-001 · the household\'s most used categories come first, in a Recently used group', () => {
    const txns: { type: TxnType; category: string; date: string }[] = [
      ...Array.from({ length: 4 }, () => ({ type: 'expense' as TxnType, category: 'groceries', date: '2026-10-10' })),
      ...Array.from({ length: 2 }, () => ({ type: 'expense' as TxnType, category: 'travel', date: '2026-10-12' })),
      { type: 'expense', category: 'utilities', date: '2026-10-01' },
      { type: 'expense', category: 'shopping', date: '2026-01-05' },        // older than 90 days
      { type: 'income', category: 'salary', date: '2026-10-01' },
    ];
    expect(recentCategories(txns, 'expense', '2026-10-15')).toEqual(['groceries', 'travel', 'utilities']);
    expect(recentCategories(txns, 'income', '2026-10-15')).toEqual(['salary']);
    expect(recentCategories(txns, 'transfer', '2026-10-15')).toEqual([]);
    const out = renderToStaticMarkup(<CategoryPicker type="expense" value="" onChange={() => {}} recent={['groceries', 'travel']} />);
    expect(out).toMatch(/<option value="" disabled="" selected="">Choose category<\/option><optgroup label="Recently used"><option value="groceries">🛒 Groceries<\/option><option value="travel">/);
    expect(out).toMatch(/<optgroup label="All categories">/);
    expect(out.match(/value="groceries"/g)).toHaveLength(1);              // listed once
    expect(renderToStaticMarkup(<CategoryPicker type="expense" value="" onChange={() => {}} />)).not.toMatch(/optgroup/);
  });

  it('A6-F1-F2-FRM-001 · amount first, Save & add another beside Save, date/time grid, More details', () => {
    const s = read('components/transactions/TransactionFormModal.tsx');
    const at = (needle: string) => s.indexOf(needle);
    expect(at('<AmountField value={form.amount}')).toBeLessThan(at('<SegmentedControl label="Transaction type"'));
    expect(at('<SegmentedControl label="Transaction type"')).toBeLessThan(at('aria-label="Description"'));
    expect(at('aria-label="Description"')).toBeLessThan(at('testId="txn-category"'));
    expect(s).toMatch(/className="btn-secondary flex-1 disabled:opacity-60">\n\s*Save &amp; add another/);
    expect(s).toMatch(/<div className="grid grid-cols-2 gap-2">\n\s*<input type="date"[^]*?className="input h-\[44px\][^]*?aria-label="Pick a time"/);
    expect(s).toMatch(/data-testid="txn-all-details" aria-expanded=\{showDetails\}/);
    expect(s).toMatch(/form\.excluded \? 'not in totals' : 'counted in totals'/);
  });

  it('A6-FS1-FS2-001 · splits: Equally by default with shares as text; description, category, date as Add transaction', () => {
    const s = read('components/splits/SplitFormModal.tsx');
    expect(s).toMatch(/<SegmentedControl label="How to split" value=\{form\.auto \? 'equal' : 'amount'\}/);
    expect(s).toMatch(/\{form\.auto \? \(\n\s*<span className="num w-24 text-right/);
    expect(s).not.toMatch(/Even \(auto\)|⚖/);
    expect(s.indexOf('aria-label="Description"')).toBeLessThan(s.indexOf('<CategoryPicker'));
    expect(s).toMatch(/const defaultCat = \(type: SplitType\) => \(type === 'income' \? 'salary' : ''\);/);
    expect(s).toMatch(/>Yesterday<\/Chip>/);
  });

  it('A6-FL1-FL2-001 · the loan form in three groups; the standard EMI is a sentence with Use', () => {
    const s = read('components/debts/DebtFormModal.tsx');
    const titles = [...s.matchAll(/<FormSection title="([^"]+)"/g)].map(m => m[1]);
    expect(titles).toEqual(['The loan', 'Repayment', 'Paying it']);
    expect(s).toMatch(/The standard EMI for these terms is \{money\(suggested\)\}\.\{' '\}/);
    expect(s).toMatch(/>Use \{money\(suggested\)\}<\/button>/);
    expect(s).not.toMatch(/standard: \$\{money/);
  });

  it('A6-FA1-001 · liquidity follows the asset type, with Change for the exception', () => {
    const s = read('components/assets/AssetFormModal.tsx');
    expect(s).toMatch(/aria-label="Change liquidity"/);
    expect(s).toMatch(/\{changeLiquidity && \(\n\s*<Field label="Liquidity"/);
    expect(s).toMatch(/setChangeLiquidity\(!!initial && ASSET_TYPES\[initial\.type\]\?\.liquidity !== initial\.liquidity\)/);
  });

  it('A6-AF1-001 · a card\'s cycle as dates: spend window, statement, due', () => {
    expect(cardCycle(18, 5, new Date(2026, 9, 15, 12))).toEqual({
      spendFrom: '2026-09-18', spendTo: '2026-10-17', statement: '2026-10-17', due: '2026-11-05',
    });
    // The due day after the statement in the same month.
    expect(cardCycle(1, 25, new Date(2026, 9, 15, 12))).toEqual({
      spendFrom: '2026-10-01', spendTo: '2026-10-31', statement: '2026-10-31', due: '2026-11-25',
    });
    expect(cardCycle(1, 30, new Date(2026, 0, 15, 12))?.due).toBe('2026-02-28');    // a short month clamps
    expect(cardCycle(0, 5, new Date())).toBeNull();
    expect(read('components/accounts/AccountFormModal.tsx')).toMatch(/\{cycle && \(\n\s*<div className="col-span-2">\n\s*<CycleTimeline cycle=\{cycle\} \/>/);
  });

  it('A6-RC1-RC2-001 · reconcile: both balances in one card, a matched state that marks it reconciled', () => {
    const s = read('components/accounts/ReconcileSheet.tsx');
    expect(s).toMatch(/data-testid="reconcile-compare"/);
    expect(s).toMatch(/>In Vyact<\/div>/);
    expect(s).toMatch(/\{isCash \? 'Cash counted' : 'On your statement'\}/);
    expect(s).toMatch(/✓ Balances match/);
    expect(s).toMatch(/const cta = !hasDrift \? 'Mark reconciled'/);
    // The money path is untouched (W7a): the stated figure is normalised, the toast reports what posted.
    expect(s).toMatch(/statedValue = statedForReconcile\(parseAmountInput\(stated\), account\.kind\)/);
  });

  it('A6-RE1-001 · the recurring editor says what the schedule will do', () => {
    expect(cadence({ freq: 'MONTHLY', interval: 1, byMonthDay: [2] }, 2026)).toBe('every month on the 2nd');
    expect(cadence({ freq: 'MONTHLY', interval: 3, bySetPos: [-1], byDay: [5] }, 2026)).toBe('every quarter on the last Friday');
    expect(cadence({ freq: 'WEEKLY', interval: 1, byDay: [1, 4] }, 2026)).toBe('every week on Monday and Thursday');
    expect(cadence({ freq: 'WEEKLY', interval: 1, byDay: [1, 2, 3, 4, 5] }, 2026)).toBe('every week on weekdays');
    expect(cadence({ freq: 'YEARLY', interval: 1, byMonth: [3], byMonthDay: [31], count: 5 }, 2026)).toBe('every year on 31 Mar, 5 times');
    expect(scheduleSummary({
      amount: '₹28,000', what: 'Rent', rule: { freq: 'MONTHLY', interval: 1, byMonthDay: [2] }, type: 'expense',
      account: 'HDFC Salary', autoConfirm: true, nextDue: '2026-11-02', todayISO: '2026-10-15',
    })).toBe('₹28,000 Rent, every month on the 2nd, from HDFC Salary · posts by itself · next on 2 Nov');
    expect(scheduleSummary({
      amount: '', what: 'Salary', rule: { freq: 'MONTHLY', interval: 1, byMonthDay: [1] }, type: 'income',
      account: 'Cash', autoConfirm: false, nextDue: '2027-01-01', todayISO: '2026-10-15',
    })).toBe('Salary, every month on the 1st, into Cash · asks you first · next on 1 Jan 2027');
  });

  it('A6-RE2-RE3-001 · Post automatically / Ask me first, in What · When · How groups', () => {
    const s = read('pages/Recurring.tsx');
    expect(s).toMatch(/<SegmentedControl label="When it’s due" value=\{autoConfirm \? 'auto' : 'ask'\}/);
    expect(s).toMatch(/label: 'Post automatically'[^]*?label: 'Ask me first'/);
    expect(s).not.toMatch(/Auto-approve this schedule/);
    expect([...s.matchAll(/<FormSection title="([^"]+)"/g)].map(m => m[1])).toEqual(['What', 'When', 'How']);
    expect(s).toMatch(/data-testid="schedule-summary"/);
  });

  it('A6-ON1-001 · onboarding groups digits as you type: lakhs for INR, thousands otherwise, commas only', () => {
    expect(groupDigits('145000', 'INR')).toBe('1,45,000');
    expect(groupDigits('28000', 'INR')).toBe('28,000');
    expect(groupDigits('12345678', 'INR')).toBe('1,23,45,678');
    expect(groupDigits('145000', 'USD')).toBe('145,000');
    expect(groupDigits('1450.5', 'EUR')).toBe('1,450.5');                 // never the currency's own "1.450,5"
    expect(groupDigits('1,45,0001', 'INR')).toBe('14,50,001');            // re-grouped as the digits change
    expect(groupDigits('00012', 'USD')).toBe('12');
    expect(groupDigits('12.345', 'USD')).toBe('12.34');
    expect(groupDigits('abc', 'USD')).toBe('');
    expect(groupedValue('1,45,000')).toBe(145000);
    expect(groupedValue('')).toBe(0);
    const ob = read('pages/Onboarding.tsx');
    expect(ob).toMatch(/onChange=\{e => setIncome\(groupDigits\(e\.target\.value, currency\)\)\}/);
    expect(ob).toMatch(/const incomeAmt = groupedValue\(income\);/);
  });

  it('A6-OB-ON2-001 · currency chips on phones, Pip on neu, the step buttons pinned', () => {
    const ob = read('pages/Onboarding.tsx');
    expect(ob).toMatch(/const COMMON_CURRENCIES = \['INR', 'USD', 'GBP', 'EUR'\];/);
    expect(ob).toMatch(/<Chip onClick=\{\(\) => setMoreCurrencies\(true\)\}>More…<\/Chip>/);
    expect(ob).not.toMatch(/glass-panel/);
    expect(ob).toMatch(/data-testid="pip-bubble"\n\s*style=\{\{ background: 'var\(--canvas\)', boxShadow: 'var\(--neu-sm\)' \}\}/);
    expect(ob).toMatch(/className="sticky bottom-0 z-\[1\][^"]*" data-testid="onboarding-footnav"/);
  });
});
