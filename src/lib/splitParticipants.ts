// Vyact — who a split can be shared with (v10.59.0, owner 4 Oct 2026).
//
//   1. a split is shared by EMAIL only (cloud mode): every other person is a valid address;
//   2. never your own email: you are already in the split as "You";
//   3. before saving, each newly added person is confirmed: someone you already share a split or a
//      household with by name ("Is the split shared with Priya Sharma?"), anyone else by email ("Share
//      this split with …? If they aren't on Vyact yet, the email invites them."). Since v10.114.0 (T2a,
//      XC-PRV-12) names come back only for people already known to you. A "No" takes them out.
//
// Pure: the split form and the tests both use it.
import { nameList } from './confirmCopy';

/**
 * F1c (v10.112.0, INT-TXN-11) — what the Split form says on save. Sharing is queued behind the
 * transaction and sent by sync; offline, it says who it will be shared with once the device is back
 * online, instead of the old "sharing failed".
 */
export function splitSavedNotice(editing: boolean, sharedOnceOnline: string[]): string {
  if (sharedOnceOnline.length) return `Split saved. It's shared with ${nameList(sharedOnceOnline)} once you're online.`;
  return editing ? 'Split updated' : 'Split added';
}

/** A plain address check: something@domain.tld, no spaces. The server is the real check. */
export const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;

/** What is wrong with this participant's email, or null when it can be shared with. */
export function participantEmailProblem(email: string, ownEmail: string | null | undefined, otherEmails: string[] = []): string | null {
  const e = email.trim().toLowerCase();
  if (!e) return 'Add their email address';
  if (!EMAIL_RE.test(e)) return 'Enter a valid email address';
  if (ownEmail && e === ownEmail.trim().toLowerCase()) return "That's your own email. You're already in this split as You.";
  if (otherEmails.map(o => o.trim().toLowerCase()).includes(e)) return 'This person is already in the split';
  return null;
}

/** People to confirm before saving: the emails not already in the split being edited. */
export function needsConfirmation(emails: string[], alreadyInSplit: string[] = []): string[] {
  const known = new Set(alreadyInSplit.map(e => e.trim().toLowerCase()));
  return [...new Set(emails.map(e => e.trim().toLowerCase()).filter(e => e && !known.has(e)))];
}

/**
 * W4c (D18) — the day a participant paid. Someone already marked paid before this edit keeps their
 * day (matched by email, else by name); only a payment marked in this edit is dated today. Saving an
 * edit used to restamp every earlier payment with today's date.
 */
export function paidOnFor(
  before: { name: string; email?: string; paid?: boolean; paidOn?: string | null }[] | undefined,
  who: { email?: string; name: string },
  paid: boolean,
  todayISO: string,
): string | null {
  if (!paid) return null;
  const email = (who.email ?? '').trim().toLowerCase();
  const prior = (before ?? []).find(p => (email ? (p.email ?? '').toLowerCase() === email : p.name === who.name));
  return prior?.paid && prior.paidOn ? prior.paidOn : todayISO;
}

export interface ConfirmItem {
  email: string;
  /** Their Vyact display name; null when the email has no account (they get an invitation). */
  name: string | null;
}

/** The question asked for one person before the split is saved. */
export function confirmQuestion(item: ConfirmItem): string {
  // v10.114.0 (T2a, XC-PRV-12; owner: "known emails only") — a name comes back only for someone you
  // already share a split or a household with. No name no longer means "not on Vyact", so the
  // question doesn't say so; the email itself invites them if they aren't.
  return item.name
    ? `Is the split shared with ${item.name} (${item.email})?`
    : `Share this split with ${item.email}? If they aren't on Vyact yet, the email invites them.`;
}

/** v10.59.0 (owner, item 6) — splits created, still open (someone hasn't settled) and settled. */
export function splitCounts(txns: { split?: { isSplit?: boolean; participants: { isYou?: boolean; paid?: boolean }[] } }[]): {
  created: number; open: number; settled: number;
} {
  const splits = txns.filter(t => t.split?.isSplit);
  const settled = splits.filter(t => t.split!.participants.every(p => p.isYou || p.paid)).length;
  return { created: splits.length, open: splits.length - settled, settled };
}
