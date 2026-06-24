import { expect, test } from '../fixtures/app';

test.describe('§24 A11Y-FC · shipped keyboard shortcut contract', () => {
  test('A11Y-FC-001 · N opens Add Transaction and Esc closes the active modal', async ({
    page, transactions, txnModal,
  }) => {
    await transactions.goto();

    await page.keyboard.press('N');
    await expect(txnModal.dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(txnModal.dialog).toBeHidden();
  });

  test('A11Y-FC-004 · tab order on transaction form is logical and complete', async ({
    page, transactions, txnModal,
  }) => {
    await transactions.goto();
    await transactions.openAdd();
    await txnModal.waitOpen();

    await expect(txnModal.descriptionInput).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(txnModal.amountInput).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(txnModal.currencySelect).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(txnModal.categorySelect).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(txnModal.memberSelect).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(txnModal.accountSelect).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(txnModal.recurringSelect).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(txnModal.noteInput).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(txnModal.excludedCheckbox).toBeFocused();
  });
});