import type { Page, Locator } from '@playwright/test';

/**
 * Page Object for `/households` — cloud-only (requires a signed-in session
 * and Supabase env). Covers §16 HH-FC create/switch/rename/leave/delete and
 * the §16 HH-REG regression pair (see TEST_CASE_INVENTORY.md).
 *
 * Local-only mode renders a completely different branch (a static
 * "set env vars to enable cloud" banner) — these locators only resolve on
 * the multi-household branch, i.e. under Lane B / `@cloud`.
 */
export class HouseholdsPage {
  readonly page: Page;
  readonly createButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.createButton = page.getByRole('button', { name: /create household/i });
  }

  async goto() {
    await this.page.goto('/households');
    await this.page.waitForURL('**/households');
  }

  /** The household card whose visible text contains `name`. */
  card(name: string): Locator {
    return this.page.getByRole('button', { name: new RegExp(name, 'i') });
  }

  async openCreate() { await this.createButton.click(); }

  /**
   * Fill + submit the "Create Household" modal. On failure (see HH-REG-001)
   * the modal stays open with the typed name intact and `submitting` reverts
   * to false — assert on `page.getByRole('button', { name: 'Create' })` and
   * a toast, not on the modal closing.
   */
  async create(name: string) {
    await this.openCreate();
    await this.page.getByLabel(/^name$/i).fill(name);
    await this.page.getByRole('button', { name: /^create$/i }).click();
  }

  async switchTo(name: string) { await this.card(name).click(); }

  /** Danger-zone "Delete" for the ACTIVE household. Aurora 4.0 CF15: the sheet wants the name typed. */
  async deleteActiveHousehold() {
    await this.page.getByRole('button', { name: /^delete$/i }).click();
    const sheet = this.page.getByRole('dialog', { name: /^Delete .* for everyone\?$/ });
    const field = sheet.getByLabel('Type the household name to confirm');
    await field.fill((await field.getAttribute('placeholder')) ?? '');
    await sheet.getByRole('button', { name: 'Delete household', exact: true }).click();
  }

  /** Aurora 4.0 CF14 — Leave asks in a sheet. */
  async leaveActiveHousehold() {
    await this.page.getByRole('button', { name: /^leave$/i }).click();
    await this.page.getByRole('dialog', { name: /^Leave .*\?$/ }).getByRole('button', { name: 'Leave household', exact: true }).click();
  }

  /**
   * Toasts (components/ui/ToastHost.tsx) have no role/testid — they're a
   * plain `<span>{text}</span>` in a fixed-position stack. Match on the
   * expected copy directly: `await expect(householdsPage.toastText('Created …')).toBeVisible()`.
   */
  toastText(text: string | RegExp): Locator {
    return this.page.getByText(text);
  }
}
