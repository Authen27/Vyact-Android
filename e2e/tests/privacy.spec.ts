import { test, expect } from '../fixtures/app';

function cardValueByLabel(page: Parameters<typeof test>[0]['page'], label: string) {
  return page.locator('div').filter({ has: page.getByText(label, { exact: true }) }).locator('span[title]').first();
}

test.describe('§21 PRIV-FC · Excluded transaction behavior', () => {
  test('PRIV-FC-001 · excluded transactions render with private badge and muted styling', async ({
    page,
    transactions,
    txnModal,
  }) => {
    await transactions.goto();
    await transactions.openAdd();
    await txnModal.waitOpen();

    await txnModal.fill({
      type: 'expense',
      amount: 42,
      date: '2026-05-12',
      description: 'PRIV-FC-001 Private expense',
      category: 'food',
      excluded: true,
    });
    await txnModal.submit();

    const row = page.getByTestId('txn-row').filter({ hasText: 'PRIV-FC-001 Private expense' }).first();

    await expect(row).toContainText('Private');
    await expect(row).toContainText('$42');
    await expect(row).toHaveClass(/opacity-65/);
  });

  test.describe('aggregate exclusion', () => {
    test.use({
      seed: {
        transactions: [
          {
            id: '00000000-0000-4000-8000-0000000000p1',
            type: 'income',
            amount: 1000,
            currency: 'USD',
            date: '2026-05-01',
            description: 'PRIV-FC-002 Income',
            category: 'salary',
          },
          {
            id: '00000000-0000-4000-8000-0000000000p2',
            type: 'expense',
            amount: 200,
            currency: 'USD',
            date: '2026-05-10',
            description: 'PRIV-FC-002 Expense',
            category: 'food',
          },
        ],
        budgets: [
          {
            id: '00000000-0000-4000-8000-0000000000p3',
            category: 'food',
            limit: 400,
            currency: 'USD',
          },
        ],
        goals: [
          {
            id: '00000000-0000-4000-8000-0000000000p4',
            type: 'savings',
            name: 'PRIV-FC-002 Goal',
            target: 100,
            current: 50,
            currency: 'USD',
            completed: false,
          },
        ],
        debts: [],
        assets: [],
      },
    });

    test('PRIV-FC-002 · excluded transactions skip transaction-derived aggregations', async ({
      page,
      transactions,
      txnModal,
      budgets,
    }) => {
      await page.goto('/dashboard');
      await page.waitForURL('**/dashboard');

      await expect(cardValueByLabel(page, 'Monthly Expenses')).toHaveAttribute('title', '$200.00');
      await expect(cardValueByLabel(page, 'Total Balance')).toHaveAttribute('title', '$800.00');
      await expect(page.getByText(/^69$/).first()).toBeVisible();

      await page.goto('/reports');
      await page.waitForURL('**/reports');
      await expect(cardValueByLabel(page, 'All-Time Expenses')).toHaveAttribute('title', '$200.00');
      await expect(cardValueByLabel(page, 'Net Flow')).toHaveAttribute('title', '$800.00');

      await budgets.goto();
      await expect(budgets.card('Food & Dining')).toContainText('$200.00');
      await expect(budgets.card('Food & Dining')).toContainText('$200.00 left');

      await transactions.goto();
      await transactions.openEdit('PRIV-FC-002 Expense');
      await txnModal.waitOpen();
      await txnModal.fill({ excluded: true });
      await txnModal.submit();

      await page.goto('/dashboard');
      await page.waitForURL('**/dashboard');
      await expect(cardValueByLabel(page, 'Monthly Expenses')).toHaveAttribute('title', '$0.00');
      await expect(cardValueByLabel(page, 'Total Balance')).toHaveAttribute('title', '$1,000.00');
      await expect(page.getByText(/^88$/).first()).toBeVisible();

      await page.goto('/reports');
      await page.waitForURL('**/reports');
      await expect(cardValueByLabel(page, 'All-Time Expenses')).toHaveAttribute('title', '$0.00');
      await expect(cardValueByLabel(page, 'Net Flow')).toHaveAttribute('title', '$1,000.00');

      await budgets.goto();
      await expect(budgets.card('Food & Dining')).toContainText('$0.00');
      await expect(budgets.card('Food & Dining')).toContainText('$400.00 left');
    });
  });
});