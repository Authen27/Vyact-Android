import { expect, test, openSettingsRow } from '../fixtures/app';
import { readFile } from 'node:fs/promises';
import { defaultSeed } from '../fixtures/seed';

test.describe('§18 BACKUP-FC · Backup and data portability', () => {
  test.use({ seed: defaultSeed });

  test('BACKUP-FC-001 · downloaded JSON backup contains the current snapshot payload', async ({ page }, testInfo) => {
    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await openSettingsRow(page, 'Sync & backup');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Backup' }).click();
    const download = await downloadPromise;

    const filePath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(filePath);
    const raw = await readFile(filePath, 'utf8');
    const backup = JSON.parse(raw) as {
      version: string;
      exported: string;
      household: { name: string; type: string; currency: string; members: unknown[] } | null;
      transactions: unknown[];
      splits: { sharedByYou: unknown[]; sharedWithYou: unknown[] };
      debts: unknown[];
      accounts: unknown[];
      netWorth: { assets: unknown[]; monthlyHistory: unknown[] };
      recurringSchedules: unknown[];
    };

    // T4b (v10.125.0; audit XC-PRV-08; owner, 19 Oct 2026): exactly the owner's list, nothing else.
    expect(backup.version).toBe('10.125.0');
    expect(Object.keys(backup)).toEqual(['version', 'appVersion', 'exported', 'household', 'transactions', 'splits',
      'debts', 'accounts', 'netWorth', 'recurringSchedules']);
    expect(backup.exported).toBe('2026-05-22');
    expect(backup.household).toMatchObject({ currency: 'USD', members: [] });
    expect(backup.transactions).toHaveLength(3);
    expect(backup.debts).toHaveLength(0);
    expect(backup.netWorth.assets).toHaveLength(1);
    for (const list of [backup.accounts, backup.recurringSchedules, backup.netWorth.monthlyHistory,
      backup.splits.sharedByYou, backup.splits.sharedWithYou]) expect(Array.isArray(list)).toBe(true);
    // No budgets, goals or profile (the seed has one budget and one goal, and the profile's email).
    expect(raw).not.toMatch(/"(budgets|budgetAllocations|goals|profile)"/);
    expect(raw).not.toContain('test@example.com');
    // W3b (owner decision D14): one currency per household — a backup carries no exchange rates.
    expect(backup).not.toHaveProperty('exchangeRates');
  });

  test('BACKUP-FC-002 · Download Backup uses the shipped Vyact filename pattern and success toast', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await openSettingsRow(page, 'Sync & backup');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Backup' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('vyact-backup-2026-05-22.json');
    await expect(page.getByText('Backup downloaded')).toBeVisible();
  });

  test('BACKUP-FC-003 · Copy to Clipboard writes the full JSON snapshot and surfaces success feedback', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await openSettingsRow(page, 'Sync & backup');

    await page.evaluate(() => {
      Object.defineProperty(window, '__copiedBackup', {
        configurable: true,
        writable: true,
        value: '',
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as unknown as Window & { __copiedBackup: string }).__copiedBackup = text;
          },
        },
      });
    });

    await page.getByRole('button', { name: 'Copy to Clipboard' }).click();
    await expect(page.getByText('Backup copied')).toBeVisible();

    const copied = await page.evaluate(() => (window as unknown as Window & { __copiedBackup: string }).__copiedBackup);
    const backup = JSON.parse(copied) as {
      household: { currency: string } | null;
      transactions: unknown[];
    };

    expect(backup.household?.currency).toBe('USD');
    expect(backup.transactions).toHaveLength(3);
    expect(backup).not.toHaveProperty('exchangeRates');
  });

  test('BACKUP-FC-004 · CSV export contains the shipped transaction columns for the current dataset', async ({ page }, testInfo) => {
    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await openSettingsRow(page, 'Sync & backup');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const download = await downloadPromise;

    const filePath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(filePath);
    const csv = await readFile(filePath, 'utf8');

    expect(csv).toContain('"Date","Type","Description","Category","Amount","Currency","Note"');
    expect(csv).toContain('"2026-05-01","income","E2E Salary","salary","5000","USD",""');
    expect(csv).toContain('"2026-05-05","expense","E2E Rent","housing","1200","USD",""');
    expect(csv).toContain('"2026-05-10","expense","E2E Grocery","food","350","USD",""');
    await expect(page.getByText('CSV exported')).toBeVisible();
  });

  test('BACKUP-FC-005 · backup and export actions remain reachable in local-only mode', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await openSettingsRow(page, 'Sync & backup');

    await expect(page.getByRole('button', { name: 'Download Backup' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy to Clipboard' })).toBeVisible();
    await expect(page.getByText('Cloud not configured. Running locally only.')).toBeVisible();
  });
});