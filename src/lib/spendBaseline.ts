// Track E, E4 (v10.98.0; owner decisions 13–14 Oct 2026, E-5 and E-9) — THE spending baseline.
//
// Every "typical month" figure reads this one function: Pip's cover, runway and safety floor, the
// Net Worth tile and the Reports runway. Before it there were two definitions (audit FE-MNY-10):
// Pip and Net Worth averaged up to 6 months that held ANY row, with the fixed need/want map and
// unmapped categories counted as essential, while Reports averaged 3 months with spending, with the
// live map. The same household got two answers to one question.
//
// The rule (E-5, the Reports rule):
//   • the last BASELINE_MONTHS COMPLETED calendar months that contain spending (`spendRows`, so a
//     loan payment counts in full, Track E); the current month is never in it;
//   • essential = spending in categories the LIVE map classifies `need` (the database rows over
//     NEEDS_WANTS_MAP, so an admin override applies); an unmapped category is NOT essential;
//   • with no completed month, the current month stands in and says so (`partialMonthOnly`).
//
// Months of cover (E-9) are ONE helper, `monthsOfCover`, so every screen that shows a figure shows
// the same one: "at your usual spending" (÷ averageMonthly) and "on essentials only" (÷ averageEssential).
//
// Pure: no store, no browser API, no Supabase client (it is bundled into the server engine).
import type { ExchangeRates, Transaction } from '../types';
import { NEEDS_WANTS_MAP } from '../constants';
import { effectiveAmount, spendByCategory, spendRows } from './calculations';
import { getMonthKey, today } from './format';

export const BASELINE_MONTHS = 3;

export type NeedWant = 'need' | 'want';
export type ClassificationMap = Record<string, NeedWant>;

/** The live need/want map: NEEDS_WANTS_MAP with the `category_classifications` rows over it. */
export function classificationMap(rows?: readonly { category: string; classification: string }[] | null): ClassificationMap {
  const map: ClassificationMap = { ...NEEDS_WANTS_MAP };
  for (const row of rows ?? []) {
    if (row.classification === 'need' || row.classification === 'want') map[row.category] = row.classification;
  }
  return map;
}

export interface SpendBaseline {
  /** The completed months the averages rest on, ascending ('YYYY-MM'); empty when only the current month exists. */
  months: string[];
  /** True when the figures come from the current, still-incomplete month. */
  partialMonthOnly: boolean;
  averageMonthly: number;
  /** Spending in categories classified `need`. */
  averageEssential: number;
  /** Everything else (wants and unmapped categories), so essential + discretionary = monthly. */
  averageDiscretionary: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function spendBaseline(transactions: Transaction[], input: {
  classifications?: ClassificationMap;
  baseCurrency: string;
  rates: ExchangeRates;
  /** Today, YYYY-MM-DD: the device's in the app, the household's on the server. */
  now?: string;
  size?: number;
}): SpendBaseline {
  const classifications = input.classifications ?? NEEDS_WANTS_MAP;
  const current = (input.now ?? today()).slice(0, 7);
  const monthTotals = new Map<string, number>();
  for (const t of spendRows(transactions)) {
    const month = getMonthKey(t.date);
    if (month < current) monthTotals.set(month, (monthTotals.get(month) ?? 0) + effectiveAmount(t, input.baseCurrency, input.rates));
  }
  const months = [...monthTotals.entries()].filter(([, total]) => total > 0).map(([m]) => m)
    .sort().slice(-(input.size ?? BASELINE_MONTHS));
  const keys = months.length > 0 ? months : [current];
  let total = 0, essential = 0;
  for (const month of keys) {
    for (const [category, amount] of Object.entries(spendByCategory(transactions, month, input.baseCurrency, input.rates))) {
      total += amount;
      if (classifications[category] === 'need') essential += amount;
    }
  }
  const n = keys.length;
  return {
    months,
    partialMonthOnly: months.length === 0,
    averageMonthly: round2(total / n),
    averageEssential: round2(essential / n),
    averageDiscretionary: round2((total - essential) / n),
  };
}

/**
 * Months a liquid balance covers at a monthly spend, one decimal. Null when there is no spend to
 * divide by; 0 when the balance is not positive. The ONE rounding, so a screen and Pip agree.
 */
export function monthsOfCover(liquid: number, monthly: number): number | null {
  if (!(monthly > 0)) return null;
  const balance = round2(liquid);
  return balance <= 0 ? 0 : Math.round((balance / monthly) * 10) / 10;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Aug 2026", "Jun–Aug 2026" or "Nov 2025–Jan 2026". */
export function baselineLabel(months: string[]): string {
  if (!months.length) return '';
  const name = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1];
  const first = months[0];
  const last = months[months.length - 1];
  if (first === last) return `${name(first)} ${first.slice(0, 4)}`;
  return first.slice(0, 4) === last.slice(0, 4)
    ? `${name(first)}–${name(last)} ${last.slice(0, 4)}`
    : `${name(first)} ${first.slice(0, 4)}–${name(last)} ${last.slice(0, 4)}`;
}
