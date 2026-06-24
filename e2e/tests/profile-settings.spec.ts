import { test, expect } from '../fixtures/app';

async function storeTheme(page: Parameters<typeof test>[0]['page']) {
  return page.evaluate(() => {
    const win = window as typeof window & {
      __vt_store?: { getState(): { theme: string } };
      __ff_store?: { getState(): { theme: string } };
    };
    const store = win.__vt_store ?? win.__ff_store;
    if (!store) throw new Error('Store oracle unavailable');
    return store.getState().theme;
  });
}

function cardValueByLabel(page: Parameters<typeof test>[0]['page'], label: string) {
  return page.locator('div').filter({ has: page.getByText(label, { exact: true }) }).locator('span[title]').first();
}

function debtCard(page: Parameters<typeof test>[0]['page'], name: string) {
  return page.locator('div').filter({ has: page.getByText(name, { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Edit' }) }).first();
}

test.describe('§15 PROFILE-FC · Settings profile behavior', () => {
  test('PROFILE-FC-001 · edit name and email persists after save and reload', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForURL('**/settings');

    const nameInput = page.getByLabel('Display Name');
    const emailInput = page.getByLabel('Email');

    await nameInput.fill('PROFILE-FC-001 User');
    await emailInput.fill('profile-fc-001@example.com');
    await page.getByRole('button', { name: 'Save Profile' }).click();

    await expect(page.getByText('Profile saved')).toBeVisible();
    await expect.poll(async () => page.evaluate(() => {
      const win = window as typeof window & {
        __vt_store?: { getState(): { profile: { name: string; email: string } } };
        __ff_store?: { getState(): { profile: { name: string; email: string } } };
      };
      const store = win.__vt_store ?? win.__ff_store;
      if (!store) throw new Error('Store oracle unavailable');
      return store.getState().profile;
    })).toMatchObject({
      name: 'PROFILE-FC-001 User',
      email: 'profile-fc-001@example.com',
    });

    await page.reload();
    await page.waitForURL('**/settings');
    await expect(page.getByLabel('Display Name')).toHaveValue('PROFILE-FC-001 User');
    await expect(page.getByLabel('Email')).toHaveValue('profile-fc-001@example.com');
  });

  test('PROFILE-FC-002 · changing base currency reformats computed money displays', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/dashboard');

    await expect(cardValueByLabel(page, 'Total Balance')).toHaveAttribute('title', '$3,450.00');
    await expect(cardValueByLabel(page, 'Monthly Income')).toHaveAttribute('title', '$5,000.00');
    await expect(cardValueByLabel(page, 'Monthly Expenses')).toHaveAttribute('title', '$1,550.00');

    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await page.getByLabel('Base Currency').selectOption('EUR');

    await expect.poll(async () => page.evaluate(() => {
      const win = window as typeof window & {
        __vt_store?: { getState(): { profile: { baseCurrency: string } } };
        __ff_store?: { getState(): { profile: { baseCurrency: string } } };
      };
      const store = win.__vt_store ?? win.__ff_store;
      if (!store) throw new Error('Store oracle unavailable');
      return store.getState().profile.baseCurrency;
    })).toBe('EUR');

    await expect(page.getByText('Monthly Extra Payment (EUR)')).toBeVisible();

    await page.goto('/dashboard');
    await page.waitForURL('**/dashboard');
    await expect(cardValueByLabel(page, 'Total Balance')).toHaveAttribute('title', '3.174,00 €');
    await expect(cardValueByLabel(page, 'Monthly Income')).toHaveAttribute('title', '5.000,00 €');
    await expect(cardValueByLabel(page, 'Monthly Expenses')).toHaveAttribute('title', '1.426,00 €');

    await page.goto('/reports');
    await page.waitForURL('**/reports');
    await expect(cardValueByLabel(page, 'All-Time Income')).toHaveAttribute('title', '5.000,00 €');
    await expect(cardValueByLabel(page, 'All-Time Expenses')).toHaveAttribute('title', '1.426,00 €');
    await expect(cardValueByLabel(page, 'Net Flow')).toHaveAttribute('title', '3.174,00 €');
  });

  test('PROFILE-FC-003 · changing language and date format updates shipped UI labels and row dates', async ({
    page,
    transactions,
  }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await page.getByLabel('Language').selectOption('es');

    await page.goto('/dashboard');
    await page.waitForURL('**/dashboard');
    await expect(page.getByRole('heading', { name: 'Panel' })).toBeVisible();

    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible();

    await transactions.goto();
    const txnRow = transactions.row('E2E Grocery');
    await expect(txnRow).toContainText('May 10, 2026');

    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await page.getByLabel('Date Format').selectOption('eu');

    await transactions.goto();
    await expect(txnRow).toContainText('10 May 2026');

    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await page.getByLabel('Date Format').selectOption('iso');

    await transactions.goto();
    await expect(txnRow).toContainText('2026-05-10');
  });

  test('PROFILE-FC-004 · changing household type persists in profile settings', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForURL('**/settings');

    const householdType = page.getByLabel('Household Type');

    await expect(householdType).toHaveValue('family');
    await householdType.selectOption('business');

    await expect.poll(async () => page.evaluate(() => {
      const win = window as typeof window & {
        __vt_store?: { getState(): { profile: { household: string } } };
        __ff_store?: { getState(): { profile: { household: string } } };
      };
      const store = win.__vt_store ?? win.__ff_store;
      if (!store) throw new Error('Store oracle unavailable');
      return store.getState().profile.household;
    })).toBe('business');

    await page.reload();
    await page.waitForURL('**/settings');
    await expect(page.getByLabel('Household Type')).toHaveValue('business');

    await page.getByLabel('Household Type').selectOption('family');
    await expect.poll(async () => page.evaluate(() => {
      const win = window as typeof window & {
        __vt_store?: { getState(): { profile: { household: string } } };
        __ff_store?: { getState(): { profile: { household: string } } };
      };
      const store = win.__vt_store ?? win.__ff_store;
      if (!store) throw new Error('Store oracle unavailable');
      return store.getState().profile.household;
    })).toBe('family');
  });

  test('PROFILE-FC-007 · theme switch persists across reload', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForURL('**/settings');

    const warmCard = page.locator('button', { hasText: 'Cream & coral' });
    const darkCard = page.locator('button', { hasText: 'Warm palette on dark ink' });
    const systemCard = page.locator('button', { hasText: 'Follow OS preference' });

    await darkCard.click();
    await expect(darkCard).toContainText('Active');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => storeTheme(page)).toBe('dark');

    await page.reload();
    await page.waitForURL('**/settings');
    await expect(darkCard).toContainText('Active');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => storeTheme(page)).toBe('dark');

    await warmCard.click();
    await expect(warmCard).toContainText('Active');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'warm');
    await expect.poll(() => storeTheme(page)).toBe('warm');

    await page.reload();
    await page.waitForURL('**/settings');
    await expect(warmCard).toContainText('Active');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'warm');
    await expect.poll(() => storeTheme(page)).toBe('warm');

    await systemCard.click();
    await expect(systemCard).toContainText('Active');
    await expect.poll(() => storeTheme(page)).toBe('system');

    await page.reload();
    await page.waitForURL('**/settings');
    await expect(systemCard).toContainText('Active');
    await expect.poll(() => storeTheme(page)).toBe('system');
  });

  test('PROFILE-FC-008 · sensitive data actions are surfaced only in Settings', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/dashboard');

    await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Download Backup' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copy to Clipboard' })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button').first().click();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Download Backup' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Settings' }).click();
    await page.waitForURL('**/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Exported files can leave the app and any destructive data-reset workflow should be triggered only from Settings after an explicit review.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download Backup' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy to Clipboard' })).toBeVisible();
  });

  test.describe('exchange rates', () => {
    test.use({
      seed: {
        profile: {
          name: 'FX User',
          email: 'fx@example.com',
          baseCurrency: 'USD',
          language: 'en',
          household: 'family',
          dateFormat: 'us',
          payoffStrategy: 'avalanche',
          extraPayment: 0,
        },
        transactions: [
          {
            id: '00000000-0000-4000-8000-0000000000f1',
            type: 'income',
            amount: 100,
            currency: 'EUR',
            date: '2026-05-01',
            description: 'FX income',
            category: 'salary',
          },
          {
            id: '00000000-0000-4000-8000-0000000000f2',
            type: 'expense',
            amount: 40,
            currency: 'EUR',
            date: '2026-05-05',
            description: 'FX expense',
            category: 'food',
          },
        ],
        budgets: [],
        goals: [],
        debts: [],
        assets: [],
        exchangeRates: {
          USD: 1,
          EUR: 1,
        },
      },
    });

    test('FX-FC-001 · editing an exchange rate re-renders converted totals everywhere', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForURL('**/dashboard');

      await expect(cardValueByLabel(page, 'Total Balance')).toHaveAttribute('title', '$60.00');
      await expect(cardValueByLabel(page, 'Monthly Income')).toHaveAttribute('title', '$100.00');
      await expect(cardValueByLabel(page, 'Monthly Expenses')).toHaveAttribute('title', '$40.00');

      await page.goto('/reports');
      await page.waitForURL('**/reports');
      await expect(cardValueByLabel(page, 'All-Time Income')).toHaveAttribute('title', '$100.00');
      await expect(cardValueByLabel(page, 'All-Time Expenses')).toHaveAttribute('title', '$40.00');
      await expect(cardValueByLabel(page, 'Net Flow')).toHaveAttribute('title', '$60.00');

      await page.goto('/settings');
      await page.waitForURL('**/settings');
      await page.getByDisplayValue('1').nth(1).fill('2');
      await page.getByDisplayValue('2').nth(0).blur();
      await expect(page.getByText('EUR rate updated')).toBeVisible();

      await page.goto('/dashboard');
      await page.waitForURL('**/dashboard');
      await expect(cardValueByLabel(page, 'Total Balance')).toHaveAttribute('title', '$120.00');
      await expect(cardValueByLabel(page, 'Monthly Income')).toHaveAttribute('title', '$200.00');
      await expect(cardValueByLabel(page, 'Monthly Expenses')).toHaveAttribute('title', '$80.00');

      await page.goto('/reports');
      await page.waitForURL('**/reports');
      await expect(cardValueByLabel(page, 'All-Time Income')).toHaveAttribute('title', '$200.00');
      await expect(cardValueByLabel(page, 'All-Time Expenses')).toHaveAttribute('title', '$80.00');
      await expect(cardValueByLabel(page, 'Net Flow')).toHaveAttribute('title', '$120.00');
    });
  });

  test.describe('base currency re-anchor', () => {
    test.use({
      seed: {
        profile: {
          name: 'FX Base Currency User',
          email: 'fx-base@example.com',
          baseCurrency: 'USD',
          language: 'en',
          household: 'family',
          dateFormat: 'us',
          payoffStrategy: 'avalanche',
          extraPayment: 0,
        },
        transactions: [
          {
            id: '00000000-0000-4000-8000-0000000000f3',
            type: 'income',
            amount: 10.25,
            currency: 'EUR',
            date: '2026-05-01',
            description: 'FX base income',
            category: 'salary',
          },
          {
            id: '00000000-0000-4000-8000-0000000000f4',
            type: 'expense',
            amount: 4.1,
            currency: 'EUR',
            date: '2026-05-05',
            description: 'FX base expense',
            category: 'food',
          },
        ],
        budgets: [],
        goals: [],
        debts: [],
        assets: [],
        exchangeRates: {
          USD: 1,
          EUR: 2,
        },
      },
    });

    test('FX-FC-005 · changing baseCurrency re-anchors every chart without precision loss', async ({ page }) => {
      const periodSummary = page.locator('.panel').filter({ has: page.getByText('Period Summary', { exact: true }) }).first();
      const categoryBreakdown = page.locator('.panel').filter({ has: page.getByText('Category Breakdown', { exact: true }) }).first();

      await page.goto('/reports');
      await page.waitForURL('**/reports');

      await expect(cardValueByLabel(page, 'All-Time Income')).toHaveAttribute('title', '$20.50');
      await expect(cardValueByLabel(page, 'All-Time Expenses')).toHaveAttribute('title', '$8.20');
      await expect(cardValueByLabel(page, 'Net Flow')).toHaveAttribute('title', '$12.30');
      await expect(periodSummary).toContainText('$20.50');
      await expect(periodSummary).toContainText('$8.20');
      await expect(periodSummary).toContainText('+$12.30');
      await expect(categoryBreakdown).toContainText('Needs');
      await expect(categoryBreakdown).toContainText('$8.20');

      await page.goto('/settings');
      await page.waitForURL('**/settings');
      await page.getByLabel('Base Currency').selectOption('EUR');

      await expect.poll(async () => page.evaluate(() => {
        const win = window as typeof window & {
          __vt_store?: { getState(): { profile: { baseCurrency: string } } };
          __ff_store?: { getState(): { profile: { baseCurrency: string } } };
        };
        const store = win.__vt_store ?? win.__ff_store;
        if (!store) throw new Error('Store oracle unavailable');
        return store.getState().profile.baseCurrency;
      })).toBe('EUR');

      await page.goto('/reports');
      await page.waitForURL('**/reports');

      await expect(cardValueByLabel(page, 'All-Time Income')).toHaveAttribute('title', '10,25 €');
      await expect(cardValueByLabel(page, 'All-Time Expenses')).toHaveAttribute('title', '4,10 €');
      await expect(cardValueByLabel(page, 'Net Flow')).toHaveAttribute('title', '6,15 €');
      await expect(periodSummary).toContainText(/10,25\s*€/);
      await expect(periodSummary).toContainText(/4,10\s*€/);
      await expect(periodSummary).toContainText(/\+6,15\s*€/);
      await expect(categoryBreakdown).toContainText('Needs');
      await expect(categoryBreakdown).toContainText(/4,10\s*€/);
    });
  });

  test.describe('debt preferences', () => {
    test.use({
      seed: {
        profile: {
          name: 'Debt Pref User',
          email: 'debt-pref@example.com',
          baseCurrency: 'USD',
          language: 'en',
          household: 'family',
          dateFormat: 'us',
          payoffStrategy: 'avalanche',
          extraPayment: 0,
        },
        transactions: [
          {
            id: '00000000-0000-4000-8000-0000000000d1',
            type: 'income',
            amount: 4800,
            currency: 'USD',
            date: '2026-05-01',
            description: 'PROFILE debt prefs income',
            category: 'salary',
          },
        ],
        debts: [
          {
            id: '00000000-0000-4000-8000-0000000000d2',
            type: 'personal_loan',
            name: 'PROFILE-FC-005 High APR',
            principal: 5000,
            currentBalance: 5000,
            interestRate: 24,
            minimumPayment: 250,
            currency: 'USD',
          },
          {
            id: '00000000-0000-4000-8000-0000000000d3',
            type: 'personal_loan',
            name: 'PROFILE-FC-005 Small Balance',
            principal: 1000,
            currentBalance: 1000,
            interestRate: 5,
            minimumPayment: 100,
            currency: 'USD',
          },
          {
            id: '00000000-0000-4000-8000-0000000000d4',
            type: 'personal_loan',
            name: 'PROFILE-FC-006 Projection Debt',
            principal: 2400,
            currentBalance: 2400,
            interestRate: 0,
            minimumPayment: 100,
            currency: 'USD',
          },
        ],
      },
    });

    test('PROFILE-FC-005 · changing payoff strategy reorders the payoff priority', async ({ page }) => {
      await page.goto('/debts');
      await page.waitForURL('**/debts');

      await expect(page.getByText('Avalanche strategy · highest APR first')).toBeVisible();
      await expect(debtCard(page, 'PROFILE-FC-005 High APR')).toContainText('Highest APR');
      await expect(debtCard(page, 'PROFILE-FC-005 Small Balance')).not.toContainText('Smallest balance');

      await page.goto('/settings');
      await page.waitForURL('**/settings');
      await page.getByLabel('Payoff Strategy').selectOption('snowball');

      await page.goto('/debts');
      await page.waitForURL('**/debts');

      await expect(page.getByText('Snowball strategy · smallest balance first')).toBeVisible();
      await expect(debtCard(page, 'PROFILE-FC-005 Small Balance')).toContainText('Smallest balance');
      await expect(debtCard(page, 'PROFILE-FC-005 High APR')).not.toContainText('Highest APR');
    });

    test('PROFILE-FC-006 · saving extra payment updates visible payoff projections', async ({ page }) => {
      await page.goto('/debts');
      await page.waitForURL('**/debts');

      await expect(debtCard(page, 'PROFILE-FC-006 Projection Debt')).toContainText('24mo');

      await page.goto('/settings');
      await page.waitForURL('**/settings');
      await page.getByLabel('Monthly Extra Payment (USD)').fill('50');
      await page.getByRole('button', { name: 'Save Preferences' }).click();

      await expect(page.getByText('Debt preferences saved')).toBeVisible();

      await page.goto('/debts');
      await page.waitForURL('**/debts');
      await expect(debtCard(page, 'PROFILE-FC-006 Projection Debt')).toContainText('16mo');
    });
  });
});