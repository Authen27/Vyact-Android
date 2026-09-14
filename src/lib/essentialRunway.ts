// Vyact v10.31.0 — essential-spend runway with a STATED completed-month baseline
// (docs/INSIGHTS_ASK_REPORTS_UX.md, "Further Product Work").
//
// Contract: "if income stopped and only essential spending continued, how long
// would liquid assets last?" — an estimate, not advice or a health score.
//   • Essential = reportable expense in categories classified `need` (the live
//     classification map, so admin overrides apply). Wants, transfers,
//     investments and private rows never count.
//   • Baseline = the last RUNWAY_BASELINE_MONTHS COMPLETED calendar months that
//     contain any recorded spending; the current month is never in it. The
//     months used are returned so the screen can state them.
//   • Resources = liquid assets from the canonical projection (cash and bank
//     accounts, liquid assets) — never credit limits or investments.
import type { ExchangeRates, Transaction } from '../types';
import { effectiveAmount, reportableTxns } from './calculations';
import { getMonthKey, today } from './format';

export const RUNWAY_BASELINE_MONTHS = 3;

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const round2 = (n: number) => Math.round(n * 100) / 100;

export function essentialRunway(input: {
  transactions: Transaction[];
  classifications: Record<string, 'need' | 'want'>;
  liquidAssets: number;
  baseCurrency: string;
  rates: ExchangeRates;
  now?: string;
  baselineSize?: number;
}): EssentialRunway {
  const now = input.now ?? today();
  const currentMonth = now.slice(0, 7);
  const size = input.baselineSize ?? RUNWAY_BASELINE_MONTHS;
  const totals = new Map<string, { spending: number; essential: number }>();
  for (const transaction of reportableTxns(input.transactions)) {
    if (transaction.type !== 'expense') continue;
    const month = getMonthKey(transaction.date);
    if (month >= currentMonth) continue;
    const amount = effectiveAmount(transaction, input.baseCurrency, input.rates);
    const row = totals.get(month) ?? { spending: 0, essential: 0 };
    row.spending += amount;
    if (input.classifications[transaction.category] === 'need') row.essential += amount;
    totals.set(month, row);
  }
  const baselineMonths = [...totals.entries()].filter(([, row]) => row.spending > 0).map(([month]) => month).sort().slice(-size);
  const liquidAssets = round2(input.liquidAssets);
  if (!baselineMonths.length) {
    return { status: 'no-baseline', baselineMonths, averageEssential: null, liquidAssets, months: null };
  }
  const averageEssential = round2(baselineMonths.reduce((sum, month) => sum + (totals.get(month)?.essential ?? 0), 0) / baselineMonths.length);
  if (averageEssential <= 0) {
    return { status: 'no-essential-spend', baselineMonths, averageEssential, liquidAssets, months: null };
  }
  const months = liquidAssets <= 0 ? 0 : Math.round((liquidAssets / averageEssential) * 10) / 10;
  return { status: 'ready', baselineMonths, averageEssential, liquidAssets, months };
}

/** "Aug 2026", "Jun–Aug 2026" or "Nov 2025–Jan 2026". */
export function baselineLabel(months: string[]): string {
  if (!months.length) return '';
  const name = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1];
  const first = months[0];
  const last = months[months.length - 1];
  if (first === last) return `${name(first)} ${first.slice(0, 4)}`;
  return first.slice(0, 4) === last.slice(0, 4)
    ? `${name(first)}–${name(last)} ${last.slice(0, 4)}`
    : `${name(first)} ${first.slice(0, 4)}–${name(last)} ${last.slice(0, 4)}`;
}
