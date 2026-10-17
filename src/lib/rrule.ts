// Vyact v9.1 — focused RFC 5545 RRULE engine (vendored).
//
// The triage spec (§5.2) calls for rrule.js. We cannot add it here — npm/npx are
// blocked by group policy — so this is a deliberately NARROW, well-tested subset
// covering exactly the frequencies the recurring redesign supports:
//   DAILY, WEEKLY (+BYDAY), MONTHLY (+BYMONTHDAY), YEARLY, plus INTERVAL, and the
//   mutually-exclusive end conditions COUNT / UNTIL. Quarterly is encoded the
//   standard way: FREQ=MONTHLY;INTERVAL=3.
//
// The dangerous parts the spec warns about — month-end (BYMONTHDAY=31 skips short
// months per RFC 5545), leap years (Feb 29) — are handled by anchoring on UTC
// calendar math. Without a policy an impossible date is SKIPPED (the RFC
// behaviour); a schedule always passes its month-end policy (W3e), so the app
// moves the date to the month's last day or the next month's 1st instead.
// Covered by unit tests in __tests__/rrule.test.ts.
//
// Dates are handled as YYYY-MM-DD strings (the app's transaction date format);
// internally we use UTC Date to avoid TZ drift.

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/**
 * W3e (v10.69.0; owner decision D13) — what a day-of-month that a month does not have (the 29th–31st,
 * Feb 29) becomes, chosen per schedule:
 *   • 'last_day'         — the last day of that month (the 31st → 30 Apr, 28 Feb). The default.
 *   • 'next_month_first' — the 1st of the next month (31 Jan → 1 Mar can make March hold two).
 * Without a policy the expansion keeps the RFC 5545 behaviour and SKIPS the month, which is how a
 * bill on the 31st silently missed February, April, June, September and November.
 */
export type ShortMonthPolicy = 'last_day' | 'next_month_first';
export interface ExpandOptions { shortMonthPolicy?: ShortMonthPolicy }

/** The date a day-of-month lands on in a given month under a policy; null = skip (no policy). */
function landDay(year: number, month0: number, dom: number, policy?: ShortMonthPolicy): Date | null {
  if (monthHasDay(year, month0, dom)) return new Date(Date.UTC(year, month0, dom));
  if (!policy) return null;
  return policy === 'last_day' ? new Date(Date.UTC(year, month0 + 1, 0)) : new Date(Date.UTC(year, month0 + 1, 1));
}

export interface RRule {
  freq: Freq;
  interval: number;          // ≥ 1
  byDay?: number[];          // 0=SU..6=SA (WEEKLY or MONTHLY nth-weekday)
  byMonthDay?: number[];     // 1..31 (MONTHLY day-of-month)
  bySetPos?: number[];       // e.g. [2] = 2nd occurrence; [-1] = last (MONTHLY nth-weekday)
  byMonth?: number[];        // 1..12 (YEARLY)
  count?: number;            // ends after N occurrences
  until?: string;            // YYYY-MM-DD inclusive (mutually exclusive with count)
}

const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// ── parse / serialise the RRULE string (DTSTART carried separately) ───────────

/** Serialise to an RFC 5545 RRULE string (without DTSTART). */
export function formatRRule(r: RRule): string {
  const parts: string[] = [`FREQ=${r.freq}`, `INTERVAL=${Math.max(1, r.interval)}`];
  if (r.byDay?.length) parts.push(`BYDAY=${r.byDay.map((d) => WD[d]).join(',')}`);
  if (r.byMonthDay?.length) parts.push(`BYMONTHDAY=${r.byMonthDay.join(',')}`);
  if (r.bySetPos?.length) parts.push(`BYSETPOS=${r.bySetPos.join(',')}`);
  if (r.byMonth?.length) parts.push(`BYMONTH=${r.byMonth.join(',')}`);
  if (r.count != null) parts.push(`COUNT=${r.count}`);
  else if (r.until) parts.push(`UNTIL=${r.until.replace(/-/g, '')}`);
  return parts.join(';');
}

/** Parse an RFC 5545 RRULE string. Tolerant of lower-case and missing INTERVAL. */
export function parseRRule(s: string): RRule {
  const map: Record<string, string> = {};
  for (const kv of s.trim().toUpperCase().split(';')) {
    const [k, v] = kv.split('=');
    if (k && v) map[k] = v;
  }
  const freq = (map.FREQ as Freq) || 'MONTHLY';
  const r: RRule = { freq, interval: Math.max(1, Number(map.INTERVAL) || 1) };
  if (map.BYDAY) r.byDay = map.BYDAY.split(',').map((d) => WD.indexOf(d)).filter((i) => i >= 0);
  if (map.BYMONTHDAY) r.byMonthDay = map.BYMONTHDAY.split(',').map(Number).filter((n) => n >= 1 && n <= 31);
  if (map.BYSETPOS) r.bySetPos = map.BYSETPOS.split(',').map(Number).filter((n) => n !== 0);
  if (map.BYMONTH) r.byMonth = map.BYMONTH.split(',').map(Number).filter((n) => n >= 1 && n <= 12);
  if (map.COUNT) r.count = Number(map.COUNT);
  else if (map.UNTIL) {
    const u = map.UNTIL.slice(0, 8);
    r.until = `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}`;
  }
  return r;
}

