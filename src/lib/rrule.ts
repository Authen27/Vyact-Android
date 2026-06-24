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
// calendar math and by SKIPPING (not clamping) impossible dates, which is the RFC
// behaviour. Covered by unit tests in __tests__/rrule.test.ts.
//
// Dates are handled as YYYY-MM-DD strings (the app's transaction date format);
// internally we use UTC Date to avoid TZ drift.

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

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
export function expandRRule(rule: RRule, dtstart: string, from: string, to: string): string[] {
  const start = toUTC(dtstart);
  const windowEnd = toUTC(to);
  const windowStart = toUTC(from);
  const untilDt = rule.until ? toUTC(rule.until) : null;
  const hardEnd = untilDt && untilDt < windowEnd ? untilDt : windowEnd;
  const interval = Math.max(1, rule.interval);
  const out: string[] = [];
  let produced = 0;                 // counts toward COUNT (all occurrences, not just in-window)
  const CAP = 10_000;               // safety: never loop unbounded
  let iters = 0;

  const emit = (dt: Date): boolean => {
    // returns false to signal "stop expanding entirely" (COUNT/UNTIL exhausted)
    if (untilDt && dt > untilDt) return false;
    if (rule.count != null && produced >= rule.count) return false;
    produced++;
    if (dt >= windowStart && dt <= hardEnd) out.push(fmt(dt));
    return true;
  };

  if (rule.freq === 'DAILY') {
    for (let dt = new Date(start); iters < CAP; dt = addDays(dt, interval), iters++) {
      if (dt > hardEnd && !(rule.count != null)) break;
      if (!emit(dt)) break;
    }
  } else if (rule.freq === 'WEEKLY') {
    const days = rule.byDay?.length ? [...rule.byDay].sort((a, b) => a - b) : [start.getUTCDay()];
    // iterate week by week from the week containing start
    for (let wk = new Date(start); iters < CAP; wk = addDays(wk, 7 * interval), iters++) {
      let stop = false;
      for (const d of days) {
        const delta = (d - wk.getUTCDay() + 7) % 7;
        const occ = addDays(wk, delta);
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
      for (let m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); iters < CAP; m = addMonths(m, interval), iters++) {
        let stop = false;
        for (const dom of doms) {
          if (!monthHasDay(m.getUTCFullYear(), m.getUTCMonth(), dom)) continue;  // RFC: skip short months
          const occ = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), dom));
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
      if (!monthHasDay(y, mo, dom)) continue;       // Feb 29 in a common year → skip
      const occ = new Date(Date.UTC(y, mo, dom));
      if (occ < start) continue;
      if (occ > hardEnd && rule.count == null) break;
      if (!emit(occ)) break;
    }
  }
  return out;
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
