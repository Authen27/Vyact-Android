import { test, expect } from '../fixtures/app';

test.describe('Error boundary', () => {
  test('CON-E2E-005 · shows fallback UI when a child throws', async ({ page }) => {
    await page.goto('/__e2e_error');
    await expect(page.locator('text=Something broke')).toBeVisible();
    await expect(page.locator('text=Your data is safe locally.')).toBeVisible();
    await page.click('text=Try Again');
    await expect(page.locator('text=Something broke')).not.toBeVisible();
  });
});
