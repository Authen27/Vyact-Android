// ──────────────────────────────────────────────────────────────────────────
// §5 BDGT-FC · Budgets
// ──────────────────────────────────────────────────────────────────────────
// Mapped to the DESIGNED inventory scenarios (spend → "used" aggregation,
// overrun styling, utilisation recompute, period handling) — not generic CRUD.
// Budget "spent" is computed from transactions in the category's period window
// (src/lib/calculations.ts:categorySpend; rendered in src/pages/Budgets.tsx).
//
// NOTE on seeding: the app loads a first-run DEMO dataset when transactions,
// budgets AND members are all empty (src/store.ts) — and that demo ships a
// sample `transport $200` budget. Create tests therefore seed a throwaway
// member to keep the household "non-empty" so the demo does not fire and
// pollute assertions.
// ──────────────────────────────────────────────────────────────────────────

import { test, expect } from '../fixtures/app';
import { defaultSeed, seedWith } from '../fixtures/seed';
import { BudgetFormModal } from '../pages/BudgetFormModal';

const FOOD_BUDGET = { id: '00000000-0000-4000-8000-0000000000b2', category: 'food', limit: 300, currency: 'USD' };
const FOOD_TXN    = { id: '00000000-0000-4000-8000-0000000000f1', type: 'expense', amount: 120, currency: 'USD', date: '2026-05-10', description: 'E2E Food Spend', category: 'food' };
const SEED_MEMBER = { id: '00000000-0000-4000-8000-0000000000a1', name: 'E2E Member', role: 'primary' };

test.describe('§5 BDGT-FC · Budgets', () => {

  test.describe('create / period validation', () => {
    // member present → demo seed suppressed; budgets/transactions start empty.
    test.use({ seed: seedWith({ budgets: [], transactions: [], members: [SEED_MEMBER] }) });

    test('CON-E2E-017 · [BDGT-FC-001] creates a monthly budget that starts at 0% used', async ({ page, budgets }) => {
      await budgets.goto();
      await budgets.openAdd();
      const modal = new BudgetFormModal(page);
      await modal.waitOpen();
      await modal.fill({ category: 'transport', limit: 200 });
      await modal.submit();

      // Exactly one budget created (no demo pollution).
      const count = await page.evaluate(() =>
        (window as { __ff_store?: { getState(): { budgets: { category: string }[] } } })
          .__ff_store?.getState().budgets.filter(b => b.category === 'transport').length ?? -1);
      expect(count).toBe(1);

      const card = budgets.card('Transport');
      await expect(card).toBeVisible();
      await expect(card).toContainText(/left/i);   // nothing spent → full limit remains
      await expect(card).toContainText('200');
    });

    test('CON-E2E-020 · [BDGT-FC-004] accepts a non-monthly (quarterly) period', async ({ page, budgets }) => {
      await budgets.goto();
      await budgets.openAdd();
      const modal = new BudgetFormModal(page);
      await modal.waitOpen();
      await modal.fill({ category: 'travel', limit: 900, period: 'quarterly' });
      await modal.submit();
      // Accepted + rendered. (Deep cross-month aggregation across the quarter
      // is a follow-up assertion tracked on BDGT-FC-004.)
      await expect(budgets.card('Travel')).toBeVisible();
    });

    test('CON-E2E-021 · [BDGT-FC-005] custom period requires start and end dates', async ({ page, budgets }) => {
      await budgets.goto();
      await budgets.openAdd();
      const modal = new BudgetFormModal(page);
      await modal.waitOpen();
      await modal.fill({ category: 'education', limit: 100, period: 'custom' });  // dates omitted
      await modal.submitButton.click();                                          // stays open on error
      await expect(page.getByText(/Enter start and end dates for custom period/i)).toBeVisible();
      await expect(modal.dialog).toBeVisible();
      await modal.cancel();
    });
  });

  test.describe('spend aggregation (under budget)', () => {
    test.use({ seed: seedWith({ budgets: [FOOD_BUDGET], transactions: [FOOD_TXN], members: [SEED_MEMBER] }) });

    test('CON-E2E-018 · [BDGT-FC-002] spend in a category reduces the remaining budget', async ({ budgets }) => {
      await budgets.goto();
      const card = budgets.card('Food & Dining');
      await expect(card).toBeVisible();
      // $120 of $300 spent → $180 remaining, shown as "left" (not over).
      await expect(card).toContainText('180');
      await expect(card).toContainText(/left/i);
      await expect(card).not.toContainText(/over/i);
    });
  });

  test.describe('overrun + utilisation recompute', () => {
    // defaultSeed: Food budget $300, seeded grocery expense $350 → OVER by $50.
    test.use({ seed: defaultSeed });

    test('CON-E2E-023 · [BDGT-FC-007] an over-budget category shows over-budget styling', async ({ budgets }) => {
      await budgets.goto();
      const card = budgets.card('Food & Dining');
      await expect(card).toBeVisible();
      await expect(card).toContainText(/over/i);   // $350 spent on a $300 limit
    });

    test('CON-E2E-022 · [BDGT-FC-006] raising the limit recomputes utilisation from over to under', async ({ page, budgets }) => {
      await budgets.goto();
      await expect(budgets.card('Food & Dining')).toContainText(/over/i);   // baseline: over

      await budgets.openEdit('Food & Dining');
      const modal = new BudgetFormModal(page);
      await modal.waitOpen();
      await modal.fill({ limit: 500 });            // $350 spent now < $500 limit
      await modal.submit();
      await expect(page.getByText(/Budget updated/i)).toBeVisible();

      const card = budgets.card('Food & Dining');
      await expect(card).toContainText(/left/i);   // recomputed: now under budget
      await expect(card).not.toContainText(/\bover\b/i);
    });
  });

  test.describe('threshold notification', () => {
    test.use({ seed: defaultSeed });

    // BLOCKED: the budget_threshold notification TYPE exists (types.ts,
    // notifications.ts), but it is not emitted on threshold crossing in
    // local-only mode just by viewing the Budgets page. Verify the trigger
    // before un-skipping; do not assert a notification the app never emits.
    test.fixme('CON-E2E-019 · [BDGT-FC-003] crossing the threshold fires a budget_threshold notification', async () => {
      // TODO: drive whatever engine emits budget_threshold (or confirm Phase),
      // then assert NotificationCenter shows it.
    });
  });
});
