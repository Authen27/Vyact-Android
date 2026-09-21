import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../../test-results/ui-pilot/', import.meta.url));
const baseURL = process.env.UI_PILOT_URL ?? 'http://127.0.0.1:5182';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.clock.setFixedTime(new Date('2026-09-11T12:00:00Z'));
  await page.goto(`${baseURL}/dashboard`);
  await expect(page.getByTestId('dashboard-pilot')).toBeVisible();
  for (const theme of ['dark', 'warm']) {
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      const measurements = await page.getByTestId('dashboard-pilot').evaluate(element => {
        const visible = Array.from(element.children).filter(child => getComputedStyle(child).display !== 'none');
        return { gap: getComputedStyle(element).rowGap,
          distances: visible.slice(1).map((child, index) => child.getBoundingClientRect().top - visible[index].getBoundingClientRect().bottom),
          heroGap: getComputedStyle(element.querySelector('[data-testid="dashboard-heroes"]')).columnGap,
          width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth };
      });
      expect(measurements.gap).toBe(width >= 1024 ? '48px' : '32px');
      for (const distance of measurements.distances) expect(Math.abs(distance - (width >= 1024 ? 48 : 32))).toBeLessThan(2);
      expect(measurements.heroGap).toBe(width >= 1024 ? '24px' : '16px');
      expect(measurements.scrollWidth).toBeLessThanOrEqual(width);
      await expect(page.getByTestId('dashboard-pulse')).toHaveCount(0);
      await expect(page.getByTestId('dashboard-debt-summary')).toHaveCount(0);
      await page.screenshot({ path: `${output}dashboard-${theme}-${width}.png`, fullPage: true });
      results.push({ screen: 'dashboard', theme, width, ...measurements });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Add transaction', exact: true }).last().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Amount', { exact: true })).toBeFocused();
  await dialog.getByLabel('Amount', { exact: true }).fill('42');
  await dialog.getByLabel('Category', { exact: true }).selectOption('groceries');
  await dialog.getByLabel('Description', { exact: true }).fill('UI pilot groceries');
  await dialog.getByTestId('txn-source').selectOption({ label: 'Cash' }).catch(async () => {
    const cash = await dialog.getByTestId('txn-source').locator('option').evaluateAll(options => options.find(option => /cash/i.test(option.textContent))?.value);
    if (!cash) throw new Error('No cash option in pilot fixture');
    await dialog.getByTestId('txn-source').selectOption(cash);
  });
  await dialog.getByRole('radio', { name: 'Income', exact: true }).check();
  await expect(dialog.getByLabel('Category', { exact: true })).toHaveValue('salary');
  await dialog.getByRole('radio', { name: 'Expense', exact: true }).check();
  await dialog.getByLabel('Category', { exact: true }).selectOption('groceries');
  const save = dialog.getByRole('button', { name: 'Save expense', exact: true });
  await expect(save).toBeVisible();
  expect((await save.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: `${output}transaction-mobile.png` });
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('dashboard-pilot').getByText('UI pilot groceries', { exact: true })).toBeVisible();
  results.push({ screen: 'transaction', category: 'groceries', amount: 42, saved: true });
  await writeFile(`${output}browser-result.json`, JSON.stringify({ success: true, results }, null, 2));
  console.log(`PASS: ${results.length} pilot checks. Screenshots: ${output}`);
} catch (error) {
  await writeFile(`${output}browser-result.json`, JSON.stringify({ success: false, error: String(error), results }, null, 2));
  throw error;
} finally {
  await browser.close();
}