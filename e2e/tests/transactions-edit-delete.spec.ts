import { test, expect } from '../fixtures/app';
import { defaultSeed, seedWith } from '../fixtures/seed';

// v10.49.1 (#45) — seeds are v9.1 budgets now: a PERIOD CONTAINER (scope + year +
// month) with ALLOCATION rows. The old legacy per-category seed ({ category, limit })
// renders a card titled "Budget" with no allocations, so a card keyed on
// "Food & Dining" never appeared. Cards are keyed on their period title ("May 2026").
const container = (id: string, month: number, limit: number) => ({
  id, scope: 'month', periodYear: 2026, periodMonth: month,
  periodStart: `2026-0${month}-01`, periodEnd: `2026-0${month}-${month === 6 ? 30 : 31}`,
  limit, currency: 'USD',
});
const MAY_BUDGET  = container('00000000-0000-4000-8000-0000000000b9', 5, 200);
const JUNE_BUDGET = container('00000000-0000-4000-8000-0000000000ba', 6, 200);
const alloc = (id: string, budgetId: string, amount: number) => ({ id, budgetId, category: 'food_dining', amount });

const MAY_FOOD_TXN = {
  id: '00000000-0000-4000-8000-0000000000f9',
  type: 'expense',
  amount: 100,
  currency: 'USD',
  date: '2026-05-15',
  description: 'TXN-EDIT-FC-003 Food',
  category: 'food_dining',
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
        budgets: [MAY_BUDGET, JUNE_BUDGET],
        budgetAllocations: [
          alloc('00000000-0000-4000-8000-0000000000c9', MAY_BUDGET.id, 200),
          alloc('00000000-0000-4000-8000-0000000000ca', JUNE_BUDGET.id, 200),
        ],
        transactions: [MAY_FOOD_TXN],
        members: [SEED_MEMBER],
      }),
    });

    test('TXN-EDIT-FC-003 · moving a transaction to the next month moves its spend to that month\'s budget', async ({
      transactions, txnModal, budgets,
    }) => {
      await budgets.goto();
      const may = budgets.card('May 2026');
      const june = budgets.card('Jun 2026');
      await expect(may).toContainText('50%');     // $100 of $200
      await expect(june).toContainText('0%');

      await transactions.goto();
      await transactions.openEdit('TXN-EDIT-FC-003 Food');
      await txnModal.waitOpen();
      // The seeded entry predates required accounts; the form asks for one before it saves.
      await txnModal.fill({ date: '2026-06-15', account: 'E2E Checking' });
      await txnModal.submit();

      await budgets.goto();
      await expect(may).toContainText('0%');
      await expect(june).toContainText('50%');
    });
  });

  test.describe('delete confirm flow', () => {
    test.use({
      seed: seedWith({
        budgets: [{ ...MAY_BUDGET, limit: 300 }],
        budgetAllocations: [alloc('00000000-0000-4000-8000-0000000000c9', MAY_BUDGET.id, 300)],
        // Allocations match the stored category id; the legacy 'food' on E2E Grocery is a
        // label alias only, so the spend this test deletes is its own Food & Dining entry.
        transactions: [...(defaultSeed.transactions ?? []), { ...MAY_FOOD_TXN, id: '00000000-0000-4000-8000-0000000000fa', amount: 350, date: '2026-05-12', description: 'TXN-DEL-FC-002 Dinner' }],
      }),
    });

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
      // Track E (E5, v10.99.0): the card reads each planned line as spent / planned. The seeded
      // grocery entry is stored under the legacy id 'food', which budgets now count as Food & Dining:
      // the Dinner ($350) and the grocery ($350) together are $700 against the $300 allocation, listed
      // once — never again as "not planned".
      // The card also lists housing as "not planned" (spending with no allocation); the check here is that
      // Food & Dining itself appears once, planned, and never as a second "not planned" row.
      const foodLines = async () => ((await foodCard.innerText()).match(/Food & Dining/g) ?? []).length;
      await expect(foodCard).toContainText('$700 / $300');
      expect(await foodLines()).toBe(1);

      await transactions.goto();
      await transactions.openEdit('TXN-DEL-FC-002 Dinner');
      await txnModal.waitOpen();
      await txnModal.delete({ accept: true });

      await expect(transactions.row('TXN-DEL-FC-002 Dinner')).toHaveCount(0);

      // Deleting the Dinner recomputes the line: only the grocery ($350) is left, still over the $300.
      await budgets.goto();
      await expect(foodCard).toContainText('$350 / $300');
      await expect(foodCard).not.toContainText('$700');
      expect(await foodLines()).toBe(1);
    });
  });
});
