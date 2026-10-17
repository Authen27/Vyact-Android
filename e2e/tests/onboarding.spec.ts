import { test, expect } from '../fixtures/app';
import { seedWith } from '../fixtures/seed';

// v10.49.1 (#45) — the template wizard these tests were written for ("Which best describes
// you?", "Skip — use Family with Kids template", primary concern) was replaced by Pip's
// two-minute setup (household-owned onboarding, v10.13+). ONB-FC-002/003/005 asserted the
// retired wizard and are retired with it; the new flow's rules are covered by the unit
// suites (onboarding / onboardingWiring / onboardingWorkflow). What still holds is pinned here.
test.describe('§20 ONB-FC · onboarding', () => {
  test.use({
    seed: seedWith({
      profile: {
        template: undefined,
        household: 'personal',
        onboardedAt: undefined,
      },
      transactions: [],
      budgets: [],
      goals: [],
      debts: [],
      assets: [],
      members: [],
    }),
  });

  test('ONB-FC-004 · fresh local users land on the dashboard without a forced onboarding redirect', async ({ page, dashboard }) => {
    await dashboard.goto();

    await expect(page).not.toHaveURL(/\/onboarding$/);
    await expect(dashboard.heading).toBeVisible();
    await expect(page.getByText(/^Family finance overview/)).toBeVisible();
    // An empty local household gets the demo data on first run (dataSlice first-run seed),
    // so the dashboard is populated rather than empty.
    await expect(page.getByRole('heading', { level: 2, name: 'Budget Progress' })).toBeVisible();
  });

  test('ONB-FC-006 · the setup opens with its promise: built for the household, everything editable, a currency to start', async ({ page }) => {
    await page.goto('/onboarding');
    await page.waitForURL('**/onboarding');

    await expect(page.getByRole('heading', { level: 1, name: 'A clear money picture, in two minutes.' })).toBeVisible();
    // v10.50.0 — positioning leads with what Vyact does, not what it doesn't (owner rule).
    await expect(page.getByText(/Built for your whole household\./)).toBeVisible();
    await expect(page.getByText(/No bank login/)).toHaveCount(0);
    await expect(page.getByText(/Nothing is locked in\./)).toBeVisible();
    // Aurora 4.0 OB1 — phones pick the currency from chips (More… opens the full list); desktop keeps the select.
    await expect(page.getByRole('combobox', { name: 'Currency' }).or(page.getByRole('group', { name: 'Currency' }))).toBeVisible();
    await expect(page.getByRole('button', { name: "Let's go" })).toBeEnabled();
  });
});
