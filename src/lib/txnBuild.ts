// Aurora 4.0 PIP2 — the transaction form's build-and-check, shared.
//
// Moved out of TransactionFormModal.persist() unchanged, so the form and Pip's inline Save card build a
// transaction the same way and refuse the same things: a valid amount, a time, a category for an
// expense or income (CAT1), the loan an EMI pays, an account for money that moves, a destination for a
// transfer or investment (never the same account twice), the investment account matrix, a payment mode
// only the paying account uses, and an edit as a patch over the row it opened (W4c, D18).
// A NEW Loan / EMI entry is not a plain upsert: it comes back as `loan` and is paid through payLoan.
import { FEATURES } from '../config/features';
import { parseAmount } from './amountInput';
import { normalizeTimeInput } from './format';
import { editPatch } from './txnEdit';
import { ACCOUNT_REQUIRED_TYPES } from './accounts';
import type { Member, PaymentMode, Recurrence, Transaction, TxnType } from '../types';

export interface TxnFormInput {
  type: TxnType;
  amount: string;
  currency: string;
  date: string;
  time: string;
  description: string;
  category: string;
  note: string;
  memberId: string;
  /** The paying (expense, transfer, investment buy) or receiving (income) account, as the picker encodes it. */
  paymentMethod: string;
  /** Transfer: the destination account. Investment: the asset. */
  paymentMethodTo: string;
  paymentMode: PaymentMode | '';
  direction: 'added' | 'withdrew';
  linkedDebtId: string;
  recurring: Recurrence | '';
  excluded: boolean;
}

export interface TxnBuildContext {
  /** The row being edited, or null for a new one. */
  initial: Transaction | null;
  /** The modes the paying account is used with ([] when unknown). */
  payingModes: readonly PaymentMode[];
  newId: () => string;
}

export interface LoanPaymentDraft {
  debtId: string;
  fundingAccountId?: string;
  amount: number;
  date: string;
  description?: string;
  memberId: string;
}

export type TxnBuildResult =
  | { ok: false; error: string; field?: 'amount' | 'category' | 'account' | 'destination' | 'loan' | 'time' }
  | { ok: true; txn: Transaction; amount: number; loan?: LoanPaymentDraft };

