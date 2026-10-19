// Vyact v6.4.6 — Linked spending accounts.
//
// A user's real money sources are the accounts they already track in Net Worth:
//   • bank/cash assets   (asset types: cash, checking, savings)
//   • credit cards       (debt type: credit_card)
// Plus a generic "Cash" fallback so a brand-new household can still record money.
//
// T5b (v10.121.0; audit XC-ARC-08) — the pickers read the household's ACCOUNTS (`buildAccountsFromStore`)
// in every build. The legacy `buildAccounts(assets, debts)` derivation is deleted: the retired Money Map
// flag still chose it in local-only builds, where a bank asset's option moved no account.
//
// Transactions reference an account via `paymentMethod`, encoded as:
//   'cash'            → generic cash
//   'asset:<uuid>'    → a bank/cash asset in Net Worth
//   'debt:<uuid>'     → a credit card in Net Worth
//
// Legacy values (the old PAYMENT_METHODS keys like 'visa') still resolve through
// the PAYMENT_METHODS table for display, so historical data is never lost.

import type { Asset, Debt, Account, Transaction } from '../types';
import { PAYMENT_METHODS } from '../constants';
import { accountValueOf } from './accountBalance';

// v10.17 — `investment` is distinguished so callers can wall investment
// accounts out of non-investment pickers (expense/income/transfer/split/debt).
export type AccountKind = 'cash' | 'bank' | 'card' | 'investment';

export interface AccountOption {
  value: string;          // paymentMethod string stored on the transaction
  label: string;          // human label for the dropdown
  abbr: string;           // short badge text
  color: string;          // badge colour
  kind: AccountKind;
}

/** Asset types that behave as spendable bank/cash accounts. */
export const BANK_ASSET_TYPES = ['cash', 'checking', 'savings'] as const;

const BANK_COLOR = '#4A6FA5'; // denim
const CASH_COLOR = '#85A88A'; // sage
const CARD_COLOR = '#6E4555'; // plum
const INVEST_COLOR = '#8A9A5B'; // olive

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '••';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Resolve any stored paymentMethod value to a displayable account, or null. */
export function resolveAccount(
  value: string | undefined,
  assets: Asset[],
  debts: Debt[],
): AccountOption | null {
  if (!value) return null;

  if (value === 'cash') {
    return { value, label: 'Cash', abbr: '$', color: CASH_COLOR, kind: 'cash' };
  }
  if (value.startsWith('asset:')) {
    const a = assets.find(x => x.id === value.slice(6));
    if (a) return { value, label: a.name, abbr: initials(a.name), color: BANK_COLOR, kind: 'bank' };
    return { value, label: 'Linked account', abbr: '••', color: BANK_COLOR, kind: 'bank' };
  }
  if (value.startsWith('debt:')) {
    const d = debts.find(x => x.id === value.slice(5));
    if (d) return { value, label: d.name, abbr: initials(d.name), color: CARD_COLOR, kind: 'card' };
    return { value, label: 'Credit card', abbr: 'CC', color: CARD_COLOR, kind: 'card' };
  }

  // Legacy PAYMENT_METHODS key (e.g. 'visa', 'amex', 'hdfc').
  const pm = PAYMENT_METHODS[value];
  if (pm) {
    return {
      value,
      label: pm.name,
      abbr: pm.abbr,
      color: pm.color,
      kind: pm.kind === 'card' ? 'card' : pm.kind === 'cash' ? 'cash' : 'bank',
    };
  }
  return null;
}

/** W8a (audit FE-UIC-05) — the account an edit form opens on, in the picker's encoding. The ledger reads
 *  the FK first (`debitAccountOf` / `creditAccountOf`), so the form must too: a row whose account was
 *  changed elsewhere (a WhatsApp correction, a reconcile) keeps a stale `paymentMethod`, and the form used
 *  to open on — and save back — that old account. */
export function editSeedAccount(
  t: Pick<Transaction, 'type' | 'accountId' | 'toAccountId' | 'paymentMethod'>,
  accounts: Account[],
): string {
  const fk = t.type === 'income' ? (t.toAccountId ?? t.accountId) : t.accountId;
  const acc = fk ? accounts.find(a => a.id === fk) : undefined;
  if (acc) return accountValueOf(acc);
  return t.paymentMethod ?? fk ?? '';
}