// ── date helpers (UTC) ────────────────────────────────────────────────────────

function toUTC(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function fmt(dt: Date): string {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function addDays(dt: Date, n: number): Date { const c = new Date(dt); c.setUTCDate(c.getUTCDate() + n); return c; }
function addMonths(dt: Date, n: number): Date { const c = new Date(dt); c.setUTCMonth(c.getUTCMonth() + n); return c; }
function addYears(dt: Date, n: number): Date { const c = new Date(dt); c.setUTCFullYear(c.getUTCFullYear() + n); return c; }

/** A "candidate" is generated, then validated against BY* rules; invalid ones
 *  (e.g. Feb 31) are SKIPPED, not clamped — matching RFC 5545. */
function monthHasDay(year: number, month0: number, day: number): boolean {
  const dt = new Date(Date.UTC(year, month0, day));
  return dt.getUTCMonth() === month0;   // rolled over → that day doesn't exist
}

// ── expansion ────────────────────────────────────────────────────────────────

/**
 * Expand occurrences of `rule` starting at `dtstart` (YYYY-MM-DD), returning
 * dates that fall within [from, to] inclusive. Honors COUNT/UNTIL globally (an
 * occurrence consumed before `from` still counts toward COUNT). Bounded by a hard
 * safety cap so a misconfigured open-ended rule can't loop forever.
 */
export function expandRRule(rule: RRule, dtstart: string, from: string, to: string, opts: ExpandOptions = {}): string[] {
  const start = toUTC(dtstart);
  const windowEnd = toUTC(to);
  const windowStart = toUTC(from);
  const untilDt = rule.until ? toUTC(rule.until) : null;
  const hardEnd = untilDt && untilDt < windowEnd ? untilDt : windowEnd;
  const interval = Math.max(1, rule.interval);
  const out: string[] = [];
  const policy = opts.shortMonthPolicy;
  const seen = new Set<number>();   // a moved day can meet a real one (31st → 1st, and the 1st itself)
  let produced = 0;                 // counts toward COUNT (all occurrences, not just in-window)
  const CAP = 10_000;               // safety: never loop unbounded
  let iters = 0;

  const emit = (dt: Date): boolean => {
    // returns false to signal "stop expanding entirely" (COUNT/UNTIL exhausted)
    if (untilDt && dt > untilDt) return false;
    if (rule.count != null && produced >= rule.count) return false;
    if (seen.has(dt.getTime())) return true;      // the same date twice is one occurrence
    seen.add(dt.getTime());
    produced++;
    if (dt >= windowStart && dt <= hardEnd) out.push(fmt(dt));
    return true;
  };

  if (rule.freq === 'DAILY') {
    // W3e: an open-ended rule jumps straight to the window (whole intervals, so the phase holds).
    // Stepping day by day from a years-old start ran into CAP, and "no date found" reads as finished.
    let first = new Date(start);
    if (rule.count == null && windowStart > start) {
      const steps = Math.floor((windowStart.getTime() - start.getTime()) / (86_400_000 * interval));
      first = addDays(start, steps * interval);
    }
    for (let dt = first; iters < CAP; dt = addDays(dt, interval), iters++) {
      if (dt > hardEnd && !(rule.count != null)) break;
      if (!emit(dt)) break;
    }
  } else if (rule.freq === 'WEEKLY') {
    const days = rule.byDay?.length ? [...rule.byDay].sort((a, b) => a - b) : [start.getUTCDay()];
    // iterate week by week from the week containing start
    for (let wk = new Date(start); iters < CAP; wk = addDays(wk, 7 * interval), iters++) {
      let stop = false;
      // Emit this week's days in DATE order, not BYDAY order: a week anchored on a
      // Tuesday start holds Fri before Mon, and stopping at a Monday past the
      // window would otherwise drop the Friday inside it (and misorder COUNT).
      const week = days.map((d) => addDays(wk, (d - wk.getUTCDay() + 7) % 7)).sort((a, b) => a.getTime() - b.getTime());
      for (const occ of week) {
        if (occ < start) continue;                 // before DTSTART
        if (occ > hardEnd && rule.count == null) { stop = true; break; }
        if (!emit(occ)) { stop = true; break; }
      }
      if (stop) break;
    }
  } else if (rule.freq === 'MONTHLY') {
    // nth-weekday pattern: BYSETPOS + BYDAY (e.g. 2nd Friday, last Monday)
    if (rule.bySetPos?.length && rule.byDay?.length) {
      const wd = rule.byDay[0];   // take first weekday
      const pos = rule.bySetPos[0]; // take first position (1-based; -1 = last)
      for (let m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); iters < CAP; m = addMonths(m, interval), iters++) {
        const year = m.getUTCFullYear(); const month0 = m.getUTCMonth();
        // collect all occurrences of `wd` in this month
        const all: Date[] = [];
        for (let d = 1; d <= 31; d++) {
          if (!monthHasDay(year, month0, d)) break;
          const c = new Date(Date.UTC(year, month0, d));
          if (c.getUTCDay() === wd) all.push(c);
        }
        const idx = pos < 0 ? all.length + pos : pos - 1;
        if (idx < 0 || idx >= all.length) continue;  // e.g. 5th weekday doesn't exist
        const occ = all[idx];
        if (occ < start) continue;
        if (occ > hardEnd && rule.count == null) break;
        if (!emit(occ)) break;
      }
    } else {
      const startDom = start.getUTCDate();
      const doms = rule.byMonthDay?.length ? [...rule.byMonthDay].sort((a, b) => a - b) : [startDom];
      // 'next_month_first' moves a short month's day into the NEXT month, so the month before the
      // start can hold an occurrence on or after it (a start of 1 May is April's 31st). Begin there;
      // anything before the start is skipped below and never counted.
      const lead = policy === 'next_month_first' ? interval : 0;
      for (let m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - lead, 1)); iters < CAP; m = addMonths(m, interval), iters++) {
        let stop = false;
        for (const dom of doms) {
          // RFC: skip short months — unless the schedule chose a month-end policy (W3e).
          const occ = landDay(m.getUTCFullYear(), m.getUTCMonth(), dom, policy);
          if (!occ) continue;
          if (occ < start) continue;
          if (occ > hardEnd && rule.count == null) { stop = true; break; }
          if (!emit(occ)) { stop = true; break; }
        }
        if (stop) break;
      }
    }
  } else { // YEARLY — honour BYMONTH + BYMONTHDAY when present, else anchor on start's month/day; skip Feb 29 in non-leap years
    const mo  = rule.byMonth?.length    ? rule.byMonth[0] - 1 : start.getUTCMonth();
    const dom = rule.byMonthDay?.length ? rule.byMonthDay[0]  : start.getUTCDate();
    for (let y = start.getUTCFullYear(); iters < CAP; y += interval, iters++) {
      const occ = landDay(y, mo, dom, policy);       // Feb 29 in a common year → skip, or the policy's day
      if (!occ) continue;
      if (occ < start) continue;
      if (occ > hardEnd && rule.count == null) break;
      if (!emit(occ)) break;
    }
  }
  return out;
}

