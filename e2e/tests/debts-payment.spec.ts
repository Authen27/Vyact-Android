// ──────────────────────────────────────────────────────────────────────────
// GOLDEN TEMPLATE — Complex (C) tier · W4f (v10.75.0; owner decision D19)
// ──────────────────────────────────────────────────────────────────────────
//
// A loan is paid from its own Pay sheet. The split is decided by pay_loan's rules (in this local-only
// run, the same rules in the store: lib/loanSchedule.ts, parity-tested against Postgres): interest
// first — outstanding × APR/12, banker's rounding to the cent — then principal.
//
// DO NOT compute the expected interest/principal in the test by re-deriving it from APR — that puts the
// test and the implementation on the same logic and they will silently agree on a bug. The figures
// below are hard-coded from a hand calculation:
//   $5,000 × 18.5% / 12 = $77.0833…  → $77.08 interest; $150 − $77.08 = $72.92 principal.
//
// Retired with the old command: DEBT-FC-009 ("apply advance"). Paying ahead is a prepayment now, which
// either finishes the loan sooner or lowers the EMI (DEBT-FC-006 / 007); the owner's model has no third way.
// ──────────────────────────────────────────────────────────────────────────

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/app';
import { defaultSeed, seedWith, sampleLoanDebt } from '../fixtures/seed';

const seed = seedWith({ debts: [sampleLoanDebt] });

type StoreDebt = { id: string; name: string; principal: number; currentBalance: number; minimumPayment: number; tenureMonths?: number;
  dueDate?: string; firstEmiDate?: string; instalmentsPaid?: number };
type StoreTxn = { id: string; description: string; type: string; amount: number; linkedDebtId?: string; linkedTxnId?: string };

async function storeState(page: Page) {
  return page.evaluate(() => {
    const win = window as typeof window & {
      __vt_store?: { getState(): { debts: StoreDebt[]; transactions: StoreTxn[] } };
      __ff_store?: { getState(): { debts: StoreDebt[]; transactions: StoreTxn[] } };
    };
    const store = win.__vt_store ?? win.__ff_store;
    if (!store) throw new Error('Store oracle unavailable');
    const { debts, transactions } = store.getState();
    return { debts, transactions };
  });
}

/** Pay from the loan's own sheet: choose the kind, the amount, and record it. */
async function payFromSheet(page: Page, loanName: string, kind: 'EMI' | 'Prepay', amount?: string, choice?: 'Finish sooner' | 'Lower the EMI') {
  await page.getByRole('button', { name: 'Pay', exact: true }).filter({ visible: true }).first().click();
  const sheet = page.getByRole('dialog', { name: `Pay ${loanName}` });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('loan-pay-explainer')).toBeVisible();
  if (kind === 'Prepay') await sheet.getByRole('radio', { name: 'Prepay', exact: true }).check();
  if (amount) await sheet.getByRole('textbox').first().fill(amount);
  if (choice) await sheet.getByRole('radio', { name: choice, exact: true }).check();
  await sheet.getByRole('button', { name: /record (payment|prepayment)/i }).click();
  await expect(sheet).toHaveCount(0);
}

