import type { Page, Locator } from '@playwright/test';

/**
 * Page Object for the Transactions list at `/transactions`. The Add and Edit
 * flows actually open the global `TransactionFormModal` (see
 * `pages/TransactionFormModal.ts`); this POM only knows how to navigate,
 * trigger that modal, and read rows.
 *
 * Locator strategy: rows are matched by their (user-supplied, untranslated)
 * description text. The Add button is matched by its accessible name, which
 * is the i18n `add-transaction` key — in English: "Add Transaction".
 */
export class TransactionsPage {
  readonly page: Page;
  readonly addButton: Locator;
  readonly calendarToggle: Locator;

  constructor(page: Page) {
    this.page = page;
    // SCOPED TO <main> ON PURPOSE — this was the single largest cause of
    // failures in this suite.
    //
    // Three controls answer to /add transaction/i: this page's own
    // "+ Add Transaction" button, the global AddFab, and MobileTabBar's button.
    // The FAB and the tab bar are siblings of <main> in Layout.tsx, so an
    // unscoped accessible-name match resolved to 2+ elements and EVERY click
    // failed Playwright's strict mode — reported as a 30s timeout, which reads
    // like a hung app rather than an ambiguous selector.
    //
    // Scoping to <main> targets the page's own button, which is what a
    // TransactionsPage object should drive. It is also robust to copy changes,
    // unlike matching the literal "+ Add Transaction" label.
    const main = page.locator('main');
    this.addButton      = main.getByRole('button', { name: /add transaction/i });
    this.calendarToggle = main.getByRole('button', { name: /calendar/i });
  }

  async goto() {
    await this.page.goto('/transactions');
    await this.page.waitForURL('**/transactions');
  }

  /**
   * A transaction row located by its description text. `exact: false` so
   * tests pass with surrounding category/amount text in the same row.
   */
  row(description: string): Locator {
    return this.page.getByText(description, { exact: false });
  }

  /** Click the "+ Add Transaction" button — caller should `txnModal.waitOpen()`. */
  async openAdd() {
    await this.addButton.click();
  }

  /** Open the edit modal for the row matching `description`. */
  async openEdit(description: string) {
    await this.row(description).click();
  }

  /**
   * Best-effort row count for "this transaction was added" assertions. Counts
   * rows by the stable description text rather than CSS, so it survives layout
   * tweaks. Use `expect(await page.txnCount('Salary')).toBe(1)`.
   */
  async countByDescription(description: string): Promise<number> {
    return this.row(description).count();
  }
}
