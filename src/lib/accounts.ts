// Vyact v6.4.6 — Linked spending accounts.
//
// A user's real money sources are the accounts they already track in Net Worth:
//   • bank/cash assets   (asset types: cash, checking, savings)
//   • credit cards       (debt type: credit_card)
// Plus a generic "Cash" fallback so a brand-new household can still record money.
//
// Transactions reference an account via `paymentMethod`, encoded as:
//   'cash'            → generic cash
//   'asset:<uuid>'    → a bank/cash asset in Net Worth
//   'debt:<uuid>'     → a credit card in Net Worth
//
// Legacy values (the old PAYMENT_METHODS keys like 'visa') still resolve through
// the PAYMENT_METHODS table for display, so historical data is never lost.

import type { Asset, Debt, Account } from '../types';
import { PAYMENT_METHODS } from '../constants';

export type AccountKind = 'cash' | 'bank' | 'card';

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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '••';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Build the list of accounts a user can spend from / receive into. */
export function buildAccounts(
  assets: Asset[],
  debts: Debt[],
  opts: { excludeId?: string; filter?: (a: AccountOption) => boolean } = {},
): AccountOption[] {
  const out: AccountOption[] = [
    { value: 'cash', label: 'Cash', abbr: '$', color: CASH_COLOR, kind: 'cash' },
  ];

  for (const a of assets) {
    if (!BANK_ASSET_TYPES.includes(a.type as (typeof BANK_ASSET_TYPES)[number])) continue;
    // A dedicated cash asset folds into generic Cash to avoid two "Cash" rows.
    if (a.type === 'cash') continue;
    out.push({
      value: `asset:${a.id}`,
      label: a.name,
      abbr: initials(a.name),
      color: BANK_COLOR,
      kind: 'bank',
    });
  }

  for (const d of debts) {
    if (d.type !== 'credit_card') continue;
    out.push({
      value: `debt:${d.id}`,
      label: d.name,
      abbr: initials(d.name),
      color: CARD_COLOR,
      kind: 'card',
    });
  }

  let result = out;
  if (opts.excludeId) result = result.filter(a => a.value !== opts.excludeId);
  if (opts.filter) result = result.filter(opts.filter);
  return result;
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

/** Transaction types that must be tied to a real account (cash or linked). */
export const ACCOUNT_REQUIRED_TYPES = ['expense', 'income', 'transfer'] as const;

// ── v7.1.2 — first-class accounts (Money Map) ────────────────────────────
//
// When the Money Map flag is `'shadow'` or `'on'` AND the household has
// real `accounts` rows (post-Phase-1 backfill), the picker should source
// options from the canonical accounts table rather than re-deriving them
// from assets+debts. The legacy `buildAccounts(assets, debts)` path stays
// untouched for the off / pre-backfill case so nothing regresses.

function kindToOption(kind: Account['kind']): { color: string; abbr: string; kind: AccountKind } {
  if (kind === 'credit_card') return { color: CARD_COLOR, abbr: 'CC', kind: 'card' };
  if (kind === 'cash')        return { color: CASH_COLOR, abbr: '$',  kind: 'cash' };
  return { color: BANK_COLOR, abbr: '••', kind: 'bank' };
}

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
      // The Phase 1 backfill links credit-card accounts to debts via
      // assetId === debt.id (one-to-one). When `assetId` is null (a user-
      // created card with no debt yet) fall back to the account id itself.
      value = `debt:${acc.assetId || acc.id}`;
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
