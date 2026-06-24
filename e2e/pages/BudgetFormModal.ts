import type { Page, Locator } from '@playwright/test';
import type { BudgetPeriod } from '../../src/types';

/**
 * Page Object for the GLOBAL BudgetFormModal mounted at App root.
 * Opened via the Budgets page "+ Add Budget" button or a card's "Edit" button.
 *
 * Mirrors TransactionFormModal: role="dialog" anchor (Modal renders the title
 * via aria-labelledby) + getByLabel field lookups (Field associates each
 * <label> with its control via htmlFor/id). Reuses `selectByValueOrText`
 * (scan options, never speculative selectOption which retries to timeout).
 */
export interface NewBudgetInput {
  category?: string;       // option value, e.g. 'transport' (not the label)
  limit?: number;
  currency?: string;
  period?: BudgetPeriod;
  start?: string;          // YYYY-MM-DD (custom period only)
  end?: string;            // YYYY-MM-DD (custom period only)
  color?: string;          // hex, e.g. '#C44536'
}

export class BudgetFormModal {
  readonly page: Page;
  readonly dialog: Locator;
  readonly categorySelect: Locator;
  readonly limitInput: Locator;
  readonly currencySelect: Locator;
  readonly periodSelect: Locator;
  readonly startDateInput: Locator;
  readonly endDateInput: Locator;
  readonly submitButton: Locator;
  readonly cancelButton: Locator;
  readonly deleteLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dialog = page.getByRole('dialog', { name: /add budget|edit budget/i });

    // exact:true on the plain-word labels — the Period field's hint text
    // "(limit applies to the current calendar month)" contains the word
    // "limit", so a substring getByLabel('Limit') would also match Period.
    this.categorySelect = this.dialog.getByLabel('Category', { exact: true });
    this.limitInput     = this.dialog.getByLabel('Limit', { exact: true });
    this.currencySelect = this.dialog.getByLabel('Currency', { exact: true });
    this.periodSelect   = this.dialog.getByLabel(/^Period/);   // name carries a hint suffix
    this.startDateInput = this.dialog.getByLabel('Start date', { exact: true });
    this.endDateInput   = this.dialog.getByLabel('End date', { exact: true });

    this.submitButton = this.dialog.getByRole('button', { name: /^(Add|Update|Saving…)$/ });
    this.cancelButton = this.dialog.getByRole('button', { name: /^Cancel$/ });
    this.deleteLink   = this.dialog.getByRole('button', { name: /^Delete$/ });
  }

  async waitOpen()   { await this.dialog.waitFor({ state: 'visible' }); }
  async waitClosed() { await this.dialog.waitFor({ state: 'hidden' }); }

  /** The colour swatch button for a given hex (aria-label="Choose colour #..."). */
  colorButton(hex: string): Locator {
    return this.dialog.getByRole('button', { name: `Choose colour ${hex}` });
  }

  async fill(input: NewBudgetInput) {
    if (input.category !== undefined) await this.selectByValueOrText(this.categorySelect, input.category);
    if (input.limit !== undefined)    await this.limitInput.fill(String(input.limit));
    if (input.currency !== undefined) await this.selectByValueOrText(this.currencySelect, input.currency);
    if (input.period !== undefined)   await this.selectByValueOrText(this.periodSelect, input.period);
    if (input.start !== undefined)    await this.startDateInput.fill(input.start);
    if (input.end !== undefined)      await this.endDateInput.fill(input.end);
    if (input.color !== undefined)    await this.colorButton(input.color).click();
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

  /**
   * Select on a native <select> by option value, then exact visible text,
   * then text substring. Scans the rendered options (instant, fails fast) —
   * never `selectOption(value)` speculatively, which retries to timeout.
   */
  async selectByValueOrText(locator: Locator, value: string | number) {
    const v = String(value);
    const options = locator.locator('option');
    await options.first().waitFor({ state: 'attached' });
    const count = await options.count();
    let substringMatch: string | null | undefined;
    for (let i = 0; i < count; i++) {
      const opt = options.nth(i);
      const [val, raw] = await Promise.all([opt.getAttribute('value'), opt.textContent()]);
      const text = (raw ?? '').trim();
      if (val === v || text === v) {
        await locator.selectOption(val ?? { label: text });
        return;
      }
      if (substringMatch === undefined && text.includes(v)) substringMatch = val;
    }
    if (substringMatch !== undefined && substringMatch !== null) {
      await locator.selectOption(substringMatch);
      return;
    }
    throw new Error(`selectByValueOrText: no option matching "${v}"`);
  }
}
