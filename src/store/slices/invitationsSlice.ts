// Vyact v10.95.0 — household invitations in the bell (#9; owner decisions 13 Oct 2026).
//
// Two live lists, cloud only:
//   • myInvitations — invitations addressed to my confirmed email (`my_pending_invitations`), any
//     household. The bell shows each with Join / Decline.
//   • householdInvitations — the open household's pending invitations, for an owner or admin (the
//     `invitations` read policy). The bell shows each with Revoke.
// They are refreshed with the household list (sign-in, a household switch) and when the bell opens.
// The bell builds its cards from them (lib/notifications.ts) and never saves them.
import type { StateCreator } from 'zustand';
import type { Store } from '../../store';
import type { HouseholdInvitation, MyInvitation } from '../../lib/invitations';
import {
  listMyInvitations, listInvitations, acceptInvitationById, declineInvitation, revokeInvitation,
} from '../../lib/auth';
import { can } from '../../lib/permissions';

export interface InvitationsSlice {
  myInvitations: MyInvitation[];
  householdInvitations: HouseholdInvitation[];
  refreshInvitations: () => Promise<void>;
  /** Joins the household; returns its id. Throws the database's refusal (HOUSEHOLD_FULL, not found). */
  joinInvitation: (invitationId: string) => Promise<string>;
  /** False when there was nothing to decline (already answered, revoked or expired). */
  declineMyInvitation: (invitationId: string) => Promise<boolean>;
  /** False when there was nothing to revoke (already accepted or revoked). */
  revokeHouseholdInvitation: (invitationId: string) => Promise<boolean>;
}

const toHouseholdInvitation = (r: Record<string, unknown>): HouseholdInvitation => ({
  id: String(r.id), householdId: String(r.household_id), label: String(r.invited_email ?? ''),
  recipientEmail: (r.recipient_email as string | null) ?? null, role: String(r.role),
  expiresAt: String(r.expires_at), createdAt: String(r.created_at),
});

export const createInvitationsSlice: StateCreator<Store, [], [], InvitationsSlice> = (set, get) => ({
  myInvitations: [],
  householdInvitations: [],

  refreshInvitations: async () => {
    const { cloudEnabled, session, currentHouseholdId, myRole } = get();
    if (!cloudEnabled || !session) { set({ myInvitations: [], householdInvitations: [] }); return; }
    const manages = !!currentHouseholdId && currentHouseholdId !== 'local' && can(myRole, 'invite_member');
    // Reads only: a failure keeps what is shown, and the next refresh retries.
    const [mine, theirs] = await Promise.all([
      listMyInvitations().catch(() => null),
      manages
        ? listInvitations(currentHouseholdId).then(rows => (rows ?? []).map(r => toHouseholdInvitation(r as Record<string, unknown>))).catch(() => null)
        : Promise.resolve([] as HouseholdInvitation[]),
    ]);
    set({
      ...(mine ? { myInvitations: mine } : {}),
      ...(theirs ? { householdInvitations: theirs } : {}),
    });
  },

  joinInvitation: async (invitationId) => {
    const result = await acceptInvitationById(invitationId);
    set({ myInvitations: get().myInvitations.filter(i => i.id !== invitationId) });
    return result.household_id;
  },

  declineMyInvitation: async (invitationId) => {
    const declined = await declineInvitation(invitationId);
    set({ myInvitations: get().myInvitations.filter(i => i.id !== invitationId) });
    return declined;
  },

  revokeHouseholdInvitation: async (invitationId) => {
    const revoked = await revokeInvitation(invitationId);
    set({ householdInvitations: get().householdInvitations.filter(i => i.id !== invitationId) });
    return revoked;
  },
});
