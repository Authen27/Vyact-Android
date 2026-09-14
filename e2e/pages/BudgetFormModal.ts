import type { Page, Locator } from '@playwright/test';

/**
 * Page Object for the global BudgetFormModal, opened from the Budgets page's
 * "+ Add Budget" button or a card's "Edit".
 *
 * 🔴 REWRITTEN for the v9.1 container model (2026-09-09).
 *
 * The previous version modelled a PRE-v9.1 budget: one `Category` <select> plus
 * one `Limit` input, with `period` accepting 'quarterly' and 'custom'. None of
 * that exists any more:
 *
 *   • A budget is a PERIOD CONTAINER — scope + year + month — whose total is
 *     split into per-category allocation child rows. It has no category of its
 *     own. (v9.1 §4.)
 *   • Scope is month or annual ONLY. Quarterly and custom date ranges were
 *     removed by the `budget_scope_drop_custom` migration.
 *   • The period is chosen from CHIPS, not a dropdown.
 *   • Since v10.21.1 every expense category has its own always-present amount
 *     field, labelled "Budget for <Label>" — there is no "Add category" step.
 *
 * So `getByLabel('Category')` matched nothing, and the specs using it waited
 * out their timeouts. This object talks to the form that actually exists.
 */
export interface NewBudgetInput {
  /** The period chip to click, e.g. 'Sep 2026' or '2026'. Omit to keep the default. */
  period?: string;
  /** The container total. */
  total?: number;
  /** Per-category allocations, keyed by the category's DISPLAY LABEL. */
  allocations?: Record<string, number>;
}

export class BudgetFormModal {
  readonly page: Page;
  readonly dialog: Locator;
  readonly totalInput: Locator;
  readonly submitButton: Locator;
  readonly cancelButton: Locator;
  readonly deleteLink: Locator;

  constructor(page: Page) {
    this.page = page;
    // v10.28.0 — a routed page (`/budgets/new`, `/budgets/:id/edit`): FormPage's
    // `main` landmark, named by the title.
    this.dialog = page.getByRole('main', { name: /add budget|edit budget/i });
    // The total is the AmountField hero; NumericKeypad labels it "Amount".
    this.totalInput  = this.dialog.getByLabel('Amount', { exact: true });
    // "Create budget · ₹X allocated" when new, "Update budget" when editing.
    this.submitButton = this.dialog.getByRole('button', { name: /^(Create budget|Update budget|Saving…)/ });
    this.cancelButton = this.dialog.getByRole('button', { name: /^Cancel$/ });
    this.deleteLink   = this.dialog.getByRole('button', { name: /^Delete$/ });
  }

  async waitOpen()   { await this.dialog.waitFor({ state: 'visible' }); }
  async waitClosed() { await this.dialog.waitFor({ state: 'hidden' }); }

  /** The always-present amount field for one category, by display label. */
  allocationFor(categoryLabel: string): Locator {
    return this.dialog.getByLabel(`Budget for ${categoryLabel}`);
  }

  /** A period chip, e.g. 'Sep 2026' or '2026'. */
  periodChip(label: string): Locator {
    return this.dialog.getByRole('button', { name: label, exact: true });
  }

  async fill(input: NewBudgetInput) {
    if (input.period !== undefined) await this.periodChip(input.period).click();
    if (input.total !== undefined)  await this.totalInput.fill(String(input.total));
    for (const [label, amount] of Object.entries(input.allocations ?? {})) {
      await this.allocationFor(label).fill(String(amount));
    }
  }

  async submit() {
    await this.submitButton.click();
    await this.waitClosed();
  }

  async cancel() {
    await this.cancelButton.click();
    await this.waitClosed();
  }

  async delete({ accept = true }: { accept?: boolean } = {}) {
    this.page.once('dialog', d => (accept ? d.accept() : d.dismiss()));
    await this.deleteLink.click();
    if (accept) await this.waitClosed();
  }
}
