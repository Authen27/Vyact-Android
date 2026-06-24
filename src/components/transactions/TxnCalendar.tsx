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
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const pad2 = (n: number) => String(n).padStart(2, '0');

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export default function TxnCalendar({
  transactions, schedules = [], initialMonth, selectedDate, onSelectDate, currency = 'USD',
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

  const expenseDays = useMemo(() => {
    const set = new Set<string>();
    for (const [d, v] of dayTotals) if (v.expense > 0) set.add(d);
    return set;
  }, [dayTotals]);

  // Future days in the viewed month: projected recurring income & expense from schedules.
  const projectedTotals = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();
    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = `${viewMonth}-${pad2(d)}`;
      if (dStr <= todayStr) continue; // future only
      let income = 0;
      let expense = 0;
      for (const s of schedules) {
        if (!scheduleFiresOnDate(s, dStr)) continue;
        const tpl = s.transactionTemplate;
        if (!tpl) continue;
        const amt = Math.abs(tpl.amount || 0);
        if (tpl.type === 'income') income += amt;
        else if (tpl.type === 'expense') expense += amt;
      }
      if (income > 0 || expense > 0) map.set(dStr, { income, expense });
    }
    return map;
  }, [schedules, daysInMonth, viewMonth, todayStr]);

  const projectedDays = useMemo(() => {
    const set = new Set<string>();
    for (const [d, v] of projectedTotals) {
      // Only mark as "projected" if there is no logged expense already.
      if (!expenseDays.has(d) && (v.income > 0 || v.expense > 0)) set.add(d);
    }
    return set;
  }, [projectedTotals, expenseDays]);

  const loggedCount = expenseDays.size;

  return (
    <div className="bg-bg3 rounded-md border border-line mb-6 p-3">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setViewMonth(m => shiftMonth(m, -1))}
          className="p-1 rounded hover:bg-bg2 text-ink-mid hover:text-ink"
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-center gap-3">
          <span className="display-italic text-ink text-lg">{monthName(viewMonth)}</span>
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
          className="p-1 rounded hover:bg-bg2 text-ink-mid hover:text-ink"
          aria-label="Next month"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w, i) => (
          <div key={`h${i}`} className="h-6 flex items-center justify-center font-mono text-[0.58rem] tracking-wider uppercase text-ink-dim">
            {w}
          </div>
        ))}

        {Array.from({ length: leading }).map((_, i) => <div key={`b${i}`} className="min-h-[3.25rem]" />)}

        {Array.from({ length: daysInMonth }).map((_, i) => {
          const d = i + 1;
          const dStr = `${viewMonth}-${pad2(d)}`;
          const logged = expenseDays.has(dStr);
          const projected = projectedDays.has(dStr);
          const isToday = dStr === todayStr;
          const isSelected = dStr === selectedDate;

          const totals = dayTotals.get(dStr);
          const proj = projectedTotals.get(dStr);
          const incomeAmt = totals?.income ?? 0;
          const expenseAmt = totals?.expense ?? 0;
          const projectedAmt = (proj?.expense ?? 0) + (proj?.income ?? 0);

          const tone = logged
            ? 'bg-sage/20 text-sage border-sage/40'
            : projected
              ? 'bg-denim/15 text-denim border-denim/40'
              : 'bg-bg text-ink-dim border-line';

          const parts: string[] = [];
          if (incomeAmt > 0) parts.push(`+${fmtShort(incomeAmt, currency)} income`);
          if (expenseAmt > 0) parts.push(`−${fmtShort(expenseAmt, currency)} expense`);
          if (projectedAmt > 0) parts.push(`~${fmtShort(projectedAmt, currency)} upcoming`);
          const title = `${dStr}${parts.length ? ' · ' + parts.join(' · ') : ': no activity'}`;

          return (
            <button
              key={dStr}
              type="button"
              onClick={() => onSelectDate?.(dStr)}
              title={title}
              className={`min-h-[3.25rem] flex flex-col items-center justify-start gap-0.5 px-1 pt-1 pb-0.5 rounded border transition-colors hover:brightness-95
                ${tone}
                ${isToday ? 'ring-1 ring-coral ring-offset-1 ring-offset-bg3' : ''}
                ${isSelected ? 'outline outline-2 outline-coral' : ''}
              `}
            >
              <span className="font-mono text-[0.82rem] leading-none">{d}</span>
              <span className="flex flex-col items-center leading-tight font-mono text-[0.52rem] tabular-nums tracking-tight">
                {incomeAmt > 0 && <span className="text-sage">+{fmtShort(incomeAmt, currency)}</span>}
                {expenseAmt > 0 && <span className="text-terracotta">−{fmtShort(expenseAmt, currency)}</span>}
                {projectedAmt > 0 && <span className="text-denim opacity-80">~{fmtShort(projectedAmt, currency)}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-4 mt-2.5 font-mono text-[0.56rem] tracking-wider uppercase text-ink-dim flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-sage/20 border border-sage/40" /> Expense logged</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-denim/15 border border-denim/40" /> Upcoming (recurring)</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-bg border border-line" /> None</span>
        <span className="ml-auto normal-case tracking-normal text-ink-dim">{loggedCount}/{daysInMonth} days logged · tap a day to filter</span>
      </div>
    </div>
  );
}
