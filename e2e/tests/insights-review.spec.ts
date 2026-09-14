import { test, expect } from '../fixtures/app';
import { seedWith, type SeedData } from '../fixtures/seed';
import { seedLocalHousehold } from '../fixtures/localHousehold';

// v10.29.0 — Insights is one personal view (docs/INSIGHTS_ASK_REPORTS_UX.md):
// two tabs, For You absorbs the Plan tab, the reel is an optional action.
// The fixture clock is 2026-05-22, so May 2026 is the current month.
const accounts = [
  { id: 'bank', kind: 'bank', name: 'Everyday account', currency: 'USD', openingBalance: 1000 },
  { id: 'cash-account', kind: 'cash', name: 'Cash in Hand', currency: 'USD', openingBalance: 50 },
];
// onboardedAt: a household with no data and no onboarding stamp is routed to /onboarding.
const empties = { profile: { name: 'Alex', baseCurrency: 'USD', onboardedAt: '2026-05-01T00:00:00Z' },
  goals: [], budgets: [], budgetAllocations: [], recurringSchedules: [], notifications: [] };

const active = seedWith({
  ...empties, accounts,
  transactions: [
    { id: 'april-income', type: 'income', amount: 1000, currency: 'USD', date: '2026-04-02', category: 'salary', description: 'April salary', toAccountId: 'bank' },
    { id: 'april-food', type: 'expense', amount: 400, currency: 'USD', date: '2026-04-10', category: 'groceries', description: 'April groceries', accountId: 'bank' },
    { id: 'may-income', type: 'income', amount: 1000, currency: 'USD', date: '2026-05-02', category: 'salary', description: 'May salary', toAccountId: 'bank' },
    { id: 'may-food', type: 'expense', amount: 990, currency: 'USD', date: '2026-05-10', category: 'groceries', description: 'May groceries', accountId: 'bank' },
  ],
});
// Not an empty ledger — local-only mode loads the demo household when there are no
// transactions at all. A lone transfer is recorded data with no reportable income
// or spending, which is exactly what "not enough recorded activity" means.
const empty = seedWith({ ...empties, accounts, transactions: [
  { id: 'move-to-cash', type: 'transfer', amount: 40, currency: 'USD', date: '2026-05-06', category: '', description: 'Cash withdrawal', accountId: 'bank', toAccountId: 'cash-account' },
] });

const seeded = (data: SeedData) => {
  test.use({ seed: data, serviceWorkers: 'block', contextOptions: { reducedMotion: 'reduce' } });
  test.beforeEach(async ({ page }) => seedLocalHousehold(page, data));
};

test.describe('Insights with recorded activity', () => {
  seeded(active);

  test('INS-FC-001 - For You is one review: two tabs, capped next steps with actions, no Pulse or Tax', async ({ page }, testInfo) => {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/insights');
      // Scoped to Insights' own tabs: the app shell has a separate Track/Plan/Analyze section tablist.
      const tabs = page.getByRole('tablist', { name: 'Insights views' }).getByRole('tab');
      await expect(tabs).toHaveText(['For You', 'Learn']);
      await expect(page.getByRole('tab', { name: 'For You' })).toHaveAttribute('aria-selected', 'true');

      const next = page.getByRole('region', { name: 'Your next steps', exact: true });
      await expect(next).toBeVisible();
      const steps = await next.getByRole('article').count();
      expect(steps).toBeGreaterThanOrEqual(1);
      expect(steps).toBeLessThanOrEqual(3);
      await expect(next.getByRole('article').first().getByRole('link').first()).toBeVisible();
      await expect(next.getByText('2026-05').first()).toBeVisible();
      await expect(page.getByText('Calculation basis').first()).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Learn about this', exact: true })).toBeVisible();

      await expect(page.getByText(/Pulse/)).toHaveCount(0);
      await expect(page.getByRole('heading', { name: /Tax/ })).toHaveCount(0);
      await expect(page.getByText(/healthy/i)).toHaveCount(0);
      // One issue per period: no two review items share a title.
      const titles = await page.locator('[data-insight-id] h3').allTextContents();
      expect(new Set(titles).size).toBe(titles.length);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await testInfo.attach(`insights-for-you-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    }
  });

  test('INS-FC-002 - highlights are optional, tabs are keyboard reachable, and old Plan links land on For You', async ({ page }) => {
    await page.goto('/insights');
    const highlights = page.getByRole('button', { name: 'Review highlights', exact: true });
    await highlights.click();
    const reel = page.getByRole('dialog', { name: 'Your insights' });
    await expect(reel).toBeVisible();
    await reel.getByRole('button', { name: 'Close insights' }).click();
    await expect(reel).toHaveCount(0);
    await expect(highlights).toBeFocused();

    await page.getByRole('tab', { name: 'For You' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Learn' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Learn' })).toBeFocused();
    await expect(page).toHaveURL(/tab=learn/);

    await page.goto('/planner');
    await expect(page).toHaveURL(/\/insights\?tab=for-you$/);
    await expect(page.getByRole('tab', { name: 'For You' })).toHaveAttribute('aria-selected', 'true');
    await page.goto('/insights?tab=plan');
    await expect(page.getByRole('tab', { name: 'For You' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'Your next steps', exact: true })).toBeVisible();
  });
});

test.describe('Insights without recorded activity', () => {
  seeded(empty);

  test('INS-FC-003 - an empty household is told there is not enough activity, never that it is healthy', async ({ page }) => {
    await page.goto('/insights');
    await expect(page.getByRole('heading', { name: 'Not enough recorded activity yet', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your next steps', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review highlights', exact: true })).toHaveCount(0);
    await expect(page.getByText(/healthy/i)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Open Transactions' })).toBeVisible();
  });
});
