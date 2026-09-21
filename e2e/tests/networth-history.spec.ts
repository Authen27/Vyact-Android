import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/app';
import { seedWith, type SeedData } from '../fixtures/seed';
import { seedLocalHousehold } from '../fixtures/localHousehold';

// v10.30.0 — Net Worth history is RECORDED once a month, never reconstructed.
// The fixture clock is 2026-05-22, so the current month is 2026-05. The
// household holds one bank account (opening 1,000) and a 500 salary, so the
// canonical projection reads 1,500 (Cash in Hand is created at 0).
const household = seedWith({
  profile: { name: 'Alex', baseCurrency: 'USD', onboardedAt: '2026-05-01T00:00:00Z' },
  accounts: [{ id: 'bank', kind: 'bank', name: 'Everyday account', currency: 'USD', openingBalance: 1000 }],
  transactions: [{ id: 'salary', type: 'income', amount: 500, currency: 'USD', date: '2026-05-02', category: 'salary', description: 'Salary', toAccountId: 'bank' }],
  goals: [], budgets: [], budgetAllocations: [], recurringSchedules: [], notifications: [], assets: [], debts: [],
});

const snapshot = (month: string, netWorth: number, currency = 'USD') => ({
  month, totalAssets: netWorth, totalLiabilities: 0, netWorth, liquidAssets: netWorth, currency, recordedAt: `${month}-03T09:00:00.000Z`,
});

type Snapshot = ReturnType<typeof snapshot>;
const recorded = (page: Page) => page.evaluate(async () => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('vyact', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const rows = await new Promise<unknown>((resolve, reject) => {
    const request = database.transaction('kv', 'readonly').objectStore('kv').get('net_worth_snapshots');
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return rows as { month: string; netWorth: number; currency: string }[];
});

const seeded = (data: SeedData, extra: Record<string, unknown> = {}) => {
  test.use({ seed: data, serviceWorkers: 'block', contextOptions: { reducedMotion: 'reduce' } });
  test.beforeEach(async ({ page }) => seedLocalHousehold(page, { ...data, ...extra } as SeedData));
};

test.describe('a household with no recorded history yet', () => {
  seeded(household);

  test('NWH-FC-001 - the month is recorded once from the loaded position and a reload never rewrites it', async ({ page }) => {
    await page.goto('/networth');
    const history = page.getByRole('region', { name: 'Net worth history', exact: true });
    await expect(history.getByText('Recording started May 2026. The chart appears once a second month is recorded.')).toBeVisible();
    await expect(history.locator('.recharts-surface')).toHaveCount(0);
    await expect.poll(() => recorded(page)).toEqual([expect.objectContaining({ month: '2026-05', netWorth: 1500, currency: 'USD' })]);

    await page.reload();
    await expect(history.getByText('Recording started May 2026', { exact: false })).toBeVisible();
    expect(await recorded(page)).toHaveLength(1);
  });
});

test.describe('a household with an earlier recorded month', () => {
  seeded(household, { net_worth_snapshots: [snapshot('2026-04', 900)] as Snapshot[] });

  test('NWH-FC-002 - two recorded months draw the history line with assets and liabilities', async ({ page }, testInfo) => {
    await page.goto('/networth');
    const history = page.getByRole('region', { name: 'Net worth history', exact: true });
    // One chart (Recharts also draws each legend icon as its own svg surface).
    await expect(history.locator('.recharts-wrapper')).toHaveCount(1);
    await expect(history.locator('.recharts-area-curve').first()).toBeVisible();
    await expect(history.getByText('Apr 2026')).toBeVisible();
    await expect(history.getByText('May 2026')).toBeVisible();
    await expect(history.getByText(/Recording started/)).toHaveCount(0);
    await expect.poll(() => recorded(page)).toEqual([
      expect.objectContaining({ month: '2026-04', netWorth: 900 }),
      expect.objectContaining({ month: '2026-05', netWorth: 1500 }),
    ]);
    await history.scrollIntoViewIfNeeded();
    await testInfo.attach('networth-history', { body: await history.screenshot(), contentType: 'image/png' });
  });
});

test.describe('a household that changed its currency', () => {
  seeded(household, { net_worth_snapshots: [snapshot('2026-03', 700, 'EUR')] as Snapshot[] });

  test('NWH-FC-003 - months recorded in a previous currency are counted but never drawn', async ({ page }) => {
    await page.goto('/networth');
    const history = page.getByRole('region', { name: 'Net worth history', exact: true });
    await expect(history.getByText('1 month recorded in a previous household currency is not shown.')).toBeVisible();
    await expect(history.getByText('Recording started May 2026', { exact: false })).toBeVisible();
    await expect(history.locator('.recharts-surface')).toHaveCount(0);
  });
});
