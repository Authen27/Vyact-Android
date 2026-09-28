// ──────────────────────────────────────────────────────────────────────────
// §12 PERM-FC · The permission model in Lane A
// ──────────────────────────────────────────────────────────────────────────
// THIS IS THE TEST THAT WOULD HAVE CAUGHT THE PHASE-0 BUG CLASS.
//
// Lane A builds the app in local-only mode. Before this fix, `myRole` was never
// populated there — its only writer sat behind a `cloudEnabled` guard — so
// `can()` fell through to its deny-by-default (`action === 'view'`) and every
// write-gated screen rendered read-only.
//
// The consequence was not a cosmetic one. It meant NO e2e test could open the
// budget editor, the household danger zone, or the recurring form, because the
// controls that open them were not rendered. Four of the eight defects reported
// against v10.20 live behind exactly those controls. The suite was green and
// blind at the same time.
//
// So this file asserts the precondition every other write test depends on: in
// local-only mode you are the owner, and the affordances exist. If it ever goes
// red, the rest of the suite has quietly stopped testing writes — treat a
// failure here as "the suite is lying", not as one broken screen.
// ──────────────────────────────────────────────────────────────────────────

import { test, expect } from '../fixtures/app';
import { defaultSeed } from '../fixtures/seed';

test.use({ seed: defaultSeed });

test.describe('§12 PERM-FC · local-only permissions', () => {
  test('CON-E2E-024 · [PERM-FC-001] local-only mode resolves to owner, so write affordances render', async ({
    page, budgets,
  }) => {
    await budgets.goto();

    // The affordance must be present …
    await expect(budgets.addButton).toBeVisible();
    // … and the read-only marker absent. Asserting both matters: the page
    // renders one OR the other, so checking only for the button would still
    // pass if the layout changed and the marker leaked in beside it.
    await expect(page.getByText('View only', { exact: true })).toHaveCount(0);

    // The role itself, read from the store rather than inferred from pixels.
    // `window.__ff_store` is exposed only outside production builds
    // (guarded by MODE !== 'production' in store.ts).
    const role = await page.evaluate(
      () => (window as unknown as { __ff_store?: { getState(): { myRole?: string } } })
        .__ff_store?.getState().myRole,
    );
    expect(role).toBe('owner');
  });

  test('CON-E2E-025 · [PERM-FC-002] the budget editor actually opens', async ({ budgets, page }) => {
    // A visible button is not the same as a reachable editor. This is the step
    // the whole budget suite (CON-E2E-017..023) silently could not perform.
    await budgets.goto();

    // Wait for the app to finish booting before clicking. Playwright's
    // actionability checks confirm the button is visible, stable and enabled —
    // none of which means React has attached its handler yet. Clicking into
    // that gap is swallowed silently and the test then waits 30s for a dialog
    // that was never asked for. (Observed exactly once here; the app itself
    // opens the sheet correctly.)
    //
    // `myRole` being populated is the right signal rather than an arbitrary
    // wait: it is set by the boot effect this whole file exists to test, so it
    // proves the store is live and effects have run.
    await page.waitForFunction(
      () => (window as unknown as { __ff_store?: { getState(): { myRole?: string } } })
        .__ff_store?.getState().myRole === 'owner',
    );

    await budgets.openAdd();
    await expect(page.getByRole('main', { name: 'Add Budget', exact: true })).toBeVisible();
  });
});
