import type { Page, Locator } from '@playwright/test';
import type { TxnType, Recurrence } from '../../src/types';

/**
 * Page Object for the GLOBAL TransactionFormModal mounted at App root
 * (`react/src/App.tsx` line 44). The modal is opened/closed via the
 * Zustand store (`openAddTxn`, `openEditTxn`, `closeTxnModal`) — typically
 * invoked from the "+ Add Transaction" button on the Transactions page
 * or the `N` keyboard shortcut.
 *
 * Locator strategy: prefer role + accessible-name (Modal renders a `dialog`
 * with the title as its name) and form labels (Field renders `<label>` →
 * `<input>` pairs). These survive copy edits and i18n better than CSS.
 */
export interface NewTransactionInput {
  type: TxnType;
  amount: number;
  date: string;            // YYYY-MM-DD
  timeClock?: string;
  timeMeridiem?: 'AM' | 'PM';
  description: string;
  category?: string;       // value (e.g. 'food'), not the display label
  currency?: string;
  account?: string;        // paymentMethod value
  member?: string;         // memberId value
  note?: string;
  recurring?: Recurrence;
  excluded?: boolean;
}

export class TransactionFormModal {
  readonly page: Page;
  readonly dialog: Locator;
  readonly trackPicker: Locator;
  readonly typeSelect: Locator;
  readonly dateInput: Locator;
  readonly timeClockInput: Locator;
  readonly timeMeridiemSelect: Locator;
  readonly descriptionInput: Locator;
  readonly amountInput: Locator;
  readonly currencySelect: Locator;
  readonly categorySelect: Locator;
  readonly memberSelect: Locator;
  readonly accountSelect: Locator;
  readonly recurringSelect: Locator;
  readonly noteInput: Locator;
  readonly excludedCheckbox: Locator;
  readonly splitToggle: Locator;
  readonly submitButton: Locator;        // "Add" or "Update" depending on mode
  readonly cancelButton: Locator;
  readonly deleteLink: Locator;          // only present in Edit mode

  constructor(page: Page) {
    this.page = page;
    // Dialog with one of the two known titles — covers both create + edit modes.
    this.dialog = page.getByRole('dialog', { name: /add transaction|edit transaction/i });
    this.trackPicker = this.dialog.locator('[data-testid="track-picker"]');

    // Field labels are defined in TransactionFormModal.tsx; using getByLabel
    // pierces the wrapper components and lands on the underlying input.
    this.typeSelect       = this.dialog.getByLabel('Track');
    this.dateInput        = this.dialog.getByLabel('Date');
    this.timeClockInput   = this.dialog.getByPlaceholder('hh:mm');
    this.timeMeridiemSelect = this.dialog.locator('input[placeholder="hh:mm"] ~ select');
    this.descriptionInput = this.dialog.getByLabel('Description');
    this.amountInput      = this.dialog.getByLabel('Amount');
    this.currencySelect   = this.dialog.getByLabel('Currency');
    this.categorySelect   = this.dialog.getByLabel('Category');
    this.memberSelect     = this.dialog.getByLabel('Member');
    this.accountSelect    = this.dialog.getByLabel('Account');
    this.recurringSelect  = this.dialog.getByLabel('Recurring');
    this.noteInput        = this.dialog.getByLabel('Note');
    this.excludedCheckbox = this.dialog.getByLabel(/Private — exclude from totals/);
    this.splitToggle      = this.dialog.getByLabel(/Split this bill with others/);

    this.submitButton = this.dialog.getByRole('button', { name: /^(Add|Update|Saving…)$/ });
    this.cancelButton = this.dialog.getByRole('button', { name: /^Cancel$/ });
    this.deleteLink   = this.dialog.getByRole('button', { name: /^Delete$/ });
  }

  /** Wait for the modal to be visible (after the trigger has been clicked). */
  async waitOpen() {
    await this.dialog.waitFor({ state: 'visible' });
  }

  /** Wait for the modal to fully close (after submit/cancel). */
  async waitClosed() {
    await this.dialog.waitFor({ state: 'hidden' });
  }

