import type { Page, Locator } from '@playwright/test';

/**
 * Page Object for `/goals`. Add/Edit open GoalFormModal at App root.
 * Progress updates open GoalProgressModal. Shape mirrors BudgetsPage / DebtsPage.
 */
export class GoalsPage {
  readonly page: Page;
  readonly addButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.addButton = page.getByRole('button', { name: /add goal/i });
  }

  async goto() {
    await this.page.goto('/goals');
    await this.page.waitForURL('**/goals');
  }

  /** Goal card located by its user-supplied `name` (e.g. "Emergency Fund"). */
  card(name: string): Locator {
    return this.page.getByText(name, { exact: false });
  }

  async openAdd() { await this.addButton.click(); }

  async openEdit(name: string) {
    await this.card(name).click();
  }
}
