import { test, expect } from '../fixtures/app';
import { defaultSeed } from '../fixtures/seed';

// ── Lane A · Budget editor (defects 1 and 3) ────────────────────────────────
//
// Reported: "Adding budget by category crashed the add budget view, and reset
// the already filled info" and "Unable assign budgets to all categories."
//
// Two causes, one file:
//
//   1. THE RESET. The hydration effect listed the store's `budgetAllocations`
//      array in its dependency array. That array takes a new identity on every
//      sync poll, so the effect re-ran mid-edit and called `setForm()` — for a
//      new budget, `setForm(blank())`. Everything typed vanished, with no
//      interaction from the user at all.
//
//   2. ONE CATEGORY AT A TIME. Every allocation needed a "＋ Add category" tap
//      and a dropdown selection, so the interaction cost scaled with how
//      thorough you were — which is why budgets covered a handful of
//      categories. It also made a DUPLICATE category reachable (the picker fell
//      back to `other_expense` once all were used), and two rows with the same
//      category violate `uq_balloc_cat` at save time.
//
// The clock is pinned to FIXED_NOW (2026-05-22) by the app fixture.

/** The store is exposed on window for e2e; `myRole` proves boot effects ran. */
async function waitForStore(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => (window as unknown as { __ff_store?: { getState(): { myRole?: string } } })
      .__ff_store?.getState().myRole === 'owner',
  );
}

test.describe('§ Budgets · the editor holds what you type, and offers every category', () => {
  test.use({ seed: defaultSeed });

  test('CON-E2E-050 · every expense category is listed, with no "add category" step', async ({ budgets, page }) => {
    await budgets.goto();
    await waitForStore(page);
    await budgets.openAdd();

    const dialog = page.getByRole('main', { name: 'Add Budget', exact: true });
    await expect(dialog).toBeVisible();

    // The CTA that used to gate each allocation is gone.
    await expect(dialog.getByRole('button', { name: /add category/i })).toHaveCount(0);

    // Every expense category the app offers has its own amount field, so a
    // budget can cover all of them without a single extra interaction.
    const expected = [
      'Food & Dining', 'Groceries', 'Rent / Mortgage', 'Utilities', 'Travel',
      'Holiday & Outstay', 'Shopping', 'Electronics & Decor', 'Personal Care',
      'Health & Wellness', 'Repairs & Maintenance', 'Entertainment', 'Education',
      'Childcare', 'Gifts & Donations', 'Insurance', 'Loan / EMI payment', 'Other',
    ];
    for (const label of expected) {
      await expect(
        dialog.getByLabel(`Budget for ${label}`),
        `no amount field for ${label}`,
      ).toBeVisible();
    }

    // And the v10.21 merge is reflected here too — Transport is gone.
    await expect(dialog.getByLabel('Budget for Transport')).toHaveCount(0);
  });

  test('CON-E2E-051 · a store refresh mid-edit does not wipe what you typed', async ({ budgets, page }) => {
    // THE REPORTED DEFECT, reproduced at its cause. `refresh()` is what a sync
    // poll, a tab focus or coming back online all call; it replaces the
    // allocations array, which used to re-run the hydration effect and blank
    // the form.
    await budgets.goto();
    await waitForStore(page);
    await budgets.openAdd();

    const dialog = page.getByRole('main', { name: 'Add Budget', exact: true });
    const groceries = dialog.getByLabel('Budget for Groceries');
    const travel = dialog.getByLabel('Budget for Travel');

    await groceries.fill('450');
    await travel.fill('120');
    await expect(groceries).toHaveValue('450');

    // Exactly what the app does on a poll — not a synthetic re-render.
    await page.evaluate(async () => {
      const w = window as unknown as { __ff_store?: { getState(): { refresh(): Promise<void> } } };
      await w.__ff_store?.getState().refresh();
    });

    // Before the fix these read '' — the effect had already reset the form.
    await expect(groceries, 'the amount survived a refresh').toHaveValue('450');
    await expect(travel).toHaveValue('120');
  });

  test('CON-E2E-052 · one row per category, so a duplicate allocation is unrepresentable', async ({ budgets, page }) => {
    // `uq_balloc_cat` is UNIQUE on (budget_id, category). The old add-a-row
    // model could produce two rows with the same category, which the database
    // then rejected at save time with 23505 — after the user had done the work.
    await budgets.goto();
    await waitForStore(page);
    await budgets.openAdd();

    const dialog = page.getByRole('main', { name: 'Add Budget', exact: true });
    for (const label of ['Groceries', 'Travel', 'Other']) {
      await expect(dialog.getByLabel(`Budget for ${label}`)).toHaveCount(1);
    }
  });
});
