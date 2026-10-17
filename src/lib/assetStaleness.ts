// Net Worth — when a hand-valued asset's figure is old enough to ask for an update.
//
// Only rows the user types a value into can go stale. Account-sourced rows are computed from the
// ledger on every render, and long-term holdings (property, vehicles, retirement) are valued rarely
// by design, so neither is ever flagged. The rule is the one the page has used since the Board D3
// chip: a cash-like or short-term asset whose value is more than 30 days old, or was never dated.
//
// 16 Oct 2026 (owner): the page used to ALSO raise a toast on every visit ("Some bank or card
// balances haven't been updated…"). It named the wrong things (bank and card balances can't go stale)
// and repeated itself with nothing to act on, so it was removed. The inline chip on the row is the
// one place this is shown, and it now says how old the value is.

import { ASSET_TYPES } from '../constants';
import type { Asset } from '../types';

export const STALE_AFTER_DAYS = 30;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Jun", or "14 Jun 2025" when the year differs from `now`'s. Reads the stored local day
 *  (YYYY-MM-DD) directly, so no time zone can move it to the day before. */
export function valueDateLabel(lastUpdated: string, now: Date = new Date()): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(lastUpdated);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const base = `${day} ${MONTHS[month - 1]}`;
  return year === now.getFullYear() ? base : `${base} ${year}`;
}

/** Whether this hand-valued asset should carry the "update" chip. */
export function isAssetValueStale(asset: Pick<Asset, 'type' | 'lastUpdated'>, now: number = Date.now()): boolean {
  const kind = ASSET_TYPES[asset.type]?.liquidity;
  if (kind !== 'liquid' && kind !== 'short') return false;
  if (!asset.lastUpdated) return true;
  return (now - new Date(asset.lastUpdated).getTime()) / (1000 * 60 * 60 * 24) > STALE_AFTER_DAYS;
}
