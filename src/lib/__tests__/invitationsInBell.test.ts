// #9, step 2 (v10.95.0; owner decisions 13 Oct 2026) — invitations in the bell. The invitee sees Join /
// Decline, an owner or admin sees Revoke; Revoke asks and then revokes at once (closes R4). Cards are
// built from live lists and never saved. Pure helpers, the store slice with a mocked client, and the
// wiring through the source.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const auth = vi.hoisted(() => ({
  listMyInvitations: vi.fn(), listInvitations: vi.fn(), acceptInvitationById: vi.fn(),
  declineInvitation: vi.fn(), revokeInvitation: vi.fn(), INVITE_LABEL_SENTINEL: '(shareable link)',
}));
vi.mock('../auth', () => auth);

import { invitationPendingNotifs, invitationReceivedNotifs, needsYou, DEFAULT_PREFS } from '../notifications';
import { checkInviteEmail, inviteEmailNotice, invitationWho, readInviteEmailResult, type HouseholdInvitation, type MyInvitation } from '../invitations';
import { declineInvitationRequest, joinInvitationRequest, revokeInvitationRequest } from '../confirmCopy';
import { inviteAcceptMessage } from '../householdTypes';
import { createInvitationsSlice } from '../../store/slices/invitationsSlice';

const src = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const NOW = Date.parse('2026-10-13T10:00:00Z');
const LATER = '2026-10-27T10:00:00Z';
const PAST = '2026-10-01T10:00:00Z';

const mine: MyInvitation[] = [
  { id: 'i1', householdId: 'h9', householdName: 'Sharma family', invitedByName: 'Asha', role: 'member', expiresAt: LATER, createdAt: '2026-10-13T09:00:00Z' },
  { id: 'i2', householdId: 'h8', householdName: 'Old flat', invitedByName: 'Ravi', role: 'viewer', expiresAt: PAST, createdAt: '2026-09-20T09:00:00Z' },
];
const theirs: HouseholdInvitation[] = [
  { id: 'p1', householdId: 'h1', label: 'Partner', recipientEmail: 'sam@example.com', role: 'member', expiresAt: LATER, createdAt: '2026-10-12T09:00:00Z' },
  { id: 'p2', householdId: 'h1', label: '(shareable link)', recipientEmail: null, role: 'viewer', expiresAt: LATER, createdAt: '2026-10-11T09:00:00Z' },
  { id: 'p3', householdId: 'h1', label: 'Old', recipientEmail: null, role: 'member', expiresAt: PAST, createdAt: '2026-09-11T09:00:00Z' },
  { id: 'p4', householdId: 'h2', label: 'Elsewhere', recipientEmail: null, role: 'member', expiresAt: LATER, createdAt: '2026-10-11T09:00:00Z' },
];

