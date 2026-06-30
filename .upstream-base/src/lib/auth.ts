// Vyact v4.1 — Auth helpers
// Thin wrappers around supabase-js so the store and pages can call signIn,
// signUp, etc. without knowing about Supabase internals.

import { sb, APP_URL } from './supabase';
import type { Session, User } from '@supabase/supabase-js';

export interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
}

export async function signUp({ email, password, displayName }: SignUpInput) {
  const { data, error } = await sb().auth.signUp({
    email, password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: `${APP_URL}/auth/verified`,
    },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await sb().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signInMagicLink(email: string) {
  const { error } = await sb().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${APP_URL}/auth/verified` },
  });
  if (error) throw error;
}

export async function signInOAuth(provider: 'google' | 'apple' | 'github') {
  const { error } = await sb().auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${APP_URL}/auth/verified` },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await sb().auth.signOut();
  if (error) throw error;
}

export async function requestPasswordReset(email: string) {
  const { error } = await sb().auth.resetPasswordForEmail(email, {
    redirectTo: `${APP_URL}/auth/reset-password`,
  });
  if (error) throw error;
}

export async function updatePassword(newPassword: string) {
  const { error } = await sb().auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const { data } = await sb().auth.getSession();
  return data.session;
}
export async function getUser(): Promise<User | null> {
  const { data } = await sb().auth.getUser();
  return data.user;
}

// Subscribe to auth state changes (sign-in, sign-out, refresh).
// Returns unsubscribe function.
export function onAuthStateChange(handler: (session: Session | null) => void): () => void {
  const { data } = sb().auth.onAuthStateChange((_event, session) => handler(session));
  return () => data.subscription.unsubscribe();
}

// ── Invitations ─────────────────────────────────────────────
// Vyact uses shareable invite links rather than emailed invites — the
// inviter copies the resulting URL and delivers it offline (Slack, SMS,
// in-person, etc.). The `invitations.invited_email` column is NOT NULL in
// the production schema, so when the inviter doesn't supply a label we
// store a sentinel that the UI renders as "Shareable link".
export const INVITE_LABEL_SENTINEL = '(shareable link)';

export async function createInviteLink(
  householdId: string,
  role: 'admin' | 'member' | 'viewer' | 'child',
  householdRole?: string,
  label?: string,
) {
  const { data: { user } } = await sb().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await sb().from('invitations').insert({
    household_id: householdId,
    invited_email: (label && label.trim()) || INVITE_LABEL_SENTINEL,
    invited_by: user.id,
    role,
    household_role: householdRole || null,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function listInvitations(householdId: string) {
  const { data, error } = await sb().from('invitations')
    .select('*').eq('household_id', householdId).is('accepted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function acceptInvitation(token: string) {
  const { data, error } = await sb().rpc('accept_invitation_link', { invite_token: token });
  if (error) throw error;
  return data as { household_id: string; membership_id?: string; role?: string; already_member?: boolean };
}

export async function revokeInvitation(invitationId: string) {
  const { error } = await sb().from('invitations').delete().eq('id', invitationId);
  if (error) throw error;
}

// ── Membership management ───────────────────────────────────
export async function transferOwnership(householdId: string, toUserId: string) {
  const { error } = await sb().rpc('transfer_ownership', { h_id: householdId, to_user: toUserId });
  if (error) throw error;
}

export async function leaveHousehold(householdId: string) {
  const { error } = await sb().rpc('leave_household', { h_id: householdId });
  if (error) throw error;
}

export async function changeMemberRole(membershipId: string, newRole: string) {
  const { error } = await sb().from('memberships').update({ role: newRole }).eq('id', membershipId);
  if (error) throw error;
}

export async function removeMembership(membershipId: string) {
  const { error } = await sb().from('memberships').delete().eq('id', membershipId);
  if (error) throw error;
}

// ── Activity log ────────────────────────────────────────────
export async function listActivity(householdId: string, limit = 100) {
  const { data, error } = await sb().from('activity_log')
    .select('id,actor_id,action,entity_type,entity_id,changes,created_at')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// ── MFA helpers (TD-15) ─────────────────────────────────────
// Small wrappers around Supabase's Auth MFA API so pages can enroll
// and verify TOTP factors without depending on Supabase internals.
export async function enrollMfaTotp(friendlyName?: string) {
  const { data, error } = await sb().auth.mfa.enroll({ factorType: 'totp', friendlyName });
  if (error) throw error;
  return data;
}

export async function verifyMfaEnrolment(factorId: string, code: string) {
  // For TOTP the Supabase SDK requires a challenge before verify; the
  // convenience `challengeAndVerify` wraps both. The plain `.verify(...)`
  // overload demands a `challengeId` which we don't have at enrolment-
  // verification time. (Lead review: dev's original code used `.verify`
  // and would not type-check.)
  const { data, error } = await sb().auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw error;
  return data;
}

export async function listMfaFactors() {
  const { data, error } = await sb().auth.mfa.listFactors();
  if (error) throw error;
  return data;
}

export async function unenrollMfaFactor(factorId: string) {
  const { data, error } = await sb().auth.mfa.unenroll({ factorId });
  if (error) throw error;
  return data;
}
