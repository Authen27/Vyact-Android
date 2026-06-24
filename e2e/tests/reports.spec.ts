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
    category: 'food',
    memberId: REPORT_MEMBER.id,
  },
  {
    id: '00000000-0000-4000-8000-0000000000bd',
    type: 'expense',
    amount: 80,
    currency: 'USD',
    date: '2026-05-08',
    description: 'RPT food 2',
    category: 'food',
    memberId: REPORT_MEMBER.id,
  },
  {
    id: '00000000-0000-4000-8000-0000000000be',
    type: 'expense',
    amount: 50,
    currency: 'USD',
    date: '2026-05-10',
    description: 'RPT transport',
    category: 'transport',
    memberId: REPORT_MEMBER.id,
  },
  {
    id: '00000000-0000-4000-8000-0000000000bf',
    type: 'expense',
    amount: 999,
    currency: 'USD',
    date: '2026-05-11',
    description: 'RPT excluded',
    category: 'food',
    excluded: true,
    memberId: REPORT_MEMBER.id,
  },
];

test.describe('§12 RPT-FC · Reports', () => {
  test('RPT-FC-001 · each period selector rerenders the period-scoped report views', async ({ page }) => {
    await page.goto('/reports');
    await page.waitForURL('**/reports');

    const trendPanel = page.locator('div').filter({ hasText: /^Income vs Expenses Trend/ }).first();

    const periods = [
      { button: 'Day', avgLabel: 'Avg Daily Net', sub: 'Daily' },
      { button: 'Week', avgLabel: 'Avg Weekly Net', sub: 'Weekly' },
      { button: 'Month', avgLabel: 'Avg Monthly Net', sub: 'Monthly' },
      { button: 'Quarter', avgLabel: 'Avg Quarterly Net', sub: 'Quarterly' },
      { button: 'Year', avgLabel: 'Avg Annual Net', sub: 'Annual' },
    ] as const;

    for (const period of periods) {
      await page.getByRole('button', { name: period.button }).click();
      await expect(page.getByText(period.avgLabel)).toBeVisible();
      await expect(trendPanel).toContainText(period.sub);
    }
  });

  test('RPT-FC-002 · empty-state copy is shown when no reportable transactions exist', async ({ page }) => {
    await page.goto('/reports');
    await page.waitForURL('**/reports');

    await expect(page.getByText('No data for this period')).toBeVisible();
    await expect(page.getByText(/^No data$/).first()).toBeVisible();
  });

  test.describe('category aggregation', () => {
    test.use({ seed: seedWith({ transactions: REPORT_TXNS, members: [REPORT_MEMBER] }) });

    test('RPT-FC-003 · donut breakdown matches summed expense category totals', async ({ page }) => {
      await page.goto('/reports');
      await page.waitForURL('**/reports');

      await expect(page.getByText('🍔 Food & Dining')).toBeVisible();
      await expect(page.getByText('🚗 Transport')).toBeVisible();
      await expect(page.getByText('$200')).toBeVisible();
      await expect(page.getByText('$50')).toBeVisible();

      // Excluded expenses are intentionally omitted from reportable aggregates.
      await expect(page.getByText('$999')).toHaveCount(0);
    });
  });
});