import type { Page, Locator } from '@playwright/test';

/**
 * Page Object for `/debts`. Add/Edit open the loan form (DebtFormModal) at App root.
 * Paying opens the loan's Pay sheet (W4f) — see the §7 DEBT-FC golden test.
 */
export class DebtsPage {
  readonly page: Page;
  readonly addButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.addButton = page.getByRole('button', { name: /add (a )?loan/i }).first();   // the header button; an empty page also offers one in its empty state
  }

  async goto() {
    await this.page.goto('/debts');
    await this.page.waitForURL('**/debts');
  }

  /** Debt card located by its user-supplied `name` (e.g. "Chase Sapphire"). */
  card(name: string): Locator {
    // The name now appears in the list row, the selected card and the detail header;
    // the first match is the list row.
    return this.page.getByText(name, { exact: true }).filter({ visible: true }).first();
  }

  async openAdd() { await this.addButton.click(); }

  async openEdit(name: string) {
    await this.card(name).click();
  }

  /** The loan's Pay button (opens its Pay sheet). */
  payButton(): Locator {
    return this.page.getByRole('button', { name: 'Pay', exact: true }).filter({ visible: true }).first();
  }
}
