// ──────────────────────────────────────────────────────────────────────────
// §13 CLOUD-FC · Lane B — RLS isolation (NEGATIVE)
// ──────────────────────────────────────────────────────────────────────────
// The test e2e/README.md calls "most importantly": user A must not be able to
// read or write user B's household.
//
// It is a negative test, which makes it the easiest kind to fake and the most
// dangerous to get wrong. Two rules it follows:
//
//   1. Every assertion is made through a client authenticated AS a real user,
//      never the service role — the service role bypasses RLS entirely, so a
//      suite written with it would pass against a database with no policies.
//   2. A blocked read returns an EMPTY RESULT, not an error, and a blocked
//      write returns success with zero rows affected. So "no error" proves
//      nothing here; only the row count does. This is the same trap that
//      produced defects 5 and 7 in the app itself.
// ──────────────────────────────────────────────────────────────────────────

import { test, expect } from '@playwright/test';
import { createActor, destroyActor, runTag, adminClient, type TestActor } from './fixtures';

let alice: TestActor;
let bob: TestActor;
let bobsTxnId: string;

test.beforeAll(async () => {
  const tag = runTag();
  alice = await createActor(tag, 'alice');
  bob = await createActor(tag, 'bob');

  // Give Bob something worth stealing. Written with the service role because
  // seeding is not the behaviour under test.
  const { data, error } = await adminClient().from('transactions').insert({
    household_id: bob.householdId,
    type: 'expense', amount: 4242, currency: 'GBP',
    date: '2027-01-15', description: 'BOB PRIVATE COFFEE', category: 'food_dining',
    created_by: bob.user.id,
    // Required by ck_txn_accounts_by_type: an expense carries account_id and no
    // to_account_id. The money model is enforced in the DATABASE, not just the
    // client — which is precisely why this lane exists.
    account_id: bob.accountId,
  }).select('id').single();
  if (error) throw new Error(`could not seed Bob's transaction: ${error.message}`);
  bobsTxnId = data!.id;
});

test.afterAll(async () => {
  await destroyActor(alice);
  await destroyActor(bob);
});

test.describe('§13 CLOUD-FC · cross-household isolation', () => {
  test('CON-E2E-028 · [CLOUD-FC-003] Alice cannot read Bob\'s household or its transactions', async () => {
    // Sanity first: the seed really is visible to its owner. Without this, an
    // isolation test passes just as happily against an empty database.
    const { data: bobSees } = await bob.db
      .from('transactions').select('id, description').eq('id', bobsTxnId);
    expect(bobSees, 'Bob must be able to read his own row').toHaveLength(1);
    expect(bobSees![0].description).toBe('BOB PRIVATE COFFEE');

    // Now the actual assertion.
    const { data: aliceSeesTxn, error: txnErr } = await alice.db
      .from('transactions').select('id, description').eq('id', bobsTxnId);
    expect(txnErr, 'RLS filters rather than errors').toBeNull();
    expect(aliceSeesTxn, 'Alice must see none of Bob\'s transactions').toHaveLength(0);

    const { data: aliceSeesHh } = await alice.db
      .from('households').select('id').eq('id', bob.householdId);
    expect(aliceSeesHh, 'Alice must not see Bob\'s household').toHaveLength(0);

    const { data: aliceSeesMem } = await alice.db
      .from('memberships').select('id').eq('household_id', bob.householdId);
    expect(aliceSeesMem, 'nor his membership rows').toHaveLength(0);
  });

  test('CON-E2E-029 · [CLOUD-FC-004] Alice cannot modify or delete Bob\'s data', async () => {
    // A blocked UPDATE does not raise — it matches zero rows. Asserting on the
    // error would pass against a database with no policies at all, so the
    // assertion is on what came back and on the row afterwards.
    const { data: updated } = await alice.db
      .from('transactions')
      .update({ description: 'ALICE WAS HERE' })
      .eq('id', bobsTxnId)
      .select('id');
    expect(updated ?? [], 'the update must touch nothing').toHaveLength(0);

    const { data: deleted } = await alice.db
      .from('transactions').delete().eq('id', bobsTxnId).select('id');
    expect(deleted ?? [], 'the delete must touch nothing').toHaveLength(0);

    // The row is unchanged and still there — proven from Bob's side.
    const { data: after } = await bob.db
      .from('transactions').select('description').eq('id', bobsTxnId);
    expect(after, 'Bob\'s row must survive').toHaveLength(1);
    expect(after![0].description).toBe('BOB PRIVATE COFFEE');
  });

  test('CON-E2E-030 · [CLOUD-FC-005] Alice cannot insert into Bob\'s household', async () => {
    // The write-side of isolation: RLS must refuse a row addressed at a
    // household the caller is not a member of.
    const { error } = await alice.db.from('transactions').insert({
      household_id: bob.householdId,
      type: 'expense', amount: 1, currency: 'GBP',
      date: '2027-01-16', description: 'ALICE INJECTED', category: 'other_expense',
      created_by: alice.user.id, account_id: bob.accountId,
    });
    expect(error, 'an insert into another household must be refused').not.toBeNull();

    const { data: bobsRows } = await bob.db
      .from('transactions').select('id').eq('household_id', bob.householdId);
    expect(bobsRows, 'Bob still has exactly his one seeded row').toHaveLength(1);
  });
});
