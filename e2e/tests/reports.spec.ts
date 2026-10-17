import { test, expect } from '../fixtures/app';
import { seedWith } from '../fixtures/seed';

const REPORT_MEMBER = {
  id: '00000000-0000-4000-8000-0000000000ba',
  name: 'Reports Member',
  role: 'primary',
};

const REPORT_TXNS = [
  {
    id: '00000000-0000-4000-8000-0000000000bb',
    type: 'income',
    amount: 5000,
    currency: 'USD',
    date: '2026-05-01',
    description: 'RPT income',
    category: 'salary',
    memberId: REPORT_MEMBER.id,
  },
  {
    id: '00000000-0000-4000-8000-0000000000bc',
    type: 'expense',
    amount: 120,
    currency: 'USD',
    date: '2026-05-05',
    description: 'RPT food 1',
    category: 'food_dining',
    memberId: REPORT_MEMBER.id,
  },
  {
    id: '00000000-0000-4000-8000-0000000000bd',
    type: 'expense',
    amount: 80,
    currency: 'USD',
    date: '2026-05-08',
    description: 'RPT food 2',
    category: 'food_dining',
    memberId: REPORT_MEMBER.id,
  },
  {
    id: '00000000-0000-4000-8000-0000000000be',
    type: 'expense',
    amount: 50,
    currency: 'USD',
    date: '2026-05-10',
    description: 'RPT travel',
    category: 'travel',
    memberId: REPORT_MEMBER.id,
  },
  {
    id: '00000000-0000-4000-8000-0000000000bf',
    type: 'expense',
    amount: 999,
    currency: 'USD',
    date: '2026-05-11',
    description: 'RPT excluded',
    category: 'food_dining',
    excluded: true,
    memberId: REPORT_MEMBER.id,
  },
];

// v10.49.1 (#45) — rewritten for the v10.31 Reports: ONE date range (default: last 12
// months) drives every panel, the grouping is a "Report period" tab rail, and a grouping
// that would draw more than 60 bars is coarsened — so Day/Week are checked on "This month".
// The unseeded app boots the demo household, so the empty state seeds an empty one.
test.describe('§12 RPT-FC · Reports', () => {
  test('RPT-FC-001 · each period selector rerenders the period-scoped report views', async ({ page }) => {
    await page.goto('/reports');
    await page.waitForURL('**/reports');
    await page.getByLabel('Date range').selectOption('this-month');

    const chartWindow = page.getByText('Chart window:', { exact: false });
    const trendPanel = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Income vs Expenses Trend', exact: true }) }).first();
    const rail = page.getByRole('tablist', { name: 'Report period' });

    const periods = [
      { tab: 'Day', title: 'Daily' },
      { tab: 'Week', title: 'Weekly' },
      { tab: 'Month', title: 'Monthly' },
      { tab: 'Quarter', title: 'Quarterly' },
      { tab: 'Year', title: 'Annual' },
    ] as const;

    for (const period of periods) {
      await rail.getByRole('tab', { name: period.tab }).click();
      await expect(rail.getByRole('tab', { name: period.tab })).toHaveAttribute('aria-selected', 'true');
      await expect(chartWindow).toContainText(`Grouped by ${period.tab.toLowerCase()}`);
      await expect(page.getByText(`Avg ${period.title} net`)).toBeVisible();
      await expect(trendPanel).toContainText(period.title);
    }
  });

  test.describe('empty household', () => {
    test.use({ seed: seedWith({
      transactions: [], members: [REPORT_MEMBER],
      profile: { onboardedAt: '2026-05-01T00:00:00.000Z' },
    }) });

    test('RPT-FC-002 · empty-state copy is shown when no reportable transactions exist', async ({ page }) => {
      await page.goto('/reports');
      await page.waitForURL('**/reports');

      await expect(page.getByText('No data for this period')).toBeVisible();
      await expect(page.getByText(/^No data$/).first()).toBeVisible();
    });
  });

  test.describe('category aggregation', () => {
    test.use({ seed: seedWith({ transactions: REPORT_TXNS, members: [REPORT_MEMBER] }) });

    test('RPT-FC-003 · donut breakdown matches summed expense category totals', async ({ page }) => {
      await page.goto('/reports');
      await page.waitForURL('**/reports');
      const breakdown = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Category Breakdown', exact: true }) }).first();

      await expect(breakdown).toContainText('Food & Dining');
      await expect(breakdown).toContainText('Travel');
      await expect(breakdown).toContainText('$200');   // 120 + 80
      await expect(breakdown).toContainText('$50');

      // Excluded expenses are intentionally omitted from reportable aggregates.
      await expect(page.getByText('$999')).toHaveCount(0);
      await expect(breakdown).not.toContainText('$1,199');
    });
  });
});
