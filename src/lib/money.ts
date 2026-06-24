// Vyact money primitives — the dinero.js v2 boundary layer.
//
// TD-01 (decimal money) is being rolled out in phases. This module is the
// foundation: every later phase migrates one more file from JS-number
// arithmetic to dinero-mediated math. For phase A this module is consumed
// only by format.ts:convert() so the FX boundary stops drifting.
//
// Rationale for the chosen representation:
//   • dinero.js v2 is currency-aware (handles JPY=0 decimals + BHD=3
//     decimals natively alongside USD=2); banker's rounding built-in;
//     immutable; tree-shakeable; small.
//   • We DO NOT change any existing public signatures in this phase —
//     functions still accept and return JS `number` in major units. The
//     gain in phase A is that *inside* the conversion, the math is exact
//     integer cents with explicit banker's rounding at the FX boundary,
//     instead of `(amount / rFrom) * rTo` chained on float.
//
// See docs/TEST_SCENARIOS.md (`CON-UNIT-006`) for the characterization
// test that pinned the pre-TD-01 lossy behaviour, now flipped to assert
// the fixed behaviour.

import { dinero, toSnapshot, convert as dineroConvert, add, type Dinero, type DineroCurrency } from 'dinero.js';
import {
  USD, EUR, GBP, INR, JPY, AUD, CAD, CHF, CNY, AED, SGD, BRL,
} from '@dinero.js/currencies';

/**
 * Registry of every currency the consumer app supports.
 *
 * Keys mirror CURRENCIES in constants.ts and the DEFAULT_RATES table.
 * If a new currency is added there, register it here too (and add it to
 * the @dinero.js/currencies import above). The CON-UNIT-040 test pins
 * this contract.
 */
export const CURRENCY_REGISTRY: Record<string, DineroCurrency<number>> = {
  USD, EUR, GBP, INR, JPY, AUD, CAD, CHF, CNY, AED, SGD, BRL,
};

/**
 * Look up a Currency definition by code. Unknown codes fall back to USD,
 * matching the documented behaviour of format.ts's prior `convert()`
 * (rate-defaults-to-1, currency-treated-as-USD) so existing call sites
 * see no behaviour regression beyond exactness.
 */
export function currencyOf(code: string): DineroCurrency<number> {
  return CURRENCY_REGISTRY[code] ?? USD;
}

/**
 * Convert a JS-number amount in **major units** (dollars, euros, etc.) to a
 * Dinero object in that currency's **minor units** (cents, pence, sen).
 *
 * Rounds to the currency's exponent using JavaScript's default rounding
 * (Math.round, half-away-from-zero) — this is acceptable because the
 * input is already a major-unit number and the only reason it might have
 * sub-minor digits is float imprecision arriving at the boundary. The
 * exact-math regime begins inside dinero.
 */
export function toDinero(amount: number, code: string): Dinero<number> {
  const currency = currencyOf(code);
  const scale = Math.pow(currency.base as number, currency.exponent);
  const scaledAmount = Math.round((amount || 0) * scale);
  return dinero({ amount: scaledAmount, currency });
}

/**
 * Convert a Dinero object back to a JS-number amount in major units.
 *
 * Uses the snapshot's scale (which may be larger than the currency's
 * native exponent after a conversion that introduced higher precision)
 * so no information is dropped at this edge.
 */
export function fromDinero(d: Dinero<number>): number {
  const { amount, scale } = toSnapshot(d);
  return amount / Math.pow(10, scale);
}

/**
 * Express a JS-number rate (e.g. 0.92 from the rate table) as the
 * `{ amount, scale }` shape that dinero's `convert` expects. Higher
 * scale = more rate precision preserved across the conversion.
 *
 * Scale 10 gives ~10 decimal digits of rate precision — well below
 * Number.MAX_SAFE_INTEGER (≈ 9.0e15) for any realistic FX rate.
 */
function rateToScaled(rate: number, scale = 10): { amount: number; scale: number } {
  return { amount: Math.round(rate * Math.pow(10, scale)), scale };
}

/**
 * Banker's rounding (round-half-to-even). dinero's `convert` returns a
 * Dinero whose scale equals (source scale + rate scale), so a USD→EUR
 * conversion at rate-scale 10 leaves a scale-12 Dinero — i.e. money with
 * sub-cent precision that's meaningless to humans and corrosive on
 * subsequent operations. We re-quantise to the target currency's native
 * exponent here, using banker's rounding so chained conversions are not
 * biased upward or downward.
 */
