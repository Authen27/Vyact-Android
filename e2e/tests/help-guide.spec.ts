import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Locator } from '@playwright/test';
import { test, expect } from '../fixtures/app';
import { seedWith } from '../fixtures/seed';
import { HELP_TOPICS } from '../../src/lib/helpContent';

const helpSeed = seedWith({
  profile: { name: 'Alex', email: 'alex@example.test', baseCurrency: 'USD' },
  members: [{ id: 'demo-member', name: 'Alex', color: '#769782', role: 'self' }],
  accounts: [
    { id: '00000000-0000-4000-8000-0000000000a0', name: 'Everyday account', kind: 'bank', currency: 'USD', openingBalance: 2400, isDefault: true },
    { id: '00000000-0000-4000-8000-0000000000a1', name: 'Cash in Hand', kind: 'cash', currency: 'USD', openingBalance: 120 },
  ],
  transactions: [{ id: '00000000-0000-4000-8000-000000000001', type: 'income', amount: 2000, currency: 'USD', date: '2026-09-01', description: 'Monthly salary', category: 'salary', toAccountId: '00000000-0000-4000-8000-0000000000a0', memberId: 'demo-member' }],
  budgets: [], budgetAllocations: [], goals: [], debts: [], assets: [], recurringSchedules: [], notifications: [],
});

// Service workers blocked, as in playwright.help.config.ts: once the PWA worker
// has cached the guide screenshots, HELP-FC-003's reload serves them from cache
// and its blocked-media route never fires, so the fallback cannot appear.
test.use({ seed: helpSeed, serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.route('**/__help-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Help fixture</title>' }));
  await page.goto('/__help-fixture');
  await page.evaluate(async data => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('vyact', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('kv');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('kv', 'readwrite');
      const store = transaction.objectStore('kv');
      const values = { ...data, recurring: data.recurringSchedules,
        active_profile: 'local', profiles_list: [{ id: 'local', name: 'Example household', type: 'family', baseCurrency: 'USD', createdAt: '2026-01-01T00:00:00Z' }] };
      for (const [key, value] of Object.entries(values)) if (value !== undefined) store.put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, helpSeed);
  await page.unroute('**/__help-fixture');
});

test('HELP-FC-001 - current task screens provide reproducible fictional guide images', async ({ page, txnModal, advanceClock }, testInfo) => {
  await advanceClock('2026-09-11T12:00:00Z');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 960, height: 1100 });
  await page.addInitScript(() => localStorage.setItem('vt_theme', 'warm'));
  const dimensions: Record<string, { width: number; height: number }> = {};
  const destination = fileURLToPath(new URL('../../public/help/current/', import.meta.url));
  const capture = async (name: string, target: Locator) => {
    await expect(target).toBeVisible();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'warm'));
    // A sheet is captured without the screen behind it. A form page (v10.28.0)
    // IS the screen, so it is captured whole, at a phone-to-tablet width so the
    // image is the form column rather than a wide page of empty margins. An
    // element screenshot is taller than the viewport, so for the capture only
    // the page drops its viewport min-height and its sticky header and Save bar
    // lie in flow: otherwise a short form gains a blank band and a long form's
    // Save bar is frozen across its fields wherever the viewport ended.
    const isSheet = await target.evaluate(element => element.getAttribute('role') === 'dialog');
    if (!isSheet) await page.setViewportSize({ width: 600, height: 1100 });
    const buffer = await target.screenshot({
      style: isSheet
        ? '#root { visibility: hidden; } [role="dialog"] { visibility: visible; }'
        : 'main[data-form-page] { min-height: 0 !important; } main[data-form-page] > * { position: static !important; }',
    });
    if (!isSheet) await page.setViewportSize({ width: 960, height: 1100 });
    dimensions[name] = { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    if (process.env.UPDATE_HELP_MEDIA === '1') {
      await mkdir(destination, { recursive: true });
      await writeFile(`${destination}${name}.png`, buffer);
    }
    await testInfo.attach(name, { body: buffer, contentType: 'image/png' });
  };

  await page.goto('/transactions');
  await expect(page.getByText('Monthly salary', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Add transaction/i }).first().click();
  await txnModal.waitOpen();
  await txnModal.setAmount(42);
  await txnModal.setCategory('groceries');
  await txnModal.setDescription('Weekly groceries');
  await txnModal.dialog.getByTestId('txn-source').selectOption({ label: 'Cash' });
  await capture('expense', txnModal.dialog);
  await txnModal.cancel();

  await page.goto('/splits');
  await page.getByRole('button', { name: '+ Add Split', exact: true }).first().click();
  const split = page.getByRole('main', { name: 'Add Split', exact: true });
  await split.getByRole('textbox', { name: 'Amount', exact: true }).fill('84');
  await split.getByRole('textbox', { name: 'Description', exact: true }).fill('Dinner with friends');
  await split.getByRole('combobox', { name: 'Paid with', exact: true }).selectOption('cash');
  await split.getByRole('textbox', { name: 'Name', exact: true }).fill('Sam');
  await split.getByRole('button', { name: /Even \(auto\)/ }).click();
  await capture('split', split);
  await split.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.goto('/accounts');
  await page.getByRole('region', { name: 'Cash in Hand', exact: true }).getByRole('button', { name: 'Reconcile', exact: true }).click();
  const reconcile = page.getByRole('main', { name: 'Cash in Hand', exact: true });
  await expect(reconcile.getByRole('textbox', { name: 'Cash counted', exact: true })).toHaveValue('120');
  await capture('cash-reconcile', reconcile);
  await reconcile.getByRole('button', { name: 'Not now', exact: true }).click();

  await page.goto('/networth');
  await page.getByRole('button', { name: /Add Asset/ }).first().click();
  const asset = page.getByRole('main', { name: 'Add Asset', exact: true });
  await expect(asset.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
  await asset.getByRole('combobox', { name: 'Type', exact: true }).selectOption('investment');
  await asset.getByRole('textbox', { name: 'Name', exact: true }).fill('Index fund');
  await asset.getByRole('spinbutton', { name: 'Value today', exact: true }).fill('3000');
  await capture('investment-asset', asset);
  await asset.getByRole('button', { name: 'Close', exact: true }).click();

  await page.goto('/debts');
  await page.getByRole('button', { name: '+ Add Debt', exact: true }).click();
  const debt = page.getByRole('main', { name: 'Add Debt', exact: true });
  await expect(debt.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
  await debt.getByRole('combobox', { name: 'Type', exact: true }).selectOption('auto_loan');
  await debt.getByRole('textbox', { name: 'Name', exact: true }).fill('Car loan');
  await debt.getByRole('spinbutton', { name: 'Current balance', exact: true }).fill('6000');
  await debt.getByRole('spinbutton', { name: 'Interest rate', exact: true }).fill('6');
  await debt.getByRole('spinbutton', { name: 'Min. monthly payment', exact: true }).fill('250');
  await capture('debt', debt);
  await debt.getByRole('button', { name: 'Close', exact: true }).click();

  await page.goto('/recurring');
  await page.getByRole('button', { name: '+ Add Schedule', exact: true }).click();
  const recurring = page.getByRole('dialog', { name: 'Add Recurring Schedule', exact: true });
  await expect(recurring.getByRole('textbox', { name: 'Amount', exact: true })).toBeVisible();
  await recurring.getByRole('textbox', { name: 'Amount', exact: true }).fill('1200');
  await recurring.getByRole('textbox', { name: 'Description', exact: true }).fill('Monthly rent');
  await recurring.getByRole('combobox', { name: 'Pay from', exact: true }).selectOption({ label: 'Everyday account' });
  await expect(recurring.getByText(/Pick an account/)).toHaveCount(0);
  await recurring.getByRole('switch', { name: 'Auto-approve this schedule', exact: true }).click();
  await capture('recurring', recurring);
  if (process.env.UPDATE_HELP_MEDIA === '1') {
    await writeFile(fileURLToPath(new URL('../../src/lib/helpMedia.json', import.meta.url)), `${JSON.stringify(dimensions, null, 2)}\n`);
  }
});

