// Vyact v10.30.0 — recorded Net Worth history (docs/INSIGHTS_ASK_REPORTS_UX.md,
// "Further Product Work").
//
// Historical Net Worth is RECORDED, never reconstructed. Standalone assets and
// debts store only their current value, so a past figure rebuilt from today's
// rows would be invented. Instead the household's canonical projection
// (lib/netWorth.ts) is written once per calendar month — the first write for a
// month wins, on the device and in the database — and the history chart draws
// only those recorded rows.
import type { NetWorthProjection } from './netWorth';
import { nowMonthKey } from './format';

export interface NetWorthSnapshot {
  /** Calendar month, 'YYYY-MM'. */
  month: string;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  liquidAssets: number;
  /** The household base currency the figures are expressed in. */
  currency: string;
  /** When the snapshot was recorded (ISO timestamp). */
  recordedAt: string;
}

/** The history chart draws a line only once this many months are recorded. */
export const MIN_HISTORY_POINTS = 2;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function snapshotFromProjection(
  projection: NetWorthProjection,
  month: string = nowMonthKey(),
  recordedAt: string = new Date().toISOString(),
): NetWorthSnapshot {
  const totalAssets = round2(projection.totalAssets);
  const totalLiabilities = round2(projection.totalLiabilities);
  return {
    month, totalAssets, totalLiabilities,
    netWorth: round2(totalAssets - totalLiabilities),
    liquidAssets: round2(projection.liquidAssets),
    currency: projection.baseCurrency,
    recordedAt,
  };
}

/** A position worth recording: the household has at least one asset or liability row. */
export function hasPositionData(projection: NetWorthProjection): boolean {
  return projection.assetRows.length + projection.liabilityRows.length > 0;
}

/** Record only a loaded, non-empty position, and only for a month not yet recorded. */
export function shouldRecordSnapshot(input: {
  loading: boolean;
  hasPosition: boolean;
  snapshots: readonly NetWorthSnapshot[];
  month?: string;
}): boolean {
  if (input.loading || !input.hasPosition) return false;
  const month = input.month ?? nowMonthKey();
  return !input.snapshots.some(snapshot => snapshot.month === month);
}

/** Adds a snapshot unless its month is already recorded (first write wins); months ascending. */
export function mergeSnapshot(list: readonly NetWorthSnapshot[], snapshot: NetWorthSnapshot): NetWorthSnapshot[] {
  const rows = list.some(row => row.month === snapshot.month) ? [...list] : [...list, snapshot];
  return rows.sort((left, right) => left.month.localeCompare(right.month));
}

// Fixed labels, not Intl: ICU versions disagree ("Sep" vs "Sept"), and a chart
// axis must read the same in every browser.
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return `${MONTH_NAMES[monthNumber - 1] ?? month} ${year}`;
}

export interface NetWorthHistory {
  points: (NetWorthSnapshot & { label: string })[];
  /** True once there are enough comparable recorded months to draw a line. */
  ready: boolean;
  /** Snapshots recorded in another currency (before a base-currency change): not comparable, not drawn. */
  otherCurrency: number;
}

export function netWorthHistory(snapshots: readonly NetWorthSnapshot[], currency: string): NetWorthHistory {
  const comparable = snapshots.filter(snapshot => snapshot.currency === currency);
  const points = [...comparable]
    .sort((left, right) => left.month.localeCompare(right.month))
    .map(snapshot => ({ ...snapshot, label: monthLabel(snapshot.month) }));
  return { points, ready: points.length >= MIN_HISTORY_POINTS, otherCurrency: snapshots.length - comparable.length };
}
