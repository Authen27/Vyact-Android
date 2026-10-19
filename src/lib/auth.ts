// Vyact v4.1 — Auth helpers
// Thin wrappers around supabase-js so the store and pages can call signIn,
// signUp, etc. without knowing about Supabase internals.

import { sb, APP_URL } from './supabase';
import { POLICY_VERSION } from './policyVersion';
import { disablePush } from './webPush';
import { deviceTimeZone } from './householdTimezone';
import { clearCacheOnSignOut } from './cacheInvalidation';
import type { MyInvitation } from './invitations';
import type { Session, User } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core'; // ANDROID-OVERLAY — native OAuth (in-app browser + vyact:// callback)
import { Browser } from '@capacitor/browser'; // ANDROID-OVERLAY
import { OAUTH_CALLBACK_URL } from './native'; // ANDROID-OVERLAY

export interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
}

export async function signUp({ email, password, displayName }: SignUpInput) {
  const { data, error } = await sb().auth.signUp({
    email, password,
    options: {
      // W3a — the household made for this account starts in this device's zone (households trigger).
      // T4b (v10.125.0, XC-PRV-09) — the policy version ticked on the form: the server records the
      // acceptance with the account (handle_new_user, T4a), so it is never lost to a new tab.
      data: { display_name: displayName, timezone: deviceTimeZone() ?? undefined, policy_version: POLICY_VERSION },
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
  const native = Capacitor.isNativePlatform();
  const { data, error } = await sb().auth.signInWithOAuth({
    provider,
    options: {
      // Native: return to the app via the custom-scheme deep link and open the
      // consent screen in an in-app browser (below) so the user is retained in
      // the native app. Web: the usual full-page redirect to /auth/verified.
      redirectTo: native ? OAUTH_CALLBACK_URL : `${APP_URL}/auth/verified`,
      skipBrowserRedirect: native,
    },
  });
  if (error) throw error;
  if (native && data?.url) {
    // The deep-link callback (see initNativeShell) completes the session and
    // closes this browser.
    await Browser.open({ url: data.url });
  }
}

export async function signOut() {
  // v10.48.0 — a signed-out device must not keep receiving this person's figures on its
  // lock screen. Unregister while the session can still authorise it.
  await disablePush().catch(() => undefined);
  const { error } = await sb().auth.signOut();
  if (error) throw error;
  // v10.110.0 (F1a, audit FE-SYN-04) — the session change starts the purge without waiting for it;
  // an explicit sign-out waits until this person's cached ledger is actually gone from the device.
  await clearCacheOnSignOut().catch(() => undefined);
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
  role: 'admin' | 'member' | 'viewer',
  householdRole?: string,
  label?: string,
  // v10.95.0 (#9) — the invitee's address, already checked (lib/invitations.ts checkInviteEmail).
  recipientEmail?: string | null,
) {
  const { data: { user } } = await sb().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await sb().from('invitations').insert({
    household_id: householdId,
    invited_email: (label && label.trim()) || INVITE_LABEL_SENTINEL,
    recipient_email: recipientEmail || null,
    invited_by: user.id,
    role,
    household_role: householdRole || null,
  }).select().single();
  if (error) throw error;
  return data;
}

// ── v10.95.0 (#9) — invitations addressed to me (matched on my confirmed email) ──
export async function listMyInvitations(): Promise<MyInvitation[]> {
  const { data, error } = await sb().rpc('my_pending_invitations');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    id: String(r.id), householdId: String(r.household_id), householdName: String(r.household_name ?? ''),
    householdType: r.household_type as string | undefined, invitedByName: String(r.invited_by_name ?? 'Someone'),
    role: String(r.role), householdRole: (r.household_role as string | null) ?? null,
    expiresAt: String(r.expires_at), createdAt: String(r.created_at),
  }));
}

export async function acceptInvitationById(invitationId: string) {
  const { data, error } = await sb().rpc('accept_invitation_by_id', { p_id: invitationId });
  if (error) throw error;
  return data as { household_id: string; membership_id?: string; role?: string; already_member?: boolean };
}

export async function declineInvitation(invitationId: string): Promise<boolean> {
  const { data, error } = await sb().rpc('decline_invitation', { p_id: invitationId });
  if (error) throw error;
  return data === true;
}

export async function listInvitations(householdId: string) {
  // v10.114.0 (T2a, INT-HH-09): pending means not accepted AND not expired, as the database counts it
  // (an expired invitation used to show as pending, and block a Couple household's invite).
  const { data, error } = await sb().from('invitations')
    .select('*').eq('household_id', householdId).is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function acceptInvitation(token: string) {
  const { data, error } = await sb().rpc('accept_invitation_link', { invite_token: token });
  if (error) throw error;
  return data as { household_id: string; membership_id?: string; role?: string; already_member?: boolean };
}

/** v10.95.0 — true when an invitation was revoked; false when there was none left to revoke (it was
 *  accepted or revoked elsewhere). A delete RLS refuses also matches no row, so it reads as false. */
export async function revokeInvitation(invitationId: string): Promise<boolean> {
  const { data, error } = await sb().from('invitations').delete().eq('id', invitationId).select('id');
  if (error) throw error;
  return (data?.length ?? 0) > 0;
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

// ── Consent + data-erasure + account lifecycle (v9.8.0) ────────────
// Backs Settings → Danger Zone and the sign-up consent checkbox. See
// supabase/migrations/20260701120000_v98_privacy_deletion_controls.sql
// and supabase/functions/delete-account for the server-side half.
// W8a (audit XC-PRV-09): the version the pages show, not a stale copy ('2026-07-01').
export const POLICY_ACCEPTANCE_VERSION = POLICY_VERSION;

/** Record ToS + Privacy acceptance against the caller's profile. An acceptance of THIS version already
 *  on record is left as it is (a Google sign-in on the sign-in page records it too, every time). */
export async function acceptPolicies(userId: string) {
  const now = new Date().toISOString();
  const { error } = await sb().from('profiles').update({
    tos_accepted_at: now, tos_version: POLICY_ACCEPTANCE_VERSION,
    privacy_accepted_at: now, privacy_version: POLICY_ACCEPTANCE_VERSION,
  }).eq('id', userId)
    .or(`privacy_version.is.null,privacy_version.neq.${POLICY_ACCEPTANCE_VERSION}`);
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

/** Why the server refused a deletion: 'reauth_required', 'transfer_required', or another code. */
export class AccountDeletionError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'AccountDeletionError'; }
}

/**
 * W1b (v10.63.0) — deletes the account NOW, through the delete-account Edge Function, which
 * runs one purge transaction on the server and then removes the login. There is no 30-day
 * schedule any more (it was never executed). Call it right after `verifyAccountActionCode`:
 * the server refuses a session that has not signed in within the last 10 minutes.
 */
export async function executeAccountDeletion(): Promise<void> {
  const { error } = await sb().functions.invoke('delete-account', { body: {} });
  if (!error) return;
  let body: { error?: string; detail?: string } | undefined;
  try { body = await (error as { context?: Response }).context?.json(); } catch { body = undefined; }
  throw new AccountDeletionError(body?.error ?? 'delete_failed', body?.detail ?? error.message);
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