/** W7a (audit FE-UIC-16) — the account a transaction row names. The `accounts` FK wins: rows saved
 *  since Money Map carry `accountId` / `toAccountId` (or an account id in `paymentMethod`), which the
 *  legacy `asset:`/`debt:` resolver labelled "Linked account" or dropped. Transfers read "From → To";
 *  a multi-account payment names each account. Falls back to the legacy resolver for old rows. */
export function txnAccountLabel(
  t: Pick<Transaction, 'type' | 'paymentMethod' | 'accountId' | 'toAccountId' | 'accountSplits'>,
  accounts: Pick<Account, 'id' | 'name'>[],
  assets: Asset[],
  debts: Debt[],
): string | null {
  const name = (id?: string) => (id ? accounts.find(a => a.id === id)?.name : undefined);
  const splits = (t.accountSplits ?? []).map(s => name(s.accountId)).filter((n): n is string => !!n);
  if (splits.length > 1) return splits.join(' + ');
  if (t.type === 'transfer') {
    const from = name(t.accountId), to = name(t.toAccountId);
    if (from && to) return `${from} → ${to}`;
  }
  const fk = name(t.accountId) ?? name(t.toAccountId) ?? name(t.paymentMethod);
  if (fk) return fk;
  return t.paymentMethod ? resolveAccount(t.paymentMethod, assets, debts)?.label ?? null : null;
}

/** Transaction types that must be tied to a real account (cash or linked). */
export const ACCOUNT_REQUIRED_TYPES = ['expense', 'income', 'transfer'] as const;

// ── v7.1.2 — first-class accounts (Money Map) ────────────────────────────
//
// The picker sources its options from the canonical accounts table. Since T5b (v10.121.0) this is the
// only path: the Money Map flag and the assets + debts derivation are retired.

function kindToOption(kind: Account['kind']): { color: string; abbr: string; kind: AccountKind } {
  if (kind === 'credit_card') return { color: CARD_COLOR, abbr: 'CC', kind: 'card' };
  if (kind === 'cash')        return { color: CASH_COLOR, abbr: '$',  kind: 'cash' };
  if (kind === 'investment')  return { color: INVEST_COLOR, abbr: '📈', kind: 'investment' };
  return { color: BANK_COLOR, abbr: '••', kind: 'bank' };
}

/** v10.17 — predicate for pickers that must NOT offer investment accounts. */
export const notInvestment = (a: AccountOption) => a.kind !== 'investment';

/** Build the picker options from first-class `accounts`. The encoded `value`
 *  matches the legacy paymentMethod scheme so existing transactions still
 *  resolve: `cash` for the cash account (asset_id === legacy cash), else
 *  `asset:<id>` / `debt:<id>` keyed by `account.assetId` (or `account.id`
 *  as a final fallback for accounts the user creates directly post-backfill). */
export function buildAccountsFromStore(
  accounts: Account[],
  opts: { excludeId?: string; filter?: (a: AccountOption) => boolean } = {},
): AccountOption[] {
  const out: AccountOption[] = [];
  let hasCash = false;
  for (const acc of accounts) {
    if (acc.isArchived) continue;
    // v9 — loan accounts are system-only (EMI principal legs land there);
    // they are never a spend-from / deposit-to option.
    if (acc.kind === 'loan') continue;
    const meta = kindToOption(acc.kind);
    let value: string;
    if (acc.kind === 'cash') {
      if (hasCash) continue;
      hasCash = true;
      value = 'cash';
    } else if (acc.kind === 'credit_card') {
      // W4f (D30) — a card is an account; its picker value is exactly the ledger's own encoding
      // (accountValueOf), never an `assetId = debt.id` bridge, so the two can never disagree.
      value = accountValueOf(acc);
    } else {
      value = `asset:${acc.assetId || acc.id}`;
    }
    out.push({
      value,
      label: acc.name,
      abbr: acc.kind === 'cash' ? '$' : initials(acc.name),
      color: meta.color,
      kind: meta.kind,
    });
  }
  if (!hasCash) {
    out.unshift({ value: 'cash', label: 'Cash', abbr: '$', color: CASH_COLOR, kind: 'cash' });
  }
  let result = out;
  if (opts.excludeId) result = result.filter(a => a.value !== opts.excludeId);
  if (opts.filter) result = result.filter(opts.filter);
  return result;
}
