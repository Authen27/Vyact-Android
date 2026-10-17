// Aurora 4.0 G4 — the words on every confirmation sheet (CF3–CF20), in one place and pure, so each
// one names its item and says what happens and what stays (CF2). Amounts arrive pre-formatted.
import type { ConfirmRequest } from './confirmSheet';

/** "Priya", "Priya and Arjun", "Priya, Arjun and Sam". */
export function nameList(names: string[]): string {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n[0] ?? '';
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** CF3 — delete a transaction. `where`: its category and account, e.g. "Food & Dining and HDFC Regalia". */
export function deleteTransactionRequest(p: { name: string; amount: string; where: string }): ConfirmRequest {
  return {
    title: `Delete ${p.name || 'this entry'}, ${p.amount}?`,
    lines: [p.where ? `It comes off ${p.where}.` : 'It comes off the household totals.', 'Everyone in the household stops seeing it.'],
    action: 'Delete entry',
  };
}

/** CF4 — delete a split; Close split is offered as the softer choice when the split was shared. */
export function deleteSplitRequest(p: { name: string; amount: string; others: string[]; canClose: boolean }): ConfirmRequest {
  const lines = [`Removes the ${p.amount} entry and your share.`];
  if (p.others.length) lines.push(`${nameList(p.others)} ${p.others.length === 1 ? 'loses the share' : 'lose the share'} sent to them.`);
  return {
    title: `Delete ${p.name || 'this split'}?`,
    lines,
    action: 'Delete split',
    choices: p.canClose ? [
      { value: 'close', label: 'Close it instead', detail: 'Keeps the record; nobody can edit it.', recommended: true, action: 'Close split', tone: 'primary' },
      { value: 'delete', label: 'Delete everything', detail: 'For a split made by mistake.', action: 'Delete split', tone: 'danger' },
    ] : undefined,
  };
}

/** CF5 — close a split: permanent, and the others are told. */
export function closeSplitRequest(p: { name: string; others: string[] }): ConfirmRequest {
  return {
    title: `Close ${p.name || 'this split'}?`,
    lines: [
      p.others.length ? `${nameList(p.others)} ${p.others.length === 1 ? 'is' : 'are'} told it is closed.` : 'Everyone on the split is told it is closed.',
      'Nobody can edit it after this; unpaid shares stay owed.',
    ],
    action: 'Close split',
  };
}

/** CF6 — delete a budget. */
export function deleteBudgetRequest(p: { label: string; allocations: number; spent?: string; period?: string }): ConfirmRequest {
  const lines = [p.allocations > 0 ? `Its ${plural(p.allocations, 'category allocation')} ${p.allocations === 1 ? 'is' : 'are'} removed.` : 'The budget is removed.'];
  lines.push(p.spent ? `Your ${p.spent} of ${p.period ?? 'spending'} stays; it just isn't tracked against a budget.` : 'Your spending stays; it just isn\'t tracked against a budget.');
  return { title: `Delete ${p.label} budget?`, lines, action: 'Delete budget' };
}

/** CF7 — delete a recurring schedule: past entries stay, future ones stop. */
export function deleteScheduleRequest(p: { name: string; made: number }): ConfirmRequest {
  return {
    title: `Delete ${p.name || 'this'} schedule?`,
    lines: [
      `No more ${p.name || 'schedule'} entries will be created or suggested.`,
      p.made > 0 ? `The ${plural(p.made, 'entry', 'entries')} it already made stay in Transactions.` : 'Nothing it already made is touched.',
    ],
    action: 'Delete schedule',
  };
}

/** CF9 — undo the latest loan payment: the entries that go, and what the loan goes back to. */
export function undoLoanPaymentRequest(p: { date: string; amount: string; interest?: string; principal?: string; loan: string; owedAfter?: string }): ConfirmRequest {
  const parts = p.interest && p.principal ? `: ${p.interest} interest and ${p.principal} principal` : '';
  return {
    title: `Undo the ${p.date} payment?`,
    lines: [`Removes the ${p.amount} payment${parts}.`, p.owedAfter ? `${p.loan} goes back to ${p.owedAfter} owed.` : `${p.loan} goes back to how it was.`],
    action: 'Undo payment',
  };
}

/** CF10 — mark a loan paid off: the write-off spelled out, with an optional note. */
export function markPaidOffRequest(p: { name: string; writeOff?: string }): ConfirmRequest {
  return {
    title: `Mark ${p.name} paid off?`,
    lines: [p.writeOff
      ? `The ${p.writeOff} still showing is written off the loan. It is a correction, not a payment.`
      : 'Nothing is owed on it now; it moves to paid off.'],
    input: { label: 'Note · optional', initial: 'Closed with the bank', optional: true, maxLength: 200 },
    action: 'Mark paid off',
    tone: 'primary',
  };
}

/** CF11 — delete a loan; Mark paid off is pointed to when nothing is owed. */
export function deleteLoanRequest(p: { name: string; payments: number; paidUp: boolean }): ConfirmRequest {
  return {
    title: `Delete ${p.name}?`,
    lines: ['The loan and its schedule are removed.', p.payments > 0 ? `Its ${plural(p.payments, 'payment')} stay in your history.` : 'Your history is not changed.'],
    action: 'Delete loan',
    choices: p.paidUp ? [
      { value: 'paidoff', label: 'Mark it paid off instead', detail: 'Keeps it in Net Worth history.', recommended: true, action: 'Mark paid off', tone: 'primary' },
      { value: 'delete', label: 'Delete it', detail: 'For a loan added by mistake.', action: 'Delete loan', tone: 'danger' },
    ] : undefined,
  };
}

/** CF12 — delete an asset: its effect on net worth. */
export function deleteAssetRequest(p: { name: string; value?: string }): ConfirmRequest {
  return {
    title: `Delete ${p.name || 'this asset'}?`,
    lines: [p.value ? `Net worth drops by ${p.value}.` : 'It comes off your net worth.', 'Past net worth history is not changed.'],
    action: 'Delete asset',
  };
}

/** CF13 — remove a member. */
export function removeMemberRequest(p: { name: string; household: string }): ConfirmRequest {
  return {
    title: `Remove ${p.name}?`,
    lines: [`They lose access to ${p.household}.`, 'Entries they added stay, under their name.'],
    action: 'Remove',
  };
}

/** CF14 — leave a household. */
export function leaveHouseholdRequest(p: { household: string }): ConfirmRequest {
  return {
    title: `Leave ${p.household}?`,
    lines: ['You lose access unless someone invites you again.', 'Your entries stay with the household.'],
    action: 'Leave household',
  };
}

/**
 * v10.95.0 (#9, owner decision 13 Oct 2026; closes R4) — revoke an invitation: it asks, then revokes at
 * once. It used to be held for an 8-second Undo, and a tab closed inside that window left the link live
 * while the screen said "revoked". `who`: the address it went to, else its label; none for a bare link.
 */
export function revokeInvitationRequest(p: { who?: string | null }): ConfirmRequest {
  return {
    title: p.who ? `Revoke the invitation to ${p.who}?` : 'Revoke this invitation link?',
    lines: ['The link stops working at once, and nobody can join with it.', 'You can invite them again later.'],
    action: 'Revoke',
  };
}

/** v10.95.0 (#9) — join a household from the bell; the same question the invitation link asks (FE-PLT-07). */
export function joinInvitationRequest(p: { household: string; role: string; inviter: string }): ConfirmRequest {
  return {
    title: `Join ${p.household} as ${p.role}?`,
    lines: [`${p.inviter} invited you.`, 'Joining shares its money picture with you, and yours with its members.'],
    action: 'Join household',
    tone: 'primary',
  };
}

/** v10.95.0 (#9) — decline an invitation: it is removed, and only the inviter can send a new one. */
export function declineInvitationRequest(p: { household: string; inviter: string }): ConfirmRequest {
  return {
    title: `Decline the invitation to ${p.household}?`,
    lines: ['The invitation is removed.', `${p.inviter} can invite you again later.`],
    action: 'Decline',
  };
}

/** CF15 — delete a household: type its name to confirm. */
export function deleteHouseholdRequest(p: { household: string }): ConfirmRequest {
  return {
    title: `Delete ${p.household} for everyone?`,
    lines: ['All entries, budgets, accounts and members are deleted.', 'There is no undo.'],
    input: { label: 'Type the household name to confirm', mustEqual: p.household, placeholder: p.household },
    action: 'Delete household',
  };
}

/** HH2 (until the rename moves into Household settings, A7) — rename a household. */
export function renameHouseholdRequest(p: { household: string }): ConfirmRequest {
  return {
    title: `Rename ${p.household}?`,
    input: { label: 'Household name', initial: p.household, maxLength: 80 },
    action: 'Rename',
    tone: 'primary',
  };
}

/** CF17 — the emailed code for a sensitive action. */
export function verificationCodeRequest(p: { email: string; action: string; resend: () => Promise<unknown> }): ConfirmRequest {
  return {
    title: 'Enter the code we emailed',
    lines: [`Sent to ${p.email} to confirm: ${p.action}.`],
    input: { label: '6-digit code', code: true },
    resend: { seconds: 45, run: p.resend },
    action: 'Confirm',
    tone: 'primary',
  };
}

/** Settings › erase household data (Danger Zone, before the code). */
export function eraseDataRequest(): ConfirmRequest {
  return {
    title: 'Erase all household data?',
    lines: [
      'Every transaction, budget, debt, asset, account and recurring schedule in this household is deleted.',
      'Your login and the household itself stay. There is no undo.',
    ],
    action: 'Erase data',
  };
}

/** CF18 — deactivate the account; the reassurance about data is kept. */
export function deactivateRequest(): ConfirmRequest {
  return {
    title: 'Deactivate your account?',
    lines: ['You are signed out straight away.', 'Your data is kept as it is and comes back when you sign in again.'],
    action: 'Deactivate',
  };
}

/** Settings › delete account (Danger Zone, before the code). */
export function deleteAccountRequest(): ConfirmRequest {
  return {
    title: 'Delete your account permanently?',
    lines: [
      'Your login, your profile and every household where you are the only member are deleted now.',
      'In households you share, your entries stay with the household. There is no undo.',
    ],
    action: 'Delete account',
  };
}

/** CF20 — unlink WhatsApp. */
export function unlinkWhatsAppRequest(p: { phone?: string }): ConfirmRequest {
  return {
    title: 'Unlink WhatsApp?',
    lines: [`Messages to Pip${p.phone ? ` from ${p.phone}` : ''} stop being recorded.`, 'You can link it again any time.'],
    action: 'Unlink',
  };
}

/** Saved views (hidden feature) — delete one. */
export function deleteSavedViewRequest(p: { name: string }): ConfirmRequest {
  return { title: `Delete the "${p.name}" view?`, lines: ['Only the saved filter goes; no entries change.'], action: 'Delete view' };
}
