import { test, expect } from '../fixtures/app';

test.describe('Error boundary', () => {
  // Aurora 4.0 ER1 — the calm crash screen: what happened, that nothing was lost, and two ways out.
  test('CON-E2E-005 · shows fallback UI when a child throws', async ({ page }) => {
    await page.goto('/__e2e_error');
    await expect(page.getByRole('heading', { name: "This page didn't load" })).toBeVisible();
    await expect(page.getByText('Nothing you entered was lost')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to Dashboard' })).toHaveAttribute('href', '/dashboard');
    await expect(page.getByRole('button', { name: 'Copy error details' })).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: "This page didn't load" })).not.toBeVisible();
  });
});
