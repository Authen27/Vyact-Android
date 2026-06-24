// ──────────────────────────────────────────────────────────────────────────
// GOLDEN TEMPLATE — Complex (C) tier
// ──────────────────────────────────────────────────────────────────────────
//
// What "Complex" adds over Medium:
//   • Precision math: interest/principal splits MUST match dinero arithmetic
//     to the cent, not eyeballed decimals. Tolerate ±$0.01 only for the
//     final assertion if the source-of-truth schedule uses banker's
//     rounding (which `lib/amortization.ts` does — see TD-01 notes).
//   • Deep state inspection: we read directly from the in-browser Zustand
//     store via `page.evaluate()` for fields the UI does not surface (the
//     paymentLog entry's `interest` / `principal` breakdown).
//
// DO NOT compute the expected interest/principal in the test by re-deriving
// it from APR — that puts the test and the implementation on the same logic
// and they will silently agree on a bug. Hard-code the dinero-correct value
// from a known-good reference computation (Excel, a calculator, or the
// vitest unit suite under `react/src/lib/__tests__/amortization.test.ts`).
// ──────────────────────────────────────────────────────────────────────────

import { test, expect } from '../fixtures/app';
import { defaultSeed, seedWith, sampleCreditCardDebt } from '../fixtures/seed';

const seed = seedWith({ debts: [sampleCreditCardDebt] });

async function debtSnapshot(page: Parameters<typeof test>[0]['page'], debtId: string) {
  return page.evaluate((id: string) => {
    const win = window as typeof window & {
      __vt_store?: { getState(): { debts: Array<{ id: string; currentBalance: number; minimumPayment: number; remainingMonths?: number; paymentLog?: Array<{ partChoice?: string }> }> } };
      __ff_store?: { getState(): { debts: Array<{ id: string; currentBalance: number; minimumPayment: number; remainingMonths?: number; paymentLog?: Array<{ partChoice?: string }> }> } };
    };
    const store = win.__vt_store ?? win.__ff_store;
    if (!store) throw new Error('Store oracle unavailable');
    const debt = store.getState().debts.find(d => d.id === id);
    if (!debt) return null;
    return {
      currentBalance: debt.currentBalance,
      minimumPayment: debt.minimumPayment,
      remainingMonths: debt.remainingMonths ?? null,
      paymentLogLength: debt.paymentLog?.length ?? 0,
      lastPartChoice: debt.paymentLog?.at(-1)?.partChoice ?? null,
    };
  }, debtId);
}

