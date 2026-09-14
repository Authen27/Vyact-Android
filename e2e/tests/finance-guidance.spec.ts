import { test, expect } from '../fixtures/app';
import { seedWith } from '../fixtures/seed';
import { seedLocalHousehold } from '../fixtures/localHousehold';
import { INTENTS, intentExample } from '../../src/lib/askVyactIntents';

const seed = seedWith({
  profile: { name: 'Alex', baseCurrency: 'USD', onboardedAt: '2026-05-01T00:00:00Z' },
  members: [{ id: 'alex', name: 'Alex', role: 'primary', color: '#769782' }],
  accounts: [
    { id: 'bank', kind: 'bank', name: 'Everyday account', currency: 'USD', openingBalance: 1000 },
    { id: 'cash-account', kind: 'cash', name: 'Cash in Hand', currency: 'USD', openingBalance: 120 },
  ],
  transactions: [
    { id: 'income', type: 'income', amount: 12345678.9, currency: 'USD', date: '2026-05-02', category: 'salary', description: 'Salary', toAccountId: 'bank' },
    { id: 'need', type: 'expense', amount: 1234567.89, currency: 'USD', date: '2026-05-03', category: 'groceries', description: 'Groceries', accountId: 'bank' },
    { id: 'want', type: 'expense', amount: 987654.32, currency: 'USD', date: '2026-05-04', category: 'entertainment', description: 'Entertainment', accountId: 'bank' },
    { id: 'unclassified', type: 'expense', amount: 25, currency: 'USD', date: '2026-05-04', category: 'legacy-unknown', description: 'Unclassified entry', accountId: 'bank' },
    { id: 'neutral', type: 'transfer', amount: 250, currency: 'USD', date: '2026-05-05', category: '', description: 'Cash withdrawal', accountId: 'bank', toAccountId: 'cash-account' },
  ],
  goals: [], budgets: [], budgetAllocations: [], recurringSchedules: [], assets: [], debts: [], notifications: [],
});

// Authored against reduced motion with service workers blocked (see
// playwright.finance.config.ts). Pinned here so Lane A's default config runs it
// the same way — with smooth scrolling on, FIN-FC-002's clicks never settle.
test.use({ seed, serviceWorkers: 'block', contextOptions: { reducedMotion: 'reduce' } });
test.beforeEach(async ({ page }) => seedLocalHousehold(page, seed));

