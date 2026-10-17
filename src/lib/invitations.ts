// Vyact v10.95.0 — household invitations addressed to a person (#9; owner decisions 13 Oct 2026).
//
// An invitation may carry the invitee's email (`recipient_email`). Vyact emails it (send-invite-email),
// and once they sign in with that address they find it in their bell with Join / Decline. Owners and
// admins see each pending invitation of the open household with Revoke, which asks and then revokes at
// once. Pure helpers here; the calls live in lib/auth.ts and the store's invitations slice.
import { supabase } from './supabase';
import { INVITE_LABEL_SENTINEL } from './auth';

/** An invitation addressed to me (`my_pending_invitations`). Never carries the token. */
export interface MyInvitation {
  id: string;
  householdId: string;
  householdName: string;
  householdType?: string;
  invitedByName: string;
  role: string;
  householdRole?: string | null;
  expiresAt: string;
  createdAt: string;
}

/** A pending invitation of a household I manage (the `invitations` row, owner/admin RLS). */
export interface HouseholdInvitation {
  id: string;
  householdId: string;
  /** What the inviter typed, or "(shareable link)" (`invited_email`, a legacy name). */
  label: string;
  recipientEmail?: string | null;
  role: string;
  expiresAt: string;
  createdAt: string;
}

/** The database's shape for an address (ck_invitation_recipient_email). */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type InviteEmailCheck =
  | { ok: true; email: string | null }
  | { ok: false; reason: 'invalid' | 'own' };

/** The optional "Their email" field: empty is fine (a link-only invitation); never your own address. */
export function checkInviteEmail(raw: string, myEmail: string | null | undefined): InviteEmailCheck {
  const email = raw.trim().toLowerCase();
  if (!email) return { ok: true, email: null };
  if (email.length > 254 || !EMAIL_SHAPE.test(email)) return { ok: false, reason: 'invalid' };
  if (myEmail && email === myEmail.trim().toLowerCase()) return { ok: false, reason: 'own' };
  return { ok: true, email };
}

export interface InviteEmailResult { ok: boolean; reason?: string }

/** The function's answer, as one result the caller can act on. */
export function readInviteEmailResult(data: unknown, error: unknown): InviteEmailResult {
  if (error) return { ok: false, reason: 'unreachable' };
  const d = (data ?? {}) as { ok?: boolean; reason?: string; error?: string };
  if (d.error) return { ok: false, reason: d.error };
  if (d.ok !== true) return { ok: false, reason: d.reason ?? 'not_sent' };
  return { ok: true };
}

/** What to tell the inviter once the invitation is saved. The invitation and its link work either way. */
export function inviteEmailNotice(r: InviteEmailResult, email: string): { message: string; tone: 'success' | 'info' } {
  if (r.ok) return { message: `Invitation emailed to ${email}.`, tone: 'success' };
  if (r.reason === 'email_not_configured') {
    return { message: `Invitation saved. Vyact can't send email yet, so share the link with ${email} yourself.`, tone: 'info' };
  }
  if (r.reason === 'daily_limit') {
    return { message: `Invitation saved. You've reached today's limit for invitation emails, so share the link with ${email} yourself.`, tone: 'info' };
  }
  return { message: `Invitation saved, but the email to ${email} couldn't be sent. Share the link instead.`, tone: 'info' };
}

export async function sendInviteEmail(invitationId: string): Promise<InviteEmailResult> {
  if (!supabase) return { ok: false, reason: 'local_only' };
  try {
    const { data, error } = await supabase.functions.invoke('send-invite-email', { body: { invitationId } });
    return readInviteEmailResult(data, error);
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

/** Who an invitation is for, as the inviter knows it: its address, else its label; null for a bare link. */
export function invitationWho(i: { recipientEmail?: string | null; label?: string | null }): string | null {
  if (i.recipientEmail) return i.recipientEmail;
  const label = (i.label ?? '').trim();
  return label && label !== INVITE_LABEL_SENTINEL ? label : null;
}

/** Still open: not past its expiry. */
export const invitationOpen = (i: { expiresAt: string }, now = Date.now()) => new Date(i.expiresAt).getTime() > now;
