import { test, expect } from '../fixtures/app';
import { defaultSeed } from '../fixtures/seed';

async function fillAssetModal(page: import('@playwright/test').Page, input: {
  type?: string;
  liquidity?: 'liquid' | 'short' | 'long';
  name?: string;
  value?: number;
  currency?: string;
  note?: string;
}) {
  const dialog = page.getByRole('dialog', { name: /add asset|edit asset/i });
  await expect(dialog).toBeVisible();
  if (input.type !== undefined) await dialog.getByLabel('Type').selectOption(input.type);
  if (input.liquidity !== undefined) await dialog.getByLabel('Liquidity').selectOption(input.liquidity);
  if (input.name !== undefined) await dialog.getByLabel('Name').fill(input.name);
  if (input.value !== undefined) await dialog.getByLabel('Current value').fill(String(input.value));
  if (input.currency !== undefined) await dialog.getByLabel('Currency').selectOption(input.currency);
  if (input.note !== undefined) await dialog.getByLabel('Note').fill(input.note);
  return dialog;
}

async function fillDebtModal(page: import('@playwright/test').Page, input: {
  type?: string;
  name?: string;
  currentBalance?: number;
  currency?: string;
  interestRate?: number;
  minimumPayment?: number;
}) {
  const dialog = page.getByRole('dialog', { name: /add debt|edit debt/i });
  await expect(dialog).toBeVisible();
  if (input.type !== undefined) await dialog.getByLabel('Type').selectOption(input.type);
  if (input.name !== undefined) await dialog.getByLabel('Name').fill(input.name);
  if (input.currentBalance !== undefined) await dialog.getByLabel('Current balance').fill(String(input.currentBalance));
  if (input.currency !== undefined) await dialog.getByLabel('Currency').selectOption(input.currency);
  if (input.interestRate !== undefined) await dialog.getByLabel('Interest rate').fill(String(input.interestRate));
  if (input.minimumPayment !== undefined) await dialog.getByLabel('Min. monthly payment').fill(String(input.minimumPayment));
  return dialog;
}

