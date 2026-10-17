// ──────────────────────────────────────────────────────────────────────────
// §13 CLOUD-FC · Lane B — account patches must not erase financial state
// ──────────────────────────────────────────────────────────────────────────
// The acceptance test the independent audit asked for, verbatim:
//
//   "reconcile an account, rename it, reload from cloud, and verify that its
//    balance, offset, history, and provenance remain unchanged."
//
// It drives the REAL SupabaseAdapter against real Postgres, because the defect
// was a payload-shape bug and every layer reported success:
//
//   AccountFormModal  sends metadata only — no openingBalance, no offset, no log
//   accountToRow      defaulted the absent columns to 0 / 0 / []
//   upsert            wrote those zeroes over the stored values
//   the UI            said "Account updated"
//
// A unit test on the mapper (CON-UNIT-081) pins the payload. This proves the
// database ends up with the right row, which is the thing that actually matters
// and the thing no amount of Lane A could ever have shown — Lane A has no
// database to lose data in.
// ──────────────────────────────────────────────────────────────────────────

import { test, expect } from '@playwright/test';
import { SupabaseAdapter } from '../../src/lib/supabaseAdapter';
import { reconcileAccount } from '../../src/lib/accountBalance';
import { createActor, destroyActor, runTag, type TestActor } from './fixtures';
import type { Account } from '../../src/types';

let owner: TestActor;

test.beforeAll(async () => { owner = await createActor(runTag(), 'acct'); });
test.afterAll(async () => { await destroyActor(owner); });

test.describe('§13 CLOUD-FC · account metadata patches', () => {
  test('CON-E2E-031 · [CLOUD-FC-006] renaming a reconciled account preserves balance, offset and history', async () => {
    // The adapter is constructed with the ACTOR's client, so every write runs
    // under that user's RLS exactly as it does in the browser.
    const adapter = new SupabaseAdapter(owner.db);
    const hh = owner.householdId;

    // ── 1. an account with real financial state ──────────────────────────
    const created = await adapter.upsert<Partial<Account>>('accounts', hh, {
      kind: 'bank', name: 'Everyday Current', currency: 'GBP',
      isDefault: false, isArchived: false,
      openingBalance: 500,
    });
    const accountId = created.id!;

    // ── 2. reconcile it, through the same function the app uses ──────────
    // Stated 525 against a computed 500 ⇒ a +25 offset and one log entry.
    const { patch, delta } = reconcileAccount(
      { ...(created as Account), openingBalance: 500 }, 500, 525, 'bank',
    );
    expect(delta, 'the reconcile must actually move something').toBe(25);
    await adapter.upsert('accounts', hh, { ...(created as Account), ...patch });

    const afterReconcile = (await adapter.list<Account>('accounts', hh))
      .find(a => a.id === accountId)!;
    expect(afterReconcile.openingBalance).toBe(500);
    expect(afterReconcile.reconciliationOffset).toBe(25);
    expect(afterReconcile.reconciliationLog).toHaveLength(1);

    // ── 3. rename it with a METADATA-ONLY patch ──────────────────────────
    // This is byte-for-byte the shape AccountFormModal.save() builds. It is the
    // whole point of the test: nothing financial is mentioned.
    await adapter.upsert('accounts', hh, {
      id: accountId,
      assetId: afterReconcile.assetId,
      kind: 'bank',
      name: 'Everyday Current (renamed)',
      currency: 'GBP',
      isDefault: false,
      isArchived: false,
      updated_at: afterReconcile.updated_at,
    });

    // ── 4. reload from cloud and assert nothing financial moved ──────────
    const reloaded = (await adapter.list<Account>('accounts', hh))
      .find(a => a.id === accountId)!;

    expect(reloaded.name, 'the rename must have applied').toBe('Everyday Current (renamed)');
    expect(reloaded.openingBalance, 'opening balance must survive a rename').toBe(500);
    expect(reloaded.reconciliationOffset, 'the reconciliation offset must survive').toBe(25);
    expect(reloaded.reconciliationLog, 'reconciliation history must survive').toHaveLength(1);
    expect(reloaded.reconciliationLog![0].stated_value).toBe(525);
  });

  test('CON-E2E-032 · [CLOUD-FC-007] archiving is also a metadata-only change', async () => {
    // Archiving runs the same code path with a different field, and an archived
    // account still contributes history — losing its balance here would corrupt
    // net worth silently the moment it were unarchived.
    const adapter = new SupabaseAdapter(owner.db);
    const hh = owner.householdId;

    const created = await adapter.upsert<Partial<Account>>('accounts', hh, {
      kind: 'bank', name: 'Old Savings', currency: 'GBP',
      isDefault: false, isArchived: false, openingBalance: 1200,
    });

    await adapter.upsert('accounts', hh, {
      id: created.id, kind: 'bank', name: 'Old Savings', currency: 'GBP',
      isDefault: false, isArchived: true,
    });

    const reloaded = (await adapter.list<Account>('accounts', hh))
      .find(a => a.id === created.id)!;
    expect(reloaded.isArchived, 'the archive flag must have applied').toBe(true);
    expect(reloaded.openingBalance, 'archiving must not zero the balance').toBe(1200);
  });
});
