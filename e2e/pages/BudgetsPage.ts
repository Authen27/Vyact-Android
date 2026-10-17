import type { Page, Locator } from '@playwright/test';

/**
 * Page Object for `/budgets`. Add/Edit flows open the global BudgetFormModal
 * (see pages/BudgetFormModal.ts).
 *
 * Each budget renders as a `[data-testid=budget-card]` containing the category label,
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
    // The Aurora redesign replaced .rounded-xl with .rounded-r3 + neu shadows, so
    // the old class selector matched nothing and every budget assertion timed
    // out. Keyed on a stable testid now rather than a styling class — the same
    // precedent as txn-row and schedule-row.
    return this.page.getByTestId('budget-card').filter({ hasText: label });
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
