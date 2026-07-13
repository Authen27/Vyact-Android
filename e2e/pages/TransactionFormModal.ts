import type { Page, Locator } from '@playwright/test';
import type { TxnType, Recurrence } from '../../src/types';

/**
 * Page Object for the GLOBAL TransactionFormModal mounted at App root
 * (`react/src/App.tsx`). The modal is opened/closed via the Zustand store
 * (`openAddTxn`, `openEditTxn`, `closeTxnModal`) — typically from the
 * "+ Add Transaction" button on the Transactions page, the AddFab, or the
 * `N` keyboard shortcut.
 *
 * v10.1 (Aurora forms doctrine): the form is an AMOUNT-FIRST half-sheet.
 * Dropdowns were replaced by chips and the amount is entered on an in-sheet
 * numeric keypad. This POM drives that UI via stable `data-testid` hooks
 * (`txn-type-*`, `txn-cat-*`, `txn-acct-*`, `txn-to-*`, `txn-cur-*`,
 * `txn-member-*`) plus a keypad helper. Secondary fields (currency, member,
 * note, time, split, private) live behind an "All details ▾" disclosure.
 */
export interface NewTransactionInput {
  type: TxnType;
  amount: number;
  date: string;            // YYYY-MM-DD
  timeClock?: string;
  timeMeridiem?: 'AM' | 'PM';
  description: string;
  category?: string;       // category id (e.g. 'food'), not the display label
  currency?: string;       // e.g. 'EUR'
  account?: string;        // account NAME (e.g. 'E2E Checking')
  member?: string;         // member NAME (e.g. 'Test User')
  note?: string;
  recurring?: Recurrence;  // no-op: recurrence is authored on the Recurring page
  excluded?: boolean;
}

export class TransactionFormModal {
  readonly page: Page;
  readonly keypad: Locator;
  readonly dialog: Locator;
  readonly amountDisplay: Locator;
  readonly descriptionInput: Locator;
  readonly dateInput: Locator;
  readonly noteInput: Locator;
  readonly excludedCheckbox: Locator;
  readonly splitToggle: Locator;
  readonly allDetailsToggle: Locator;
  readonly submitButton: Locator;         // "Save" (create) / "Update" (edit)
  readonly addAnotherButton: Locator;     // "Save & add another" (create only)
  readonly deleteLink: Locator;           // only present in Edit mode

  constructor(page: Page) {
    this.page = page;
    this.keypad = page.getByRole('group', { name: 'Amount keypad' });
    // The txn sheet is the dialog that owns the amount keypad — unambiguous
    // even if another dialog is on screen.
    this.dialog = page.getByRole('dialog').filter({ has: this.keypad });
    this.amountDisplay = this.dialog.locator('[aria-live="polite"]').first();
    this.descriptionInput = this.dialog.getByLabel('Description');
    this.dateInput = this.dialog.getByLabel('Pick a date');
    this.noteInput = this.dialog.getByLabel('Note');
    this.excludedCheckbox = this.dialog.getByLabel(/Private — exclude from totals/);
    this.splitToggle = this.dialog.getByLabel(/Split this bill with others|Share this income with others/);
    this.allDetailsToggle = this.dialog.getByTestId('txn-all-details');
    this.submitButton = this.dialog.getByRole('button', { name: /^(Save|Update|Saving…)$/, exact: true });
    this.addAnotherButton = this.dialog.getByRole('button', { name: 'Save & add another' });
    this.deleteLink = this.dialog.getByRole('button', { name: /^Delete$/ });
  }

  async waitOpen() { await this.dialog.waitFor({ state: 'visible' }); }
  async waitClosed() { await this.dialog.waitFor({ state: 'hidden' }); }

  // ── amount keypad ──────────────────────────────────────────────────────
  private key(label: string): Locator {
    return this.keypad.getByRole('button', { name: label === '⌫' ? 'Backspace' : label, exact: true });
  }

  /** Read the current amount as a plain decimal string ("" when unset). */
  async amountValue(): Promise<string> {
    const raw = (await this.amountDisplay.textContent()) ?? '';
    const digits = raw.replace(/[^0-9.]/g, '');
    return digits === '0' ? '' : digits;
  }

