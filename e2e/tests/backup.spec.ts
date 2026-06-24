import { expect, test } from '../fixtures/app';
import { readFile } from 'node:fs/promises';

test.describe('§18 BACKUP-FC · Backup and data portability', () => {
  test('BACKUP-FC-001 · downloaded JSON backup contains the current snapshot payload', async ({ page }, testInfo) => {
    await page.goto('/settings');
    await page.waitForURL('**/settings');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Backup' }).click();
    const download = await downloadPromise;

    const filePath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(filePath);
    const raw = await readFile(filePath, 'utf8');
    const backup = JSON.parse(raw) as {
      version: string;
      exported: string;
      profile: { name: string; email: string; baseCurrency: string };
      transactions: unknown[];
      budgets: unknown[];
      goals: unknown[];
      members: unknown[];
      debts: unknown[];
      assets: unknown[];
      exchangeRates: Record<string, number>;
    };

    expect(backup.version).toBe('6.4.9');
    expect(backup.exported).toBe('2026-05-22');
    expect(backup.profile).toMatchObject({
      name: 'Test User',
      email: 'test@example.com',
      baseCurrency: 'USD',
    });
    expect(backup.transactions).toHaveLength(3);
    expect(backup.budgets).toHaveLength(1);
    expect(backup.goals).toHaveLength(1);
    expect(backup.members).toHaveLength(0);
    expect(backup.debts).toHaveLength(0);
    expect(backup.assets).toHaveLength(1);
    expect(backup.exchangeRates.USD).toBe(1);
  });

  test('BACKUP-FC-002 · Download Backup uses the shipped Vyact filename pattern and success toast', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForURL('**/settings');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Backup' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('vyact-backup-2026-05-22.json');
    await expect(page.getByText('Backup downloaded')).toBeVisible();
  });

  test('BACKUP-FC-003 · Copy to Clipboard writes the full JSON snapshot and surfaces success feedback', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForURL('**/settings');

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
            (window as Window & { __copiedBackup: string }).__copiedBackup = text;
          },
        },
      });
    });

    await page.getByRole('button', { name: 'Copy to Clipboard' }).click();
    await expect(page.getByText('Backup copied')).toBeVisible();

    const copied = await page.evaluate(() => (window as Window & { __copiedBackup: string }).__copiedBackup);
    const backup = JSON.parse(copied) as {
      profile: { name: string };
      transactions: unknown[];
      exchangeRates: Record<string, number>;
    };

    expect(backup.profile.name).toBe('Test User');
    expect(backup.transactions).toHaveLength(3);
    expect(backup.exchangeRates.USD).toBe(1);
  });

  test('BACKUP-FC-004 · CSV export contains the shipped transaction columns for the current dataset', async ({ page }, testInfo) => {
    await page.goto('/settings');
    await page.waitForURL('**/settings');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const download = await downloadPromise;

    const filePath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(filePath);
    const csv = await readFile(filePath, 'utf8');

    expect(csv).toContain('"Date","Type","Description","Category","Amount","Currency","Note"');
    expect(csv).toContain('"2026-05-05","income","E2E Salary","salary","5000","USD","seed income"');
    expect(csv).toContain('"2026-05-07","expense","E2E Rent","housing","1500","USD","seed rent"');
    expect(csv).toContain('"2026-05-10","expense","E2E Grocery","food","120","USD","seed grocery"');
    await expect(page.getByText('CSV exported')).toBeVisible();
  });

  test('BACKUP-FC-005 · backup and export actions remain reachable in local-only mode', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForURL('**/settings');

    await expect(page.getByRole('button', { name: 'Download Backup' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy to Clipboard' })).toBeVisible();
    await expect(page.getByText('Cloud not configured. Running locally only.')).toBeVisible();
  });
});