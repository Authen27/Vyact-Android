import { test, expect } from '../fixtures/app';
import { seedWith } from '../fixtures/seed';

test.describe('§20 ONB-FC · onboarding and templates', () => {
  test.use({
    seed: seedWith({
      profile: {
        template: undefined,
        household: 'personal',
        onboardedAt: undefined,
      },
      transactions: [],
      budgets: [],
      goals: [],
      debts: [],
      assets: [],
      members: [],
    }),
  });

  test('ONB-FC-004 · fresh local users land on the dashboard without a forced onboarding redirect', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL('**/dashboard');

    await expect(page).not.toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Building your Pulse — add income and a budget to begin.')).toBeVisible();
    await expect(page.getByText('No budgets yet')).toBeVisible();
  });

  test('ONB-FC-002 · skip applies the family template starter data', async ({ page }) => {
    await page.goto('/onboarding');
    await page.waitForURL('**/onboarding');

    await expect(page.getByRole('heading', { name: 'Which best describes you?' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip — use Family with Kids template' }).click();

    await page.waitForURL('**/dashboard');
    await expect(page.getByText('Welcome — Family with Kids template applied')).toBeVisible();

    const seeded = await page.evaluate(() => {
      const win = window as typeof window & {
        __vt_store?: { getState(): { budgets: unknown[]; goals: unknown[]; debts: unknown[]; profile: { template?: string; primaryConcern?: string; household?: string } } };
        __ff_store?: { getState(): { budgets: unknown[]; goals: unknown[]; debts: unknown[]; profile: { template?: string; primaryConcern?: string; household?: string } } };
      };
      const store = win.__vt_store ?? win.__ff_store;
      if (!store) throw new Error('Store oracle unavailable');
      const state = store.getState();
      return {
        budgets: state.budgets.length,
        goals: state.goals.length,
        debts: state.debts.length,
        template: state.profile.template,
        primaryConcern: state.profile.primaryConcern,
        household: state.profile.household,
      };
    });

    expect(seeded).toMatchObject({
      budgets: 7,
      goals: 3,
      debts: 1,
      template: 'family',
      primaryConcern: 'spending',
      household: 'family',
    });
  });

  test('ONB-FC-005 · completing onboarding sets onboardedAt and flips the Settings relaunch label', async ({ page }) => {
    await page.goto('/onboarding');
    await page.waitForURL('**/onboarding');

    await page.getByRole('button', { name: 'Skip — use Family with Kids template' }).click();
    await page.waitForURL('**/dashboard');

    const onboardedAt = await page.evaluate(() => {
      const win = window as typeof window & {
        __vt_store?: { getState(): { profile: { onboardedAt?: string } } };
        __ff_store?: { getState(): { profile: { onboardedAt?: string } } };
      };
      const store = win.__vt_store ?? win.__ff_store;
      if (!store) throw new Error('Store oracle unavailable');
      return store.getState().profile.onboardedAt;
    });

    expect(onboardedAt).toBeTruthy();

    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await expect(page.getByRole('link', { name: 'Re-run onboarding wizard →' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Run onboarding wizard →' })).toHaveCount(0);
  });

  test('ONB-FC-003 · chosen primary concern persists in onboarding profile metadata', async ({ page }) => {
    await page.goto('/onboarding');
    await page.waitForURL('**/onboarding');

    await page.getByRole('button', { name: /Family with Kids/i }).first().click();
    await page.getByRole('button', { name: /^Next$/ }).click();

    await page.getByRole('button', { name: /^3$/ }).click();
    await page.getByRole('button', { name: /^Next$/ }).click();

    await page.getByRole('button', { name: /Pay off debt/i }).click();
    await page.getByRole('button', { name: /^Next$/ }).click();

    await page.getByRole('button', { name: /Get started/i }).click();
    await page.waitForURL('**/dashboard');

    const persisted = await page.evaluate(() => {
      const win = window as typeof window & {
        __vt_store?: { getState(): { profile: { template?: string; primaryConcern?: string; household?: string } } };
        __ff_store?: { getState(): { profile: { template?: string; primaryConcern?: string; household?: string } } };
      };
      const store = win.__vt_store ?? win.__ff_store;
      if (!store) throw new Error('Store oracle unavailable');
      return store.getState().profile;
    });

    expect(persisted).toMatchObject({
      template: 'family',
      primaryConcern: 'debt',
      household: 'family',
    });
  });
});