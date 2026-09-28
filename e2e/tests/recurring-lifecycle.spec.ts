import { test, expect } from '../fixtures/app';
import { defaultSeed } from '../fixtures/seed';

// ── Lane A · Recurring schedule lifecycle ────────────────────────────────────
//
// Written in response to the 2026-09-08 report: newly created schedules
// duplicated on refresh, then vanished, and one "appeared as a transaction for
// the current day". Three defects sat behind that, and none of them had a test:
//
//   1. The save path computed nextDueDate by stepping ONE period on from the
//      schedule's startDate. Creating on the 8th for the 20th produced the 20th
//      of NEXT month; editing an old schedule produced a date months in the
//      PAST, which the engine then materialised as a back-dated transaction on
//      every refresh.
//   2. The re-key migration changed a schedule's primary key without evicting
//      the old one, so the next load listed both.
//   3. The form had no account field at all, so every generated transaction was
//      rejected by `ck_txn_accounts_by_type` (23514) and never left the device.
//
// The clock is pinned to FIXED_NOW (2026-05-22) by the app fixture, so "this
// month" below means May 2026.

const DOM = 28;              // safely after the 22nd, so it is still ahead
const PAST_DOM = 2;          // safely before the 22nd, so it must roll forward

async function openForm(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '+ Add Schedule' }).click();
  await expect(page.getByRole('heading', { name: 'Add Recurring Schedule' })).toBeVisible();
}

async function fillSchedule(
  page: import('@playwright/test').Page,
  opts: { name: string; amount: string; dom: number; account: string },
) {
  await page.getByLabel('Description').fill(opts.name);
  await page.getByLabel('Amount').fill(opts.amount);
  await page.getByLabel('Day of month').first().fill(String(opts.dom));
  await page.getByLabel('Day of month').first().blur();
  // The payment method. Its absence was defect 3. A select-only "Pay from"
  // dropdown since v10.27.1 (fixed-choice dropdowns use `Select`), not buttons.
  await page.getByLabel('Pay from').selectOption({ label: opts.account });
}

test.describe('§ Recurring · create · delete · regression', () => {
  test.use({ seed: defaultSeed });

  test('CON-E2E-036 · a schedule created for the Xth of the month with a chosen account falls due THIS month', async ({ page }) => {
    await page.goto('/recurring');
    await openForm(page);
    await fillSchedule(page, {
      name: 'E2E Rent', amount: '1200', dom: DOM, account: 'E2E Checking',
    });
    await page.getByRole('button', { name: 'Save schedule' }).click();

    const row = page.getByText('E2E Rent').first();
    await expect(row).toBeVisible();

    // THE REGRESSION GUARD. The old code returned 2026-06-28 here — the 28th of
    // this month had not happened yet, so the first bill silently skipped a
    // month. Asserting the rendered next-due date keeps that honest.
    await expect(page.locator('body')).toContainText(/28 May 2026|May 28, 2026|2026-05-28/);

    // Exactly one LIST row. Scoped to the schedule list on purpose: a schedule
    // due within the horizon also renders in the bill calendar above (v10.32.0),
    // so a page-wide text count is legitimately 2. The duplication this guards
    // against (defect 2 — re-keying without evicting the old key) produced two
    // rows in the list itself.
    await expect(page.getByTestId('schedule-row').filter({ hasText: 'E2E Rent' }))
      .toHaveCount(1);
  });

  test('CON-E2E-037 · a day already past this month rolls to next month, never backwards', async ({ page }) => {
    await page.goto('/recurring');
    await openForm(page);
    await fillSchedule(page, {
      name: 'E2E Salary', amount: '5000', dom: PAST_DOM, account: 'E2E Checking',
    });
    await page.getByRole('button', { name: 'Save schedule' }).click();

    await expect(page.getByText('E2E Salary').first()).toBeVisible();
    // The 2nd of May has gone, so June. What must NEVER appear is a date before
    // today — that is what made the engine invent back-dated transactions.
    await expect(page.locator('body')).toContainText(/2 Jun 2026|Jun 2, 2026|2026-06-02/);
  });

  test('CON-E2E-038 · deleting a schedule removes it, and it stays deleted across a reload', async ({ page }) => {
    await page.goto('/recurring');
    await openForm(page);
    await fillSchedule(page, {
      name: 'E2E Doomed', amount: '99', dom: DOM, account: 'E2E Checking',
    });
    await page.getByRole('button', { name: 'Save schedule' }).click();
    await expect(page.getByText('E2E Doomed').first()).toBeVisible();

    page.once('dialog', d => void d.accept());
    await page.getByRole('button', { name: 'Delete schedule' }).first().click();
    await expect(page.getByText('E2E Doomed')).toHaveCount(0);

    // THE ACTUAL COMPLAINT — "toast says deleted, refresh brings it back". The
    // v7.3 backfill used to recreate any schedule whose signature had no match,
    // with no concept of a deliberate deletion.
    await page.reload();
    await expect(page.getByText('E2E Doomed')).toHaveCount(0);
  });

  test('CON-E2E-039 · creating a schedule writes no transaction', async ({
    page, transactions,
  }) => {
    // Regression surface: a schedule is a TEMPLATE. Creating one must not post
    // anything to the ledger, and must not disturb Cash Flow or Net Worth.
    await transactions.goto();
    // Wait for the list to render before counting — an unwaited count races the
    // hydration and silently reads 0.
    await expect(page.getByTestId('txn-row').first()).toBeVisible();
    const before = await page.getByTestId('txn-row').count();

    await page.goto('/recurring');
    await openForm(page);
    await fillSchedule(page, {
      name: 'E2E Neutral', amount: '4321', dom: DOM, account: 'E2E Checking',
    });
    await page.getByRole('button', { name: 'Save schedule' }).click();
    await expect(page.getByText('E2E Neutral').first()).toBeVisible();

    await transactions.goto();
    await expect(page.getByTestId('txn-row').first()).toBeVisible();
    const after = await page.getByTestId('txn-row').count();
    expect(after, 'creating a schedule must not post a transaction').toBe(before);

    // And specifically: nothing dated today. This is the reported
    // "recurring schedule appears as a transaction for the current day".
    await expect(page.getByText('E2E Neutral')).toHaveCount(0);

    // And the schedule must not have posted anything to the ledger under any
    // date — the engine materialises on the due date, not at creation.
    await expect(page.getByTestId('txn-row').filter({ hasText: 'E2E Neutral' }))
      .toHaveCount(0);
  });
});
