import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/app';
import { seedWith } from '../fixtures/seed';
import { seedLocalHousehold } from '../fixtures/localHousehold';

// v10.32.0 — the approval-aware bill calendar (docs/INSIGHTS_ASK_REPORTS_UX.md).
// Fixture clock: Friday 2026-05-22. Three schedules on one bank account:
//   Rent     auto-approve, monthly on the 25th        → May 25 "Posts automatically"
//   Salary   auto-approve, monthly on the 1st (income) → Jun 1
//   Cleaner  APPROVAL, weekly on Saturday, pointer May 16 (6 days overdue)
//            → May 16 "Awaiting your approval"; May 23 … Jun 20 "You approve when due"
const schedule = (id: string, patch: Record<string, unknown>, template: Record<string, unknown>) => ({
  id, frequency: 'monthly', active: true, autoConfirm: true, reminderLeadDays: 3,
  transactionTemplate: { type: 'expense', currency: 'USD', accountId: 'bank', ...template },
  ...patch,
});

const seed = seedWith({
  profile: { name: 'Alex', baseCurrency: 'USD', onboardedAt: '2026-01-01T00:00:00Z' },
  accounts: [{ id: 'bank', kind: 'bank', name: 'Everyday account', currency: 'USD', openingBalance: 5000 }],
  transactions: [{ id: 'opening-salary', type: 'income', amount: 3000, currency: 'USD', date: '2026-05-01', category: 'salary', description: 'Salary', toAccountId: 'bank' }],
  recurringSchedules: [
    schedule('rent', { startDate: '2026-01-25', nextDueDate: '2026-05-25', dayOfMonth: 25, rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=25' },
      { amount: 1200, description: 'Rent', category: 'rent_mortgage' }),
    schedule('salary', { startDate: '2026-01-01', nextDueDate: '2026-06-01', dayOfMonth: 1, rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1' },
      { type: 'income', amount: 3000, description: 'Monthly salary', category: 'salary', accountId: undefined, toAccountId: 'bank' }),
    schedule('cleaner', { frequency: 'weekly', autoConfirm: false, startDate: '2026-04-04', nextDueDate: '2026-05-16', rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=SA' },
      { amount: 50, description: 'Cleaner', category: 'other_expense' }),
  ],
  goals: [], budgets: [], budgetAllocations: [], assets: [], debts: [], notifications: [],
});

test.use({ seed, serviceWorkers: 'block', contextOptions: { reducedMotion: 'reduce' } });
test.beforeEach(async ({ page }) => seedLocalHousehold(page, seed));

type StoreWindow = Window & { __ff_store?: { getState(): { transactions: { recurringScheduleId?: string; date: string }[]; recurringSchedules: { id: string; nextDueDate: string }[] } } };
const cleanerPosted = (page: Page) => page.evaluate(() => (window as StoreWindow).__ff_store!.getState().transactions
  .filter(transaction => transaction.recurringScheduleId === 'cleaner').map(transaction => transaction.date));
const cleanerPointer = (page: Page) => page.evaluate(() => (window as StoreWindow).__ff_store!.getState().recurringSchedules
  .find(row => row.id === 'cleaner')?.nextDueDate);

test('BILL-FC-001 - the calendar states what each occurrence will do and totals the window', async ({ page }, testInfo) => {
  await page.goto('/recurring');
  const calendar = page.getByRole('region', { name: 'Bill calendar', exact: true });
  await expect(calendar).toBeVisible();
  const rows = calendar.getByTestId('bill-occurrence');
  await expect(rows).toHaveCount(8);   // cleaner ×6 (May 16…Jun 20), rent, salary
  await expect(rows.first()).toContainText('Cleaner');
  await expect(rows.first()).toContainText('Awaiting your approval');
  await expect(calendar.getByText('6 days overdue', { exact: false })).toBeVisible();
  await expect(rows.filter({ hasText: 'Rent' })).toContainText('Posts automatically');
  await expect(rows.filter({ hasText: 'Monthly salary' })).toContainText('+$3,000');
  await expect(rows.filter({ hasText: 'You approve when due' })).toHaveCount(5);
  await expect(calendar.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(1);
  await expect(calendar).toContainText('Going out$1,500');
  await expect(calendar).toContainText('Coming in$3,000');
  await expect(calendar).toContainText('Awaiting approval1');

  await calendar.getByRole('tab', { name: 'Next 7 days', exact: true }).click();
  await expect(rows).toHaveCount(3);   // cleaner May 16 + May 23, rent May 25
  await expect(calendar.getByText('Monthly salary')).toHaveCount(0);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const body = await calendar.screenshot({ path: testInfo.outputPath(`bill-calendar-${width}.png`) });
    await testInfo.attach(`bill-calendar-${width}`, { body, contentType: 'image/png' });
  }
});

test('BILL-FC-002 - approving the due occurrence posts it once and moves the schedule on', async ({ page }) => {
  await page.goto('/recurring');
  const calendar = page.getByRole('region', { name: 'Bill calendar', exact: true });
  await calendar.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved — transaction posted').first()).toBeVisible();
  await expect.poll(() => cleanerPosted(page)).toEqual(['2026-05-16']);
  await expect.poll(() => cleanerPointer(page)).toBe('2026-05-23');
  await expect(calendar.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await expect(calendar.getByText('Awaiting your approval')).toHaveCount(0);
  await expect(calendar.getByTestId('bill-occurrence').first()).toContainText('You approve when due');
});

test('BILL-FC-003 - skipping once moves the schedule on without posting anything', async ({ page }) => {
  await page.goto('/recurring');
  const calendar = page.getByRole('region', { name: 'Bill calendar', exact: true });
  page.once('dialog', dialog => dialog.accept());
  await calendar.getByRole('button', { name: 'Skip once', exact: true }).click();
  await expect(page.getByText('Skipped once').first()).toBeVisible();
  await expect.poll(() => cleanerPointer(page)).toBe('2026-05-23');
  expect(await cleanerPosted(page)).toEqual([]);
  await expect(calendar.getByText('overdue', { exact: false })).toHaveCount(0);
});
