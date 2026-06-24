import { test, expect } from '../fixtures/app';
import { defaultSeed, seedWith } from '../fixtures/seed';

const FOOD_BUDGET = {
  id: '00000000-0000-4000-8000-0000000000b9',
  category: 'food',
  limit: 200,
  currency: 'USD',
};

const MAY_FOOD_TXN = {
  id: '00000000-0000-4000-8000-0000000000f9',
  type: 'expense',
  amount: 100,
  currency: 'USD',
  date: '2026-05-15',
  description: 'TXN-EDIT-FC-003 Food',
  category: 'food',
  memberId: '00000000-0000-4000-8000-0000000000a9',
};

const SEED_MEMBER = {
  id: '00000000-0000-4000-8000-0000000000a9',
  name: 'E2E Member',
  role: 'primary',
};

test.describe('§2/§3 TXN-EDIT-FC · Transaction edit and delete', () => {
  test.describe('date edit propagation', () => {
    test.use({
      seed: seedWith({
        budgets: [FOOD_BUDGET],
        transactions: [MAY_FOOD_TXN],
        members: [SEED_MEMBER],
      }),
    });

    test('TXN-EDIT-FC-003 · moving a transaction to the next month updates the active budget window', async ({
      page, transactions, txnModal, budgets, advanceClock,
    }) => {
      await budgets.goto();
      const foodCard = budgets.card('Food & Dining');
      await expect(foodCard).toBeVisible();
      await expect(foodCard).toContainText('100');
      await expect(foodCard).toContainText(/left/i);

      await transactions.goto();
      await transactions.openEdit('TXN-EDIT-FC-003 Food');
      await txnModal.waitOpen();
      await txnModal.fill({ date: '2026-06-15' });
      await txnModal.submit();

      await budgets.goto();
      await expect(foodCard).toContainText('200');
      await expect(foodCard).toContainText(/left/i);

      await advanceClock('2026-06-20T12:00:00Z');
      await page.reload();
      await expect(foodCard).toContainText('100');
      await expect(foodCard).toContainText(/left/i);
    });
  });

  test.describe('delete confirm flow', () => {
    test.use({ seed: defaultSeed });

    test('TXN-DEL-FC-001 · canceling the delete confirm keeps the transaction intact', async ({
      transactions, txnModal,
    }) => {
      await transactions.goto();
      await expect(transactions.row('E2E Grocery')).toBeVisible();

      await transactions.openEdit('E2E Grocery');
      await txnModal.waitOpen();
      await txnModal.delete({ accept: false });
      await expect(txnModal.dialog).toBeVisible();
      await txnModal.cancel();

      await expect(transactions.row('E2E Grocery')).toBeVisible();
      await expect(transactions.row('E2E Grocery')).toHaveCount(1);
    });

    test('TXN-DEL-FC-002 · confirming delete removes the row and recomputes the budget aggregate', async ({
      transactions, txnModal, budgets,
    }) => {
      await budgets.goto();
      const foodCard = budgets.card('Food & Dining');
      await expect(foodCard).toBeVisible();
      await expect(foodCard).toContainText(/over/i);

      await transactions.goto();
      await transactions.openEdit('E2E Grocery');
      await txnModal.waitOpen();
      await txnModal.delete({ accept: true });

      await expect(transactions.row('E2E Grocery')).toHaveCount(0);

      await budgets.goto();
      await expect(foodCard).toContainText('300');
      await expect(foodCard).toContainText(/left/i);
      await expect(foodCard).not.toContainText(/\bover\b/i);
    });
  });
});