test.describe('§7 DEBT-FC · Debt Payment Cascading', () => {
  test.describe('creation flow', () => {
    test.use({ seed: defaultSeed });

    test('DEBT-FC-001 · create debt with principal, APR, minimum payment, and tenure', async ({
      page, debts,
    }) => {
      await debts.goto();
      await page.getByRole('button', { name: /add first debt|add debt/i }).first().click();

      const dialog = page.getByRole('dialog', { name: /add debt/i });
      await expect(dialog).toBeVisible();

      await dialog.getByLabel('Name').fill('DEBT-FC-001 Loan');
      await dialog.getByLabel('Lender').fill('Local Bank');
      await dialog.getByLabel('Account').fill('1234');
      await dialog.getByLabel('Current balance').fill('2400');
      await dialog.getByLabel('Original principal').fill('3000');
      await dialog.getByLabel('Interest rate').fill('12.5');
      await dialog.getByLabel('Min. monthly payment').fill('180');
      await dialog.getByLabel('Tenure').fill('18');
      await dialog.getByLabel('Due date').fill('2026-06-15');
      await dialog.getByRole('button', { name: /^Add$/ }).click();

      await expect(dialog).toHaveCount(0);
      await expect(debts.card('DEBT-FC-001 Loan')).toBeVisible();
      await expect(page.getByText('12.5% APR')).toBeVisible();
      await expect(page.getByText('$180.00').first()).toBeVisible();

      const created = await page.evaluate(() => {
        const win = window as typeof window & {
          __vt_store?: { getState(): { debts: Array<{ name: string; principal: number; currentBalance: number; minimumPayment: number; tenureMonths?: number; dueDate?: string }> } };
          __ff_store?: { getState(): { debts: Array<{ name: string; principal: number; currentBalance: number; minimumPayment: number; tenureMonths?: number; dueDate?: string }> } };
        };
        const store = win.__vt_store ?? win.__ff_store;
        if (!store) throw new Error('Store oracle unavailable');
        return store.getState().debts.find(d => d.name === 'DEBT-FC-001 Loan') ?? null;
      });

      expect(created).toMatchObject({
        principal: 3000,
        currentBalance: 2400,
        minimumPayment: 180,
        tenureMonths: 18,
        dueDate: '2026-06-15',
      });
    });
  });

  test.describe('seeded debt payment flows', () => {
    test.use({ seed });

    test('CON-E2E-008 · [DEBT-FC-002] payment splits interest and principal at the configured APR', async ({
      page, debts,
    }) => {
    // ── ARRANGE ─────────────────────────────────────────────────────────────
    // Debt: $5,000 balance, 18.5% APR, $150 minimum payment.
    // Expected at the configured APR with monthly compounding:
    //   monthlyRate    = 0.185 / 12     = 0.01541666…
    //   interestPortion = 5000 * monthlyRate = 77.0833…  → $77.08 (banker)
    //   principalPortion = 150 - 77.08 = $72.92
    //   balanceAfter   = 5000 - 72.92 = $4,927.08
    //
    // These numbers come from `react/src/lib/__tests__/amortization.test.ts`
    // (vitest source of truth). NEVER recompute in this file — that puts
    // test and implementation on the same logic.
    const EXPECTED_INTEREST   = 77.08;
    const EXPECTED_PRINCIPAL  = 72.92;
    const EXPECTED_BALANCE    = 4_927.08;

    await debts.goto();
    await expect(debts.card(sampleCreditCardDebt.name)).toBeVisible();

    // ── ACT ─────────────────────────────────────────────────────────────────
    // TODO(junior): the Record Payment trigger is not yet wired in
    // DebtsPage POM. Once `recordPaymentButton(name)` is confirmed
    // against the real UI, replace this block with the modal-driven
    // interaction. For now, we drive the store action directly via
    // page.evaluate(). The assertion is identical either way — that
    // is the point of using the store as our oracle.
    await page.evaluate(({ debtId, amount }) => {
      // Reach into the Zustand store via the well-known global hook —
      // exposed by `src/store.ts` so DevTools can introspect.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__ff_store;
      if (!store) throw new Error(
        'window.__ff_store not exposed — add it to src/store.ts under a ' +
        '`if (import.meta.env.MODE !== "production")` guard before running.',
      );
      return store.getState().recordDebtPayment(debtId, amount, '2026-05-22');
    }, { debtId: sampleCreditCardDebt.id, amount: 150 });

    // ── ASSERT ──────────────────────────────────────────────────────────────
    // Inspect the debt's `paymentLog` directly. This is the strictest possible
    // assertion: any drift between displayed and stored values gets caught.
    const log = await page.evaluate(({ debtId }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const debts = (window as any).__ff_store.getState().debts;
      type LogEntry = { interest: number; principal: number; outstandingAfter: number };
      type Debt = { id: string; paymentLog?: LogEntry[] };
      const d = debts.find((d: Debt) => d.id === debtId);
      return d?.paymentLog?.at(-1) ?? null;
    }, { debtId: sampleCreditCardDebt.id });

    expect(log).not.toBeNull();
    // ±0.01 tolerance — banker's rounding at the cent.
    expect(log!.interest).toBeCloseTo(EXPECTED_INTEREST,  2);
    expect(log!.principal).toBeCloseTo(EXPECTED_PRINCIPAL, 2);
    expect(log!.outstandingAfter).toBeCloseTo(EXPECTED_BALANCE, 2);

    // UI assertion — the reduced balance ($4,927.08) renders on the Debts
    // page. Kept separate from the store-oracle assertions above so a
    // UI-formatting bug surfaces independently from a store-math bug.
    // (debts.card() resolves to the debt's name node; the balance lives
    // elsewhere in the card, so we assert at page level.)
      await expect(page.getByText(/4,927/).first()).toBeVisible();
    });

    test('DEBT-FC-003 · recording a payment writes linked debt transactions into the transaction list', async ({
      page, debts, transactions,
    }) => {
      await debts.goto();
      await expect(debts.card(sampleCreditCardDebt.name)).toBeVisible();

      await page.evaluate(({ debtId, amount }) => {
        const win = window as typeof window & {
          __vt_store?: { getState(): { recordDebtPayment: (id: string, payment: number, choice?: string) => Promise<unknown> } };
          __ff_store?: { getState(): { recordDebtPayment: (id: string, payment: number, choice?: string) => Promise<unknown> } };
        };
        const store = win.__vt_store ?? win.__ff_store;
        if (!store) throw new Error('Store oracle unavailable');
        return store.getState().recordDebtPayment(debtId, amount);
      }, { debtId: sampleCreditCardDebt.id, amount: 150 });

      await transactions.goto();
      await expect(transactions.row('E2E Credit Card — interest')).toBeVisible();
      await expect(transactions.row('E2E Credit Card — principal')).toBeVisible();

      const linkedRows = await page.evaluate((debtId: string) => {
        const win = window as typeof window & {
          __vt_store?: { getState(): { transactions: Array<{ description: string; linkedDebtId?: string; linkedTxnId?: string; type: string }> } };
          __ff_store?: { getState(): { transactions: Array<{ description: string; linkedDebtId?: string; linkedTxnId?: string; type: string }> } };
        };
        const store = win.__vt_store ?? win.__ff_store;
        if (!store) throw new Error('Store oracle unavailable');
        return store.getState().transactions
          .filter(t => t.linkedDebtId === debtId)
          .map(t => ({ description: t.description, linkedTxnId: t.linkedTxnId ?? null, type: t.type }));
      }, sampleCreditCardDebt.id);

      expect(linkedRows).toHaveLength(2);
      expect(new Set(linkedRows.map(t => t.linkedTxnId)).size).toBe(1);
      expect(linkedRows.map(t => t.description).sort()).toEqual([
        'E2E Credit Card — interest',
        'E2E Credit Card — principal',
      ]);
    });

    test('DEBT-FC-006 · part-payment reduce_tenure shortens remaining months while keeping EMI flat', async ({
      page, debts,
    }) => {
      await debts.goto();
      const before = await debtSnapshot(page, sampleCreditCardDebt.id);
      expect(before).not.toBeNull();

      const result = await page.evaluate(({ debtId, amount }) => {
        const win = window as typeof window & {
          __vt_store?: { getState(): { recordDebtPayment: (id: string, payment: number, choice?: string) => Promise<{ message?: string }> } };
          __ff_store?: { getState(): { recordDebtPayment: (id: string, payment: number, choice?: string) => Promise<{ message?: string }> } };
        };
        const store = win.__vt_store ?? win.__ff_store;
        if (!store) throw new Error('Store oracle unavailable');
        return store.getState().recordDebtPayment(debtId, amount, 'reduce_tenure');
      }, { debtId: sampleCreditCardDebt.id, amount: 500 });

      const after = await debtSnapshot(page, sampleCreditCardDebt.id);
      expect(after).not.toBeNull();
      expect(after!.remainingMonths).toBeLessThan(before!.remainingMonths ?? Number.MAX_SAFE_INTEGER);
      expect(after!.minimumPayment).toBe(before!.minimumPayment);
      expect(after!.lastPartChoice).toBe('reduce_tenure');
      expect(result.message).toMatch(/Loan now ends in \d+ months/);
    });

    test('DEBT-FC-007 · part-payment reduce_emi lowers EMI while tenure ticks down by one month', async ({
      page, debts,
    }) => {
      await debts.goto();
      const before = await debtSnapshot(page, sampleCreditCardDebt.id);
      expect(before).not.toBeNull();

      const result = await page.evaluate(({ debtId, amount }) => {
        const win = window as typeof window & {
          __vt_store?: { getState(): { recordDebtPayment: (id: string, payment: number, choice?: string) => Promise<{ message?: string }> } };
          __ff_store?: { getState(): { recordDebtPayment: (id: string, payment: number, choice?: string) => Promise<{ message?: string }> } };
        };
        const store = win.__vt_store ?? win.__ff_store;
        if (!store) throw new Error('Store oracle unavailable');
        return store.getState().recordDebtPayment(debtId, amount, 'reduce_emi');
      }, { debtId: sampleCreditCardDebt.id, amount: 500 });

      const after = await debtSnapshot(page, sampleCreditCardDebt.id);
      expect(after).not.toBeNull();
      expect(after!.minimumPayment).toBeLessThan(before!.minimumPayment);
      expect(after!.remainingMonths).toBe((before!.remainingMonths ?? 0) - 1);
      expect(after!.lastPartChoice).toBe('reduce_emi');
      expect(result.message).toMatch(/EMI reduced to/);
    });

    test('DEBT-FC-009 · part-payment apply_advance covers future EMIs without changing the EMI amount', async ({
      page, debts,
    }) => {
      await debts.goto();
      const before = await debtSnapshot(page, sampleCreditCardDebt.id);
      expect(before).not.toBeNull();

      const result = await page.evaluate(({ debtId, amount }) => {
        const win = window as typeof window & {
          __vt_store?: { getState(): { recordDebtPayment: (id: string, payment: number, choice?: string) => Promise<{ message?: string }> } };
          __ff_store?: { getState(): { recordDebtPayment: (id: string, payment: number, choice?: string) => Promise<{ message?: string }> } };
        };
        const store = win.__vt_store ?? win.__ff_store;
        if (!store) throw new Error('Store oracle unavailable');
        return store.getState().recordDebtPayment(debtId, amount, 'apply_advance');
      }, { debtId: sampleCreditCardDebt.id, amount: 500 });

      const after = await debtSnapshot(page, sampleCreditCardDebt.id);
      expect(after).not.toBeNull();
      expect(after!.minimumPayment).toBe(before!.minimumPayment);
      expect(after!.remainingMonths).toBeLessThan((before!.remainingMonths ?? 0) - 1);
      expect(after!.lastPartChoice).toBe('apply_advance');
      expect(result.message).toMatch(/EMIs covered in advance/);
    });
  });
});
