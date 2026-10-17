// Currency formatting · date formatting · misc
import type { Transaction } from '../types';
import { CURRENCIES } from '../constants';
import { toDinero, fromDinero, convertViaUsdRates } from './money';

// ── "Today" is a LOCAL calendar day (W3a, v10.65.0; audit INT-TZC-03, INT-PAR-04; owner decision D12).
// In the app it is the DEVICE's day; on the server the engine passes the HOUSEHOLD's zone (`tz`).
// It used to be the UTC day, so between 00:00 and 05:30 in India an entry, a due bill and "this
// month" all landed on yesterday. Date-only ARITHMETIC stays in UTC (`addDaysISO`): it works on the
// string, so the device's zone and daylight saving never move it.

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The calendar date (YYYY-MM-DD) of an instant in `tz`, or in the device's zone when `tz` is absent or unknown. */
export function dateKeyIn(at: Date, tz?: string | null): string {
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(at);
      const part = (type: string) => parts.find(p => p.type === type)?.value ?? '';
      return `${part('year')}-${part('month')}-${part('day')}`;
    } catch { /* an unknown zone name: use the device's day, as the app does */ }
  }
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
}

/** Today's date (YYYY-MM-DD): the device's day, or the given zone's (the household's, on the server). */
export const today = (tz?: string | null): string => dateKeyIn(new Date(), tz);

/**
 * "Now" for code that reads getDate()/getMonth()/setHours(): a Date whose LOCAL getters show the wall
 * clock in `tz`. Without `tz` it is just `new Date()` (the device's clock). On the server, where the
 * host runs in UTC, this is how the engine reads the household's day without any global state.
 */
export function wallClock(tz?: string | null, at: Date = new Date()): Date {
  if (!tz) return new Date(at.getTime());
  try {
    const p: Record<string, string> = {};
    for (const x of new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(at)) p[x.type] = x.value;
    return new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second, at.getMilliseconds());
  } catch {
    return new Date(at.getTime());
  }
}

/**
 * The local calendar day of an instant (the device's, or `tz`'s) as a UTC-midnight Date, for date-only
 * arithmetic that reads UTC getters. Reading getUTCDate() on the raw instant gives the UTC day instead.
 */
