// Vyact v4.1 — Role-based permissions (client-side gating)
//
// Authorization is ENFORCED server-side by Postgres RLS policies in
// db/schema.sql. This module is purely UX — it hides actions the user
// can't take so they don't get a confusing error from the database.
//
// Role hierarchy (matches schema's CHECK constraint):
//   owner > admin > member > viewer
//          (child has scoped permissions)

import type { AppRole } from '../types';

export type Action =
  | 'view'
  | 'add_transaction' | 'edit_transaction' | 'delete_transaction'
  | 'edit_others_transaction'
  | 'manage_budgets' | 'manage_goals' | 'manage_debts' | 'manage_assets'
  | 'invite_member' | 'remove_member' | 'change_member_role'
  | 'transfer_ownership' | 'delete_household' | 'edit_household_settings'
  | 'view_activity_log';

const PERMS: Record<AppRole, Set<Action>> = {
  owner: new Set<Action>([
    'view',
    'add_transaction','edit_transaction','delete_transaction','edit_others_transaction',
    'manage_budgets','manage_goals','manage_debts','manage_assets',
    'invite_member','remove_member','change_member_role',
    'transfer_ownership','delete_household','edit_household_settings',
    'view_activity_log',
  ]),
  admin: new Set<Action>([
    'view',
    'add_transaction','edit_transaction','delete_transaction','edit_others_transaction',
    'manage_budgets','manage_goals','manage_debts','manage_assets',
    'invite_member','remove_member','change_member_role',
    'edit_household_settings',
    'view_activity_log',
  ]),
  member: new Set<Action>([
    'view',
    'add_transaction','edit_transaction','delete_transaction','edit_others_transaction',
    // v9.5.0 — budget management is owner/admin only; members are view-only on budgets
    // (DB-enforced by RLS + the upsert_budget RPC guard). Goals/debts/assets unchanged.
    'manage_goals','manage_debts','manage_assets',
  ]),
  viewer: new Set<Action>(['view','view_activity_log']),
};

/**
 * W1 (owner decision): the 'child' app role is retired and the database now stores those
 * members as 'member'. A role string read from an older cache may still say 'child'; it
 * means 'member' everywhere, exactly as the migration and its insert trigger map it.
 */
export function normalizeAppRole(role: string | null | undefined): AppRole | undefined {
  if (!role) return undefined;
  if (role === 'child') return 'member';
  return (['owner', 'admin', 'member', 'viewer'] as const).includes(role as AppRole) ? role as AppRole : undefined;
}

export function can(role: AppRole | undefined, action: Action): boolean {
  const r = normalizeAppRole(role);
  if (!r) return action === 'view'; // anonymous = read-only
  return PERMS[r]?.has(action) ?? false;
}

/**
 * W6 (audit FE-UIS-06) — may this person change the fields stored on the HOUSEHOLD row (currency,
 * language, payoff strategy, extra payment)? The database lets only the owner update a household
 * (RLS "owners update household"), so for anyone else the write queued, dead-lettered and the value
 * quietly reverted after a "saved" toast. Local-only mode has a single user and no roles.
 * (`edit_household_settings` above also grants admins; reconciling that with RLS is INT-HH-08.)
 */
export function canEditHouseholdRow(role: AppRole | undefined, cloudEnabled: boolean): boolean {
  if (!cloudEnabled) return true;
  return normalizeAppRole(role) === 'owner';
}

/**
 * The OTHER half of the permission policy: which role the current user holds.
 *
 * `can()` decides what a role may do; this decides what role you have. It is
 * pure and lives here, beside `can()`, because the two are one rule — split
 * across two files they drifted, and the drift was invisible.
 *
 * Three states, and the difference between the last two is the whole point:
 *
 *   local-only          → 'owner'.    One anonymous household on this device
 *                                     with no auth and no sharing. There is no
 *                                     one else to be, and no server to enforce
 *                                     anything, so denying writes here just
 *                                     bricks the app (it did — see App.tsx).
 *   cloud, signed out   → undefined.  No identity ⇒ no role. `can()` then
 *                                     grants `view` and nothing else.
 *   cloud, signed in    → the membership row's role, or undefined when the
 *                                     user has no membership in this household.
 *
 * The bug this replaces keyed the 'owner' fallback on "no session" rather than
 * "no cloud", so a signed-out CLOUD user resolved to 'owner'. It was
 * unreachable only because nothing invoked it in that state — the kind of
 * latent hole that becomes live the moment someone adds a caller.
 */
export function resolveMyRole(opts: {
  cloudEnabled: boolean;
  hasSession: boolean;
  membershipRole?: AppRole | null;
}): AppRole | undefined {
  if (!opts.cloudEnabled) return 'owner';
  if (!opts.hasSession) return undefined;
  return normalizeAppRole(opts.membershipRole);
}

export function highestRole(roles: AppRole[]): AppRole | undefined {
  const rank: AppRole[] = ['viewer','member','admin','owner'];
  let best: AppRole | undefined;
  let bestRank = -1;
  for (const raw of roles) {
    const r = normalizeAppRole(raw);
    const i = r ? rank.indexOf(r) : -1;
    if (i > bestRank) { bestRank = i; best = r; }
  }
  return best;
}

export function roleLabel(role: AppRole | undefined): string {
  switch (normalizeAppRole(role)) {
    case 'owner':  return 'Owner';
    case 'admin':  return 'Admin';
    case 'member': return 'Member';
    case 'viewer': return 'Viewer';
    default:       return 'Guest';
  }
}

export function canRemove(actorRole: AppRole | undefined, targetRole: AppRole | undefined, isSelf: boolean): boolean {
  if (isSelf) return true; // anyone can leave
  if (!actorRole) return false;
  if (targetRole === 'owner') return false; // owners can never be removed by others
  if (actorRole === 'owner') return true;   // owner removes anyone non-owner
  // After the early-return above, targetRole is narrowed to non-'owner'
  if (actorRole === 'admin') return true;
  return false;
}