function bankersRound(n: number): number {
  const trunc = Math.trunc(n);
  const frac = n - trunc;
  // Half-to-even only at exact .5; otherwise Math.round is correct.
  if (frac === 0.5)  return trunc % 2 === 0 ? trunc : trunc + 1;
  if (frac === -0.5) return trunc % 2 === 0 ? trunc : trunc - 1;
  return Math.round(n);
}

function quantizeToCurrency(d: Dinero<number>): Dinero<number> {
  const snap = toSnapshot(d);
  const native = snap.currency.exponent as number;
  if (snap.scale <= native) return d;
  const factor = Math.pow(10, snap.scale - native);
  const requantized = bankersRound(snap.amount / factor);
  return dinero({ amount: requantized, currency: snap.currency });
}

/**
 * Convert a Dinero amount across currencies using the FinFlow rate table
 * (rates expressed *per USD*, matching DEFAULT_RATES in constants.ts).
 *
 * Implementation: two-step through USD, exactly matching the legacy
 * `(amount / rFrom) * rTo` semantics. Each dinero conversion preserves
 * full precision internally; the final result is re-quantised to the
 * target currency's native exponent with banker's rounding so a JS-number
 * caller sees a value that round-trips cleanly through future operations.
 * No-ops if source and target are the same currency.
 */
export function convertViaUsdRates(
  d: Dinero<number>,
  toCode: string,
  rates: Record<string, number>,
): Dinero<number> {
  const fromCode = toSnapshot(d).currency.code;
  if (fromCode === toCode) return d;

  // Step 1: from → USD (multiplier = 1 / rates[fromCode]).
  const dUsd = fromCode === 'USD'
    ? d
    : quantizeToCurrency(
        dineroConvert(d, USD, { USD: rateToScaled(1 / (rates[fromCode] ?? 1)) }),
      );

  // Step 2: USD → to (multiplier = rates[toCode]).
  if (toCode === 'USD') return dUsd;
  const target = currencyOf(toCode);
  // Key the rates object by the *resolved* currency code (target.code), not
  // the caller-supplied toCode — these only differ when toCode is unknown
  // and falls back to USD, in which case the rates lookup must also use
  // 'USD' to satisfy dinero's "rates[targetCurrency.code]" contract.
  return quantizeToCurrency(
    dineroConvert(dUsd, target, { [target.code]: rateToScaled(rates[toCode] ?? 1) }),
  );
}

/**
 * Re-export of dinero's `add` so consumers don't have to import the
 * library directly. Used by aggregators in `calculations.ts` that need
 * to fold many amounts together without falling back to float `+`.
 */
export { add as addDinero };

/**
 * A zero-valued Dinero in the given currency, suitable as a `reduce`
 * initial accumulator. Centralised here so future changes to the
 * currency-of-zero contract (e.g. carrying a higher scale to retain
 * sub-minor precision through long sums) happen in one place.
 */
export function dineroZero(code: string): Dinero<number> {
  return dinero({ amount: 0, currency: currencyOf(code) });
}

/**
 * Fold an iterable of items into a single Dinero in the target currency.
 *
 * `getDinero` maps each item to a Dinero (responsible for any per-item
 * FX). All addition happens in dinero space — integer arithmetic in the
 * target currency's minor units — so no float drift can accumulate
 * across the reduction, no matter how many items are summed. This is
 * the load-bearing helper of TD-01 phase B.
 */
export function sumDinero<T>(items: readonly T[], getDinero: (t: T) => Dinero<number>, baseCode: string): Dinero<number> {
  let acc = dineroZero(baseCode);
  for (const it of items) acc = add(acc, getDinero(it));
  return acc;
}

/**
 * Parse a money value as it arrives from the Supabase cloud boundary.
 *
 * TD-01 phase D: Postgres `numeric(15,2)` columns are serialised by
 * Supabase as JSON **strings** (because JS Number loses precision past
 * 2^53). The previous row mappers did a blanket `Number(r.amount)`,
 * which works in practice for amounts < $9e13 but offers no defence
 * against bad input (NaN, undefined, malformed strings). This helper:
 *
 *   • accepts string ("100.10"), number, or null/undefined,
 *   • returns 0 for null / undefined / empty / NaN inputs (matching the
 *     previous behaviour of `Number(null) === 0`),
 *   • centralises the boundary so a future PR can replace `number` with
 *     a `Money` opaque type in one place rather than every mapper.
 *
 * No exact-decimal guarantee is made here yet — that requires a Money
 * type change end-to-end. The math layer (calculations / amortization)
 * is what eliminates drift today; this is the defensive entry door.
 */
export function parseMoneyFromCloud(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
