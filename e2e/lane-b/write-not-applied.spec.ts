// ──────────────────────────────────────────────────────────────────────────
// §13 CLOUD-FC · Lane B — a refused write must not report success
// ──────────────────────────────────────────────────────────────────────────
// Defects 5 and 7 ("deleting a household does nothing", "deleting a recurring
// schedule reverts") were never delete bugs. They were this:
//
//   A row-level-security policy does not RAISE on a blocked write. The
//   statement runs, matches zero rows, and returns { error: null }.
//
// So `if (error) throw` saw a clean success, the store dropped the row from
// local state, the UI said "Deleted", and the next sync pulled it back.
//
// CON-UNIT-084..086 pin the adapter's new row-count check with mocks. This
// proves it against a REAL refusal from a REAL policy — which is the only way
// to know the premise is true rather than assumed. If Postgres ever started
// raising on these instead of silently matching zero rows, the mocks would keep
// passing and only this file would notice.
// ──────────────────────────────────────────────────────────────────────────

import { test, expect } from '@playwright/test';
import { SupabaseAdapter, WriteNotAppliedError } from '../../src/lib/supabaseAdapter';
import { createActor, destroyActor, runTag, adminClient, type TestActor } from './fixtures';

let alice: TestActor;
let bob: TestActor;
let bobsScheduleId: string;

test.beforeAll(async () => {
  const tag = runTag();
  alice = await createActor(tag, 'wna-alice');
  bob = await createActor(tag, 'wna-bob');

  const { data, error } = await adminClient().from('recurring_schedules').insert({
    household_id: bob.householdId,
    frequency: 'monthly',
    start_date: '2027-03-01',
    next_due_date: '2027-03-01',
    auto_confirm: false,
    // The column is `txn_template`, not `transaction_template` — the fourth
    // schema assumption this lane has corrected. Lane A could not have caught
    // any of them; it has no schema to be wrong about.
    txn_template: {
      type: 'expense', amount: 999, currency: 'GBP',
      description: 'BOB RENT', category: 'rent_mortgage',
      account_id: bob.accountId,
    },
  }).select('id').single();
  if (error) throw new Error(`could not seed Bob's schedule: ${error.message}`);
  bobsScheduleId = data!.id;
});

test.afterAll(async () => {
  await destroyActor(alice);
  await destroyActor(bob);
});

test.describe('§13 CLOUD-FC · refused writes surface as errors', () => {
  test('CON-E2E-033 · [CLOUD-FC-008] a soft-delete Alice is not allowed to make throws instead of resolving', async () => {
    const aliceAdapter = new SupabaseAdapter(alice.db);

    // Pre-flight: the row really is there, read as its owner. Without this the
    // test would pass just as happily against a schedule that never existed.
    const { data: before } = await bob.db
      .from('recurring_schedules').select('id, deleted_at').eq('id', bobsScheduleId);
    expect(before, "Bob's schedule must exist to begin with").toHaveLength(1);
    expect(before![0].deleted_at).toBeNull();

    // THE ASSERTION. Before Phase 1 this call RESOLVED — no error, nothing
    // changed — and the caller then removed the row from local state.
    await expect(
      aliceAdapter.remove('recurring', alice.householdId, bobsScheduleId),
      'a refused soft-delete must reject, not resolve',
    ).rejects.toThrow(WriteNotAppliedError);

    // And the row is genuinely untouched, proven from Bob's side.
    const { data: after } = await bob.db
      .from('recurring_schedules').select('id, deleted_at').eq('id', bobsScheduleId);
    expect(after, "Bob's schedule must survive").toHaveLength(1);
    expect(after![0].deleted_at, 'it must not have been tombstoned').toBeNull();
  });

  test('CON-E2E-034 · [CLOUD-FC-009] a household delete Alice is not allowed to make throws', async () => {
    // The households DELETE policy is `role_in(id) = 'owner'`. Alice is not a
    // member of Bob's household at all, so she gets zero rows and no error —
    // which used to reach the user as "Profile deleted".
    const aliceAdapter = new SupabaseAdapter(alice.db);

    await expect(
      aliceAdapter.deleteHousehold(bob.householdId),
      "deleting someone else's household must reject",
    ).rejects.toThrow(WriteNotAppliedError);

    // Bob's household is still there. Checked as Bob, because Alice cannot see
    // it either way and an empty result from her would prove nothing.
    const { data: stillThere } = await bob.db
      .from('households').select('id').eq('id', bob.householdId);
    expect(stillThere, "Bob's household must survive").toHaveLength(1);
  });

  test('CON-E2E-035 · [CLOUD-FC-010] the owner\'s own delete still works', async () => {
    // The guard must not break the legitimate path. Bob removes his own
    // schedule and it tombstones normally.
    const bobAdapter = new SupabaseAdapter(bob.db);
    await expect(
      bobAdapter.remove('recurring', bob.householdId, bobsScheduleId),
    ).resolves.toBeUndefined();

    const { data: after } = await bob.db
      .from('recurring_schedules').select('deleted_at').eq('id', bobsScheduleId);
    expect(after![0].deleted_at, 'the owner\'s delete must actually tombstone').not.toBeNull();
  });
});
