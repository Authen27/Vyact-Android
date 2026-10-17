import type { Page } from '@playwright/test';
import { test, expect, openSettingsRow } from '../fixtures/app';
import { defaultSeed } from '../fixtures/seed';

// v10.49.1 (#45) — rewritten for the Board E Settings screen and the Aurora dashboard.
//  · Settings are grouped rows that expand in place (`openSettingsRow`); only Profile
//    stays open. Theme cards are Nocturne / Mist / System.
//  · Household Type moved to the Households page (it lives on the household record).
//  · The dashboard has no "Total Balance" card and Reports has no "All-Time" cards
//    (v10.31 reads one date range); money is read from the Monthly Income / Monthly
//    Expenses tiles and the Reports "Period Summary" panel instead.
//  · Debt cards with the priority badge and months-to-payoff are the list shown below
//    the desktop breakpoint.
//  · Rates are "1 USD = x units" (the Settings copy and DEFAULT_RATES, EUR ≈ 0.92): a EUR
//    amount is DIVIDED by its rate. The old expectations multiplied.

async function storeState<T>(page: Page, pick: string): Promise<T> {
  return page.evaluate((path) => {
    const win = window as typeof window & { __vt_store?: { getState(): Record<string, unknown> }; __ff_store?: { getState(): Record<string, unknown> } };
    const store = win.__vt_store ?? win.__ff_store;
    if (!store) throw new Error('Store oracle unavailable');
    return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], store.getState()) as T;
  }, pick);
}

/** A dashboard metric tile (desktop), e.g. "Monthly Income". */
function metric(page: Page, label: string | RegExp) {
  return page.getByRole('link', { name: typeof label === 'string' ? new RegExp(`^${label}`) : label });
}

/** A Panel located by its title. */
function panel(page: Page, title: string) {
  return page.locator('.panel').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).first();
}

function debtCard(page: Page, name: string) {
  return page.locator('div.rounded-r3').filter({ has: page.getByText(name, { exact: true }) }).first();
}

