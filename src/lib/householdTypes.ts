// Vyact — household types and their member limits (v10.59.0, owner 4 Oct 2026).
//
//   personal  private: just you, no one can be invited
//   couple    you and one other person
//   family    you and as many people as you invite
//   business  as many people as you invite; Insights add business terms (cash runway,
//             setting aside for tax)
//
// The database enforces the same limits (migration 20261007120000: invitations and
// memberships triggers, and a guard on changing the type). This module lets the app say
// so BEFORE the database refuses: the invite button and the type picker read it.

import type { ProfileTypeKey } from '../types';

/** Members a type has room for, the owner included; null = no limit. Mirrors household_member_limit(). */
export const HOUSEHOLD_MEMBER_LIMIT: Record<ProfileTypeKey, number | null> = {
  personal: 1,
  couple: 2,
  family: null,
  business: null,
};

export const HOUSEHOLD_TYPE_ORDER: ProfileTypeKey[] = ['personal', 'couple', 'family', 'business'];

/**
 * A stored type, as one of today's four. 'shared' (retired) is family and 'multi_biz'
 * (app-only, never in the database) is business. These are the migration's own mappings
 * for a cache written before it. Anything unknown is family, the type that limits nothing.
 */
export function normalizeHouseholdType(type: unknown): ProfileTypeKey {
  switch (type) {
    case 'personal': case 'couple': case 'family': case 'business': return type;
    case 'shared': return 'family';
    case 'multi_biz': return 'business';
    default: return 'family';
  }
}

/** Does a household of `memberCount` members fit this type? */
export function typeFits(type: ProfileTypeKey, memberCount: number): boolean {
  const limit = HOUSEHOLD_MEMBER_LIMIT[type];
  return limit === null || memberCount <= limit;
}

/** Why no one more can be invited, or null when they can. Pending invitations hold a place. */
export function inviteBlockedReason(type: unknown, memberCount: number, pendingInvites = 0): string | null {
  const t = normalizeHouseholdType(type);
  const limit = HOUSEHOLD_MEMBER_LIMIT[t];
  if (limit === null || memberCount + pendingInvites < limit) return null;
  if (t === 'personal') return 'Personal households are private. Change the type to Couple or Family to invite someone.';
  return pendingInvites > 0
    ? 'A Couple household has room for one other person, and an invitation is already waiting. Revoke it, or change the type to Family to invite more.'
    : 'A Couple household has room for one other person. Change the type to Family to invite more.';
}

/** The database's refusal (HOUSEHOLD_FULL / HOUSEHOLD_TYPE_TOO_SMALL), in words a person can act on. */
export function householdLimitMessage(err: unknown): string | null {
  const msg = String((err as { message?: string })?.message ?? err ?? '');
  if (msg.includes('HOUSEHOLD_FULL')) {
    return msg.includes('personal household')
      ? 'Personal households are private. Change the type to Couple or Family to invite someone.'
      : 'This household is full for its type. Change the type to Family to invite more people.';
  }
  if (msg.includes('HOUSEHOLD_TYPE_TOO_SMALL')) return 'This household has more members than that type allows.';
  return null;
}

/** W7a (audit INT-HH-13) — after leaving or deleting a household, the household to open next: the first
 *  one the person is still in (the list is already refreshed, so the exited one is normally gone; it
 *  is skipped regardless). null when none remain. */
export function nextHouseholdAfterExit(households: { id: string }[], exitedId: string): string | null {
  return households.find(h => h.id !== exitedId && h.id !== 'local')?.id ?? null;
}

/** W7a (audit FE-UIS-16) — the same refusal, worded for the person ACCEPTING an invite: they cannot
 *  change the household's type, so they are told who can. Other errors pass through unchanged. */
export function inviteAcceptMessage(err: unknown): string {
  const msg = String((err as { message?: string })?.message ?? err ?? '');
  if (msg.includes('HOUSEHOLD_FULL')) {
    return 'This household is already full. Ask the person who invited you to change its type to Family, then send you a new invite.';
  }
  // v10.95.0 (#9) — accept_invitation_by_id's refusals, in words.
  if (msg.includes('invitation_not_found')) return 'This invitation is no longer open. It may have been revoked or declined, or it expired.';
  if (msg.includes('not_signed_in')) return 'Confirm your email address first, then try again.';
  return msg || 'Could not accept the invitation.';
}