export function localDayUTC(at: Date = new Date(), tz?: string | null): Date {
  const [y, m, d] = dateKeyIn(at, tz).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Date-only arithmetic on a YYYY-MM-DD string, in UTC so no zone or DST change can move it. */
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
export const nowTime = (): string => {
  const current = new Date();
  return `${String(current.getHours()).padStart(2, '0')}:${String(current.getMinutes()).padStart(2, '0')}`;
};

export function normalizeTimeInput(input?: string | null): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;

  const meridiemMatch = raw.match(/\s*(am|pm)$/i);
  const meridiem = meridiemMatch?.[1]?.toUpperCase() as 'AM' | 'PM' | undefined;
  const core = meridiemMatch ? raw.slice(0, meridiemMatch.index).trim() : raw;

  let hours: string;
  let minutes: string;

  if (/^\d{1,2}:\d{1,2}$/.test(core)) {
    [hours, minutes] = core.split(':');
  } else if (/^\d{3,4}$/.test(core)) {
    hours = core.slice(0, core.length - 2);
    minutes = core.slice(-2);
  } else {
    return null;
  }

  let hh = Number(hours);
  const mm = Number(minutes);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (meridiem) {
    if (hh < 1 || hh > 12) return null;
    hh %= 12;
    if (meridiem === 'PM') hh += 12;
  } else if (hh < 0 || hh > 23) {
    return null;
  }
  if (mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// IDs must be valid UUIDs: the cloud schema's primary-key columns are `uuid`,
// so a non-UUID id (the old Date.toString(36)+Math.random() scheme) made every
// locally-created record fail to sync to Supabase with `22P02 invalid input
// syntax for type uuid`. crypto.randomUUID() is available in all modern
// browsers in a secure context (incl. localhost); the manual fallback covers
// the rare non-secure / old-runtime case and is still RFC-4122 v4 shaped.
export const uid = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  // RFC-4122 v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};
export const escHtml = (s: string): string =>
  String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
export const getMonthKey = (d: string): string => d.slice(0, 7);
/** This month (YYYY-MM): the device's, or the given zone's (W3a — it used to be the UTC month). */
export const nowMonthKey = (tz?: string | null): string => today(tz).slice(0, 7);

/**
 * When the MONEY MOVED: the transaction's own date, plus an explicit time if the
 * user gave one.
 *
 * 🔴 `created_at` is deliberately NOT consulted here (v10.20.8). It used to be
 * the second choice, ahead of the date, so any row without a `time` sorted by
 * WHEN IT WAS WRITTEN rather than when it happened. That is wrong for a ledger
 * and it broke "recent transactions" the moment rows started carrying
 * `created_at`: three Salary rows written in one catch-up batch sorted above a
 * transaction dated a month later, so July's salary appeared above September's
 * rent.
 *
 * The bug was invisible while rows came from the local cache, which does not set
 * `created_at`; clearing that cache in v10.20.7 made every row cloud-sourced and
 * exposed it. `created_at` still breaks ties — see `compareTxnRecency`.
 */
export function transactionSortValue(txn: Pick<Transaction, 'date' | 'time' | 'created_at'>): number {
  const normalizedTime = normalizeTimeInput(txn.time);
  if (txn.date && normalizedTime) {
    const explicit = Date.parse(`${txn.date}T${normalizedTime}:00`);
    if (!Number.isNaN(explicit)) return explicit;
  }
  const fallback = Date.parse(`${txn.date}T00:00:00`);
  return Number.isNaN(fallback) ? 0 : fallback;
}

/**
 * Newest-first ordering for a transaction list. Total and deterministic:
 *
 *   1. when the money moved (date, + time when given)
 *   2. `created_at` — only ever a TIE-BREAK, so two rows on the same day appear
 *      in the order they were entered
 *   3. `id`, so the order can never depend on array position
 *
 * Every list that shows transactions newest-first must use this. Two call sites
 * previously inlined step 1 and step 3 and skipped step 2.
 */
export function compareTxnRecency(
  a: Pick<Transaction, 'id' | 'date' | 'time' | 'created_at'>,
  b: Pick<Transaction, 'id' | 'date' | 'time' | 'created_at'>,
): number {
  const byMoment = transactionSortValue(b) - transactionSortValue(a);
  if (byMoment) return byMoment;
  const ac = a.created_at ? Date.parse(a.created_at) : NaN;
  const bc = b.created_at ? Date.parse(b.created_at) : NaN;
  if (!Number.isNaN(ac) && !Number.isNaN(bc) && bc !== ac) return bc - ac;
  return b.id.localeCompare(a.id);
}

export function formatTime(time?: string): string {
  return normalizeTimeInput(time) ?? '';
}

export function monthName(key: string): string {
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: 'short', year: 'numeric' });
}

/** Whole days from today (local) to a YYYY-MM-DD date: 0 = today, 1 = tomorrow, −1 = yesterday. */
export function daysUntil(dateStr?: string, tz?: string | null): number | null {
  if (!dateStr) return null;
  const at = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((at(dateStr) - at(today(tz))) / 86400000);
}

/**
 * Multi-currency conversion using a USD-base rate table.
 *
 * TD-01 phase A: this function previously did `(amount / rFrom) * rTo` on
 * raw JS floats, which drifted across round-trips and across aggregations.
 * It now routes the math through dinero.js — the input/output signature is
 * unchanged (number → number, major units) so no caller needs to change,
 * but the conversion itself is exact integer arithmetic with banker's
 * rounding at the FX boundary. See `react/src/lib/money.ts` for the
 * dinero plumbing and `CON-UNIT-006` for the regression test that pins
 * the fixed behaviour.
 */
/**
 * Face value (W3b, v10.66.0): one currency per household, never converted — the amount comes back
 * unchanged, re-rounded to the target currency's minor unit. `rates` is ignored (TD-45).
 * @deprecated There is nothing to convert; new code should use the amount as it is.
 */