  /** Clear the amount, then type it digit-by-digit on the in-sheet keypad. */
  async setAmount(amount: number | string) {
    const cur = await this.amountValue();
    for (let i = 0; i < cur.length + 2; i++) await this.key('⌫').click();
    for (const ch of String(amount)) {
      if (ch >= '0' && ch <= '9') await this.key(ch).click();
      else if (ch === '.') await this.key('.').click();
      // any other char (e.g. '-') has no keypad key — silently unenterable
    }
  }

  // ── chip / field setters ───────────────────────────────────────────────
  async setType(type: TxnType) { await this.dialog.getByTestId(`txn-type-${type}`).click(); }
  async setCategory(id: string) { await this.dialog.getByTestId(`txn-cat-${id}`).click(); }
  async setDate(date: string) { await this.dateInput.fill(date); }
  async setDescription(text: string) { await this.descriptionInput.fill(text); }

  /** Reveal the "All details ▾" section (currency / member / time / note / split). */
  async openAllDetails() {
    if (await this.allDetailsToggle.count() > 0 && await this.allDetailsToggle.isVisible()) {
      await this.allDetailsToggle.click();
    }
  }

  async setTime(clock?: string, meridiem?: 'AM' | 'PM') {
    if (clock === undefined && meridiem === undefined) return;
    await this.openAllDetails();
    if (clock !== undefined) await this.dialog.getByLabel('Time').fill(clock);
    if (meridiem !== undefined) await this.dialog.getByRole('button', { name: meridiem, exact: true }).click();
  }

  async setCurrency(code: string) {
    await this.openAllDetails();
    await this.dialog.getByTestId(`txn-cur-${code}`).click();
  }

  /** Select a member by NAME (chip lives under "All details"). */
  async setMember(name: string) {
    await this.openAllDetails();
    await this.dialog.getByRole('button', { name, exact: true }).click();
  }

  async setNote(text: string) {
    await this.openAllDetails();
    await this.noteInput.fill(text);
  }

  /** Select the source account chip by its visible NAME (e.g. 'E2E Checking'). */
  async selectAccount(name: string) {
    await this.dialog.getByRole('button', { name, exact: true }).first().click();
  }

  /** Select the destination account chip (transfer/investment) by NAME. */
  async selectToAccount(name: string) {
    await this.dialog.getByRole('button', { name, exact: true }).last().click();
  }

  /**
   * Fill every field present in `input`. Empty / undefined fields are skipped.
   * Order matters: type first (it resets the category set), then the rest.
   * Account selection is intentionally left to the caller (`selectAccount`)
   * because required accounts vary by track.
   */
  async fill(input: Partial<NewTransactionInput>) {
    if (input.type !== undefined)        await this.setType(input.type);
    if (input.amount !== undefined)      await this.setAmount(input.amount);
    if (input.date !== undefined)        await this.setDate(input.date);
    if (input.description !== undefined) await this.setDescription(input.description);
    if (input.category !== undefined)    await this.setCategory(input.category);
    if (input.timeClock !== undefined || input.timeMeridiem !== undefined) {
      await this.setTime(input.timeClock, input.timeMeridiem);
    }
    if (input.currency !== undefined)    await this.setCurrency(input.currency);
    if (input.member !== undefined)      await this.setMember(input.member);
    if (input.note !== undefined)        await this.setNote(input.note);
    if (input.account !== undefined)     await this.selectAccount(input.account);
    if (input.excluded === true)  { await this.openAllDetails(); await this.excludedCheckbox.check(); }
    if (input.excluded === false) { await this.openAllDetails(); await this.excludedCheckbox.uncheck(); }
  }

  /** Click Save/Update and wait for the sheet to dismiss. */
  async submit() {
    await this.submitButton.click();
    await this.waitClosed();
  }

  /** Click "Save & add another" — the sheet stays open, form resets. */
  async saveAndAddAnother() {
    await this.addAnotherButton.click();
  }

  /** Dismiss without saving. The Aurora sheet has no Cancel button — Escape,
   *  the ✕ (desktop) / grabber (mobile), or a scrim tap all close it. */
  async cancel() {
    await this.page.keyboard.press('Escape');
    await this.waitClosed();
  }

  /**
   * Edit-mode only: clicks the Delete link, accepts the confirm() dialog,
   * and waits for the sheet to dismiss. Pass `accept=false` to test the
   * cancel path on the confirm.
   */
  async delete({ accept = true }: { accept?: boolean } = {}) {
    this.page.once('dialog', d => (accept ? d.accept() : d.dismiss()));
    await this.deleteLink.click();
    if (accept) await this.waitClosed();
  }
}
