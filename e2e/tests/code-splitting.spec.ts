import { test, expect } from '../fixtures/app';

test.describe('Code splitting / lazy-loading', () => {
  test('CON-E2E-006 · Recharts lazy-loads only when chart pages are visited', async ({ page }) => {
    let rechartsRequested = false;

    page.on('response', async (res) => {
      try {
        const req = res.request();
        if (req.resourceType() === 'script') {
          const text = await res.text();
          if (text.includes('recharts') || text.includes('Recharts')) rechartsRequested = true;
        }
      } catch { /* ignore binary/non-text responses */ }
    });

    // Visit a non-chart page first.
    await page.goto('/transactions');
    await page.waitForTimeout(600);
    expect(rechartsRequested).toBeFalsy();

    // Now visit the dashboard which includes charts; the recharts chunks should load.
    rechartsRequested = false;
    await page.goto('/dashboard');
    // allow time for dynamic imports to fetch
    await page.waitForTimeout(1200);
    expect(rechartsRequested).toBeTruthy();
  });
});
