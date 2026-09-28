// Vyact v10.31.0 — ONE date range for every Reports flow view
// (docs/INSIGHTS_ASK_REPORTS_UX.md, "Further Product Work").
//
// Contract: a range is a pair of inclusive YYYY-MM-DD dates that never runs past
// today. Every flow panel — headline tiles, trend, surplus/shortfall, categories,
// needs vs wants, period summary, top categories, member and account tables —
// reads the SAME range. The household position and "this month" stay current and
// say so. Calendar buckets inside the range are clamped to it and marked partial.
import type { ExchangeRates, Transaction } from '../types';
import type { ReportBucket, ReportPeriod } from './reportsModel';
import { effectiveAmount, reportableTxns } from './calculations';
import { today } from './format';

export type RangePreset = 'this-month' | 'last-3m' | 'last-6m' | 'last-12m' | 'ytd' | 'all' | 'custom';

export const RANGE_PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'this-month', label: 'This month' },
  { id: 'last-3m', label: 'Last 3 months' },
  { id: 'last-6m', label: 'Last 6 months' },
  { id: 'last-12m', label: 'Last 12 months' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
];
export const DEFAULT_RANGE_PRESET: RangePreset = 'last-12m';
export const GROUPINGS: ReportPeriod[] = ['day', 'week', 'month', 'quarter', 'year'];
/** Past this many buckets a grouping is coarsened: a year of daily bars is unreadable. */
export const MAX_BUCKETS = 60;

export interface ReportRange { preset: RangePreset; from: string; to: string }
export interface RangeBucket extends ReportBucket { partial: boolean }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;
const isoOf = (date: Date) => date.toISOString().slice(0, 10);
const utc = (value: string) => new Date(`${value}T00:00:00Z`);
const firstOfMonth = (year: number, monthIndex: number) => isoOf(new Date(Date.UTC(year, monthIndex, 1)));

function validDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = utc(value);
  return !Number.isNaN(date.getTime()) && isoOf(date) === value;
}

export function resolveRange(
  input: { preset?: string | null; from?: string | null; to?: string | null },
  firstDate: string | null,
  now: string = today(),
): ReportRange {
  const [year, month] = now.split('-').map(Number);
  const back = (months: number) => firstOfMonth(year, month - 1 - (months - 1));
  const preset = (RANGE_PRESETS.some(option => option.id === input.preset) ? input.preset : DEFAULT_RANGE_PRESET) as RangePreset;
  switch (preset) {
    case 'this-month': return { preset, from: back(1), to: now };
    case 'last-3m': return { preset, from: back(3), to: now };
    case 'last-6m': return { preset, from: back(6), to: now };
    case 'last-12m': return { preset, from: back(12), to: now };
    case 'ytd': return { preset, from: `${year}-01-01`, to: now };
    case 'all': return { preset, from: validDate(firstDate) && firstDate <= now ? firstDate : back(1), to: now };
    case 'custom': {
      const from = input.from;
      const to = validDate(input.to) && input.to < now ? input.to : now;
      if (!validDate(from) || !validDate(input.to) || from > to) {
        return resolveRange({ preset: DEFAULT_RANGE_PRESET }, firstDate, now);
      }
      return { preset, from, to };
    }
  }
}

function alignStart(date: Date, grouping: ReportPeriod): Date {
  switch (grouping) {
    case 'day': return date;
    case 'week': return new Date(date.getTime() - date.getUTCDay() * DAY_MS);   // weeks start on Sunday
    case 'month': return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    case 'quarter': return new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1));
    case 'year': return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  }
}

function nextStart(date: Date, grouping: ReportPeriod): Date {
  switch (grouping) {
    case 'day': return new Date(date.getTime() + DAY_MS);
    case 'week': return new Date(date.getTime() + 7 * DAY_MS);
    case 'month': return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    case 'quarter': return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 3, 1));
    case 'year': return new Date(Date.UTC(date.getUTCFullYear() + 1, 0, 1));
  }
}

