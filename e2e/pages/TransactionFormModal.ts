import type { Page, Locator } from '@playwright/test';
import type { TxnType, Recurrence } from '../../src/types';
import { getCat } from '../../src/constants';

/**
 * Page Object for the transaction form. Since v10.28.0 it is a routed,
 * full-screen PAGE (`/transactions/new`, `/transactions/:id/edit`), opened by
 * the store's `openAddTxn` / `openEditTxn` — typically from the
 * "+ Add Transaction" button on the Transactions page, the AddFab, or the
 * `N` keyboard shortcut — and closed back to the screen that opened it.
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
    // ANCHORED ON THE DIALOG'S ACCESSIBLE NAME.
    //
    // This used to key off a `group` named "Amount keypad". That element no
    // longer exists anywhere in the app, so the dialog locator matched nothing
    // and every modal-dependent test failed with a 30s `waitFor` timeout — the
    // page object was describing a UI that had been redesigned out from under
    // it (the sheet now renders through HalfSheet, role="dialog" + aria-label).
    //
    // The title is `${'Add'|'Edit'} ${typeMeta.label}` (TransactionFormModal
    // :421), so the name below matches exactly this form and NOT the budget,
    // debt or split forms that share the same FormPage wrapper.
    //
    // v10.28.0 — the form is a page: FormPage renders a `main` landmark named
    // by its title. The property keeps the name `dialog` so every spec that
    // scopes a locator to "the transaction form" still reads the same.
    this.dialog = page.getByRole('main', {
      name: /^(Add|Edit) (transaction|expense|income|transfer|investment)$/i,
    });
    // The keypad group is gone; keep the property pointing at the dialog's
    // amount control so callers that reference it still resolve to something
    // meaningful rather than a phantom.
    this.keypad = this.dialog;
    // The amount INPUT (not a display element) — see setAmount below.
    this.amountDisplay = this.dialog.getByLabel('Amount', { exact: true });
    this.descriptionInput = this.dialog.getByLabel('Description');
    this.dateInput = this.dialog.getByLabel('Pick a date');
    this.noteInput = this.dialog.getByLabel('Note');
    this.excludedCheckbox = this.dialog.getByLabel(/Private — exclude from totals/);
    this.splitToggle = this.dialog.getByLabel(/Split this bill with others|Share this income with others/);
    this.allDetailsToggle = this.dialog.getByTestId('txn-all-details');
    // The primary button is `Save ${form.type}` / `Update ${form.type}` — e.g.
    // "Save expense" (TransactionFormModal.tsx:476), never a bare "Save". The
    // old exact `/^(Save|Update|Saving…)$/` matched nothing, so `submit()` sat
    // out its 30s timeout on every create/edit test. The type alternation is
    // spelled out rather than using a wildcard so this cannot accidentally
    // match the "Save & add another" cap link beneath it.
    this.submitButton = this.dialog.getByRole('button', {
      name: /^((Save|Update) (transaction|expense|income|transfer|investment)|Saving…)$/i,
    });
    this.addAnotherButton = this.dialog.getByRole('button', { name: 'Save & add another' });
    this.deleteLink = this.dialog.getByRole('button', { name: /^Delete$/ });
  }

  async waitOpen() { await this.dialog.waitFor({ state: 'visible' }); }
  async waitClosed() { await this.dialog.waitFor({ state: 'hidden' }); }

  // ── amount ─────────────────────────────────────────────────────────────
  //
  // 🔴 REPAIRED 2026-09-10. THERE IS NO KEYPAD.
  //
  // These helpers drove an in-sheet digit pad: `setAmount` clicked "⌫" to clear,
  // then one button per digit. No such buttons exist — the dialog's full button
  // list is Close, the four type chips, the category chips, Today/Yesterday,
  // Pick a time, the account chips, the member chips, Save and Save & add
  // another. Amount is a plain `input type="text" inputmode="decimal"` with its
  // own sanitiser.
  //
  // The cost of that drift was disproportionate: `setAmount` is on the path of
  // almost every transaction test, and clicking a button that does not exist
  // burns the full 30s timeout and then reports `locator.click` on "Backspace" —
  // an error that names the keypad, not the redesign. A large share of Lane A's
  // failures traced back to these two methods alone.
  //
  // `amountValue` was broken in a quieter way: it read `textContent` from what
  // is an `<input>`, so it returned "" no matter what the field held, and every
  // caller comparing against it was asserting nothing.

  /** Read the current amount as a plain decimal string ("" when unset). */
  async amountValue(): Promise<string> {
    const raw = await this.amountDisplay.inputValue();
    return raw === '0' ? '' : raw;
  }

  /**
   * Set the amount through the real input.
   *
   * The field silently rejects anything that is not a positive decimal — a
   * leading '-' is stripped, letters never land, a second '.' is refused — so
   * the value that sticks may differ from what was asked for. That is the app's
   * contract (asserted by CON-E2E-013), not something to work around here.
   */
  async setAmount(amount: number | string) {
    await this.amountDisplay.fill('');
    await this.amountDisplay.fill(String(amount));
  }

  // ── chip / field setters ───────────────────────────────────────────────
  async setType(type: TxnType) { await this.dialog.getByTestId(`txn-type-${type}`).check(); }
  async setCategory(id: string) {
    const category = getCat(id);
    await this.dialog.getByTestId('txn-category').selectOption({ label: `${category.icon} ${category.label}` });
  }
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
    const option = await this.dialog.getByTestId('txn-member').locator('option').evaluateAll((options, memberName) =>
      options.find(option => option.textContent === memberName || option.textContent === `${memberName} (You)`)?.getAttribute('value'), name);
    if (!option) throw new Error(`Member option not found: ${name}`);
    await this.dialog.getByTestId('txn-member').selectOption(option);
  }

  async setNote(text: string) {
    await this.openAllDetails();
    await this.noteInput.fill(text);
  }

  /** Select the source account chip by its visible NAME (e.g. 'E2E Checking'). */
  async selectAccount(name: string) {
    await this.dialog.getByTestId('txn-source').selectOption({ label: name });
  }

  /** Select the destination account chip (transfer/investment) by NAME. */
  async selectToAccount(name: string) {
    await this.dialog.getByTestId('txn-destination').selectOption({ label: name });
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

  /** Dismiss without saving. The form has no Cancel button — Escape or the
   *  ✕ Close control returns to the screen that opened the page. */
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
