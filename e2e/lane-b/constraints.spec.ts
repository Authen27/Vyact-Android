// ──────────────────────────────────────────────────────────────────────────
// §13 CLOUD-FC · Lane B — database constraints
// ──────────────────────────────────────────────────────────────────────────
// THE REASON LANE B EXISTS.
//
// Lane A runs the app in localStorage-only mode, where there is no database and
// therefore nothing to violate. I proved that directly against the running app:
// calling `saveBudgetWithAllocations` with two allocations for the SAME category
// resolved and stored both rows. The identical payload in cloud mode hits
// `uq_balloc_cat` and throws.
//
// So every unique index, CHECK constraint and RLS policy in the schema was
// invisible to the suite — and the budget editor's stale-closure bug (defects 1
// and 3) produces exactly that duplicate payload. A whole class of defect could
// only ever be found by users.
//
// These specs run against the disposable vyact-test project, whose schema is
// built from db/schema.sql — the same snapshot CI generates for production, so
// the constraints here are byte-for-byte the ones users hit.
// ──────────────────────────────────────────────────────────────────────────

import { test, expect } from '@playwright/test';
import { createActor, destroyActor, runTag, type TestActor } from './fixtures';

let owner: TestActor;

test.beforeAll(async () => { owner = await createActor(runTag(), 'con'); });
test.afterAll(async () => { await destroyActor(owner); });

test.describe('§13 CLOUD-FC · budget allocation constraints', () => {
  test('CON-E2E-026 · [CLOUD-FC-001] a duplicate category in one budget is rejected by the database', async () => {
    const { data: budget, error: budgetErr } = await owner.db
      .from('budgets')
      .insert({
        household_id: owner.householdId,
        scope: 'month', period_year: 2027, period_month: 4,
        period_start: '2027-04-01', period_end: '2027-04-30',
        monthly_limit: 5000, currency: 'GBP',
      })
      .select('id')
      .single();
    expect(budgetErr, 'the budget itself must insert cleanly').toBeNull();

    // First allocation: fine.
    const { error: firstErr } = await owner.db.from('budget_allocations').insert({
      household_id: owner.householdId, budget_id: budget!.id,
      category: 'education', amount: 100,
    });
    expect(firstErr).toBeNull();

    // Second allocation, SAME category — this is precisely what the budget
    // editor produces today when "Add category" is clicked repeatedly, because
    // it reads the already-used set from a stale render closure.
    const { error: dupeErr } = await owner.db.from('budget_allocations').insert({
      household_id: owner.householdId, budget_id: budget!.id,
      category: 'education', amount: 200,
    });

    expect(dupeErr, 'uq_balloc_cat must reject the duplicate').not.toBeNull();
    expect(dupeErr!.code, 'a unique violation is 23505').toBe('23505');

    // And the database must hold exactly one row, not two.
    const { data: rows } = await owner.db
      .from('budget_allocations')
      .select('category, amount')
      .eq('budget_id', budget!.id);
    expect(rows).toHaveLength(1);
  });

  test('CON-E2E-027 · [CLOUD-FC-002] the same category in a DIFFERENT budget is allowed', async () => {
    // The guard is scoped to (budget_id, category), not category alone. Without
    // this, a fix for the duplicate bug could over-correct into "a category may
    // only ever be budgeted once", which would silently break next month.
    const mk = async (month: number) => {
      const { data, error } = await owner.db.from('budgets').insert({
        household_id: owner.householdId,
        scope: 'month', period_year: 2027, period_month: month,
        period_start: `2027-${String(month).padStart(2, '0')}-01`,
        period_end: `2027-${String(month).padStart(2, '0')}-28`,
        monthly_limit: 1000, currency: 'GBP',
      }).select('id').single();
      expect(error).toBeNull();
      return data!.id as string;
    };

    const may = await mk(5);
    const june = await mk(6);

    for (const id of [may, june]) {
      const { error } = await owner.db.from('budget_allocations').insert({
        household_id: owner.householdId, budget_id: id,
        category: 'groceries', amount: 300,
      });
      expect(error, 'groceries must be budgetable in every period').toBeNull();
    }
  });
});
