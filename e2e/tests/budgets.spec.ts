// ──────────────────────────────────────────────────────────────────────────
// §5 BDGT-FC · Budgets
// ──────────────────────────────────────────────────────────────────────────
// Mapped to the DESIGNED inventory scenarios (spend → "used" aggregation,
// overrun styling, utilisation recompute) — not generic CRUD. Budget "spent" is
// computed from transactions in the category's period window
// (src/lib/calculations.ts; rendered in src/pages/Budgets.tsx).
//
// 🔴 REWRITTEN 2026-09-09 for the v9.1 container model.
//
// These specs modelled a PRE-v9.1 budget — one category, one limit — created
// through a `Category` dropdown that no longer exists, using `transport`, a
// category retired in v10.21. They had been failing for months, and the failure
// looked like a stale selector because it surfaced as a 30s timeout.
//
// Two of the original seven tested features that were DELIBERATELY REMOVED
// (quarterly and custom-range budgets, dropped by `budget_scope_drop_custom`).
// Those are retired rather than rewritten — a test for a removed feature is not
// a gap in coverage.
//
// NOTE on seeding: the app loads a first-run DEMO dataset when transactions,
// budgets AND members are all empty, and that demo ships its own budget. Create
// tests seed a throwaway member so the demo does not fire and pollute
// assertions. They also seed `profile.onboardedAt`, because an empty ledger
// otherwise makes App.tsx redirect /budgets to /onboarding.
// ──────────────────────────────────────────────────────────────────────────

import { test, expect } from '../fixtures/app';
import { defaultSeed, seedWith } from '../fixtures/seed';
import { BudgetFormModal } from '../pages/BudgetFormModal';

// A v9.1 budget is a PERIOD CONTAINER (scope + year + month, a total) whose
// limit is split into ALLOCATION child rows. The Budgets page takes its
// category labels from the allocations — a container alone renders a card with
// no category text, which is why the old legacy-shaped seeds matched nothing.
// FIXED_NOW is 2026-05-22, so the container must be May 2026 for the seeded
// spend to fall inside its window.
const FOOD_BUDGET = {
  id: '00000000-0000-4000-8000-0000000000b2',
  scope: 'month', periodYear: 2026, periodMonth: 5,
  periodStart: '2026-05-01', periodEnd: '2026-05-31',
  limit: 300, currency: 'USD',
};
const FOOD_ALLOC = {
  id: '00000000-0000-4000-8000-0000000000c2',
  budgetId: FOOD_BUDGET.id, category: 'food_dining', amount: 300,
};
const FOOD_TXN    = { id: '00000000-0000-4000-8000-0000000000f1', type: 'expense', amount: 120, currency: 'USD', date: '2026-05-10', description: 'E2E Food Spend', category: 'food_dining' };
const SEED_MEMBER = { id: '00000000-0000-4000-8000-0000000000a1', name: 'E2E Member', role: 'primary' };