test.describe('§15 PROFILE-FC · Settings profile behavior', () => {
  test.use({ seed: defaultSeed });   // the unseeded app boots the demo household

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });   // dashboard metric tiles are desktop-only
  });

  // W6 (audit FE-UIS-06): the Email input is gone — in cloud mode it saved nowhere while saying
  // "Profile saved". The account email is shown, not edited, on this screen.
  test('PROFILE-FC-001 · edit name persists after save and reload; email is not an editable field', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForURL('**/settings');

    await expect(page.getByRole('textbox', { name: 'Email' })).toHaveCount(0);
    // Aurora 4.0 ST1 — Profile is a group of rows; each opens its own editor.
    await openSettingsRow(page, 'Display name');
    await page.getByLabel('Display Name').fill('PROFILE-FC-001 User');
    await page.getByRole('button', { name: 'Save name' }).click();

    await expect(page.getByText('Profile saved')).toBeVisible();
    await expect.poll(() => storeState(page, 'profile')).toMatchObject({ name: 'PROFILE-FC-001 User' });

    await page.reload();
    await page.waitForURL('**/settings');
    await openSettingsRow(page, 'Display name');
    await expect(page.getByLabel('Display Name')).toHaveValue('PROFILE-FC-001 User');
  });

  test('PROFILE-FC-002 · changing base currency reformats computed money displays', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/dashboard');
    await expect(metric(page, 'Monthly Income')).toContainText('$5,000');
    await expect(metric(page, 'Monthly Expenses')).toContainText('$1,550');

    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await openSettingsRow(page, 'Language & currency');
    await page.getByLabel('Household currency').selectOption('EUR');
    await expect.poll(() => storeState(page, 'profile.baseCurrency')).toBe('EUR');
    await expect(page.getByText('Changing it changes the symbol only; amounts are not converted.')).toBeVisible();

    await openSettingsRow(page, 'Debt preferences');
    await expect(page.getByText('Monthly Extra Payment (EUR)')).toBeVisible();

    await page.goto('/dashboard');
    await page.waitForURL('**/dashboard');
    await expect(metric(page, 'Monthly Income')).toContainText('€');
    await expect(metric(page, 'Monthly Income')).not.toContainText('$');
    await expect(metric(page, 'Monthly Expenses')).toContainText('€');

    await page.goto('/reports');
    await page.waitForURL('**/reports');
    await expect(panel(page, 'Period Summary')).toContainText('€');
    await expect(panel(page, 'Period Summary')).not.toContainText('$');
  });

  test('PROFILE-FC-003 · changing language and date format updates shipped UI labels and row dates', async ({
    page,
    transactions,
  }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/dashboard');
    await expect(metric(page, 'Monthly Income')).toBeVisible();

    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await openSettingsRow(page, 'Language & currency');
    await page.getByLabel('Language').selectOption('es');
    await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible();

    await page.goto('/dashboard');
    await page.waitForURL('**/dashboard');
    await expect(metric(page, 'Ingresos Mensuales')).toBeVisible();

    await transactions.goto();
    await expect(page.getByRole('heading', { level: 1, name: 'Transacciones' })).toBeVisible();
    const txnRow = page.getByTestId('txn-row').filter({ hasText: 'E2E Grocery' }).first();
    await expect(txnRow).toContainText('May 10, 2026');

    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await openSettingsRow(page, 'Date format');
    await page.getByLabel('Date Format').selectOption('eu');
    await transactions.goto();
    await expect(txnRow).toContainText('10 May 2026');

    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await openSettingsRow(page, 'Date format');
    await page.getByLabel('Date Format').selectOption('iso');
    await transactions.goto();
    await expect(txnRow).toContainText('2026-05-10');
  });

  test('PROFILE-FC-004 · changing household type persists (Households page)', async ({ page }) => {
    await page.goto('/households');
    await page.waitForURL('**/households');

    const householdType = page.getByLabel('Household Type').first();
    await expect(householdType).toHaveValue('family');
    await householdType.selectOption('business');
    await expect.poll(() => storeState(page, 'profile.household')).toBe('business');

    await page.reload();
    await page.waitForURL('**/households');
    await expect(page.getByLabel('Household Type').first()).toHaveValue('business');

    await page.getByLabel('Household Type').first().selectOption('family');
    await expect.poll(() => storeState(page, 'profile.household')).toBe('family');
  });

  test('PROFILE-FC-007 · theme switch persists across reload', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForURL('**/settings');
    const themeCard = (label: string) => page.getByRole('button', { name: new RegExp(`^${label}`) });
    const pick = async (label: string, theme: string) => {
      await openSettingsRow(page, 'Appearance');
      await themeCard(label).click();
      await expect(themeCard(label)).toContainText('Active');
      await expect.poll(() => storeState(page, 'theme')).toBe(theme);
    };
    const survivesReload = async (label: string, theme: string) => {
      await page.reload();
      await page.waitForURL('**/settings');
      await openSettingsRow(page, 'Appearance');
      await expect(themeCard(label)).toContainText('Active');
      await expect.poll(() => storeState(page, 'theme')).toBe(theme);
    };

    await pick('Mist', 'warm');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'warm');
    await survivesReload('Mist', 'warm');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'warm');

    await pick('Nocturne', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await survivesReload('Nocturne', 'dark');

    await pick('System', 'system');
    await survivesReload('System', 'system');
  });

  test('PROFILE-FC-008 · sensitive data actions are surfaced only in Settings', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/dashboard');
    for (const name of ['Export CSV', 'Download Backup', 'Copy to Clipboard']) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Account menu' }).first().click();
    await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Download Backup' })).toHaveCount(0);
    await page.getByRole('button', { name: /Settings/ }).first().click();
    await page.waitForURL('**/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

    await openSettingsRow(page, 'Sync & backup');
    await expect(page.getByText(/Exported files can leave the app and any destructive data-reset workflow should be triggered only from Settings/)).toBeVisible();
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
          { id: '00000000-0000-4000-8000-0000000000f1', type: 'income',  amount: 100, currency: 'EUR', date: '2026-05-01', description: 'FX income',  category: 'salary' },
          { id: '00000000-0000-4000-8000-0000000000f2', type: 'expense', amount: 40,  currency: 'EUR', date: '2026-05-05', description: 'FX expense', category: 'food_dining' },
        ],
        budgets: [],
        goals: [],
        debts: [],
        assets: [],
        exchangeRates: { USD: 1, EUR: 1 },
      },
    });

    // W3b (v10.66.0; owner decision D14): one currency per household and no exchange rates. Rows
    // still labelled EUR count at face value in the household's USD, and Settings has no rates sheet.
    test('FX-FC-001 · rows labelled in another currency count at face value; there is no rates sheet', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForURL('**/dashboard');
      await expect(metric(page, 'Monthly Income')).toContainText('$100');
      await expect(metric(page, 'Monthly Expenses')).toContainText('$40');

      await page.goto('/reports');
      await page.waitForURL('**/reports');
      const summary = panel(page, 'Period Summary');
      await expect(summary).toContainText('$100');
      await expect(summary).toContainText('$40');
      await expect(summary).toContainText('+$60');

      await page.goto('/settings');
      await page.waitForURL('**/settings');
      await expect(page.getByText('Exchange rates')).toHaveCount(0);
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
          { id: '00000000-0000-4000-8000-0000000000f3', type: 'income',  amount: 10.25, currency: 'EUR', date: '2026-05-01', description: 'FX base income',  category: 'salary' },
          { id: '00000000-0000-4000-8000-0000000000f4', type: 'expense', amount: 4.1,   currency: 'EUR', date: '2026-05-05', description: 'FX base expense', category: 'food_dining' },
        ],
        budgets: [],
        goals: [],
        debts: [],
        assets: [],
        exchangeRates: { USD: 1, EUR: 2 },
      },
    });

    test('FX-FC-005 · changing the household currency changes the symbol only, without precision loss', async ({ page }) => {
      await page.goto('/reports');
      await page.waitForURL('**/reports');
      const summary = panel(page, 'Period Summary');
      const breakdown = panel(page, 'Category Breakdown');

      // W3b (D14): face value — the EUR-labelled rows count as dollars, and the rates are ignored.
      await expect(summary).toContainText('$10.25');
      await expect(summary).toContainText('$4.10');
      await expect(summary).toContainText('+$6.15');
      await expect(breakdown).toContainText('Needs');
      await expect(breakdown).toContainText('$4.10');

      await page.goto('/settings');
      await page.waitForURL('**/settings');
      await openSettingsRow(page, 'Language & currency');
      await page.getByLabel('Household currency').selectOption('EUR');
      await expect.poll(() => storeState(page, 'profile.baseCurrency')).toBe('EUR');

      // A currency change only changes the symbol: the same amounts, now in euros.
      await page.goto('/reports');
      await page.waitForURL('**/reports');
      await expect(summary).toContainText(/10,25\s*€/);
      await expect(summary).toContainText(/4,10\s*€/);
      await expect(summary).toContainText(/\+6,15\s*€/);
      await expect(breakdown).toContainText('Needs');
      await expect(breakdown).toContainText(/4,10\s*€/);
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
          { id: '00000000-0000-4000-8000-0000000000d1', type: 'income', amount: 4800, currency: 'USD', date: '2026-05-01', description: 'PROFILE debt prefs income', category: 'salary' },
        ],
        debts: [
          { id: '00000000-0000-4000-8000-0000000000d2', type: 'personal_loan', name: 'PROFILE-FC-005 High APR', principal: 5000, currentBalance: 5000, interestRate: 24, minimumPayment: 250, currency: 'USD' },
          { id: '00000000-0000-4000-8000-0000000000d3', type: 'personal_loan', name: 'PROFILE-FC-005 Small Balance', principal: 1000, currentBalance: 1000, interestRate: 5, minimumPayment: 100, currency: 'USD' },
          { id: '00000000-0000-4000-8000-0000000000d4', type: 'personal_loan', name: 'PROFILE-FC-006 Projection Debt', principal: 2400, currentBalance: 2400, interestRate: 0, minimumPayment: 100, currency: 'USD' },
        ],
      },
    });

    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });   // the card list with the priority badge
    });

    test('PROFILE-FC-005 · changing payoff strategy reorders the payoff priority', async ({ page }) => {
      await page.goto('/debts');
      await page.waitForURL('**/debts');
      // v10.59.0 — the strategy caption under the title was removed (owner); the selected tab says it.
      await expect(page.getByRole('tab', { name: 'avalanche', selected: true })).toBeVisible();
      await expect(debtCard(page, 'PROFILE-FC-005 High APR')).toContainText('Highest APR');
      await expect(debtCard(page, 'PROFILE-FC-005 Small Balance')).not.toContainText('Smallest balance');

      await page.goto('/settings');
      await page.waitForURL('**/settings');
      await openSettingsRow(page, 'Debt preferences');
      await page.getByLabel('Payoff Strategy').selectOption('snowball');

      await page.goto('/debts');
      await page.waitForURL('**/debts');
      await expect(page.getByRole('tab', { name: 'snowball', selected: true })).toBeVisible();
      await expect(debtCard(page, 'PROFILE-FC-005 Small Balance')).toContainText('Smallest balance');
      await expect(debtCard(page, 'PROFILE-FC-005 High APR')).not.toContainText('Highest APR');
    });

    // W4f: a loan's months are the bank's own schedule (its EMI on a reducing balance), so the Settings
    // extra payment no longer shortens the card; it only feeds the avalanche/snowball comparison.
    test('PROFILE-FC-006 · saving extra payment leaves a loan on its own EMI schedule', async ({ page }) => {
      await page.goto('/debts');
      await page.waitForURL('**/debts');
      await expect(debtCard(page, 'PROFILE-FC-006 Projection Debt')).toContainText(/24\s*mo/);

      await page.goto('/settings');
      await page.waitForURL('**/settings');
      await openSettingsRow(page, 'Debt preferences');
      await page.getByLabel('Monthly Extra Payment (USD)').fill('50');
      await page.getByRole('button', { name: 'Save Preferences' }).click();
      await expect(page.getByText('Debt preferences saved')).toBeVisible();

      await page.goto('/debts');
      await page.waitForURL('**/debts');
      await expect(debtCard(page, 'PROFILE-FC-006 Projection Debt')).toContainText(/24\s*mo/);
    });
  });
});
