// Aurora 4.0 · A7 Insights, Pip, Households, Settings (v10.106.0) — INS2, LN1, LN3, P1, P2, PIP1–PIP4,
// HH1, HH2, ST1, ST2, MIST3 and the X1/X9 sweep on these pages. Each case is named after its change code.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTxn, defaultMemberIdFor, undoableNewTxn, type TxnFormInput } from '../txnBuild';
import type { Member, Transaction } from '../../types';

const src = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(src, p), 'utf8').replace(/\r\n/g, '\n');

const base: TxnFormInput = {
  type: 'expense', amount: '450', currency: 'INR', date: '2026-10-15', time: '09:30', description: ' Swiggy ',
  category: 'food_dining', note: '', memberId: 'm1', paymentMethod: 'cash', paymentMethodTo: '', paymentMode: '',
  direction: 'added', linkedDebtId: '', recurring: '', excluded: false,
};
const ctx = { initial: null, payingModes: [] as const, newId: () => 'new-id' };

describe('A7 · PIP2 — one build-and-check for the form and Pip', () => {
  it('A7-PIP2-001 · a plain expense is built as the form built it', () => {
    const r = buildTxn(base, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.loan).toBeUndefined();
    expect(r.txn).toMatchObject({
      id: 'new-id', type: 'expense', amount: 450, currency: 'INR', date: '2026-10-15', time: '09:30',
      description: 'Swiggy', category: 'food_dining', memberId: 'm1', paymentMethod: 'cash',
    });
    expect(r.txn.paymentMode).toBeUndefined();               // modes unknown → never written
    expect(buildTxn({ ...base, paymentMode: 'upi' }, { ...ctx, payingModes: ['upi', 'card'] }).ok && (buildTxn({ ...base, paymentMode: 'upi' }, { ...ctx, payingModes: ['upi', 'card'] }) as { txn: Transaction }).txn.paymentMode).toBe('upi');
    const notStated = buildTxn(base, { ...ctx, payingModes: ['upi'] });
    expect(notStated.ok && notStated.txn.paymentMode).toBeNull();     // "Not specified" with known modes
  });

  it('A7-PIP2-002 · it refuses what the form refuses, in the form\'s order and words', () => {
    const refuse = (f: Partial<TxnFormInput>) => { const r = buildTxn({ ...base, ...f }, ctx); return r.ok ? null : [r.error, r.field]; };
    expect(refuse({ amount: '0' })).toEqual(['Enter a valid amount greater than 0', 'amount']);
    expect(refuse({ amount: 'abc' })).toEqual(['Enter a valid amount greater than 0', 'amount']);
    expect(refuse({ time: '' })).toEqual(['Pick a time for this transaction', 'time']);
    expect(refuse({ category: '' })).toEqual(['Choose a category', 'category']);
    expect(refuse({ category: 'loan_emi' })).toEqual(['Choose which loan this EMI pays', 'loan']);
    expect(refuse({ paymentMethod: '' })).toEqual(['Choose an Account (cash, bank or card) for this transaction', 'account']);
    expect(refuse({ type: 'transfer', category: '' })).toEqual(['Choose a destination Account', 'destination']);
    expect(refuse({ type: 'transfer', category: '', paymentMethodTo: 'cash' })).toEqual(['Source and destination must be different accounts', 'destination']);
    expect(refuse({ type: 'investment', category: '', paymentMethod: 'asset:b1' })).toEqual(['Choose an Investment Vehicle', 'destination']);
  });

  it('A7-PIP2-003 · a new Loan / EMI entry is a loan payment (payLoan), never a plain upsert', () => {
    const r = buildTxn({ ...base, category: 'loan_emi', linkedDebtId: 'loan-1', paymentMethod: 'asset:bank-1', description: 'Car EMI' }, ctx);
    expect(r.ok && r.loan).toEqual({ debtId: 'loan-1', fundingAccountId: 'asset:bank-1', amount: 450, date: '2026-10-15', description: 'Car EMI', memberId: 'm1' });
    // An edit of an existing EMI leg is not a new payment.
    const edit = buildTxn({ ...base, category: 'loan_emi', linkedDebtId: 'loan-1' }, { ...ctx, initial: { id: 'old', type: 'expense', amount: 450, currency: 'INR', date: '2026-10-01', description: '', category: 'loan_emi' } as Transaction });
    expect(edit.ok && edit.loan).toBeUndefined();
  });

  it('A7-PIP2-004 · transfers and investments keep their account matrix; an edit is a patch', () => {
    const t = buildTxn({ ...base, type: 'transfer', category: 'food_dining', paymentMethod: 'cash', paymentMethodTo: 'asset:b1' }, ctx);
    expect(t.ok && t.txn).toMatchObject({ category: '', paymentMethod: 'cash', linkedToAssetId: 'asset:b1' });
    const out = buildTxn({ ...base, type: 'investment', category: '', direction: 'withdrew', paymentMethod: 'asset:b1', paymentMethodTo: 'fund-1' }, ctx);
    expect(out.ok && out.txn).toMatchObject({ category: '', assetId: 'fund-1', toAccountId: 'asset:b1', paymentMethod: undefined, accountId: undefined });
    const initial = { id: 'r1', type: 'expense', amount: 10, currency: 'INR', date: '2026-10-01', description: 'x', category: 'groceries',
      recurringScheduleId: 'sch-1', accountId: 'acc-old', updated_at: '2026-10-01T00:00:00Z' } as Transaction;
    const patched = buildTxn(base, { ...ctx, initial });
    expect(patched.ok && patched.txn).toMatchObject({ id: 'r1', recurringScheduleId: 'sch-1', accountId: undefined, updated_at: '2026-10-01T00:00:00Z' });
  });

  it('A7-PIP2-005 · the member and the Undo rule are the form\'s', () => {
    const members = [{ id: 'a', name: 'Asha', userId: 'u-a' }, { id: 'b', name: 'Ravi' }] as Member[];
    expect(defaultMemberIdFor(members, 'u-a', '')).toBe('a');
    expect(defaultMemberIdFor(members, undefined, ' ravi ')).toBe('b');
    expect(defaultMemberIdFor(members, undefined, 'Nobody')).toBe('a');
    expect(defaultMemberIdFor([], undefined, '')).toBe('');
    expect(undoableNewTxn(null, 'expense', 'groceries')).toBe(true);
    expect(undoableNewTxn(null, 'expense', 'loan_emi')).toBe(false);
    expect(undoableNewTxn(null, 'transfer', '')).toBe(false);
  });

  it('A7-PIP2-006 · the form and Pip\'s card both build through txnBuild; Pip confirms in the chat', () => {
    const form = read('components/transactions/TransactionFormModal.tsx');
    expect(form).toMatch(/const built = buildTxn\(form, \{ initial, payingModes, newId: uid \}\);/);
    expect(form).not.toMatch(/toast\('Choose an Account \(cash, bank or card\)/);   // the checks live in one place
    const card = read('components/chat/CaptureCard.tsx');
    expect(card).toMatch(/const built = buildTxn\(form, \{ initial: null, payingModes: modes, newId: uid \}\);/);
    expect(card).toMatch(/await runExclusive\(slot,/);
    expect(card).toMatch(/payLoan\(\{ operationId: loanOperation\.current, kind: 'emi', \.\.\.built\.loan \}\)/);
    const chat = read('pages/Chat.tsx');
    expect(chat).toMatch(/if \(turn\.seed\.split\) openAddTxn\(turn\.seed\);\n\s*else patchTurn\(\{ capture: \{ seed: turn\.seed \} \}\);/);
    expect(chat).toMatch(/<CaptureCard seed=\{m\.capture\.seed\}/);
  });
});

describe('A7 · Pip page', () => {
  const chat = read('pages/Chat.tsx');
  it('A7-PIP1-001 · a failed turn says nothing was saved, offers Try again and keeps the question', () => {
    expect(chat).not.toMatch(/content: `Error: \$\{/);
    expect(chat).toMatch(/I couldn’t answer that just now, and nothing was saved\./);
    expect(chat).toMatch(/setInput\(cur => cur \|\| question\);/);
    expect(chat).toMatch(/data-testid="ask-retry"/);
  });
  it('A7-P1-P2-PIP3-PIP4-001 · full-height on desktop, raised chips, Ask next, a listening strip', () => {
    expect(chat).toMatch(/lg:h-\[calc\(100dvh-8\.5rem\)\]/);
    expect(chat.match(/className=\{CHIP_CLASS\} style=\{CHIP_STYLE\}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(chat).toMatch(/<div className="ui-label mb-1\.5">Ask next<\/div>/);
    expect(chat).not.toMatch(/<span className="block text-xs text-ink-dim mt-1">Use question<\/span>/);
    expect(chat).toMatch(/data-testid="ask-listening"/);
    expect(chat).toMatch(/placeholder="Ask me anything…"/);
  });
});

describe('A7 · Insights, Households, Settings', () => {
  it('A7-INS2-LN-001 · one action per insight; suggested lessons; one row of 40px chips on phones', () => {
    const ins = read('pages/Insights.tsx');
    expect(ins).toMatch(/<OverflowMenu ariaLabel=\{`More for \$\{item\.title\}`\} items=\{more\} \/>/);
    expect(ins).not.toMatch(/<summary[^>]*>Calculation basis<\/summary>/);
    expect(ins).toMatch(/reason: `Because of “\$\{item\.title\}”`/);
    const learn = read('components/insights/EvergreenLearn.tsx');
    expect(learn).toMatch(/data-testid="learn-suggested"/);
    expect(learn).toMatch(/flex-nowrap overflow-x-auto[^"]*sm:flex-wrap/);
    expect(learn).toMatch(/h-10 px-3\.5 rounded-pill/);
  });
  it('A7-HH1-HH2-001 · activity filters are chips; the name is a field in Household settings', () => {
    const hh = read('pages/Households.tsx');
    expect(hh).toMatch(/<Chip key=\{f\.value\} on=\{activityType === f\.value\}/);
    expect(hh).not.toMatch(/bg-coral text-\[color:var\(--accent-ink\)\]/);
    expect(hh).toMatch(/<HouseholdNameField name=\{active\.name\} disabled=\{!can\(myRole, 'edit_household_settings'\)\}/);
    expect(hh).not.toMatch(/Rename household/);
  });
  it('A7-ST1-ST2-MIST3-001 · Profile as rows, WhatsApp under Connections, real theme previews', () => {
    const st = read('pages/Settings.tsx');
    expect(st).toMatch(/<SettingsGroup caption="Profile">[^]*?label="Display name"[^]*?label="Email"[^]*?label="Date format"/);
    expect(st).not.toMatch(/Save Profile/);
    expect(st).toMatch(/<SettingsGroup caption="Connections">[^]*?<WhatsAppLink embedded \/>/);
    expect(st).toMatch(/<div data-theme=\{theme\}/);
    expect(st).toMatch(/<ThemePreview theme="dark" \/><\/div><div className="w-1\/2"><ThemePreview theme="warm" \/>/);
    expect(read('components/settings/WhatsAppLink.tsx')).toMatch(/return embedded \? body : <Panel title="WhatsApp">\{body\}<\/Panel>;/);
  });
  it('A7-X1-X9-001 · these pages use sans labels and no text under 11px', () => {
    for (const f of ['pages/Insights.tsx', 'pages/Chat.tsx', 'pages/Households.tsx', 'pages/Settings.tsx', 'pages/Help.tsx',
      'components/insights/EvergreenLearn.tsx', 'components/settings/WhatsAppLink.tsx', 'components/chat/CaptureCard.tsx']) {
      const s = read(f);
      expect(s, f).not.toMatch(/font-mono[^"`]*uppercase|uppercase[^"`]*font-mono/);
      expect(s, f).not.toMatch(/text-\[(?:[0-9]|10)(?:\.\d+)?px\]/);
      expect(s, f).not.toMatch(/text-\[0\.(?:[0-5]\d*|6[0-7]?)rem\]/);
    }
  });
});

describe('A7 · owner follow-ups (16 Oct 2026)', () => {
  it('A7-MENU-001 · the ⋯ menu is drawn in a portal at a fixed position, so a clipping card cannot hide it', () => {
    const s = read('components/ui/OverflowMenu.tsx');
    expect(s).toMatch(/createPortal\(/);
    expect(s).toMatch(/className="glass-panel fixed z-\[300\]/);
    expect(s).toMatch(/const flip = below < height \+ GAP \+ 96 && r\.top > height \+ GAP;/);
    expect(s).toMatch(/!trigger\.current\?\.contains\(t\) && !menu\.current\?\.contains\(t\)/);   // a tap in the menu is not "outside"
    expect(read('pages/Debts.tsx')).toMatch(/className=\{`rounded-r3 overflow-hidden/);       // the card that clipped it
  });

  it('A7-LEARN-001 · the Dashboard shelf picks for the household: loan, over budget, then saving, rotating weekly', async () => {
    const { dashboardLessons, lessonPreview } = await import('../learnPicks');
    const card = (id: string, tags: string[], category = 'Saving') =>
      ({ id, title: id, category, tags, body_md: 'One. Two.', reading_seconds: 60 }) as never;
    const lib = [card('d1', ['debt'], 'Debt'), card('d2', ['debt'], 'Debt'), card('b1', ['budgeting'], 'Budgeting'),
      card('s1', ['saving']), card('h1', ['household']), card('in', ['debt'], 'India'), card('t1', ['debt', 'tax'], 'Debt')];
    const ids = (p: { card: { id: string } }[]) => p.map(x => x.card.id);
    const all = { hasDebt: true, overBudget: true, hasBudget: true };
    expect(ids(dashboardLessons(all, '2026-10-12', 3, lib))).toEqual(['d1', 'b1', 's1']);          // week 40: even
    expect(ids(dashboardLessons(all, '2026-10-19', 3, lib))).toEqual(['d2', 'b1', 's1']);          // the next week rotates
    expect(dashboardLessons(all, '2026-10-12', 3, lib).map(p => p.reason)).toEqual([
      'Because you’re repaying a loan', 'Because a budget is over this month', 'For building a safety cushion']);
    expect(ids(dashboardLessons({ hasDebt: false, overBudget: false, hasBudget: false }, '2026-10-12', 3, lib))).toEqual(['b1', 's1', 'h1']);
    // Never a one-country lesson or a tax one (owner positioning rule).
    expect(ids(dashboardLessons(all, '2026-10-12', 7, lib))).not.toEqual(expect.arrayContaining(['in']));
    expect(ids(dashboardLessons(all, '2026-10-12', 7, lib))).not.toEqual(expect.arrayContaining(['t1']));
    expect(lessonPreview('**Save** a little. Then more.')).toBe('Save a little.');
    expect(lessonPreview('word '.repeat(60), 40).endsWith('…')).toBe(true);
    expect(lessonPreview('See [the guide](https://x.y) now')).toBe('See the guide now');
  });

  it('A7-LEARN-002 · the shelf is the last Dashboard section, loaded lazily, opening lessons in place', () => {
    const dash = read('pages/Dashboard.tsx');
    expect(dash).toMatch(/const LearnShelf = lazy\(\(\) => import\('\.\.\/components\/dashboard\/LearnShelf'\)\);/);
    expect(dash).toMatch(/<LearnShelf situation=\{learnSituation\} todayISO=\{today\(\)\} \/>\n\s*<\/Suspense>\n\s*<\/div>\n\s*\);\n\}/);
    const shelf = read('components/dashboard/LearnShelf.tsx');
    expect(shelf).toMatch(/<EvergreenReel cards=\{picks\.map\(p => p\.card\)\} startIndex=\{open\}/);
    expect(shelf).toMatch(/to="\/insights\?tab=learn"/);
  });
});
