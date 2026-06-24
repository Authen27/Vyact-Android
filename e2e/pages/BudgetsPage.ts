import type { Page, Locator } from '@playwright/test';

/**
 * Page Object for `/budgets`. Add/Edit flows open the global BudgetFormModal
 * (see pages/BudgetFormModal.ts).
 *
 * Each budget renders as a `.rounded-xl` card containing the category label,
 * a progress bar, a "left"/"over" remainder, and "Edit"/"Del" buttons
 * (src/pages/Budgets.tsx). Scope to the card so per-budget assertions don't
 * collide when several budgets are present.
 */
export class BudgetsPage {
  readonly page: Page;
  readonly addButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.addButton = page.getByRole('button', { name: /add budget/i });
  }

  async goto() {
    await this.page.goto('/budgets');
    await this.page.waitForURL('**/budgets');
  }

  /** The budget card whose text contains `label` (category display name). */
  card(label: string): Locator {
    return this.page.locator('div.rounded-xl').filter({ hasText: label });
  }

  /** Loose text match for "is this budget present at all". */
  row(label: string): Locator {
    return this.page.getByText(label, { exact: false });
  }

  async openAdd() { await this.addButton.click(); }

  /** Open the edit modal by clicking a card's "Edit" button. */
  async openEdit(label: string) {
    await this.card(label).getByRole('button', { name: 'Edit' }).click();
  }

  /** Switch the period view (Monthly / Quarterly / …). */
  async switchView(view: string) {
    await this.page.getByRole('button', { name: new RegExp(`^${view}$`, 'i') }).click();
  }
}