/** Whole calendar buckets overlapping the range (unclamped edges). */
function calendarBuckets(range: { from: string; to: string }, grouping: ReportPeriod): { start: string; end: string }[] {
  const last = utc(range.to);
  const buckets: { start: string; end: string }[] = [];
  for (let start = alignStart(utc(range.from), grouping); start <= last; start = nextStart(start, grouping)) {
    buckets.push({ start: isoOf(start), end: isoOf(new Date(nextStart(start, grouping).getTime() - DAY_MS)) });
  }
  return buckets;
}

/** The requested grouping, coarsened until the range fits in MAX_BUCKETS. */
export function effectiveGrouping(range: { from: string; to: string }, requested: ReportPeriod): { grouping: ReportPeriod; coarsened: boolean } {
  let index = Math.max(0, GROUPINGS.indexOf(requested));
  while (index < GROUPINGS.length - 1 && calendarBuckets(range, GROUPINGS[index]).length > MAX_BUCKETS) index++;
  return { grouping: GROUPINGS[index], coarsened: GROUPINGS[index] !== requested };
}

function bucketLabel(start: string, grouping: ReportPeriod): string {
  const [year, month, day] = start.split('-').map(Number);
  const shortYear = String(year).slice(2);
  switch (grouping) {
    case 'day':
    case 'week': return `${MONTHS[month - 1]} ${day}`;
    case 'month': return `${MONTHS[month - 1]} '${shortYear}`;
    case 'quarter': return `Q${Math.floor((month - 1) / 3) + 1} '${shortYear}`;
    case 'year': return String(year);
  }
}

/** Reportable entries dated inside the range (transfers, adjustments, private rows excluded). */
export function inRange(transactions: Transaction[], range: { from: string; to: string }): Transaction[] {
  return reportableTxns(transactions).filter(transaction => transaction.date >= range.from && transaction.date <= range.to);
}

export function rangeBuckets(
  transactions: Transaction[],
  range: { from: string; to: string },
  grouping: ReportPeriod,
  currency: string,
  rates: ExchangeRates,
): RangeBucket[] {
  const rows = inRange(transactions, range);
  return calendarBuckets(range, grouping).map(bucket => {
    const start = bucket.start < range.from ? range.from : bucket.start;
    const end = bucket.end > range.to ? range.to : bucket.end;
    let income = 0;
    let expense = 0;
    for (const transaction of rows) {
      if (transaction.date < start || transaction.date > end) continue;
      const amount = effectiveAmount(transaction, currency, rates);
      if (transaction.type === 'income') income += amount;
      else expense += amount;
    }
    return { label: bucketLabel(bucket.start, grouping), start, end, income, expense, net: income - expense,
      partial: start !== bucket.start || end !== bucket.end };
  });
}

export function firstReportableDate(transactions: Transaction[]): string | null {
  let first: string | null = null;
  for (const transaction of reportableTxns(transactions)) if (!first || transaction.date < first) first = transaction.date;
  return first;
}

export function formatRangeDay(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function rangeLabel(range: { from: string; to: string }): string {
  return `${formatRangeDay(range.from)} – ${formatRangeDay(range.to)}`;
}

// URL contract: /reports?range=last-6m&group=month, or range=custom&start=…&end=….
// `start`/`end`, not `from`/`to`: Reports already reads `from=savings`.
export function rangeFromParams(params: URLSearchParams, firstDate: string | null, now: string = today()): ReportRange {
  return resolveRange({ preset: params.get('range'), from: params.get('start'), to: params.get('end') }, firstDate, now);
}

export function writeRangeParams(params: URLSearchParams, range: ReportRange, grouping: ReportPeriod): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set('range', range.preset);
  next.set('group', grouping);
  if (range.preset === 'custom') { next.set('start', range.from); next.set('end', range.to); }
  else { next.delete('start'); next.delete('end'); }
  return next;
}

export function groupingFromParam(value: string | null, fallback: ReportPeriod = 'month'): ReportPeriod {
  return GROUPINGS.includes(value as ReportPeriod) ? value as ReportPeriod : fallback;
}
