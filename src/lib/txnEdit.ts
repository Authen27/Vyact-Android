// W4c (v10.72.0; owner decision D18; audit INT-TXN-01, FE-UIC-01) — an edit is a PATCH over the row
// it opened.
//
// Both entry forms used to rebuild the transaction from their own fields alone, so anything a form
// does not show was dropped on every save: the split on a split row (the shares and who had paid,
// gone after one edit in the plain form), the link to the recurring schedule that posted it, the
// loan it paid, its provenance (estimated vs confirmed), and in the Split form even the version the
// store sends as the edit's precondition. A form now owns only its own fields; the rest of the row
// rides through unchanged.
import type { Transaction } from '../types';

/**
 * The row an edit saves: the opened row, with the form's fields on top. The stored account ids are
 * cleared first, because the store derives them from the form's account (`paymentMethod` /
 * `linkedToAssetId`) and a stored id would otherwise win over the one just picked. A form that
 * owns an account id (an investment names it) sets it explicitly, and that wins.
 */
export function editPatch(initial: Transaction | null | undefined, built: Transaction): Transaction {
  if (!initial) return built;
  return { ...initial, accountId: undefined, toAccountId: undefined, ...built };
}

/** A split row is edited in the Split form, never the plain one (which would not show the shares). */
export const isSplitRow = (t: Pick<Transaction, 'split'> | null | undefined): boolean => Boolean(t?.split?.isSplit);