export function convert(amount: number, from: string, to: string, _rates?: Record<string, number>): number {
  if (!amount || from === to) return amount;
  return fromDinero(convertViaUsdRates(toDinero(amount, from), to));
}

export function fmt(amount: number, currency = 'USD'): string {
  const cur = CURRENCIES[currency] ?? CURRENCIES.USD;
  const n = Math.abs(amount || 0);
  // Show fractional digits only when the value actually has one — a whole amount
  // renders without a trailing ".00" (cleaner, and stops 2-decimal strings from
  // overflowing tight KPI tiles). Round to the currency's precision first so
  // float dust (e.g. 16000.0000003) doesn't force spurious decimals.
  const factor = 10 ** cur.decimals;
  const hasFraction = Math.round(n * factor) % factor !== 0;
  const digits = hasFraction ? cur.decimals : 0;
  try {
    return new Intl.NumberFormat(cur.locale, {
      style: 'currency', currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return cur.symbol + n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
}

export type NumberSystem = 'western' | 'indian';

/** v7.4.0 — module-scope number-system selection. The store calls
 *  `setNumberSystem` whenever the active profile changes so that
 *  non-React utilities (Money component, fmt-short usages in tooltips)
 *  pick up the user's choice without prop-drilling. Defaults to western. */
let _numberSystem: NumberSystem = 'western';
export function setNumberSystem(s: NumberSystem) { _numberSystem = s; }
export function getNumberSystem(): NumberSystem { return _numberSystem; }

export function fmtShort(amount: number, currency = 'USD', system?: NumberSystem): string {
  const cur = CURRENCIES[currency] ?? CURRENCIES.USD;
  const sys = system ?? _numberSystem;
  const n = Math.abs(amount || 0);
  const fix = (v: number) => v.toFixed(v >= 100 ? 0 : 1).replace(/\.0$/, '');
  if (sys === 'indian') {
    if (n >= 1_00_00_000) return cur.symbol + fix(n / 1_00_00_000) + 'Cr'; // 10M
    if (n >= 1_00_000)    return cur.symbol + fix(n / 1_00_000) + 'L';      // 100K
    if (n >= 1_000)       return cur.symbol + fix(n / 1_000) + 'K';
    return cur.symbol + n.toLocaleString(cur.locale, { maximumFractionDigits: 0 });
  }
  if (n >= 1_000_000_000_000) return cur.symbol + fix(n / 1_000_000_000_000) + 'T';
  if (n >= 1_000_000_000)     return cur.symbol + fix(n / 1_000_000_000) + 'B';
  if (n >= 1_000_000)         return cur.symbol + fix(n / 1_000_000) + 'M';
  if (n >= 1_000)             return cur.symbol + fix(n / 1_000) + 'K';
  return cur.symbol + n.toLocaleString(cur.locale, { maximumFractionDigits: 0 });
}

export const fmtSigned = (n: number, currency = 'USD'): string =>
  (n >= 0 ? '+' : '−') + fmt(Math.abs(n), currency);

/**
 * W4d (audit FE-UIC-04, INT-TZC-06) — a figure that can cross zero: a balance, a net, net worth, a
 * chart axis. `fmt` and `fmtShort` print the magnitude only (they take Math.abs), so an overdrawn
 * bank read "₹5,000" beside a "−₹5,000" from <Money> on the same screen. These keep the minus and
 * add nothing to a positive figure.
 */
export const fmtNet = (n: number, currency = 'USD'): string =>
  ((n || 0) < 0 ? '−' : '') + fmt(n, currency);
export const fmtShortNet = (n: number, currency = 'USD', system?: NumberSystem): string =>
  ((n || 0) < 0 ? '−' : '') + fmtShort(n, currency, system);

export function formatDate(dateStr: string, format: 'us' | 'eu' | 'iso' = 'us'): string {
  if (!dateStr) return '';
  if (format === 'iso') return dateStr;
  const d = new Date(dateStr + 'T12:00:00');
  if (format === 'eu') return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}