test('HELP-FC-002 - search, task links and support fields work on desktop and mobile', async ({ page }, testInfo) => {
  for (const width of [390, 1440]) {
    for (const theme of ['warm', 'dark']) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/help');
      await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
      await expect(page.getByRole('heading', { name: 'Help & Guide', exact: true })).toBeVisible();
      // v10.34.0 — the page h1 stays at the bold display weight, matching
      // Settings/Households; only body copy and subheadings use the lighter
      // reading-surface weight.
      await expect(page.getByRole('heading', { name: 'Help & Guide', exact: true })).toHaveCSS('font-weight', '600');
      await expect(page.getByRole('heading', { name: 'Your next step', exact: true })).toHaveCSS('font-weight', '400');
      await expect(page.locator('summary')).toHaveCount(HELP_TOPICS.length);
      const first = page.locator('summary').first();
      await expect(first.getByRole('heading')).toHaveCSS('font-weight', '400');
      await first.focus();
      await first.press('Enter');
      await expect(page.locator('details').first()).toHaveAttribute('open', '');
      const search = page.getByRole('searchbox', { name: 'Search Help & Guide', exact: true });
      await search.fill('CASH counted');
      await expect(page.getByRole('heading', { name: 'How do I check the cash I am holding?', exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'Check Cash in Hand', exact: true }).click();
      await expect(page).toHaveURL(/\/accounts$/);
      await page.goto('/help');
      await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
      await search.fill('no such topic xyz');
      await expect(page.getByRole('heading', { name: 'No answers found' })).toBeVisible();
      await page.getByRole('button', { name: 'Clear search', exact: true }).click();
      await expect(page.locator('summary')).toHaveCount(HELP_TOPICS.length);
      const subject = page.getByRole('textbox', { name: 'Subject', exact: true });
      const message = page.getByRole('textbox', { name: 'What happened?', exact: true });
      await subject.fill('Question about a split');
      await message.fill('I am trying to record my share.');
      await expect(message).toHaveAttribute('aria-describedby', /description/);
      await expect(page.locator('label').filter({ hasText: /^Subject$/ })).toHaveCSS('font-weight', '400');
      await expect(page.getByRole('button', { name: 'Open email draft', exact: true })).toHaveCSS('font-weight', '400');
      for (const control of [search, subject, message]) {
        expect(await control.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await testInfo.attach(`help-${theme}-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
  }
});

test('HELP-FC-003 - all current screenshots load and broken media has an explicit fallback', async ({ page }) => {
  await page.goto('/help');
  for (const topic of HELP_TOPICS.filter(topic => topic.image)) {
    await page.locator('summary').filter({ hasText: topic.question }).click();
    const image = page.getByRole('img', { name: topic.image!.alt, exact: true });
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(new URL(await page.getByRole('link', { name: `Open full-size screenshot: ${topic.image!.alt}`, exact: true }).getAttribute('href') ?? '', page.url()).pathname).toMatch(/^\/help\/current\//);
  }
  await page.route('**/help/current/*.png', route => route.fulfill({ status: 404, body: '' }));
  await page.reload();
  await page.getByRole('searchbox', { name: 'Search Help & Guide', exact: true }).fill('cash counted');
  await expect(page.getByText('Screenshot unavailable. The steps above still apply.', { exact: true })).toBeVisible();
});