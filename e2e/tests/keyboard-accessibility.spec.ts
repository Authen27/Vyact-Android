import { expect, test } from '../fixtures/app';

test.describe('§24 A11Y-FC · shipped keyboard shortcut contract', () => {
  // v10.91.0 (audit FE-UIS-10, WCAG 2.1.4; owner decision 13 Oct 2026) — the single-key n / b / d / a
  // add shortcuts are removed. This used to assert that N opened the form; it now asserts that a letter
  // opens nothing. "/" still focuses the search box (focus only), and Esc still closes the form.
  test('A11Y-FC-001 · a single letter opens nothing, "/" focuses search, and Esc closes the form', async ({
    page, transactions, txnModal,
  }) => {
    await transactions.goto();
    // The "/" listener mounts with the page; a key pressed before it renders is lost.
    await expect(page.getByRole('heading', { level: 1, name: 'Transactions' })).toBeVisible();
    const before = page.url();

    for (const key of ['n', 'N', 'b', 'd', 'a']) await page.keyboard.press(key);
    // "/" runs through the same listener after the letters, so once it has acted they were handled.
    await page.keyboard.press('/');
    await expect(page.getByRole('textbox', { name: 'Search transactions' })).toBeFocused();
    await expect(txnModal.dialog).toBeHidden();
    expect(page.url()).toBe(before);

    await transactions.openAdd();
    await txnModal.waitOpen();
    await page.keyboard.press('Escape');
    await expect(txnModal.dialog).toBeHidden();
  });

  // 🔴 REWRITTEN 2026-09-10 for the Aurora transaction form.
  //
  // The previous version tabbed through descriptionInput → amountInput →
  // currencySelect → categorySelect → memberSelect → accountSelect →
  // recurringSelect → noteInput → excludedCheckbox. That is not a renamed set of
  // controls; it is a different FORM. Aurora replaced the flat stack of selects
  // with an amount keypad, testid-driven category chips, and a progressive
  // "all details" disclosure that keeps currency/member/account/recurring out of
  // the initial tab ring entirely. None of those page-object members had existed
  // for months, and because `e2e` was excluded from typechecking the only symptom
  // was a 30s timeout naming the wrong problem.
  //
  // The expected order below was MEASURED against the running form, not assumed.
  // It asserts waypoints rather than every stop, deliberately:
  //   * the category row is a variable number of chips (8 today, driven by
  //     EXPENSE_CATEGORIES + "More"), so enumerating them would break on every
  //     category change — CON-UNIT-155..162 already pin that set;
  //   * `input[type=date]` consumes FOUR consecutive tab stops in Chromium, one
  //     per date segment. Verified as a single input (not four duplicates) before
  //     writing this, so it is browser behaviour, not a defect — but it is
  //     engine-specific and must not be hard-coded as a stop count.
  test('A11Y-FC-004 · tab order on the transaction form follows the visual order and stays on the form', async ({
    page, transactions, txnModal,
  }) => {
    await transactions.goto();
    await transactions.openAdd();
    await txnModal.waitOpen();

    // Initial focus lands on the page heading (v10.35.0 — Amount no longer
    // auto-focuses, so opening the form doesn't pop the OS keyboard uninvited).
    await expect(txnModal.dialog.getByRole('heading', { level: 1 })).toBeFocused();

    // Aurora 4.0 F1 / CAT2: Amount, then the type, then Description, then the
    // category it suggests. Waypoint 1: Description. Walk forward without
    // assuming how many stops precede it (the header help icon, Amount, the
    // transaction-type radiogroup) — those are an implementation detail, not the
    // ordering this test pins.
    const description = txnModal.descriptionInput;
    let headGuard = 0;
    while (!(await description.evaluate(el => el === document.activeElement)) && headGuard < 20) {
      await page.keyboard.press('Tab');
      headGuard++;
    }
    await expect(description, 'Description must be reachable by Tab from the heading').toBeFocused();

    // Waypoint 2: the category select follows Description.
    const categoryPicker = txnModal.dialog.getByTestId('txn-category');
    let guard = 0;
    while (!(await categoryPicker.evaluate(el => el === document.activeElement)) && guard < 20) {
      await page.keyboard.press('Tab');
      guard++;
    }
    await expect(categoryPicker, 'Category picker must follow Description').toBeFocused();

    // Waypoint 3: the date control follows the category (via its Today/Yesterday
    // shortcut buttons), and focus is still on the form page.
    const dateInput = txnModal.dialog.locator('input[type=date]');
    guard = 0;
    while (!(await dateInput.evaluate(el => el === document.activeElement)) && guard < 20) {
      await page.keyboard.press('Tab');
      guard++;
    }
    await expect(dateInput, 'the date field must be reachable by keyboard').toBeFocused();

    // v10.28.0 — the form is a page, not a modal, so there is no focus trap to
    // test. What must hold instead: tabbing never reaches app chrome. The page
    // renders without the Layout, so every focusable stop belongs to the form.
    // (Tabbing past the last control hands focus to the browser's own UI, which
    // fires no focusin and so is not counted.) Checked with a focusin recorder
    // rather than a round-trip per Tab: an evaluate() after every keypress cost
    // minutes of wall clock for a single assertion.
    await page.evaluate(() => {
      const win = window as unknown as { __escapes: string[] };
      win.__escapes = [];
      document.addEventListener('focusin', () => {
        const form = document.querySelector('main[data-form-page]');
        const el = document.activeElement;
        if (!form || !el || !form.contains(el)) {
          win.__escapes.push((el as HTMLElement | null)?.tagName ?? '<none>');
        }
      }, true);
    });

    for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');

    const escapes = await page.evaluate(() =>
      (window as unknown as { __escapes: string[] }).__escapes);
    expect(escapes, 'focus left the form page while tabbing').toEqual([]);
  });
});