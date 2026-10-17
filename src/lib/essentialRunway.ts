// Vyact v10.31.0 — essential-spend runway with a STATED completed-month baseline
// (docs/INSIGHTS_ASK_REPORTS_UX.md, "Further Product Work").
//
// Contract: "if income stopped and only essential spending continued, how long
// would liquid assets last?" — an estimate, not advice or a health score.
//   • Essential = spending in categories classified `need` (the live
//     classification map, so admin overrides apply). Wants, unmapped categories,
//     transfers, investments and private rows never count; a loan payment counts
//     in full as Loan / EMI (Track E).
//   • Baseline = the last BASELINE_MONTHS COMPLETED calendar months that
//     contain any recorded spending; the current month is never in it. The
//     months used are returned so the screen can state them.
//   • Resources = liquid assets from the canonical projection (cash and bank
//     accounts, liquid assets) — never credit limits or investments.
//
// Track E, E4 (v10.98.0): the baseline and the months figure are `lib/spendBaseline.ts`, the ones
// Pip and Net Worth read, so this screen's "on essentials only" figure is Pip's (E-5, E-9).
import type { ExchangeRates, Transaction } from '../types';
import { today } from './format';
import { BASELINE_MONTHS, monthsOfCover, spendBaseline, type ClassificationMap } from './spendBaseline';

export { baselineLabel } from './spendBaseline';
export const RUNWAY_BASELINE_MONTHS = BASELINE_MONTHS;

export type RunwayStatus = 'ready' | 'no-baseline' | 'no-essential-spend';

export interface EssentialRunway {
  status: RunwayStatus;
  /** Completed months used, ascending ('YYYY-MM'). */
  baselineMonths: string[];
  averageEssential: number | null;
  liquidAssets: number;
  /** Months of essential spending the liquid assets cover, one decimal; 0 when liquid assets are not positive. */
  months: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function essentialRunway(input: {
  transactions: Transaction[];
  classifications: ClassificationMap;
  liquidAssets: number;
  baseCurrency: string;
  rates: ExchangeRates;
  now?: string;
  baselineSize?: number;
}): EssentialRunway {
  const basis = spendBaseline(input.transactions, {
    classifications: input.classifications, baseCurrency: input.baseCurrency, rates: input.rates,
    now: input.now ?? today(), size: input.baselineSize,
  });
  const baselineMonths = basis.months;
  const liquidAssets = round2(input.liquidAssets);
  if (basis.partialMonthOnly) {
    return { status: 'no-baseline', baselineMonths, averageEssential: null, liquidAssets, months: null };
  }
  const months = monthsOfCover(liquidAssets, basis.averageEssential);
  if (months == null) {
    return { status: 'no-essential-spend', baselineMonths, averageEssential: basis.averageEssential, liquidAssets, months: null };
  }
  return { status: 'ready', baselineMonths, averageEssential: basis.averageEssential, liquidAssets, months };
}
