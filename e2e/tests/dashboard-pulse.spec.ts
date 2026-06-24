import { test, expect } from '../fixtures/app';
import { seedWith } from '../fixtures/seed';

test.describe('§13 PULSE-FC · Dashboard pulse behavior', () => {
  test.use({
    seed: seedWith({
      transactions: [],
      budgets: [],
      goals: [],
      debts: [],
      assets: [],
      members: [],
    }),
  });

  test('PULSE-FC-005 · empty households show the earnable pulse empty state', async ({
    page, dashboard,
  }) => {
    await dashboard.goto();

    await expect(dashboard.logoLink).toBeVisible();
    await expect(page.getByText('Family Pulse Score™')).toBeVisible();
    await expect(page.getByText('Building your Pulse — add income and a budget to begin.')).toBeVisible();
    await expect(page.getByText('—').first()).toBeVisible();
  });

  test.describe('debt-free renormalisation', () => {
    test.use({
      seed: seedWith({
        transactions: [
          {
            id: '00000000-0000-4000-8000-0000000000ca',
            type: 'income',
            amount: 1000,
            currency: 'USD',
            date: '2026-05-01',
            description: 'PULSE-FC-006 Income',
            category: 'salary',
          },
          {
            id: '00000000-0000-4000-8000-0000000000cb',
            type: 'expense',
            amount: 200,
            currency: 'USD',
            date: '2026-05-10',
            description: 'PULSE-FC-006 Expense',
            category: 'food',
          },
          {
            id: '00000000-0000-4000-8000-0000000000cc',
            type: 'expense',
            amount: 100,
            currency: 'USD',
            date: '2026-04-10',
            description: 'PULSE-FC-006 Previous Expense',
            category: 'food',
          },
        ],
        budgets: [
          {
            id: '00000000-0000-4000-8000-0000000000cd',
            category: 'food',
            limit: 400,
            currency: 'USD',
          },
        ],
        goals: [
          {
            id: '00000000-0000-4000-8000-0000000000ce',
            type: 'savings',
            name: 'PULSE-FC-006 Goal',
            target: 100,
            current: 50,
            currency: 'USD',
            completed: false,
          },
        ],
        debts: [],
      }),
    });

    test('PULSE-FC-006 · debt-free households renormalise the remaining components', async ({
      page, dashboard,
    }) => {
      await dashboard.goto();

      await expect(page.getByText('Family Pulse Score™')).toBeVisible();
      await expect(page.getByText(/^60$/).first()).toBeVisible();

      const pulse = await page.evaluate(() => {
        const win = window as typeof window & {
          __vt_store?: { getState(): { transactions: unknown[]; budgets: unknown[]; goals: unknown[]; debts: unknown[]; profile: { baseCurrency: string }; rates: Record<string, number> } };
          __ff_store?: { getState(): { transactions: unknown[]; budgets: unknown[]; goals: unknown[]; debts: unknown[]; profile: { baseCurrency: string }; rates: Record<string, number> } };
        };
        const store = win.__vt_store ?? win.__ff_store;
        if (!store) throw new Error('Store oracle unavailable');
        const state = store.getState();
        const total = 60;
        return {
          expectedTotal: total,
          transactions: state.transactions.length,
          budgets: state.budgets.length,
          goals: state.goals.length,
          debts: state.debts.length,
        };
      });

      expect(pulse.transactions).toBe(3);
      expect(pulse.budgets).toBe(1);
      expect(pulse.goals).toBe(1);
      expect(pulse.debts).toBe(0);
      expect(pulse.expectedTotal).toBe(60);

      const debtRow = page.locator('div').filter({ hasText: /^Debt$/ }).first().locator('..');
      await expect(debtRow).toContainText('—');
    });
  });
});