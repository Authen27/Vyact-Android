import { test, expect } from '../fixtures/app';

// v10.49.1 (#45) — rewritten for the Aurora navigation (components/layout/navModel.ts):
// desktop has a top banner with Track / Plan / Analyze tabs and each section's links
// beneath; mobile has a slim header and a bottom "Primary" bar (Track · Plan · Add ·
// Analyze · Ask Pip). Settings, Households and Help live in the account menu on both.
// The old sidebar / hamburger / Planner FAB these tests asserted no longer exist.
test.describe('§25 RESP-FC · responsive layout', () => {
  test('RESP-FC-001 · desktop width renders the full layout', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/dashboard');
    await page.waitForURL('**/dashboard');

    const banner = page.getByRole('banner');
    await expect(banner.getByRole('link', { name: 'Vyact — go to dashboard' })).toBeVisible();
    for (const tab of ['Track', 'Plan', 'Analyze']) await expect(banner.getByRole('tab', { name: tab })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Transactions', exact: true })).toBeVisible();

    await banner.getByRole('tab', { name: 'Analyze' }).click();
    await page.waitForURL('**/networth');
    await expect(page.getByRole('link', { name: 'Reports', exact: true })).toBeVisible();
    // The mobile bottom bar is not shown on desktop.
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
  });

  test.describe('mobile', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
    });

    test('RESP-FC-002 · mobile swaps the top banner for a bottom bar, and Settings stays reachable', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForURL('**/dashboard');

      await expect(page.getByRole('banner')).toBeHidden();
      const primary = page.getByRole('navigation', { name: 'Primary' });
      await expect(primary).toBeVisible();
      for (const item of ['Track', 'Plan', 'Add transaction', 'Analyze', 'Ask Pip']) {
        await expect(primary.getByRole('button', { name: item })).toBeVisible();
      }

      await page.getByRole('button', { name: 'Account menu' }).first().click();
      await page.getByRole('button', { name: /Settings/ }).first().click();
      await page.waitForURL('**/settings');
      await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    });

    test('RESP-FC-004 · Pip and Add transaction stay one tap away on mobile', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForURL('**/dashboard');
      const primary = page.getByRole('navigation', { name: 'Primary' });

      await primary.getByRole('button', { name: 'Ask Pip' }).click();
      await expect(page.getByTestId('ask-composer')).toBeVisible();
      // v10.54.0 (owner) — the drawer header's "Vyact does the maths" subtitle is removed.
      await expect(page.getByText('Vyact does the maths, not guesswork')).toHaveCount(0);
      // v10.52.0 — the "Every amount comes from your own data" banner is gone;
      // an AI caveat sits under the composer instead.
      await expect(page.getByTestId('ask-ai-disclaimer')).toHaveText('Pip is AI-based and can make mistakes. Please double-check its responses.');
      await expect(page.getByText(/Every amount comes from your own/)).toHaveCount(0);
    });

    test('RESP-FC-005 · section labels for Accounts and Insights stay title-cased and readable', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForURL('**/dashboard');
      const primary = page.getByRole('navigation', { name: 'Primary' });

      await primary.getByRole('button', { name: 'Plan' }).click();
      const accountsLink = page.getByRole('link', { name: 'Accounts', exact: true });
      await expect(accountsLink).toBeVisible();
      await expect(accountsLink).toHaveText('Accounts');

      await primary.getByRole('button', { name: 'Analyze' }).click();
      const insightsLink = page.getByRole('link', { name: 'Insights', exact: true });
      await expect(insightsLink).toBeVisible();
      await expect(insightsLink).toHaveText('Insights');
    });

    test('RESP-FC-006 · mobile Analyze opens Net Worth, the same landing page as desktop', async ({ page }) => {
      // v10.52.0: the bottom bar hard-coded Analyze → /reports while the desktop
      // tab opened /networth. Both now read the section's first route from navModel.
      await page.goto('/dashboard');
      await page.waitForURL('**/dashboard');
      const primary = page.getByRole('navigation', { name: 'Primary' });

      await primary.getByRole('button', { name: 'Analyze' }).click();
      await page.waitForURL('**/networth');
      await expect(primary.getByRole('button', { name: 'Analyze' })).toHaveAttribute('aria-current', 'page');

      await primary.getByRole('button', { name: 'Track' }).click();
      await page.waitForURL('**/dashboard');
      await primary.getByRole('button', { name: 'Plan' }).click();
      await page.waitForURL('**/budgets');
    });
  });
});