test.describe('§5 BDGT-FC · Budgets', () => {

  test.describe('create', () => {
    // member present → demo seed suppressed; budgets/transactions start empty.
    // onboardedAt → App.tsx does not redirect an empty household to /onboarding.
    test.use({ seed: seedWith({
      budgets: [], transactions: [], members: [SEED_MEMBER],
      profile: { onboardedAt: '2026-05-01T00:00:00.000Z' },
    }) });

    test('CON-E2E-017 · [BDGT-FC-001] creates a period budget with a category allocation, starting at 0% used', async ({ page, budgets }) => {
      await budgets.goto();
      await budgets.openAdd();
      const modal = new BudgetFormModal(page);
      await modal.waitOpen();

      // The container carries the total; the category carries an allocation.
      // That split IS the v9.1 model — a budget has no category of its own.
      await modal.fill({ total: 500, allocations: { Groceries: 200 } });
      await modal.submit();

      // Exactly one budget, and it is a CONTAINER: no category on the row.
      const created = await page.evaluate(() => {
        const s = (window as unknown as {
          __ff_store?: { getState(): {
            budgets: { id: string; category?: string; limit?: number }[];
            budgetAllocations: { category: string; amount: number }[];
          } };
        }).__ff_store?.getState();
        return {
          budgets: s?.budgets.length ?? -1,
          hasCategoryOnBudget: s?.budgets.some(b => !!b.category) ?? true,
          allocations: s?.budgetAllocations.map(a => ({ c: a.category, amt: a.amount })) ?? [],
        };
      });

      expect(created.budgets).toBe(1);
      expect(created.hasCategoryOnBudget, 'a v9.1 budget is a container, not a category').toBe(false);
      expect(created.allocations).toContainEqual({ c: 'groceries', amt: 200 });

      // Nothing spent yet → 0% of the container total used, and the
      // allocation row shows its own limit.
      const card = budgets.card('Groceries');
      await expect(card).toBeVisible();
      await expect(card).toContainText('0%');
      await expect(card).toContainText('200');
    });

    test('CON-E2E-053 · an annual budget is accepted alongside monthly', async ({ page, budgets }) => {
      // Replaces the retired quarterly case: month and annual are the only two
      // scopes the model still has, so annual is what "non-monthly" now means.
      await budgets.goto();
      await budgets.openAdd();
      const modal = new BudgetFormModal(page);
      await modal.waitOpen();

      await modal.fill({ period: 'Annual 2026', total: 9000, allocations: { Travel: 900 } });
      await modal.submit();

      const scope = await page.evaluate(() =>
        (window as unknown as { __ff_store?: { getState(): { budgets: { scope?: string }[] } } })
          .__ff_store?.getState().budgets[0]?.scope);
      expect(scope).toBe('annual');
      await expect(budgets.card('Travel')).toBeVisible();
    });
  });

  test.describe('spend aggregation (under budget)', () => {
    test.use({ seed: seedWith({
      budgets: [FOOD_BUDGET], budgetAllocations: [FOOD_ALLOC],
      transactions: [FOOD_TXN], members: [SEED_MEMBER],
    }) });

    test('CON-E2E-018 · [BDGT-FC-002] spend in a category reduces the remaining budget', async ({ budgets }) => {
      await budgets.goto();
      const card = budgets.card('Food & Dining');
      await expect(card).toBeVisible();
      // $120 of a $300 container → the card reads "$120 / $300" and 40%.
      await expect(card).toContainText('120');
      await expect(card).toContainText('300');
      await expect(card).toContainText('40%');
    });
  });

  test.describe('overrun + utilisation recompute', () => {
    // $350 spent against a $300 allocation → OVER by $50.
    test.use({ seed: seedWith({
      budgets: [FOOD_BUDGET], budgetAllocations: [FOOD_ALLOC],
      transactions: [{ ...FOOD_TXN, amount: 350 }], members: [SEED_MEMBER],
    }) });

    test('CON-E2E-023 · [BDGT-FC-007] an over-budget category shows over-budget styling', async ({ budgets }) => {
      await budgets.goto();
      const card = budgets.card('Food & Dining');
      await expect(card).toBeVisible();
      // v10.22.1 — the percentage is no longer clamped, so $350 of $300 reads
      // its true 117%. The terra styling still marks the overrun; assert both,
      // because the number alone was the part that used to lie.
      await expect(card).toContainText('117%');
      await expect(card.locator('span.text-terra')).toHaveText('117%');
      await expect(card.locator('div.bg-terra').first()).toBeVisible();
    });

    test('CON-E2E-022 · [BDGT-FC-006] raising the limit recomputes utilisation from over to under', async ({ page, budgets }) => {
      await budgets.goto();
      await expect(budgets.card('Food & Dining').locator('span.text-terra')).toHaveText('117%');   // baseline: over

      await budgets.openEdit('Food & Dining');
      const modal = new BudgetFormModal(page);
      await modal.waitOpen();
      // The CONTAINER total drives the overall percentage, so raising only
      // the allocation would leave the card at 117%. Raise both.
      await modal.fill({ total: 500, allocations: { 'Food & Dining': 500 } });
      await modal.submit();

      const card = budgets.card('Food & Dining');
      await expect(card).toContainText('70%');            // 350 of 500 — recomputed
      await expect(card.locator('span.text-terra')).toHaveCount(0);   // no longer over
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
