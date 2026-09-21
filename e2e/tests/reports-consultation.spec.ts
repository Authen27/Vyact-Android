import { test, expect } from '../fixtures/app';
import { seedWith } from '../fixtures/seed';
import { seedLocalHousehold } from '../fixtures/localHousehold';

// v10.31.0 — the Reports consultation items (docs/INSIGHTS_ASK_REPORTS_UX.md):
// one date range for every flow view, budget vs actual by matching scope, and an
// essential-spend runway with a stated completed-month baseline.
//
// Fixture clock: 2026-05-22. One bank account (opening 1,000).
//   Feb  groceries 300 (need)
//   Mar  groceries 300 (need) + entertainment 200 (want)
//   Apr  groceries 600 (need)            ← April budget allocates 500 → over by 100
//   May  groceries 100 (need) + salary 2,000   ← May budget allocates 400 → in progress
// Liquid assets = 1,000 + 2,000 − 1,500 = 1,500. Essential baseline Feb–Apr:
// (300 + 300 + 600) / 3 = 400 a month → 3.8 months.
const expense = (id: string, date: string, category: string, amount: number) =>
  ({ id, type: 'expense', amount, currency: 'USD', date, category, description: `${category} ${date}`, accountId: 'bank' });

const seed = seedWith({
  profile: { name: 'Alex', baseCurrency: 'USD', onboardedAt: '2026-01-01T00:00:00Z' },
  members: [{ id: 'alex', name: 'Alex', role: 'primary', color: '#769782' }],
  accounts: [{ id: 'bank', kind: 'bank', name: 'Everyday account', currency: 'USD', openingBalance: 1000 }],
  transactions: [
    expense('feb-food', '2026-02-10', 'groceries', 300),
    expense('mar-food', '2026-03-10', 'groceries', 300),
    expense('mar-fun', '2026-03-12', 'entertainment', 200),
    expense('apr-food', '2026-04-10', 'groceries', 600),
    expense('may-food', '2026-05-04', 'groceries', 100),
    { id: 'may-salary', type: 'income', amount: 2000, currency: 'USD', date: '2026-05-01', category: 'salary', description: 'Salary', toAccountId: 'bank', memberId: 'alex' },
  ],
  budgets: [
    { id: 'budget-apr', scope: 'month', periodYear: 2026, periodMonth: 4, limit: 500, currency: 'USD', periodStart: '2026-04-01', periodEnd: '2026-04-30' },
    { id: 'budget-may', scope: 'month', periodYear: 2026, periodMonth: 5, limit: 400, currency: 'USD', periodStart: '2026-05-01', periodEnd: '2026-05-31' },
  ],
  budgetAllocations: [
    { id: 'alloc-apr', budgetId: 'budget-apr', category: 'groceries', amount: 500 },
    { id: 'alloc-may', budgetId: 'budget-may', category: 'groceries', amount: 400 },
  ],
  goals: [], recurringSchedules: [], assets: [], debts: [], notifications: [],
});

test.use({ seed, serviceWorkers: 'block', contextOptions: { reducedMotion: 'reduce' } });
test.beforeEach(async ({ page }) => seedLocalHousehold(page, seed));

test('RPTC-FC-001 - one date range drives every flow view and survives in the URL', async ({ page }, testInfo) => {
  await page.goto('/reports');
  const window = page.getByText('Chart window:', { exact: false });
  await expect(window).toContainText('1 Jun 2025 – 22 May 2026');
  const top = page.getByRole('region', { name: 'Top expense categories', exact: true });
  await expect(top).toContainText('Groceries');
  await expect(top).toContainText('Entertainment');   // March, inside the default 12 months
  await page.getByLabel('Date range').selectOption('this-month');
  await expect(window).toContainText('1 May 2026 – 22 May 2026');
  await expect(page).toHaveURL(/range=this-month/);
  await expect(top).not.toContainText('Entertainment');
  await expect(page.getByText('Income · in range')).toBeVisible();

  await page.goto('/reports?range=custom&start=2026-03-01&end=2026-03-31&group=week');
  await expect(window).toContainText('1 Mar 2026 – 31 Mar 2026');
  await expect(window).toContainText('Grouped by week');
  await expect(page.getByLabel('Date range')).toHaveValue('custom');
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('2026-03-01');
  await expect(page.getByLabel('To', { exact: true })).toHaveValue('2026-03-31');
  await expect(top).toContainText('Entertainment');
  await page.reload();
  await expect(window).toContainText('1 Mar 2026 – 31 Mar 2026');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await testInfo.attach('reports-custom-range', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('RPTC-FC-002 - budget vs actual compares each budget over its own month and never judges the current one', async ({ page }) => {
  await page.goto('/reports');
  const panel = page.getByRole('region', { name: 'Budget vs actual', exact: true });
  const april = panel.getByRole('row', { name: /Apr 2026/ });
  await expect(april).toContainText('$500');
  await expect(april).toContainText('$600');
  await expect(april).toContainText('$100 over');
  await expect(april).toContainText('Over');
  const may = panel.getByRole('row', { name: /May 2026/ });
  await expect(may).toContainText('$400');
  await expect(may).toContainText('$300 left');
  await expect(may).toContainText('In progress');
  await expect(panel).toContainText('Completed: 1 over, 0 under.');
  await expect(panel.locator('.recharts-wrapper')).toHaveCount(1);

  await page.getByLabel('Date range').selectOption('this-month');
  await expect(panel.getByRole('row', { name: /Apr 2026/ })).toHaveCount(0);
  await expect(panel.getByRole('row', { name: /May 2026/ })).toBeVisible();
});

test('RPTC-FC-003 - the essential-spend runway states its completed-month baseline and its limits', async ({ page }) => {
  await page.goto('/reports');
  const runway = page.getByRole('region', { name: 'Essential-spend runway', exact: true });
  await expect(runway).toContainText('3.8 months');
  await expect(runway).toContainText('($1,500 against $400 a month)');
  await runway.getByText('Calculation basis').click();
  await expect(runway).toContainText('Based on 3 completed months with recorded spending: Feb–Apr 2026.');
  await expect(runway).toContainText('The current month is never included.');
  await expect(runway).toContainText('not advice or a financial-health score');
});