test.describe('§7 DEBT-FC · Loan payments', () => {
  test.describe('creation flow', () => {
    test.use({ seed: defaultSeed });

    test('DEBT-FC-001 · create a loan with its terms: sanctioned, still owed, APR, EMI, tenure, EMI dates', async ({ page, debts }) => {
      await debts.goto();
      await page.getByRole('button', { name: /add (a )?loan/i }).first().click();

      const dialog = page.getByRole('main', { name: /add loan/i });
      await expect(dialog).toBeVisible();

      await dialog.getByLabel('Name').fill('DEBT-FC-001 Loan');
      await dialog.getByLabel('Lender').fill('Local Bank');
      await dialog.getByLabel('Account').fill('1234');
      await dialog.getByLabel('Sanctioned amount').fill('3000');
      await dialog.getByLabel('Still owed').fill('2400');
      await dialog.getByLabel('Interest rate').fill('12.5');
      await dialog.getByLabel('Tenure').fill('18');
      await dialog.getByLabel('EMI', { exact: true }).fill('180');
      await dialog.getByLabel('First EMI date').fill('2026-01-15');
      await dialog.getByLabel('Next EMI date').fill('2026-06-15');
      await dialog.getByRole('button', { name: /^Add$/ }).click();

      await expect(dialog).toHaveCount(0);
      await expect(debts.card('DEBT-FC-001 Loan')).toBeVisible();
      await expect(page.getByText(/12\.5% APR/).filter({ visible: true }).first()).toBeVisible();

      const created = (await storeState(page)).debts.find(d => d.name === 'DEBT-FC-001 Loan') ?? null;
      expect(created).toMatchObject({
        principal: 3000, currentBalance: 2400, minimumPayment: 180, tenureMonths: 18,
        firstEmiDate: '2026-01-15', dueDate: '2026-06-15', instalmentsPaid: 5,
      });
    });
  });

  test.describe('seeded loan payment flows', () => {
    test.use({ seed });

    test('CON-E2E-008 · [DEBT-FC-002] an EMI splits interest and principal at the configured APR', async ({ page, debts }) => {
      const EXPECTED_INTEREST  = 77.08;
      const EXPECTED_PRINCIPAL = 72.92;

      await debts.goto();
      await expect(debts.card(sampleLoanDebt.name)).toBeVisible();
      await payFromSheet(page, sampleLoanDebt.name, 'EMI');      // prefilled with the EMI due: $150

      const { debts: after, transactions } = await storeState(page);
      const legs = transactions.filter(t => t.linkedDebtId === sampleLoanDebt.id);
      expect(legs.find(t => t.type === 'expense')?.amount).toBe(EXPECTED_INTEREST);
      expect(legs.find(t => t.type === 'transfer')?.amount).toBe(EXPECTED_PRINCIPAL);
      expect(after.find(d => d.id === sampleLoanDebt.id)).toMatchObject({ currentBalance: 4927.08, instalmentsPaid: 1, dueDate: '2026-07-15' });
      // The outstanding on the page is the loan account's ledger.
      await expect(page.getByText(/4,927/).first()).toBeVisible();
    });

    test('DEBT-FC-003 · a payment writes its two linked entries into the transaction list', async ({ page, debts, transactions }) => {
      await debts.goto();
      await payFromSheet(page, sampleLoanDebt.name, 'EMI');

      await transactions.goto();
      // loan_emi is a system split: the interest is a visible Loan / EMI expense; the principal moves
      // money into the loan account.
      await expect(transactions.row('E2E Personal Loan EMI - principal')).toBeVisible();
      // Track E (v10.97.0): the principal leg now also reads "counted in Loan / EMI spending", so match
      // the interest expense by its own category icon, not by the text both rows now share.
      await expect(page.getByRole('button', { name: /^💳 E2E Personal Loan EMI/ })).toBeVisible();

      const linked = (await storeState(page)).transactions.filter(t => t.linkedDebtId === sampleLoanDebt.id);
      expect(linked).toHaveLength(2);
      const ids = new Set(linked.map(t => t.id));
      expect(linked.filter(t => t.linkedTxnId && ids.has(t.linkedTxnId))).toHaveLength(1);
      expect(linked.map(t => t.description).sort()).toEqual(['E2E Personal Loan EMI', 'E2E Personal Loan EMI - principal']);
    });

    test('DEBT-FC-006 · a prepayment that finishes sooner keeps the EMI and is all principal', async ({ page, debts }) => {
      await debts.goto();
      await payFromSheet(page, sampleLoanDebt.name, 'Prepay', '500', 'Finish sooner');
      const { debts: after, transactions } = await storeState(page);
      expect(after.find(d => d.id === sampleLoanDebt.id)).toMatchObject({ currentBalance: 4500, minimumPayment: 150, instalmentsPaid: 0 });
      const legs = transactions.filter(t => t.linkedDebtId === sampleLoanDebt.id);
      expect(legs.map(t => [t.type, t.amount])).toEqual([['transfer', 500]]);
    });

    test('DEBT-FC-007 · a prepayment that lowers the EMI keeps the end date', async ({ page, debts }) => {
      await debts.goto();
      await payFromSheet(page, sampleLoanDebt.name, 'Prepay', '500', 'Lower the EMI');
      const after = (await storeState(page)).debts.find(d => d.id === sampleLoanDebt.id)!;
      expect(after.currentBalance).toBe(4500);
      expect(after.minimumPayment).toBeLessThan(150);
    });
  });
});