test.describe('§4/§8 NWRT-FC and ASSET-FC', () => {
  test.use({ seed: defaultSeed });

  test('ASSET-FC-001 · creates assets across liquid, short, and long liquidity tiers', async ({
    page, networth,
  }) => {
    await networth.goto();

    await networth.openAddAsset();
    let dialog = await fillAssetModal(page, {
      type: 'checking',
      liquidity: 'liquid',
      name: 'ASSET-FC-001 Liquid',
      value: 1250,
    });
    await dialog.getByRole('button', { name: /^Add$/ }).click();
    await expect(dialog).toBeHidden();

    await networth.openAddAsset();
    dialog = await fillAssetModal(page, {
      type: 'investment',
      liquidity: 'short',
      name: 'ASSET-FC-001 Short',
      value: 2500,
    });
    await dialog.getByRole('button', { name: /^Add$/ }).click();
    await expect(dialog).toBeHidden();

    await networth.openAddAsset();
    dialog = await fillAssetModal(page, {
      type: 'real_estate',
      liquidity: 'long',
      name: 'ASSET-FC-001 Long',
      value: 50000,
    });
    await dialog.getByRole('button', { name: /^Add$/ }).click();
    await expect(dialog).toBeHidden();

    await expect(networth.assetRow('ASSET-FC-001 Liquid')).toBeVisible();
    await expect(networth.assetRow('ASSET-FC-001 Short')).toBeVisible();
    await expect(networth.assetRow('ASSET-FC-001 Long')).toBeVisible();
    await expect(page.getByText(/Liquid ·/)).toBeVisible();
    await expect(page.getByText(/Short-term ·/)).toBeVisible();
    await expect(page.getByText(/Long-term ·/)).toBeVisible();
  });

  test('ASSET-FC-002 · editing an asset updates value and lastUpdated in the store', async ({
    page, networth,
  }) => {
    await networth.goto();

    // UI gap: asset rows expose icon-only edit buttons with no accessible name.
    // Open the edit modal via the dev store hook until the row actions have a
    // stable accessible contract.
    await page.evaluate(() => {
      const win = window as typeof window & {
        __vt_store?: { getState(): { assets: { id: string; name: string }[]; openEditAsset(a: unknown): void } };
        __ff_store?: { getState(): { assets: { id: string; name: string }[]; openEditAsset(a: unknown): void } };
      };
      const store = win.__vt_store ?? win.__ff_store;
      if (!store) throw new Error('Store oracle unavailable');
      const asset = store.getState().assets.find(a => a.name === 'E2E Checking');
      if (!asset) throw new Error('Seed asset missing');
      store.getState().openEditAsset(asset);
    });

    const before = await page.evaluate(() => {
      const win = window as typeof window & {
        __vt_store?: { getState(): { assets: { name: string; lastUpdated?: string }[] } };
        __ff_store?: { getState(): { assets: { name: string; lastUpdated?: string }[] } };
      };
      const store = win.__vt_store ?? win.__ff_store;
      return store?.getState().assets.find(a => a.name === 'E2E Checking')?.lastUpdated ?? null;
    });

    const dialog = await fillAssetModal(page, { value: 9100, note: 'ASSET-FC-002 updated' });
    await dialog.getByRole('button', { name: /^Update$/ }).click();
    await expect(dialog).toBeHidden();

    await expect(networth.assetRow('E2E Checking')).toBeVisible();
    await expect(page.getByText(/9,100/).first()).toBeVisible();

    const after = await page.evaluate(() => {
      const win = window as typeof window & {
        __vt_store?: { getState(): { assets: { name: string; value: number; note?: string; lastUpdated?: string }[] } };
        __ff_store?: { getState(): { assets: { name: string; value: number; note?: string; lastUpdated?: string }[] } };
      };
      const store = win.__vt_store ?? win.__ff_store;
      return store?.getState().assets.find(a => a.name === 'E2E Checking') ?? null;
    });

    expect(after).not.toBeNull();
    expect(after!.value).toBe(9100);
    expect(after!.note).toBe('ASSET-FC-002 updated');
    expect(after!.lastUpdated).toBeTruthy();
    expect(after!.lastUpdated).not.toBe(before);
  });

  test('NWRT-FC-003 · adding an asset increases total assets', async ({
    page, networth,
  }) => {
    await networth.goto();
    const before = await networth.readAmount(networth.totalAssetsRow);

    await networth.openAddAsset();
    const dialog = await fillAssetModal(page, {
      type: 'real_estate',
      liquidity: 'long',
      name: 'NWRT-FC-003 Property',
      value: 500000,
    });
    await dialog.getByRole('button', { name: /^Add$/ }).click();
    await expect(dialog).toBeHidden();

    const after = await networth.readAmount(networth.totalAssetsRow);
    expect(after).toBeCloseTo(before + 500000, 2);
    await expect(networth.assetRow('NWRT-FC-003 Property')).toBeVisible();
  });

  test('NWRT-FC-004 · adding a debt increases total liabilities', async ({
    page, networth, debts,
  }) => {
    await networth.goto();
    const before = await networth.readAmount(networth.totalLiabilitiesRow);

    await debts.goto();
    await debts.openAdd();
    const dialog = await fillDebtModal(page, {
      type: 'mortgage',
      name: 'NWRT-FC-004 Mortgage',
      currentBalance: 300000,
      interestRate: 6.5,
      minimumPayment: 1800,
    });
    await dialog.getByRole('button', { name: /^Add$/ }).click();
    await expect(dialog).toBeHidden();

    await networth.goto();
    const after = await networth.readAmount(networth.totalLiabilitiesRow);
    expect(after).toBeCloseTo(before + 300000, 2);
    await expect(page.getByText('NWRT-FC-004 Mortgage')).toBeVisible();
  });

  test('ASSET-FC-004 · liquidity ratio only uses liquid-tier assets', async ({
    page, networth,
  }) => {
    await networth.goto();
    const before = page.getByText('Liquidity Ratio').locator('..');
    await expect(before).toContainText('8.0x');

    await networth.openAddAsset();
    const dialog = await fillAssetModal(page, {
      type: 'real_estate',
      liquidity: 'long',
      name: 'ASSET-FC-004 Long Asset',
      value: 120000,
    });
    await dialog.getByRole('button', { name: /^Add$/ }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText('ASSET-FC-004 Long Asset')).toBeVisible();
    await expect(page.getByText('Liquidity Ratio').locator('..')).toContainText('8.0x');
  });
});