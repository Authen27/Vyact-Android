// Vyact v10.32.0 — the approval-aware bill calendar on Recurring
// (lib/billCalendar.ts holds the contract). An agenda grouped by date for the next
// 7, 30 or 60 days. Each occurrence says what the engine will do with it; the one
// occurrence awaiting approval can be approved or skipped here, through the same
// store actions the notification uses. Nothing is posted by viewing it.
import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { billCalendar, type BillOccurrence, type BillStatus } from '../../lib/billCalendar';
import { advanceSchedule } from '../../lib/recurring';
import { fmt, formatDate, today } from '../../lib/format';
import { getCat } from '../../constants';

const HORIZONS = [7, 30, 60] as const;
type Horizon = typeof HORIZONS[number];

const STATUS: Record<BillStatus, { label: string; tone: string }> = {
  'awaiting-approval': { label: 'Awaiting your approval', tone: 'honey' },
  auto: { label: 'Posts automatically', tone: 'sage' },
  'approval-when-due': { label: 'You approve when due', tone: 'denim' },
  posted: { label: 'Posted', tone: 'ink-dim' },
};

function dayHeading(date: string, dateFormat: Parameters<typeof formatDate>[1]): string {
  const now = today();
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${now}T00:00:00Z`)) / 86_400_000);
  const relative = days < 0 ? `${-days} day${days === -1 ? '' : 's'} overdue` : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
  return `${formatDate(date, dateFormat)} · ${relative}`;
}

export default function BillCalendar() {
  const schedules = useStore(s => s.recurringSchedules);
  const transactions = useStore(s => s.transactions);
  const baseCurrency = useStore(s => s.profile.baseCurrency);
  const dateFormat = useStore(s => s.profile.dateFormat);
  const rates = useStore(s => s.rates);
  const approveRecurring = useStore(s => s.approveRecurring);
  const upsertRecurring = useStore(s => s.upsertRecurring);
  const toast = useStore(s => s.toast);
  const [horizon, setHorizon] = useState<Horizon>(30);
  const [busy, setBusy] = useState<string | null>(null);

  const calendar = useMemo(
    () => billCalendar({ schedules, transactions, baseCurrency, rates, horizonDays: horizon }),
    [schedules, transactions, baseCurrency, rates, horizon],
  );

  const keyOf = (item: BillOccurrence) => `${item.scheduleId}|${item.date}`;

  async function approve(item: BillOccurrence) {
    setBusy(keyOf(item));
    try {
      await approveRecurring(item.scheduleId, item.date);
      toast('Approved — transaction posted', 'success');
    } catch {
      toast('Could not approve this bill. Please retry.', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function skip(item: BillOccurrence) {
    const schedule = schedules.find(row => row.id === item.scheduleId);
    if (!schedule || schedule.nextDueDate !== item.date) return;
    if (!confirm(`Skip ${item.description || 'this bill'} on ${formatDate(item.date, dateFormat)}? It will not be posted.`)) return;
    setBusy(keyOf(item));
    try {
      await upsertRecurring(advanceSchedule(schedule));
      toast('Skipped once', 'info');
    } catch (error) {
      toast(`Could not skip: ${(error as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Bill calendar" className="mb-5 min-w-0">
      <div className="flex items-end justify-between gap-3 flex-wrap mb-2">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-medium text-ink">Bill calendar</h2>
          <p className="text-xs text-ink-dim mt-1">What active schedules will do. Nothing posts until it is due and approved, or auto-approved. Not a balance forecast.</p>
        </div>
        <div role="tablist" aria-label="Calendar horizon" className="inline-flex gap-1 p-1 rounded-pill" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
          {HORIZONS.map(days => (
            <button key={days} type="button" role="tab" aria-selected={horizon === days} onClick={() => setHorizon(days)}
              className="min-h-[36px] px-3 rounded-pill border-none cursor-pointer font-display font-semibold text-[11.5px] whitespace-nowrap"
              style={horizon === days
                ? { color: 'var(--accent)', boxShadow: 'var(--neu-inset)', background: 'color-mix(in srgb, var(--accent) 10%, var(--canvas))' }
                : { color: 'var(--ff-ink-3)', background: 'transparent' }}>
              Next {days} days
            </button>
          ))}
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm mb-3">
        <div className="flex gap-1.5"><dt className="text-ink-dim">Going out</dt><dd className="num text-ink">{fmt(calendar.outgoing, baseCurrency)}</dd></div>
        <div className="flex gap-1.5"><dt className="text-ink-dim">Coming in</dt><dd className="num text-sage">{fmt(calendar.incoming, baseCurrency)}</dd></div>
        {calendar.investing > 0 && <div className="flex gap-1.5"><dt className="text-ink-dim">To investments</dt><dd className="num text-ink">{fmt(calendar.investing, baseCurrency)}</dd></div>}
        {calendar.awaitingApproval > 0 && <div className="flex gap-1.5"><dt className="text-ink-dim">Awaiting approval</dt><dd className="num" style={{ color: 'hsl(var(--honey))' }}>{calendar.awaitingApproval}</dd></div>}
      </dl>

      {calendar.days.length === 0 ? (
        <p className="text-sm text-ink-mid py-4 border-y border-line">No recurring bills or income in the next {horizon} days.</p>
      ) : (
        <ol className="border-y border-line divide-y divide-line">
          {calendar.days.map(day => (
            <li key={day.date} className="py-3 min-w-0">
              <h3 className="text-xs text-ink-dim mb-2">{dayHeading(day.date, dateFormat)}</h3>
              <ul className="space-y-2">
                {day.items.map(item => {
                  const status = STATUS[item.status];
                  const isIncome = item.type === 'income';
                  const cat = getCat(item.category);
                  return (
                    <li key={keyOf(item)} data-testid="bill-occurrence" className="flex items-center gap-3 flex-wrap min-w-0">
                      <span className="text-lg leading-none w-6 text-center" aria-hidden>{item.type === 'investment' ? '📈' : cat.icon}</span>
                      <div className="flex-1 min-w-[10rem]">
                        <div className="text-sm text-ink [overflow-wrap:anywhere]">{item.description || cat.label}</div>
                        <div className={`text-xs ${status.tone === 'ink-dim' ? 'text-ink-dim' : ''}`} style={status.tone === 'ink-dim' ? undefined : { color: `hsl(var(--${status.tone}))` }}>{status.label}</div>
                      </div>
                      <span className={`num text-sm ${isIncome ? 'text-sage' : 'text-ink'}`}>
                        {isIncome ? '+' : item.type === 'expense' ? '−' : ''}{fmt(item.amount, item.currency)}
                      </span>
                      {item.actionable && (
                        <div className="flex gap-2 w-full sm:w-auto sm:ml-2">
                          <button type="button" className="btn-primary min-h-[44px] px-4" disabled={busy === keyOf(item)} onClick={() => approve(item)}>Approve</button>
                          <button type="button" className="btn-ghost min-h-[44px] px-3" disabled={busy === keyOf(item)} onClick={() => skip(item)}>Skip once</button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
