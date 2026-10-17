import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/app';
import { defaultSeed } from '../fixtures/seed';
import { parseMoney } from '../pages/NetWorthPage';

// v10.49.1 (#45) — rewritten for the Aurora dashboard. The old version read a "Total
// Balance" card, the Pulse number and Reports' "All-Time" cards, none of which exist any
// more (the dashboard is Cash Flow + Net Worth, Pulse is hidden). The rule is unchanged:
// a private (excluded) entry never counts in spending or budgets.

/** The dashboard's "Monthly Expenses" figure (desktop metrics row). */
async function monthlyExpenses(page: Page): Promise<number> {
  return parseMoney((await page.getByRole('link', { name: /^Monthly Expenses/ }).innerText()).replace(/^Monthly Expenses/, ''));
}

test.describe('§21 PRIV-FC · Excluded transaction behavior', () => {
  test('PRIV-FC-001 · excluded transactions render with a "Not in totals" badge and muted styling', async ({
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
      account: 'Cash',            // every entry moves an account (money model)
      excluded: true,
    });
    await txnModal.submit();

    const row = page.getByTestId('txn-row').filter({ hasText: 'PRIV-FC-001 Private expense' }).first();

    // W0 (FE-PUB-01): the badge no longer says "Private" — the entry stays visible to the whole household.
    await expect(row).toContainText('Not in totals');
    await expect(row).toContainText('$42');
    await expect(row).toHaveClass(/opacity-65/);
  });

  test.describe('aggregate exclusion', () => {
    test.use({ seed: defaultSeed });

    test('PRIV-FC-002 · excluding an expense from totals removes it from monthly spending', async ({
      page,
      dashboard,
      transactions,
      txnModal,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await dashboard.goto();
      // May 2026: E2E Rent 1,200 + E2E Grocery 350.
      await expect.poll(() => monthlyExpenses(page)).toBe(1550);

      await transactions.goto();
      await transactions.openEdit('E2E Grocery');
      await txnModal.waitOpen();
      // The seeded entry predates required accounts; the form asks for one before it saves.
      await txnModal.fill({ excluded: true, account: 'E2E Checking' });
      await txnModal.submit();

      await dashboard.goto();
      await expect.poll(() => monthlyExpenses(page)).toBe(1200);
    });
  });
});
