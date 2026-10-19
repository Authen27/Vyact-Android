// Aurora 4.0 · A3 confirmations and undo (v10.87.0) — G4 (X6, CF1, CF2, MD1, CF19) and the page
// confirmations CF3–CF20, plus FB1. Each case is named after its change code.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { askSheet, confirmSheet, inputAccepts, useConfirmStore } from '../confirmSheet';
import * as copy from '../confirmCopy';
import { deferCommit, deferredCount, flushDeferred, offerUndo, UNDO_MS } from '../undoable';
import { trimAllocations, budgetTitle } from '../budgetForm';
import { toastLifetimeMs } from '../toastPolicy';

const src = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(src, p), 'utf8').replace(/\r\n/g, '\n');
function codeFiles(dir = src): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : codeFiles(p);
    return /\.(ts|tsx)$/.test(p) ? [relative(src, p).split('\\').join('/')] : [];
  });
}
/** Source with comments and string literals removed, so only real calls count. */
const code = (s: string) => s
  .replace(/\/\*[^]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  // Quoted text on one line (an apostrophe in JSX text closes on its own line), then templates.
  .replace(/'[^'\n]*'|"[^"\n]*"/g, '""')
  .replace(/`[^`]*`/g, '""');

afterEach(() => { useConfirmStore.setState({ current: null }); vi.useRealTimers(); });

describe('A3 · confirmations and undo', () => {
  it('A3-X6-001 · no window.confirm() or window.prompt() is left anywhere in the app', () => {
    for (const f of codeFiles()) {
      // (?!\)\s*:) — a `prompt(): Promise<void>` type member (lib/pwa.ts) is not a call.
      expect(code(read(f)), f).not.toMatch(/(^|[^\w.])(window\.)?(confirm|prompt)\((?!\)\s*:)/);
    }
  });

  it('A3-CF2-001 · the sheet resolves with the answer; a second request cancels the first', async () => {
    const first = confirmSheet({ title: 'Delete A?', action: 'Delete' });
    const second = askSheet({ title: 'Rename?', action: 'Rename', input: { label: 'Name', initial: 'X' } });
    await expect(first).resolves.toBe(false);
    useConfirmStore.getState().current!.resolve({ ok: true, value: 'Home' });
    await expect(second).resolves.toEqual({ ok: true, value: 'Home' });
    expect(useConfirmStore.getState().current).toBeNull();
  });

  it('A3-CF2-002 · inputs gate the action: a 6-digit code, the typed household name, an optional note', () => {
    expect(inputAccepts({ label: 'c', code: true }, '48121')).toBe(false);
    expect(inputAccepts({ label: 'c', code: true }, '481213')).toBe(true);
    expect(inputAccepts({ label: 'n', mustEqual: 'Mehta Family' }, 'mehta family')).toBe(false);
    expect(inputAccepts({ label: 'n', mustEqual: 'Mehta Family' }, ' Mehta Family ')).toBe(true);
    expect(inputAccepts({ label: 'note', optional: true }, '')).toBe(true);
    expect(inputAccepts({ label: 'name' }, '  ')).toBe(false);
  });

  it('A3-MD1-001 · one host renders it: a 460px dialog on desktop, buttons right-aligned, Cancel first', () => {
    const host = read('components/ui/ConfirmHost.tsx');
    expect(host).toMatch(/size="confirm"/);
    expect(read('components/ui/AccessibleDialog.tsx')).toMatch(/confirm: 'sm:max-w-\[460px\]'/);
    expect(host).toMatch(/flex flex-col sm:flex-row-reverse sm:justify-start gap-2/);   // action first in DOM, shown last on desktop
    expect(read('App.tsx')).toMatch(/<ConfirmHost \/>\n {8}<DeferredFlush \/>/);
  });

  it('A3-CF-COPY · every sheet names its item and says what happens and what stays (board copy)', () => {
    expect(copy.deleteTransactionRequest({ name: 'Swiggy', amount: '₹486', where: 'Food & Dining and HDFC Regalia' })).toMatchObject({
      title: 'Delete Swiggy, ₹486?', action: 'Delete entry',
      lines: ['It comes off Food & Dining and HDFC Regalia.', 'Everyone in the household stops seeing it.'],
    });
    const split = copy.deleteSplitRequest({ name: 'Dinner at Toit', amount: '₹1,450', others: ['Priya', 'Arjun'], canClose: true });
    expect(split.lines).toEqual(['Removes the ₹1,450 entry and your share.', 'Priya and Arjun lose the share sent to them.']);
    expect(split.choices?.[0]).toMatchObject({ value: 'close', recommended: true, action: 'Close split' });
    expect(copy.deleteSplitRequest({ name: 'X', amount: '₹1', others: [], canClose: false }).choices).toBeUndefined();
    expect(copy.closeSplitRequest({ name: 'Dinner at Toit', others: ['Priya', 'Arjun'] }).lines?.[0]).toBe('Priya and Arjun are told it is closed.');
    expect(copy.deleteBudgetRequest({ label: 'Oct 2026', allocations: 6, spent: '₹11,000', period: 'October spending' })).toMatchObject({
      title: 'Delete Oct 2026 budget?', lines: ['Its 6 category allocations are removed.', "Your ₹11,000 of October spending stays; it just isn't tracked against a budget."],
    });
    expect(copy.deleteScheduleRequest({ name: 'Netflix', made: 9 }).lines).toEqual(['No more Netflix entries will be created or suggested.', 'The 9 entries it already made stay in Transactions.']);
    expect(copy.undoLoanPaymentRequest({ date: '15 Sep', amount: '₹12,900', interest: '₹4,480', principal: '₹8,420', loan: 'Car loan', owedAfter: '₹5,93,820' })).toMatchObject({
      title: 'Undo the 15 Sep payment?', lines: ['Removes the ₹12,900 payment: ₹4,480 interest and ₹8,420 principal.', 'Car loan goes back to ₹5,93,820 owed.'],
    });
    const paidOff = copy.markPaidOffRequest({ name: 'Car loan', writeOff: '₹1,200' });
    expect(paidOff).toMatchObject({ tone: 'primary', action: 'Mark paid off', input: { optional: true, initial: 'Closed with the bank' } });
    expect(copy.deleteLoanRequest({ name: 'Car loan', payments: 19, paidUp: true }).choices?.[0]).toMatchObject({ value: 'paidoff', recommended: true });
    expect(copy.deleteAssetRequest({ name: 'Plot · Nashik', value: '₹8,50,050' }).lines?.[0]).toBe('Net worth drops by ₹8,50,050.');
    expect(copy.removeMemberRequest({ name: 'Asha Mehta', household: 'Mehta Family' }).lines).toEqual(['They lose access to Mehta Family.', 'Entries they added stay, under their name.']);
    expect(copy.leaveHouseholdRequest({ household: 'Mehta Family' }).action).toBe('Leave household');
    expect(copy.deleteHouseholdRequest({ household: 'Mehta Family' }).input).toMatchObject({ mustEqual: 'Mehta Family' });
    expect(copy.verificationCodeRequest({ email: 'a@b.c', action: 'erase all household data', resend: async () => undefined })).toMatchObject({
      title: 'Enter the code we emailed', input: { code: true }, resend: { seconds: 45 }, tone: 'primary',
    });
    expect(copy.deactivateRequest().lines?.[1]).toMatch(/kept as it is/);
    expect(copy.unlinkWhatsAppRequest({ phone: '•••• 4410' }).lines?.[0]).toBe('Messages to Pip from •••• 4410 stop being recorded.');
  });

  it('A3-CF-SITES · each page asks through the sheet with its own copy', () => {
    const uses: [string, RegExp][] = [
      ['components/transactions/TransactionFormModal.tsx', /deleteTransactionRequest\(/],
      ['pages/Splits.tsx', /deleteSplitRequest\([^]*closeSplitRequest\(/],
      ['components/splits/SplitFormModal.tsx', /deleteSplitRequest\(/],
      ['pages/Budgets.tsx', /deleteBudgetRequest\(/],
      ['components/budgets/BudgetFormModal.tsx', /deleteBudgetRequest\(/],
      ['pages/Recurring.tsx', /deleteScheduleRequest\(/],
      ['pages/Debts.tsx', /undoLoanPaymentRequest\([^]*markPaidOffRequest\([^]*deleteLoanRequest\(/],
      ['components/debts/DebtFormModal.tsx', /deleteLoanRequest\(/],
      ['pages/NetWorth.tsx', /deleteAssetRequest\(/],
      ['components/assets/AssetFormModal.tsx', /deleteAssetRequest\(/],
      // A7 HH2 — the name is a field in Household settings now (Save, no sheet), so rename asks nothing.
      ['pages/Households.tsx', /leaveHouseholdRequest\([^]*deleteHouseholdRequest\([^]*removeMemberRequest\(/],
      ['pages/Settings.tsx', /verificationCodeRequest\([^]*eraseDataRequest\(\)[^]*deactivateRequest\(\)[^]*deleteAccountRequest\(\)/],
      ['components/whatsapp/useWhatsAppLink.ts', /unlinkWhatsAppRequest\(/],
    ];
    for (const [f, re] of uses) expect(read(f), f).toMatch(re);
  });

  it('A3-CF1-001 · reversible actions do not ask: skip a bill (Undo restores it), sign out', () => {
    const cal = read('components/recurring/BillCalendar.tsx');
    expect(cal).toMatch(/offerUndo\(toast, `\$\{item\.description \|\| 'Bill'\} skipped for \$\{formatDate\(item\.date, dateFormat\)\}`, \(\) => unskipRecurring\(schedule\)\)/);
    const slice = read('store/slices/recurringSlice.ts');
    expect(slice).toMatch(/if \(!current \|\| current\.nextDueDate !== advanceSchedule\(before\)\.nextDueDate\) return false;/);
    expect(slice).toMatch(/upsertRecurring\(\{ \.\.\.before, updated_at: current\.updated_at \}\)/);
    // v10.95.0 (owner decision 13 Oct 2026; R4): revoking an invite is no longer held for Undo. It asks,
    // then revokes at once (invitationsInBell.test.ts INV-B-008).
    expect(read('pages/Households.tsx')).toMatch(/confirmSheet\(revokeInvitationRequest\(/);
    expect(read('components/layout/AccountMenu.tsx')).toMatch(/CF19[^\n]*\n\s*try \{ await authSignOut\(\); \}/);
  });

  it('A3-CF1-002 · an Undo toast stays 8 s; a held action commits after 8 s, on navigation, never on Undo', async () => {
    vi.useFakeTimers();
    expect(toastLifetimeMs('info', true)).toBe(UNDO_MS);
    const toast = vi.fn();
    const commit = vi.fn();
    const undone = vi.fn();
    deferCommit(toast, 'Invitation link revoked', commit, undone);
    expect(toast).toHaveBeenCalledWith('Invitation link revoked', 'info', expect.objectContaining({ label: 'Undo' }));
    vi.advanceTimersByTime(UNDO_MS - 1);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    expect(commit).toHaveBeenCalledTimes(1);

    // Undo cancels the commit and restores the row.
    const commit2 = vi.fn();
    deferCommit(toast, 'x', commit2, undone);
    toast.mock.calls.at(-1)![2].run();
    vi.advanceTimersByTime(UNDO_MS * 2);
    expect(commit2).not.toHaveBeenCalled();
    expect(undone).toHaveBeenCalledTimes(1);

    // Navigation commits whatever is held, at once.
    const commit3 = vi.fn();
    deferCommit(toast, 'y', commit3);
    expect(deferredCount()).toBe(1);
    await flushDeferred();
    expect(commit3).toHaveBeenCalledTimes(1);
    expect(deferredCount()).toBe(0);
    expect(read('components/layout/DeferredFlush.tsx')).toMatch(/void flushDeferred\(\);\n {2}\}, \[pathname\]\);/);

    const undo = vi.fn();
    offerUndo(toast, 'Netflix skipped for 10 Oct', undo);
    toast.mock.calls.at(-1)![2].run();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('A3-FB1-001 · over the total shows while editing, with Raise total and Trim; Save no longer asks', () => {
    const form = read('components/budgets/BudgetFormModal.tsx');
    expect(code(form)).not.toMatch(/\bconfirm\(/);   // no "Save anyway?" box at Save
    expect(form).toMatch(/data-testid="budget-over-total"/);
    expect(form).toMatch(/Raise total to \{fmt\(allocSum, form\.currency\)\}/);
    expect(form).toMatch(/Trim allocations/);
    // Trim keeps each line's share, lands exactly on the total, never below 0, leaves 0-lines alone.
    const lines = [12000, 7000, 6000, 4500, 4000, 4500];
    const trimmed = trimAllocations(lines, 36000);
    expect(Math.round(trimmed.reduce((s, a) => s + a, 0) * 100)).toBe(3600000);   // exactly the total
    trimmed.forEach((a, i) => {
      expect(a).toBeLessThanOrEqual(lines[i]);
      expect(Math.abs(a - lines[i] * (36000 / 38000))).toBeLessThan(0.1);           // keeps each line's share
      expect(Math.abs(a * 100 - Math.round(a * 100))).toBeLessThan(1e-6);             // whole hundredths
    });
    const t = trimAllocations([100, 50, 0, 25.55], 100);
    expect(Math.round(t.reduce((s, a) => s + a, 0) * 100)).toBe(10000);
    expect(t[2]).toBe(0);
    expect(trimAllocations([10, 20], 50)).toEqual([10, 20]);   // not over: unchanged
    expect(budgetTitle({ scope: 'month', periodYear: 2026, periodMonth: 10 })).toBe('Oct 2026');
    expect(budgetTitle({ scope: 'annual', periodYear: 2026 })).toBe('2026');
  });
});
