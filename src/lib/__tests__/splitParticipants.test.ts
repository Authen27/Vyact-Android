// v10.59.0 (owner, 4 Oct 2026) — sharing a split: email only, never yourself, each new
// person confirmed (by name if they have an account, as an invitation if not), the
// created / open / settled counts, and the invitation email itself.
import { describe, expect, it } from 'vitest';
import { participantEmailProblem, needsConfirmation, confirmQuestion, splitCounts } from '../splitParticipants';
import { splitInviteEmail, type SplitEmailData } from '../../../../supabase/functions/_shared/emailTemplates';

describe('who a split is shared with', () => {
  it('CON-UNIT-SPL-001 · only a valid email, never your own, never twice', () => {
    expect(participantEmailProblem('priya@example.com', 'me@example.com')).toBeNull();
    expect(participantEmailProblem('  Priya@Example.COM ', 'me@example.com')).toBeNull();
    expect(participantEmailProblem('', 'me@example.com')).toMatch(/Add their email/);
    for (const bad of ['priya', 'priya@', 'priya@example', 'pri ya@example.com', '@example.com', 'priya@example.c']) {
      expect(participantEmailProblem(bad, 'me@example.com'), bad).toMatch(/valid email/);
    }
    expect(participantEmailProblem('ME@example.com', 'me@example.com')).toMatch(/your own email/);
    expect(participantEmailProblem('sam@example.com', null, ['Sam@example.com'])).toMatch(/already in the split/);
  });

  // v10.114.0 (T2a, XC-PRV-12; owner "known emails only"): no name no longer means "not on Vyact" — a name
  // comes back only for someone already known to you — so the question for anyone else is neutral.
  it('CON-UNIT-SPL-002 · only people new to the split are confirmed; someone you know by name, anyone else by email', () => {
    expect(needsConfirmation(['a@x.com', 'B@x.com', 'b@x.com'], ['a@x.com'])).toEqual(['b@x.com']);
    expect(needsConfirmation(['a@x.com'], ['A@x.com'])).toEqual([]);
    expect(confirmQuestion({ email: 'priya@x.com', name: 'Priya Sharma' })).toBe('Is the split shared with Priya Sharma (priya@x.com)?');
    expect(confirmQuestion({ email: 'sam@x.com', name: null })).toBe("Share this split with sam@x.com? If they aren't on Vyact yet, the email invites them.");
    expect(confirmQuestion({ email: 'sam@x.com', name: null })).not.toMatch(/isn't on Vyact/);
  });

  it('CON-UNIT-SPL-003 · created vs open vs settled: settled means everyone but you has paid', () => {
    const t = (paid: boolean[], isSplit = true) => ({ split: { isSplit, participants: [{ isYou: true, paid: true }, ...paid.map(p => ({ paid: p }))] } });
    expect(splitCounts([t([true, true]), t([true, false]), t([false]), t([true], false), {}])).toEqual({ created: 3, open: 2, settled: 1 });
    expect(splitCounts([])).toEqual({ created: 0, open: 0, settled: 0 });
  });

  it('CON-UNIT-SPL-004 · the invitation names the sender (name and email), says why, shows the split and links to sign up on Splits', () => {
    const d: SplitEmailData = {
      ownerName: 'Priya Sharma', ownerEmail: 'priya@example.com', description: 'Dinner at Olive', date: '2026-10-03', currency: 'INR',
      total: 2400, recipientShare: 800,
      participants: [{ name: 'sam@example.com', share: 800, isRecipient: true }, { name: 'Rohan', share: 800, isRecipient: false }],
      appUrl: 'https://vyact.app', recipientEmail: 'sam@example.com',
    };
    const mail = splitInviteEmail(d);
    expect(mail.subject).toBe('Priya Sharma invited you to settle "Dinner at Olive" on Vyact');
    expect(mail.text).toContain('Priya Sharma (priya@example.com) added you to "Dinner at Olive" on Vyact, the family budget app');
    expect(mail.text).toContain('Your share is');
    expect(mail.text).toContain('Join Vyact to review and settle: https://vyact.app/auth/sign-up?email=sam%40example.com&method=email&next=%2Fsplits&ref=split_invite');
    expect(mail.html).not.toContain('<script');
    const hostile = splitInviteEmail({ ...d, ownerName: '<b>x</b>', description: '<img src=x>' });
    expect(hostile.html).not.toContain('<img src=x>');
    expect(hostile.html).not.toContain('<b>x</b>');
  });
});
