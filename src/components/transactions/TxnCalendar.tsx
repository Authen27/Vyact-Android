import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Transaction, RecurringSchedule } from '../../types';
import { nowMonthKey, today, monthName, fmtShort } from '../../lib/format';
import { scheduleFiresOnDate } from '../../lib/recurring';

interface TxnCalendarProps {
  transactions: Transaction[];          // all transactions (filtered to the viewed month internally)
  schedules?: RecurringSchedule[];      // recurring schedules → projected future payments
  initialMonth?: string;                // YYYY-MM to open on (defaults to current month)
  selectedDate?: string | null;         // currently selected day (YYYY-MM-DD)
  onSelectDate?: (date: string) => void;
  currency?: string;                    // base currency for per-day totals (defaults to USD)
  /** Board D1 "mini heat calendar" — smaller cells for the desktop right rail. */
  mini?: boolean;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const pad2 = (n: number) => String(n).padStart(2, '0');

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export default function TxnCalendar({
  transactions, schedules = [], initialMonth, selectedDate, onSelectDate, currency = 'USD', mini = false,
}: TxnCalendarProps) {
  const [viewMonth, setViewMonth] = useState(initialMonth || nowMonthKey());
  const todayStr = today();

  const { leading, daysInMonth } = useMemo(() => {
    const [y, m] = viewMonth.split('-').map(Number);
    return {
      leading: new Date(y, m - 1, 1).getDay(),
      daysInMonth: new Date(y, m, 0).getDate(),
    };
  }, [viewMonth]);

  // Per-day income & expense totals for the viewed month (counted, non-private).
  const dayTotals = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();
    for (const t of transactions) {
      if (t.excluded) continue;
      if (!t.date.startsWith(viewMonth + '-')) continue;
      if (t.type !== 'income' && t.type !== 'expense') continue;
      const cur = map.get(t.date) ?? { income: 0, expense: 0 };
      cur[t.type] += Math.abs(t.amount || 0);
      map.set(t.date, cur);
    }
    return map;
  }, [transactions, viewMonth]);

  // Board §.cal — the expense dot's opacity is a heat read (bigger day = more
  // solid dot), scaled against this month's single biggest spend day.
  const maxExpense = useMemo(() => {
    let max = 0;
    for (const v of dayTotals.values()) if (v.expense > max) max = v.expense;
    return max;
  }, [dayTotals]);

  // Future days in the viewed month: projected recurring income & expense from schedules.
  const projectedDays = useMemo(() => {
    const set = new Set<string>();
    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = `${viewMonth}-${pad2(d)}`;
      if (dStr <= todayStr) continue; // future only
      for (const s of schedules) {
        if (scheduleFiresOnDate(s, dStr)) { set.add(dStr); break; }
      }
    }
    return set;
  }, [schedules, daysInMonth, viewMonth, todayStr]);

  const loggedCount = useMemo(() => {
    let n = 0;
    for (const v of dayTotals.values()) if (v.expense > 0) n++;
    return n;
  }, [dayTotals]);

  const cellSize = mini ? 30 : 40;
  const cellRadius = mini ? 8 : 10;
  const cellFont = mini ? '10.5px' : '12px';

  return (
    <div className="rounded-r3 p-3.5" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-2.5">
        <button
          type="button"
          onClick={() => setViewMonth(m => shiftMonth(m, -1))}
          className="w-7 h-7 rounded-full flex items-center justify-center text-ink-mid hover:text-ink border-none cursor-pointer"
          style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}
          aria-label="Previous month"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="flex items-center gap-2">
          <span className="font-display font-semibold text-ink text-[13.5px]">{monthName(viewMonth)}</span>
          {viewMonth !== nowMonthKey() && (
            <button
              type="button"
              onClick={() => setViewMonth(nowMonthKey())}
              className="font-mono text-[0.56rem] tracking-wider uppercase text-coral hover:underline"
            >
              Today
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setViewMonth(m => shiftMonth(m, 1))}
          className="w-7 h-7 rounded-full flex items-center justify-center text-ink-mid hover:text-ink border-none cursor-pointer"
          style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}
          aria-label="Next month"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-[3px]">
        {WEEKDAYS.map((w, i) => (
          <div key={`h${i}`} className="text-center font-mono text-[8.5px] tracking-[0.08em] uppercase text-ink-dim py-[3px]">
            {w}
          </div>
        ))}

        {Array.from({ length: leading }).map((_, i) => <div key={`b${i}`} style={{ height: cellSize }} />)}

        {Array.from({ length: daysInMonth }).map((_, i) => {
          const d = i + 1;
          const dStr = `${viewMonth}-${pad2(d)}`;
          const totals = dayTotals.get(dStr);
          const incomeAmt = totals?.income ?? 0;
          const expenseAmt = totals?.expense ?? 0;
          const isFuture = dStr > todayStr;
          const isSelected = dStr === selectedDate;
          const isToday = dStr === todayStr;
          const hasRecurring = projectedDays.has(dStr);
          // Heat: 35–100% dot opacity scaled to this month's biggest spend day.
          const heat = expenseAmt > 0 ? 0.35 + 0.65 * Math.min(1, expenseAmt / (maxExpense || 1)) : 0;

          const parts: string[] = [];
          if (incomeAmt > 0) parts.push(`+${fmtShort(incomeAmt, currency)} income`);
          if (expenseAmt > 0) parts.push(`−${fmtShort(expenseAmt, currency)} expense`);
          if (hasRecurring) parts.push('projected recurring');
          const title = `${dStr}${parts.length ? ' · ' + parts.join(' · ') : ': no activity'}`;

          return (
            <button
              key={dStr}
              type="button"
              onClick={() => onSelectDate?.(dStr)}
              title={title}
              className="relative flex items-center justify-center border-none cursor-pointer transition-[box-shadow,color] duration-150 font-mono"
              style={{
                height: cellSize,
                borderRadius: cellRadius,
                fontSize: cellFont,
                color: isFuture ? 'var(--ff-ink-4)' : 'var(--ff-ink-2)',
                fontWeight: isToday ? 700 : 400,
                background: isSelected ? 'color-mix(in srgb, var(--accent) 16%, var(--canvas))' : 'transparent',
                boxShadow: isSelected ? `var(--neu-inset), 0 0 0 1.5px var(--accent)` : 'none',
              }}
            >
              <span style={isSelected ? { color: 'var(--accent)' } : undefined}>{d}</span>
              {hasRecurring && (
                <span aria-hidden className="absolute top-[3px] right-[5px] text-[8px] text-ink-dim leading-none">↻</span>
              )}
              {(heat > 0 || incomeAmt > 0) && (
                <span className="absolute bottom-[4px] flex gap-[2.5px]">
                  {heat > 0 && (
                    <i aria-hidden className="block w-1 h-1 rounded-full" style={{ background: 'var(--accent)', opacity: heat }} />
                  )}
                  {incomeAmt > 0 && (
                    <i aria-hidden className="block w-1 h-1 rounded-full" style={{ background: 'hsl(var(--sage))' }} />
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!mini && (
        <div className="mt-2.5 font-mono text-[0.56rem] tracking-wider uppercase text-ink-dim">
          {loggedCount}/{daysInMonth} days logged · tap a day to filter
        </div>
      )}
    </div>
  );
}
