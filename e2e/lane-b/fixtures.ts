// Lane B — per-run user + household provisioning.
//
// Each run mints its own users and households against the disposable test
// project, then removes them. Nothing persists between runs, so a failed run
// cannot poison the next one and two runs can never collide.
//
// WHY NOT A BROWSER: these specs assert what only a real database can tell us —
// unique indexes, CHECK constraints and RLS. Driving that through sign-in UI
// would add minutes of flake to test something the UI is not even involved in.
// The browser-driven cloud journeys are a separate, later addition; this file
// deliberately covers the layer Lane A structurally cannot reach.

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { TEST_SUPABASE_URL, TEST_ANON_KEY, requireServiceKey } from './env';

export interface TestActor {
  user: User;
  /** A client authenticated AS this user — every query runs under their RLS. */
  db: SupabaseClient;
  householdId: string;
  /**
   * A cash account. Not optional scenery: `ck_txn_accounts_by_type` enforces
   * the money model in the database — an expense MUST carry `account_id` and
   * MUST NOT carry `to_account_id`; income is the mirror image; transfer and
   * investment need both. Any spec inserting a transaction needs this.
   */
  accountId: string;
  email: string;
}

export const adminClient = (): SupabaseClient =>
  createClient(TEST_SUPABASE_URL, requireServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** A unique suffix per run so parallel or repeated runs never collide. */
export const runTag = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Create a confirmed user, sign them in, and give them a household they own.
 *
 * `email_confirm: true` skips the email round-trip — the only reason this needs
 * the service-role key at all.
 */
export async function createActor(tag: string, label: string): Promise<TestActor> {
  const admin = adminClient();
  const email = `lane-b-${label}-${tag}@vyact.test`;
  const password = `pw-${tag}-${label}-Aa1!`;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(`could not create ${label}: ${createErr?.message ?? 'no user returned'}`);
  }

  const db = createClient(TEST_SUPABASE_URL, TEST_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInErr } = await db.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`could not sign in ${label}: ${signInErr.message}`);

  // Household + owner membership are written with the service role: this is
  // fixture setup, not the behaviour under test. Tests that exercise the real
  // create path do so explicitly through the user's own client.
  // `created_by` is NOT NULL and references auth.users — found by probing the
  // real schema rather than assuming, which is the whole point of this lane.
  const { data: hh, error: hhErr } = await admin
    .from('households')
    .insert({
      name: `Lane B ${label} ${tag}`, type: 'family', base_currency: 'GBP',
      created_by: created.user.id,
    })
    .select('id')
    .single();
  if (hhErr || !hh) throw new Error(`could not create household for ${label}: ${hhErr?.message}`);

  // `display_name` is NOT NULL here too — the second column this lane caught
  // that Lane A could never have, because Lane A has no schema to violate.
  const { error: memErr } = await admin
    .from('memberships')
    .insert({
      household_id: hh.id, user_id: created.user.id, role: 'owner',
      display_name: `Lane B ${label}`,
    });
  if (memErr) throw new Error(`could not create membership for ${label}: ${memErr.message}`);

  const { data: acc, error: accErr } = await admin
    .from('accounts')
    .insert({
      household_id: hh.id, kind: 'cash',
      name: `Lane B ${label} Cash`, currency: 'GBP',
    })
    .select('id')
    .single();
  if (accErr || !acc) throw new Error(`could not create account for ${label}: ${accErr?.message}`);

  return { user: created.user, db, householdId: hh.id, accountId: acc.id, email };
}

/** Remove everything this run created. Households cascade to their children. */
export async function destroyActor(actor: TestActor | undefined): Promise<void> {
  if (!actor) return;
  const admin = adminClient();
  // Best-effort and order-independent: a failed teardown must never mask the
  // test result, but it must also not leave rows behind for the next run.
  try { await admin.from('households').delete().eq('id', actor.householdId); } catch { /* noop */ }
  try { await admin.auth.admin.deleteUser(actor.user.id); } catch { /* noop */ }
  try { await actor.db.auth.signOut(); } catch { /* noop */ }
}
