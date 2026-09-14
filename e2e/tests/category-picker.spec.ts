import { test, expect } from '../fixtures/app';
import { seedWith } from '../fixtures/seed';
import { seedLocalHousehold } from '../fixtures/localHousehold';

const seed = seedWith({ goals: [], debts: [], recurringSchedules: [] });
test.use({ seed });
test.beforeEach(async ({ page }) => seedLocalHousehold(page, seed));

test('CAT-FC-001 - Accounts stays reachable under Plan on mobile and desktop', async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/budgets');
    const accounts = page.locator('a[href="/accounts"]:visible');
    await expect(accounts).toHaveText('Accounts');
    await accounts.click();
    await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
    const cash = page.getByRole('region', { name: 'Cash in Hand', exact: true });
    await expect(cash).toBeVisible();
    for (const name of ['Bank', 'Credit Card']) {
      await expect(page.getByRole('region', { name, exact: true }).getByRole('button', { name: 'Edit Cash in Hand' })).toHaveCount(0);
    }
    const balanceBefore = await cash.locator('.num').innerText();
    await cash.getByRole('button', { name: 'Reconcile', exact: true }).click();
    const reconcile = page.getByRole('main', { name: 'Cash in Hand', exact: true });
    await expect(reconcile.getByRole('textbox', { name: 'Cash counted', exact: true })).toBeVisible();
    await reconcile.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(reconcile).toHaveCount(0);
    await expect(page.getByText('Cash balance confirmed', { exact: true }).first()).toBeVisible();
    await expect(cash.locator('.num')).toHaveText(balanceBefore);
  }
});

test('CAT-FC-002 - category dropdown matches Debt Type without allowing text entry', async ({ page, txnModal }, testInfo) => {
  for (const theme of ['dark', 'warm']) {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/debts');
      await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
      await page.getByRole('button', { name: '+ Add Debt', exact: true }).click();
      const debt = page.getByRole('main', { name: 'Add Debt', exact: true });
      const reference = await debt.getByRole('combobox', { name: 'Type', exact: true }).evaluate(element => {
        const style = getComputedStyle(element);
        return [element.tagName, style.fontSize, style.fontWeight, style.borderRadius, style.backgroundColor, style.paddingRight];
      });
      await debt.getByRole('button', { name: 'Close', exact: true }).click();
      await page.goto('/transactions');
      await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
      await page.getByRole('button', { name: /Add Transaction/i }).first().click();
      await txnModal.waitOpen();
      const picker = txnModal.dialog.getByRole('combobox', { name: 'Category', exact: true });
      expect(await picker.evaluate(element => {
        const style = getComputedStyle(element);
        return [element.tagName, style.fontSize, style.fontWeight, style.borderRadius, style.backgroundColor, style.paddingRight];
      })).toEqual(reference);
      await expect(picker.locator('input,[contenteditable="true"]')).toHaveCount(0);
      await picker.selectOption({ label: '🔧 Repairs & Maintenance' });
      await expect(picker.locator('option:checked')).toHaveText('🔧 Repairs & Maintenance');
      await picker.selectOption('groceries');
      await picker.focus();
      await picker.press('z');
      expect(await picker.evaluate(element => Array.from((element as HTMLSelectElement).options).some(option => option.value === (element as HTMLSelectElement).value))).toBe(true);
      await picker.selectOption('groceries');
      await expect(picker).toHaveValue('groceries');
      await expect(picker).toBeFocused();
      await txnModal.setType('income');
      await expect(picker).toHaveValue('salary');
      await expect(picker.locator('option[value="groceries"]')).toHaveCount(0);
      await txnModal.setType('investment');
      await expect(picker).toHaveCount(0);
      await txnModal.setType('transfer');
      await expect(picker).toHaveCount(0);
      await txnModal.setType('expense');
      await testInfo.attach(`category-${theme}-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
      await txnModal.cancel();
    }
  }
});

test('CAT-FC-003 - recurring and split forms use the same select-only category control', async ({ page }) => {
  for (const surface of [{ path: '/recurring', button: '+ Add Schedule' }, { path: '/splits', button: '+ Add Split' }]) {
    await page.goto(surface.path);
    await page.getByRole('button', { name: surface.button, exact: true }).first().click();
    // The recurring schedule form is still a sheet; Add Split is a page (v10.28.0).
    const dialog = surface.path === '/splits'
      ? page.getByRole('main', { name: 'Add Split', exact: true })
      : page.getByRole('dialog');
    const picker = dialog.getByRole('combobox', { name: 'Category', exact: true });
    expect(await picker.evaluate(element => element.tagName)).toBe('SELECT');
    await picker.selectOption('groceries');
    await expect(picker).toHaveValue('groceries');
    await expect(picker.locator('option:checked')).toHaveText('🛒 Groceries');
    if (surface.path === '/recurring') {
      const account = dialog.getByRole('combobox', { name: 'Pay from', exact: true });
      await account.selectOption({ label: 'E2E Checking' });
      await expect(account.locator('option:checked')).toHaveText('E2E Checking');
      await expect(dialog.getByRole('combobox', { name: 'Owner', exact: true })).toHaveValue('');
    } else {
      const account = dialog.getByRole('combobox', { name: 'Paid with', exact: true });
      await account.selectOption('cash');
      await expect(account).toHaveValue('cash');
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
});

test('CAT-FC-004 - transaction filters offer All categories through the same control', async ({ page }) => {
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Filters/ }).click();
  const dialog = page.getByRole('dialog');
  const picker = dialog.getByRole('combobox', { name: 'Category', exact: true });
  await expect(picker).toHaveValue('all');
  await picker.selectOption('salary');
  await expect(picker).toHaveValue('salary');
  await picker.selectOption('all');
  await expect(picker).toHaveValue('all');
  await picker.selectOption('groceries');
  await dialog.getByRole('button', { name: 'Transfer', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await dialog.getByRole('button', { name: 'All', exact: true }).first().click();
  await expect(picker).toHaveValue('all');
});

test('CAT-FC-005 - Settings dropdowns are labelled fixed-choice selects', async ({ page }) => {
  await page.goto('/settings');
  const date = page.getByRole('combobox', { name: 'Date Format', exact: true });
  await expect(date).toBeVisible();
  const reference = await date.evaluate(element => {
    const style = getComputedStyle(element);
    return [element.tagName, style.borderRadius, style.fontSize, style.fontWeight];
  });
  await page.getByRole('button', { name: /Language & currency/ }).click();
  for (const name of ['Language', 'Base Currency', 'Number System']) {
    const dropdown = page.getByRole('combobox', { name, exact: true });
    await expect(dropdown).toBeVisible();
    expect(await dropdown.evaluate(element => {
      const style = getComputedStyle(element);
      return [element.tagName, style.borderRadius, style.fontSize, style.fontWeight];
    })).toEqual(reference);
    const first = await dropdown.locator('option').first().getAttribute('value');
    await dropdown.selectOption(first!);
    await expect(dropdown).toHaveValue(first!);
  }
  await page.getByRole('button', { name: /Debt preferences/ }).click();
  const payoff = page.getByRole('combobox', { name: 'Payoff Strategy', exact: true });
  await payoff.selectOption('snowball');
  await expect(payoff).toHaveValue('snowball');
  await payoff.selectOption('avalanche');
  await expect(payoff).toHaveValue('avalanche');
  await expect(page.locator('input[role="combobox"]')).toHaveCount(0);
});