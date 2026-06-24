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
  child: new Set<Action>([
    'view',
    'add_transaction','edit_transaction','delete_transaction',
    // Note: child can only edit/delete their own — enforced by RLS
  ]),
};

export function can(role: AppRole | undefined, action: Action): boolean {
  if (!role) return action === 'view'; // anonymous = read-only
  return PERMS[role]?.has(action) ?? false;
}

export function highestRole(roles: AppRole[]): AppRole | undefined {
  const rank: AppRole[] = ['child','viewer','member','admin','owner'];
  let best: AppRole | undefined;
  let bestRank = -1;
  for (const r of roles) {
    const i = rank.indexOf(r);
    if (i > bestRank) { bestRank = i; best = r; }
  }
  return best;
}

export function roleLabel(role: AppRole | undefined): string {
  switch (role) {
    case 'owner':  return 'Owner';
    case 'admin':  return 'Admin';
    case 'member': return 'Member';
    case 'viewer': return 'Viewer';
    case 'child':  return 'Child';
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
