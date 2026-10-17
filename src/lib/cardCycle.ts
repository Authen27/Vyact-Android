// Aurora 4.0 AF1 — a card's cycle as dates: the spend window the statement covers, the statement date
// and the payment due date ("18th" and "5th" read as numbers, not as when to pay). Read-only, from the
// two stored days; it never changes what the card stores.
import { statementWindow } from './accountsView';
import { addDaysISO } from './format';

export interface CardCycle {
  /** First and last day of spending on the current statement. */
  spendFrom: string;
  spendTo: string;
  /** The statement is drawn up on the last day of the window. */
  statement: string;
  /** The first due day after the statement. */
  due: string;
}

const lastDayOf = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

export function cardCycle(cycleDay: number, dueDay: number, nowInstant: Date): CardCycle | null {
  if (!(cycleDay >= 1 && cycleDay <= 31 && dueDay >= 1 && dueDay <= 31)) return null;
  const { start, end } = statementWindow(cycleDay, nowInstant);
  // The due date is the first `dueDay` strictly after the statement date (short months clamp).
  const after = addDaysISO(end, 1);
  let y = Number(after.slice(0, 4));
  let m = Number(after.slice(5, 7)) - 1;
  const d = Number(after.slice(8, 10));
  if (d > Math.min(dueDay, lastDayOf(y, m))) { m += 1; if (m > 11) { m = 0; y += 1; } }
  const due = `${y}-${String(m + 1).padStart(2, '0')}-${String(Math.min(dueDay, lastDayOf(y, m))).padStart(2, '0')}`;
  return { spendFrom: start, spendTo: end, statement: end, due };
}
