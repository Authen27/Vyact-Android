// Aurora 4.0 RE1 — the recurring editor says what the schedule will do, in one live line:
// "₹28,000 Rent, every month on the 2nd, from HDFC Salary · posts by itself · next on 2 Nov".
// A describer of its own: `describeRRule` is the short list-row wording and stays as it is.
import type { RRule } from './rrule';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NTH: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last' };

export function ordinalDay(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** "2 Nov" from YYYY-MM-DD (the year only when it is not the current one). */
export function shortDate(iso: string, thisYear: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${y !== thisYear ? ` ${y}` : ''}`;
}

const joinWords = (words: string[]) =>
  words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/** "every month on the 2nd", "every week on Monday and Thursday", "every quarter on the last Friday". */
export function cadence(rule: RRule, thisYear: number): string {
  const n = rule.interval || 1;
  let text: string;
  if (rule.freq === 'DAILY') {
    text = n === 1 ? 'every day' : `every ${n} days`;
  } else if (rule.freq === 'WEEKLY') {
    const days = [...(rule.byDay ?? [])].sort();
    const on = days.length === 5 && [1, 2, 3, 4, 5].every(d => days.includes(d)) ? 'on weekdays'
      : days.length ? `on ${joinWords(days.map(d => DAY_NAMES[d]))}` : '';
    text = `${n === 1 ? 'every week' : `every ${n} weeks`}${on ? ` ${on}` : ''}`;
  } else if (rule.freq === 'MONTHLY') {
    const every = n === 3 ? 'every quarter' : n === 1 ? 'every month' : `every ${n} months`;
    const on = rule.bySetPos?.length && rule.byDay?.length
      ? `on the ${NTH[rule.bySetPos[0]] ?? ordinalDay(rule.bySetPos[0])} ${DAY_NAMES[rule.byDay[0]]}`
      : rule.byMonthDay?.length ? `on the ${ordinalDay(rule.byMonthDay[0])}` : '';
    text = `${every}${on ? ` ${on}` : ''}`;
  } else {
    const on = rule.byMonth?.length && rule.byMonthDay?.length
      ? ` on ${rule.byMonthDay[0]} ${MONTHS[rule.byMonth[0] - 1]}` : '';
    text = `${n === 1 ? 'every year' : `every ${n} years`}${on}`;
  }
  if (rule.count != null) text += `, ${rule.count} time${rule.count === 1 ? '' : 's'}`;
  else if (rule.until) text += `, until ${shortDate(rule.until, thisYear)}`;
  return text;
}

export interface ScheduleSummaryInput {
  amount: string;           // formatted money, '' when not entered yet
  what: string;             // the description, else the category label
  rule: RRule;
  type: 'expense' | 'income' | 'investment';
  account?: string;         // account name
  into?: string;            // an investment's asset name
  autoConfirm: boolean;
  nextDue?: string | null;  // YYYY-MM-DD
  todayISO: string;
}

export function scheduleSummary(s: ScheduleSummaryInput): string {
  const year = Number(s.todayISO.slice(0, 4));
  const head = [s.amount, s.what].filter(Boolean).join(' ');
  const where = s.type === 'income'
    ? (s.account ? `into ${s.account}` : '')
    : s.type === 'investment'
      ? [s.account && `from ${s.account}`, s.into && `into ${s.into}`].filter(Boolean).join(' ')
      : (s.account ? `from ${s.account}` : '');
  const main = [head, cadence(s.rule, year), where].filter(Boolean).join(', ');
  const posting = s.autoConfirm ? 'posts by itself' : 'asks you first';
  const next = s.nextDue ? `next on ${shortDate(s.nextDue, year)}` : '';
  return [main.charAt(0).toUpperCase() + main.slice(1), posting, next].filter(Boolean).join(' · ');
}