export function buildTxn(form: TxnFormInput, ctx: TxnBuildContext): TxnBuildResult {
  const { initial, payingModes } = ctx;
  const isTransfer = form.type === 'transfer';
  const isInvestment = form.type === 'investment';
  const needsToAccount = isTransfer || isInvestment;
  const isWithdraw = isInvestment && form.direction === 'withdrew';
  const accountRequired = ACCOUNT_REQUIRED_TYPES.includes(form.type as (typeof ACCOUNT_REQUIRED_TYPES)[number]);

  const amount = parseAmount(form.amount);
  if (isNaN(amount) || amount <= 0) return { ok: false, error: 'Enter a valid amount greater than 0', field: 'amount' };
  // v9 F-VALIDATION — block save only on missing REQUIRED-primary fields.
  // Description and member are 'More details' fields, never required.
  if (!FEATURES.txnRedesign.enabled && !isTransfer && !form.description.trim()) {
    return { ok: false, error: 'Description is required' };
  }
  const normalizedTime = normalizeTimeInput(form.time);
  if (!normalizedTime) return { ok: false, error: 'Pick a time for this transaction', field: 'time' };
  if (!FEATURES.txnRedesign.enabled && !isTransfer && !form.memberId) {
    return { ok: false, error: 'Choose a member for this transaction' };
  }
  // CAT1 — an expense or income needs a category: a pick or an accepted suggestion.
  if (!isTransfer && !isInvestment && !form.category) return { ok: false, error: 'Choose a category', field: 'category' };
  // v9 §4.1 — loan_emi requires the linked loan (the system split needs it).
  if (FEATURES.txnRedesign.enabled && form.type === 'expense'
      && form.category === 'loan_emi' && !form.linkedDebtId) {
    return { ok: false, error: 'Choose which loan this EMI pays', field: 'loan' };
  }
  // ── Account required for money that moves in/out of an account ──
  if (accountRequired && !form.paymentMethod) {
    return { ok: false, error: 'Choose an Account (cash, bank or card) for this transaction', field: 'account' };
  }
  // v7.0.3 — transfer + investment require a destination account too.
  if (needsToAccount && !form.paymentMethodTo) {
    return { ok: false, error: isTransfer ? 'Choose a destination Account' : 'Choose an Investment Vehicle', field: 'destination' };
  }
  if (needsToAccount && form.paymentMethod && form.paymentMethodTo === form.paymentMethod) {
    return { ok: false, error: 'Source and destination must be different accounts', field: 'destination' };
  }

  // Splits are authored in the standalone Split form (v10.16); a plain
  // transaction never carries a `split`.
  // v9 §4.3 — investment direction maps the account matrix:
  //   'added'    → from = cash side (paymentMethod), to = investment account
  //   'withdrew' → from = investment account,        to = cash side
  const swap = isInvestment && form.direction === 'withdrew';
  const fromEncoded = swap ? form.paymentMethodTo : form.paymentMethod;
  const toEncoded   = swap ? form.paymentMethod   : form.paymentMethodTo;
  // W4c (D18) — an edit is a patch over the opened row: what this form does not show (the
  // schedule or loan it came from, its provenance) is kept, never silently dropped.
  const txn: Transaction = editPatch(initial, {
    id: initial?.id ?? ctx.newId(),
    type: form.type,
    amount,
    currency: form.currency,
    date: form.date,
    time: normalizedTime,
    description: form.description.trim(),
    // transfer-class rows carry no category ('' → null at the adapter).
    category: (isTransfer || isInvestment) ? '' : form.category,
    note: form.note.trim() || undefined,
    memberId: form.memberId,
    // v10.26.0 (R4) — an investment names the asset plus ONE account: the
    // paying account for a buy, the receiving account for a withdrawal.
    paymentMethod: isInvestment ? (isWithdraw ? undefined : form.paymentMethod || undefined) : (fromEncoded || undefined),
    ...(isInvestment ? {
      assetId: form.paymentMethodTo || undefined,
      accountId: undefined,
      toAccountId: isWithdraw ? form.paymentMethod || undefined : undefined,
    } : {}),
    // v10.25.0 — undefined when the account's modes are unknown, so an edit
    // never erases a stored mode it could not display.
    // An investment only ever CLEARS a mode it already had — sending null on
    // every investment would name a column a lagging schema does not have yet.
    paymentMode: isInvestment ? (initial?.paymentMode ? null : undefined)
      : payingModes.length ? (form.paymentMode || null) : undefined,
    recurring: form.recurring || undefined,
    excluded: form.excluded || undefined,
    linkedToAssetId: isInvestment ? undefined : needsToAccount ? toEncoded || undefined : initial?.linkedToAssetId,
    linkedDebtId: (form.category === 'loan_emi' ? form.linkedDebtId : undefined) ?? initial?.linkedDebtId,
    linkedTxnId:   initial?.linkedTxnId,
    // Audit F7 — carry the read version through the edit so the store can
    // pass it as the optimistic-concurrency precondition. Without this the
    // edit fell back to last-write-wins.
    updated_at:    initial?.updated_at,
  } as Transaction);

  // Audit F2 — a NEW loan EMI is an explicit financial command, not a generic upsert. W4f (D19): the
  // SERVER computes the split (pay_loan: interest first, then principal, for the instalment due).
  const loan = !initial && form.category === 'loan_emi' && form.linkedDebtId
    ? {
        debtId: form.linkedDebtId,
        fundingAccountId: fromEncoded || undefined,
        amount,
        date: form.date,
        description: form.description.trim() || undefined,
        memberId: form.memberId,
      }
    : undefined;
  return { ok: true, txn, amount, ...(loan ? { loan } : {}) };
}

/** The member a new entry is attributed to: the signed-in person's member, else the profile name's,
 *  else the first member (the transaction form's rule). */
export function defaultMemberIdFor(members: readonly Member[], sessionUserId: string | undefined, profileName: string): string {
  if (sessionUserId) {
    const mine = members.find(m => m.userId === sessionUserId);
    if (mine) return mine.id;
  }
  if (profileName) {
    const byName = members.find(m => m.name.trim().toLowerCase() === profileName.trim().toLowerCase());
    if (byName) return byName.id;
  }
  return members[0]?.id ?? '';
}

/** A plain new expense or income deletes cleanly, so its toast offers Undo; system-split rows do not. */
export function undoableNewTxn(initial: Transaction | null, type: TxnType, category: string): boolean {
  return !initial && (type === 'expense' || type === 'income') && category !== 'loan_emi';
}