describe('invitations in the bell (#9 step 2)', () => {
  it('INV-B-001 · the invitee\'s card: Join / Decline, waiting on them, in whichever household is open', () => {
    const cards = invitationReceivedNotifs(mine, DEFAULT_PREFS, NOW);
    expect(cards).toHaveLength(1);                                   // the expired one is gone
    const [c] = cards;
    expect(c).toMatchObject({
      type: 'invite_received', priority: 'P1', status: 'unread', invitationId: 'i1',
      title: 'Asha invited you to Sharma family',
      body: 'Join as Member. The invitation expires on 2026-10-27.',
    });
    expect(c.actions?.map(a => [a.id, a.kind])).toEqual([['join', 'primary'], ['decline', 'ghost']]);
    expect(c.householdId).toBeUndefined();                          // not tied to the open household
    expect(needsYou(c)).toBe(true);
    expect(invitationReceivedNotifs(mine, { ...DEFAULT_PREFS, perType: { invite_received: false } }, NOW)).toEqual([]);
    expect(invitationReceivedNotifs(mine, { ...DEFAULT_PREFS, master: false }, NOW)).toEqual([]);
  });

  it('INV-B-002 · the inviter\'s cards: the open household\'s open invitations, each with Revoke', () => {
    const cards = invitationPendingNotifs(theirs, DEFAULT_PREFS, 'h1', NOW);
    expect(cards.map(c => [c.invitationId, c.title])).toEqual([
      ['p1', 'Invitation to sam@example.com is waiting'],
      ['p2', 'An invitation link is waiting'],
    ]);
    expect(cards[0]).toMatchObject({ type: 'invite_pending', priority: 'P1', householdId: 'h1', body: 'Member access. Expires on 2026-10-27.' });
    expect(cards[0].actions?.map(a => a.id)).toEqual(['revoke']);
    expect(cards.every(needsYou)).toBe(true);
  });

  it('INV-B-003 · the "Their email" field: optional, normalised, email-shaped, never your own', () => {
    expect(checkInviteEmail('  ', 'me@example.com')).toEqual({ ok: true, email: null });
    expect(checkInviteEmail(' Sam@Example.COM ', 'me@example.com')).toEqual({ ok: true, email: 'sam@example.com' });
    for (const bad of ['sam', 'sam@', 'a@b', 'two@@x.com', 'a b@x.com', `${'x'.repeat(250)}@x.com`]) {
      expect(checkInviteEmail(bad, null), bad).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(checkInviteEmail('ME@example.com', 'me@Example.com')).toEqual({ ok: false, reason: 'own' });
  });

  it('INV-B-004 · the email\'s outcome is told, never swallowed', () => {
    expect(readInviteEmailResult({ ok: true }, null)).toEqual({ ok: true });
    expect(readInviteEmailResult({ ok: false, reason: 'email_not_configured' }, null)).toEqual({ ok: false, reason: 'email_not_configured' });
    expect(readInviteEmailResult({ error: 'forbidden' }, null)).toEqual({ ok: false, reason: 'forbidden' });
    expect(readInviteEmailResult(null, new Error('down'))).toEqual({ ok: false, reason: 'unreachable' });
    expect(inviteEmailNotice({ ok: true }, 'sam@example.com')).toEqual({ message: 'Invitation emailed to sam@example.com.', tone: 'success' });
    expect(inviteEmailNotice({ ok: false, reason: 'email_not_configured' }, 'sam@example.com').message)
      .toBe("Invitation saved. Vyact can't send email yet, so share the link with sam@example.com yourself.");
    expect(inviteEmailNotice({ ok: false, reason: 'daily_limit' }, 's@x.com').message).toMatch(/today's limit for invitation emails/);
    expect(inviteEmailNotice({ ok: false, reason: 'unreachable' }, 's@x.com').message).toMatch(/couldn't be sent\. Share the link instead\./);
  });

  it('INV-B-005 · the questions name the invitation and say what happens', () => {
    expect(invitationWho({ recipientEmail: 'sam@example.com', label: 'Partner' })).toBe('sam@example.com');
    expect(invitationWho({ recipientEmail: null, label: 'Partner' })).toBe('Partner');
    expect(invitationWho({ recipientEmail: null, label: '(shareable link)' })).toBeNull();
    expect(revokeInvitationRequest({ who: 'sam@example.com' })).toEqual({
      title: 'Revoke the invitation to sam@example.com?',
      lines: ['The link stops working at once, and nobody can join with it.', 'You can invite them again later.'],
      action: 'Revoke',
    });
    expect(revokeInvitationRequest({ who: null }).title).toBe('Revoke this invitation link?');
    expect(joinInvitationRequest({ household: 'Sharma family', role: 'Member', inviter: 'Asha' })).toMatchObject({
      title: 'Join Sharma family as Member?', action: 'Join household', tone: 'primary',
    });
    expect(declineInvitationRequest({ household: 'Sharma family', inviter: 'Asha' })).toMatchObject({
      title: 'Decline the invitation to Sharma family?', action: 'Decline',
    });
    expect(inviteAcceptMessage(new Error('invitation_not_found'))).toBe('This invitation is no longer open. It may have been revoked or declined, or it expired.');
  });
});

describe('the invitations slice', () => {
  type State = Record<string, unknown> & ReturnType<typeof createInvitationsSlice>;
  function store(init: Record<string, unknown>) {
    let state = {} as State;
    const set = (p: Partial<State> | ((s: State) => Partial<State>)) => { state = { ...state, ...(typeof p === 'function' ? p(state) : p) }; };
    const get = () => state;
    state = { ...createInvitationsSlice(set as never, get as never, {} as never), ...init } as State;
    return get;
  }
  beforeEach(() => { vi.clearAllMocks(); });

  it('INV-B-006 · refresh: an owner gets both lists, a member only theirs, a signed-out device none', async () => {
    auth.listMyInvitations.mockResolvedValue(mine);
    auth.listInvitations.mockResolvedValue([{ id: 'p1', household_id: 'h1', invited_email: 'Partner', recipient_email: 'sam@example.com', role: 'member', expires_at: LATER, created_at: '2026-10-12T09:00:00Z' }]);
    const owner = store({ cloudEnabled: true, session: { user: { id: 'u' } }, currentHouseholdId: 'h1', myRole: 'owner' });
    await owner().refreshInvitations();
    expect(owner().myInvitations).toEqual(mine);
    expect(owner().householdInvitations).toEqual([theirs[0]]);
    expect(auth.listInvitations).toHaveBeenCalledWith('h1');

    auth.listInvitations.mockClear();
    const member = store({ cloudEnabled: true, session: { user: { id: 'u' } }, currentHouseholdId: 'h1', myRole: 'member' });
    await member().refreshInvitations();
    expect(member().householdInvitations).toEqual([]);
    expect(auth.listInvitations).not.toHaveBeenCalled();

    const out = store({ cloudEnabled: true, session: null, currentHouseholdId: 'h1', myInvitations: mine, householdInvitations: theirs });
    await out().refreshInvitations();
    expect([out().myInvitations, out().householdInvitations]).toEqual([[], []]);
    // A failed read keeps what is shown.
    auth.listMyInvitations.mockRejectedValue(new Error('offline'));
    const kept = store({ cloudEnabled: true, session: { user: { id: 'u' } }, currentHouseholdId: 'h1', myRole: 'member', myInvitations: mine });
    await kept().refreshInvitations();
    expect(kept().myInvitations).toEqual(mine);
  });

  it('INV-B-007 · join, decline and revoke each remove the card and report what happened', async () => {
    const s = store({ myInvitations: mine, householdInvitations: theirs });
    auth.acceptInvitationById.mockResolvedValue({ household_id: 'h9', already_member: false });
    expect(await s().joinInvitation('i1')).toBe('h9');
    expect(s().myInvitations.map(i => i.id)).toEqual(['i2']);
    auth.declineInvitation.mockResolvedValue(false);
    expect(await s().declineMyInvitation('i2')).toBe(false);
    expect(s().myInvitations).toEqual([]);
    auth.revokeInvitation.mockResolvedValue(true);
    expect(await s().revokeHouseholdInvitation('p1')).toBe(true);
    expect(s().householdInvitations.map(i => i.id)).toEqual(['p2', 'p3', 'p4']);
    // A refused join leaves the card for the person to see why.
    auth.acceptInvitationById.mockRejectedValue(new Error('HOUSEHOLD_FULL: a couple household has room for 2 members'));
    const t = store({ myInvitations: mine });
    await expect(t().joinInvitation('i1')).rejects.toThrow(/HOUSEHOLD_FULL/);
    expect(t().myInvitations).toEqual(mine);
  });

  it('INV-B-008 · wiring: cards are never saved; Revoke asks then revokes at once; the form sends the email after saving', () => {
    // Never saved: the persisted feed does not build invitation cards; the bell merges them in.
    const notify = src('store/slices/notifySlice.ts');
    expect(notify).not.toMatch(/invitation(Received|Pending)Notifs/);
    const sheet = src('components/layout/NotificationSheet.tsx');
    expect(sheet).toMatch(/const active = \[\.\.\.notifications, \.\.\.invitationCards\]/);
    expect(sheet).toMatch(/case 'join': void joinFromCard\(n\); return;/);
    expect(sheet).toMatch(/confirmSheet\(revokeInvitationRequest\(\{ who: invitationWho\(inv\) \}\)\)/);
    expect(src('components/layout/NotificationCenter.tsx')).toMatch(/\)\.length \+ invitationCards\.length;/);
    // The server engine bundles notifications.ts: it may only TYPE-import the invitations module.
    expect(src('lib/notifications.ts')).toMatch(/import type \{ MyInvitation, HouseholdInvitation \} from '\.\/invitations';/);
    // Households: Revoke asks, then revokes; no 8-second hold for invitations any more (R4).
    const hh = src('pages/Households.tsx');
    expect(hh).not.toMatch(/deferCommit/);
    expect(hh).toMatch(/if \(!\(await confirmSheet\(revokeInvitationRequest\(/);
    expect(hh).toMatch(/const result = await sendInviteEmail\(\(inv as \{ id: string \}\)\.id\);/);
    const a = src('lib/auth.ts');
    expect(a).toMatch(/recipient_email: recipientEmail \|\| null,/);
    expect(a).toMatch(/\.delete\(\)\.eq\('id', invitationId\)\.select\('id'\)/);
    expect(src('store/slices/cloudAuthSlice.ts')).toMatch(/myInvitations: \[\], householdInvitations: \[\],/);
  });
});