  /**
   * Fill every field present in `input`. Empty / undefined fields are skipped,
   * so callers can express "use defaults" by simply omitting the key.
   *
   * Note on Selects: the underlying `<select>` is the labelled element, so
   * `selectOption` works directly on the locator returned by `getByLabel`.
   */
  async fill(input: Partial<NewTransactionInput>) {
    // All <select> fields go through selectByValueOrText, which matches by
    // value OR visible text and FAILS FAST on a bad value (a bare
    // selectOption(value) retries until the test timeout if no option
    // matches — a 30 s hang trap).
    if (input.type !== undefined)        await this.selectByValueOrText(this.typeSelect, input.type);
    if (input.date !== undefined)        await this.dateInput.fill(input.date);
    if (input.timeClock !== undefined)   await this.timeClockInput.fill(input.timeClock);
    if (input.timeMeridiem !== undefined) await this.selectByValueOrText(this.timeMeridiemSelect, input.timeMeridiem);
    if (input.description !== undefined) await this.descriptionInput.fill(input.description);
    if (input.amount !== undefined)      await this.amountInput.fill(String(input.amount));
    if (input.currency !== undefined)    await this.selectByValueOrText(this.currencySelect, input.currency);
    if (input.category !== undefined)    await this.selectByValueOrText(this.categorySelect, input.category);
    if (input.member !== undefined)      await this.selectByValueOrText(this.memberSelect, input.member);
    if (input.account !== undefined)     await this.selectByValueOrText(this.accountSelect, input.account);
    if (input.recurring !== undefined)   await this.selectByValueOrText(this.recurringSelect, input.recurring);
    if (input.note !== undefined)        await this.noteInput.fill(input.note);
    if (input.excluded === true)         await this.excludedCheckbox.check();
    if (input.excluded === false)        await this.excludedCheckbox.uncheck();
  }

  /**
   * Select an option on a native <select> by value OR by visible text
   * (exact, then substring). Currency/account options carry an emoji/symbol
   * prefix in their text (e.g. "🏦 E2E Checking", "$ USD"), so the caller can
   * pass the bare name.
   *
   * IMPORTANT: we scan the existing <option> set and match in JS rather than
   * calling `locator.selectOption(value)` speculatively. `selectOption` does
   * NOT fail fast on a non-matching value — it RETRIES until the test timeout
   * (30 s), so a try/catch cascade of selectOption calls would hang. Scanning
   * the already-rendered options is instant and fails with a clear error.
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
      if (val === v || text === v) {                       // exact value or label
        await locator.selectOption(val ?? { label: text });
        return;
      }
      if (substringMatch === undefined && text.includes(v)) {
        substringMatch = val;                              // remember first substring hit
      }
    }
    if (substringMatch !== undefined) {
      await locator.selectOption(substringMatch);
      return;
    }
    throw new Error(`selectByValueOrText: no option matching "${v}"`);
  }

  /** Click Add/Update and wait for the modal to dismiss. */
  async submit() {
    await this.submitButton.click();
    await this.waitClosed();
  }

  /** Click Cancel and wait for the modal to dismiss. */
  async cancel() {
    await this.cancelButton.click();
    await this.waitClosed();
  }

  trackPickButton(type: TxnType): Locator {
    return this.dialog.locator(`[data-testid="track-pick-${type}"]`);
  }

  trackFieldValue(label: string): Locator {
    return this.dialog.locator('div').filter({ has: this.dialog.getByText('Track', { exact: true }) }).getByText(label, { exact: true }).first();
  }

  get changeTrackButton(): Locator {
    return this.dialog.getByRole('button', { name: /^Change$/ });
  }

  /**
   * Edit-mode only: clicks the Delete link, accepts the confirm() dialog,
   * and waits for the modal to dismiss. Pass `accept=false` to test the
   * cancel path on the confirm.
   */
  async delete({ accept = true }: { accept?: boolean } = {}) {
    this.page.once('dialog', d => (accept ? d.accept() : d.dismiss()));
    await this.deleteLink.click();
    if (accept) await this.waitClosed();
  }
}