const shiftDays = (iso: string, n: number): string => fmt(addDays(toUTC(iso), n));

/**
 * W3e — the first occurrence strictly AFTER `after` (YYYY-MM-DD), honouring COUNT and UNTIL counted
 * from `dtstart`; null when the rule has no further occurrence (it is finished). Looks ahead in
 * widening windows, so a daily rule costs a few days and an every-four-years rule still resolves.
 */
export function nextOccurrenceAfter(rule: RRule, dtstart: string, after: string, opts: ExpandOptions = {}): string | null {
  return firstOccurrenceOnOrAfter(rule, dtstart, shiftDays(after, 1), opts);
}

/** W3e — the first occurrence on or after `from` (inclusive); null when the rule is finished. */
export function firstOccurrenceOnOrAfter(rule: RRule, dtstart: string, from: string, opts: ExpandOptions = {}): string | null {
  const floor = from < dtstart ? dtstart : from;
  for (const span of [62, 400, 1600, 4000]) {
    if (rule.until && rule.until < floor) return null;
    const dates = expandRRule(rule, dtstart, floor, shiftDays(floor, span * Math.max(1, rule.interval)), opts);
    if (dates.length) return dates[0];
  }
  return null;
}

/** Human label for a rule, e.g. "Every month on the 1st", "Every 3 months". */
export function describeRRule(r: RRule): string {
  const n = r.interval;
  const base =
    r.freq === 'DAILY' ? (n === 1 ? 'Every day' : `Every ${n} days`)
    : r.freq === 'WEEKLY' ? (n === 1 ? 'Every week' : `Every ${n} weeks`)
    : r.freq === 'MONTHLY' ? (n === 3 ? 'Every quarter' : n === 1 ? 'Every month' : `Every ${n} months`)
    : (n === 1 ? 'Every year' : `Every ${n} years`);
  if (r.count != null) return `${base}, ${r.count} times`;
  if (r.until) return `${base}, until ${r.until}`;
  return base;
}
