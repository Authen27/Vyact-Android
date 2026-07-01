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

// ── Consent + data-erasure + account lifecycle (v9.8.0) ────────────
// Backs Settings → Danger Zone and the sign-up consent checkbox. See
// supabase/migrations/20260701120000_v98_privacy_deletion_controls.sql
// and supabase/functions/delete-account for the server-side half.
export const POLICY_ACCEPTANCE_VERSION = '2026-07-01';

/** Record ToS + Privacy acceptance against the caller's profile at sign-up. */
export async function acceptPolicies(userId: string) {
  const now = new Date().toISOString();
  const { error } = await sb().from('profiles').update({
    tos_accepted_at: now, tos_version: POLICY_ACCEPTANCE_VERSION,
    privacy_accepted_at: now, privacy_version: POLICY_ACCEPTANCE_VERSION,
  }).eq('id', userId);
  if (error) throw error;
}

/** Permanently erase every financial row for a household; keeps the household + membership shell. */
export async function eraseHouseholdData(householdId: string) {
  const { error } = await sb().rpc('erase_household_data', { h_id: householdId });
  if (error) throw error;
}

/** Temporary account hold. Signs the caller out immediately after. */
export async function deactivateAccount() {
  const { error } = await sb().rpc('deactivate_my_account');
  if (error) throw error;
}

/** Clears any deactivation / pending-deletion hold. Called automatically on sign-in. */
export async function reactivateAccount() {
  const { error } = await sb().rpc('reactivate_my_account');
  if (error) throw error;
}

/** Schedules permanent deletion with a 30-day undo window; puts the account on hold immediately. */
export async function requestAccountDeletion(): Promise<string> {
  const { data, error } = await sb().rpc('request_account_deletion');
  if (error) throw error;
  return data as string;
}

/**
 * Checks whether the signed-in user has a deactivation or pending-deletion
 * hold and clears it (reactivation happens simply by successfully signing
 * back in). Returns true if a hold was found and cleared, so the caller can
 * surface a "welcome back" toast.
 */
export async function reactivateIfNeeded(): Promise<boolean> {
  const { data: { user } } = await sb().auth.getUser();
  if (!user) return false;
  const { data: profile } = await sb().from('profiles')
    .select('deactivated_at, deletion_requested_at').eq('id', user.id).maybeSingle();
  if (!profile?.deactivated_at && !profile?.deletion_requested_at) return false;
  await reactivateAccount();
  return true;
}

/**
 * Executes the permanent delete via the service-role edge function. Only
 * succeeds once `requestAccountDeletion()` has run; pass `immediate: true`
 * to skip the 30-day undo window (explicit "delete right now" confirmation).
 */
export async function executeAccountDeletion(immediate = false) {
  const { data, error } = await sb().functions.invoke('delete-account', { body: { immediate } });
  if (error) throw error;
  return data as { deleted: boolean };
}

// ── Email-code re-authentication for irreversible account actions ──
// Data erasure, deactivation, and deletion are gated on proving the caller
// currently controls the account's inbox — a stolen/idle browser session
// alone is not enough. Uses Supabase's built-in email-OTP (a 6-digit code,
// not a magic link) rather than a bespoke table: signInWithOtp sends the
// code, verifyOtp both checks it AND re-establishes a fresh session, so a
// successful verify is proof-of-control at the moment of the dangerous action.
export async function sendAccountActionCode(): Promise<string> {
  const { data: { user } } = await sb().auth.getUser();
  if (!user?.email) throw new Error('No email on this account');
  const { error } = await sb().auth.signInWithOtp({
    email: user.email,
    options: { shouldCreateUser: false },
  });
  if (error) throw error;
  return user.email;
}

export async function verifyAccountActionCode(email: string, code: string): Promise<void> {
  const { error } = await sb().auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) throw new Error('Incorrect or expired code');
}