test('FIN-FC-001 - Reports keeps full Needs and Wants amounts inside narrow containers', async ({ page }, testInfo) => {
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/reports');
    const report = page.getByTestId('reports-page');
    const mix = page.getByRole('region', { name: 'Needs vs Wants', exact: true });
    await expect(mix).toBeVisible();
    await expect(report.locator('.recharts-sector').first()).toBeVisible();
    await expect(report.locator('.recharts-area-curve').first()).toBeVisible();
    expect(await report.locator('.recharts-bar-rectangle').evaluateAll(elements => elements.some(element => element.getBoundingClientRect().height > 1))).toBe(true);
    await expect(mix.locator('dd')).toHaveCount(2);
    await expect(mix.getByText('Unclassified: $25', { exact: true })).toBeVisible();
    const geometry = await mix.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth,
      values: Array.from(element.querySelectorAll('dd')).map(value => ({ width: value.clientWidth, scroll: value.scrollWidth })) }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
    for (const value of geometry.values) expect(value.scroll).toBeLessThanOrEqual(value.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(report.getByRole('heading', { name: 'Household position', exact: true })).toBeVisible();
    await expect(report.getByText('Tracked minimum debt payments / month', { exact: true })).toBeVisible();
    await expect(report.getByText('Chart window:', { exact: false })).toBeVisible();
    await expect(report.getByText('By member', { exact: true })).toBeVisible();
    await expect(report.getByText('By account', { exact: true })).toBeVisible();
    await expect(report.getByRole('heading', { name: /Tax/ })).toHaveCount(0);
    await mix.scrollIntoViewIfNeeded();
    await testInfo.attach(`reports-needs-wants-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
  }
  // v10.31.0 — groupings apply inside ONE date range. Over the default 12 months a
  // daily view would draw more than 60 bars and coarsens by design, so step
  // through the groupings on "This month", where every grouping fits.
  await page.getByLabel('Date range').selectOption('this-month');
  for (const period of ['Day', 'Week', 'Month', 'Quarter', 'Year']) {
    await page.getByRole('tab', { name: period, exact: true }).click();
    await expect(page.getByText('Chart window:', { exact: false })).toContainText(`Grouped by ${period.toLowerCase()}`);
  }
});

test('FIN-FC-002 - Ask examples fill the composer without calling Ask Vyact', async ({ page }, testInfo) => {
  let modelCalls = 0;
  await page.route('**/functions/v1/ask-vyact', route => { modelCalls += 1; return route.fulfill({ status: 503, body: '{}' }); });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/chat');
    const composer = page.getByRole('textbox', { name: 'Your question or entry', exact: true });
    await expect(page.getByRole('heading', { name: 'Ask Vyact', exact: true })).toHaveCSS('font-weight', '400');
    for (const intent of INTENTS) {
      const example = intentExample(intent);
      if (!example) continue;
      const useExample = page.getByRole('button', { name: `Use example: ${intent.label}`, exact: true });
      await expect(useExample).toHaveText('');
      await expect(useExample).toHaveAttribute('title', `Use example: ${intent.label}`);
      await expect(useExample.locator('svg')).toHaveAttribute('width', '16');
      await expect(page.getByTestId(`ask-intent-${intent.id}`).getByRole('heading')).toHaveCSS('font-weight', '400');
      const layout = await useExample.evaluate(button => {
        const control = button.getBoundingClientRect();
        const title = button.parentElement!.querySelector('h3')!.getBoundingClientRect();
        return { width: control.width, height: control.height, separation: control.left - title.right,
          alignment: Math.abs(control.top + control.height / 2 - title.top - title.height / 2) };
      });
      expect(layout.width).toBe(44);
      expect(layout.height).toBe(44);
      expect(layout.separation).toBeGreaterThanOrEqual(0);
      expect(layout.separation).toBeLessThanOrEqual(8);
      expect(layout.alignment).toBeLessThan(1);
      await useExample.click();
      await expect(composer).toHaveValue(example);
      await expect(composer).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByTestId('ask-intent-add-expense').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 0));
    await testInfo.attach(`ask-examples-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.goto('/reports');
    await page.getByRole('button', { name: 'Ask Vyact', exact: true }).click();
    await expect(page.getByTestId('ask-intent-spend-month').getByRole('heading')).toHaveCSS('font-weight', '400');
    await page.getByRole('button', { name: 'Use example: Spend this month', exact: true }).click();
    await expect(page.locator('#ask-drawer-input')).toHaveValue('How much did I spend this month?');
    await expect(page.locator('#ask-drawer-input')).toBeFocused();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
  }
  expect(modelCalls).toBe(0);
});

test('FIN-FC-003 - follow-up questions remain editable and examples stay available after a reply', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addInitScript(() => localStorage.setItem('vt_chat_history_local', JSON.stringify([
    { role: 'user', content: 'Show my spending' },
    { role: 'assistant', content: 'Review the recorded entries.', chips: [{ label: 'Categories', prompt: 'What are my top spending categories this month?' }] },
  ])));
  await page.goto('/chat');
  const followUp = page.getByTestId('ask-vyact-chip-0');
  expect(await followUp.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByTestId('ask-vyact-chip-0').click();
  await expect(page.getByRole('textbox', { name: 'Your question or entry', exact: true })).toHaveValue('What are my top spending categories this month?');
  await page.getByRole('button', { name: 'Show examples', exact: true }).click();
  await expect(page.getByTestId('ask-intent-add-expense')).toBeVisible();
  await expect(page.getByText('Review the recorded entries.', { exact: true })).toBeVisible();
});

test('FIN-FC-004 - current household position preserves a negative net worth', async ({ page }) => {
  await seedLocalHousehold(page, seedWith({
    ...seed,
    transactions: [],
    accounts: [
      { id: 'cash-account', kind: 'cash', name: 'Cash in Hand', currency: 'USD', openingBalance: 0 },
      { id: 'card', kind: 'credit_card', name: 'Card', currency: 'USD', openingBalance: -500 },
    ],
  }));
  await page.goto('/reports');
  const position = page.getByRole('region', { name: 'Household position', exact: true });
  const netWorth = position.locator('div').filter({ has: page.locator('dt').filter({ hasText: /^Net worth$/ }) }).locator('dd');
  await expect(netWorth).toHaveText('−$500');
  await expect(position.getByText('Not available', { exact: true })).toBeVisible();
});