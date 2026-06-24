import { test, expect } from '../fixtures/app';

test.describe('§25 RESP-FC · responsive mobile layout', () => {
  test('RESP-FC-001 · desktop width renders the full layout', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto('/dashboard');
    await page.waitForURL('**/dashboard');

    await expect(page.getByRole('link', { name: 'Vyact — go to dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Transactions' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible();
    await expect(page.locator('header')).toBeHidden();
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('RESP-FC-002 · mobile width collapses the sidebar into a hamburger menu', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/dashboard');

    const settingsLink = page.getByRole('link', { name: 'Settings' });

    await expect(page.locator('header')).toBeVisible();
    await expect(settingsLink).toBeHidden();

    await page.locator('header button').first().click();

    await expect(settingsLink).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();

    await settingsLink.click();
    await page.waitForURL('**/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('RESP-FC-004 · planner and chat floating actions remain reachable on mobile', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/dashboard');

    const plannerFab = page.getByRole('button', { name: 'Planner' });
    const chatFab = page.getByRole('button', { name: 'Ask Vyact' });

    await expect(plannerFab).toBeVisible();
    await expect(chatFab).toBeVisible();

    await plannerFab.click();
    await expect(page.getByRole('heading', { name: 'Planner' })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('heading', { name: 'Planner' })).toHaveCount(0);

    await chatFab.click();
    await expect(page.getByRole('heading', { name: 'Ask Vyact' })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('heading', { name: 'Ask Vyact' })).toHaveCount(0);
  });

  test('RESP-FC-005 · drawer labels for Accounts and Insights stay title-cased and readable', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('vt_feature_money_map', 'on');
    });

    await page.goto('/dashboard');
    await page.waitForURL('**/dashboard');

    await page.locator('header button').first().click();

    const accountsLink = page.getByRole('link', { name: 'Accounts' });
    const insightsLink = page.getByRole('link', { name: 'Insights' });

    await expect(accountsLink).toBeVisible();
    await expect(insightsLink).toBeVisible();
    await expect(accountsLink).toHaveText('Accounts');
    await expect(insightsLink).toHaveText('Insights');
    await expect(page.getByRole('link', { name: 'accounts' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'insights' })).toHaveCount(0);
  });
});