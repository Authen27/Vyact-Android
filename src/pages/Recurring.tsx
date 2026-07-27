import { useState, useMemo } from 'react';
import { Repeat, Trash2, Pencil } from 'lucide-react';
import { useStore } from '../store';
import { Panel } from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import Money from '../components/ui/Money';
import Chip, { CategoryChip } from '../components/ui/Chip';
import { AmountField } from '../components/ui/NumericKeypad';
import HalfSheet from '../components/ui/HalfSheet';
import { formatDate, today } from '../lib/format';
import { getCat, EXPENSE_CATEGORIES, INCOME_CATEGORIES, CURRENCIES } from '../constants';
import type { RecurrenceFreq, RecurringSchedule } from '../types';
import { computeNextDueDate } from '../lib/recurring';
import { formatRRule, parseRRule, describeRRule } from '../lib/rrule';

/* Board M4 member chips are initials ("MR"), matching Add Transaction. */
const memberInitials = (name: string) =>
  name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';

type SchedType = 'expense' | 'income' | 'investment';
type MonthlyMode = 'dom' | 'nth';
type EndsKind = 'never' | 'count';

const TYPE_META: Record<SchedType, { label: string; emoji: string }> = {
  expense:    { label: 'Expense',    emoji: '💸' },
  income:     { label: 'Income',     emoji: '💰' },
  investment: { label: 'Investment', emoji: '📈' },
};

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const NTH_LABELS = ['1st', '2nd', '3rd', '4th', 'Last'];
const NTH_VALUES = [1, 2, 3, 4, -1];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function todayWeekday(): number { return new Date().getDay(); }
function todayDom(): number { return new Date().getDate(); }
function todayMonth(): number { return new Date().getMonth() + 1; }
const daysUntil = (d: string): number =>
  Math.round((Date.parse(`${d}T00:00:00`) - Date.parse(`${today()}T00:00:00`)) / 86_400_000);
const countdownLabel = (d: number): string => (d <= 0 ? 'Due today' : d === 1 ? 'Tomorrow' : `in ${d} days`);

export default function Recurring() {
  const schedules = useStore(s => s.recurringSchedules);
  const members = useStore(s => s.members);
  const upsert = useStore(s => s.upsertRecurring);
  const remove = useStore(s => s.removeRecurring);
  const baseCur = useStore(s => s.profile.baseCurrency);
  const dateFormat = useStore(s => s.profile.dateFormat);
  const toast = useStore(s => s.toast);

  // Board M5 — schedules due within the next 7 days, for the upcoming strip.
  const upcoming = useMemo(() => {
    const t0 = today();
    return schedules
      .filter(s => s.active !== false && s.nextDueDate >= t0 && daysUntil(s.nextDueDate) <= 7)
      .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
  }, [schedules]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringSchedule | null>(null);
  const [type, setType] = useState<SchedType>('expense');
  const [freq, setFreq] = useState<RecurrenceFreq>('monthly');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('rent_mortgage');
  const [autoConfirm, setAutoConfirm] = useState(true);
  const [reminderLead, setReminderLead] = useState<1|3|7>(3);
  const [ownerMemberId, setOwnerMemberId] = useState<string>('');
  const [endsKind, setEndsKind] = useState<EndsKind>('never');
  const [endsCount, setEndsCount] = useState('12');
  // Weekly
  const [weekDays, setWeekDays] = useState<number[]>([todayWeekday()]);
  // Monthly
  const [monthlyMode, setMonthlyMode] = useState<MonthlyMode>('dom');
  const [dayOfMonth, setDayOfMonth] = useState<number>(todayDom());
  const [nthWeek, setNthWeek] = useState<number>(1);
  const [nthWeekday, setNthWeekday] = useState<number>(1); // Monday
  // Annual
  const [annualMonth, setAnnualMonth] = useState<number>(todayMonth());
  const [annualDay, setAnnualDay] = useState<number>(todayDom());

  function resetForm() {
    setType('expense'); setFreq('monthly'); setName(''); setAmount('');
    setCategory('rent_mortgage'); setAutoConfirm(true); setReminderLead(3);
    setOwnerMemberId(''); setEndsKind('never'); setEndsCount('12');
    setWeekDays([todayWeekday()]); setMonthlyMode('dom');
    setDayOfMonth(todayDom()); setNthWeek(1); setNthWeekday(1);
    setAnnualMonth(todayMonth()); setAnnualDay(todayDom());
  }

  function toggleWeekday(d: number) {
    setWeekDays(ws => ws.includes(d) ? (ws.length > 1 ? ws.filter(x => x !== d) : ws) : [...ws, d].sort());
  }

  function buildRruleStr(): string {
    const ends = endsKind === 'count' ? { count: Math.max(1, parseInt(endsCount, 10) || 1) } : {};
    if (freq === 'daily') {
      return formatRRule({ freq: 'DAILY', interval: 1, ...ends });
    }
    if (freq === 'weekly') {
      return formatRRule({ freq: 'WEEKLY', interval: 1, byDay: [...weekDays].sort(), ...ends });
    }
    if (freq === 'monthly' || freq === 'custom_day') {
      if (monthlyMode === 'nth') {
        return formatRRule({ freq: 'MONTHLY', interval: 1, bySetPos: [nthWeek], byDay: [nthWeekday], ...ends });
      }
      return formatRRule({ freq: 'MONTHLY', interval: 1, byMonthDay: [dayOfMonth], ...ends });
    }
    if (freq === 'yearly') {
      return formatRRule({ freq: 'YEARLY', interval: 1, byMonth: [annualMonth], byMonthDay: [annualDay], ...ends });
    }
    return formatRRule({ freq: 'MONTHLY', interval: 1, ...ends });
  }

  async function save() {
    if (!name || !amount) { toast('Enter a name and amount', 'error'); return; }
    const startDate = editing?.startDate || new Date().toISOString().split('T')[0];
    const rrule = buildRruleStr();
    const dom = (freq === 'monthly' || freq === 'custom_day') && monthlyMode === 'dom' ? dayOfMonth : undefined;
    const next = computeNextDueDate(freq, startDate, undefined, dom ?? 1);
    const schedule = {
      ...(editing || {}),
      transactionTemplate: {
        ...(editing?.transactionTemplate || {}),
        type, amount: parseFloat(amount), description: name,
        category: type === 'investment' ? '' : category,
        currency: baseCur, recurring: freq === 'custom_day' ? 'monthly' : freq,
        memberId: ownerMemberId || undefined,
      },
      frequency: freq,
      dayOfMonth: dom,
      startDate,
      nextDueDate: next,
      autoConfirm,
      active: editing?.active ?? true,
      reminderLeadDays: reminderLead,
      rrule,
      ownerMemberId: ownerMemberId || undefined,
    };
    await upsert(schedule);
    setOpen(false); setEditing(null); resetForm();
    toast(editing ? 'Recurring schedule updated' : 'Recurring schedule created', 'success');
  }

  function populateFromSchedule(s: RecurringSchedule) {
    setEditing(s);
    setType((['expense','income','investment'] as const).includes(s.transactionTemplate.type as SchedType) ? s.transactionTemplate.type as SchedType : 'expense');
    setFreq(s.frequency);
    setName(s.transactionTemplate.description);
    setAmount(String(s.transactionTemplate.amount));
    setCategory(s.transactionTemplate.category || 'rent_mortgage');
    setAutoConfirm(s.autoConfirm);
    setReminderLead(([1,3,7] as const).includes(s.reminderLeadDays as 1|3|7) ? (s.reminderLeadDays as 1|3|7) : 3);
    setOwnerMemberId(s.ownerMemberId ?? s.transactionTemplate.memberId ?? '');
    // Parse RRULE to restore sub-fields
    if (s.rrule) {
      const r = parseRRule(s.rrule);
      setEndsKind(r.count != null ? 'count' : 'never');
      setEndsCount(r.count != null ? String(r.count) : '12');
      if (r.freq === 'WEEKLY' && r.byDay?.length) setWeekDays([...r.byDay]);
      if (r.freq === 'MONTHLY') {
        if (r.bySetPos?.length && r.byDay?.length) {
          setMonthlyMode('nth');
          setNthWeek(r.bySetPos[0]);
          setNthWeekday(r.byDay[0]);
        } else {
          setMonthlyMode('dom');
          setDayOfMonth(r.byMonthDay?.[0] ?? s.dayOfMonth ?? todayDom());
        }
      }
      if (r.freq === 'YEARLY') {
        setAnnualMonth(r.byMonth?.[0] ?? todayMonth());
        setAnnualDay(r.byMonthDay?.[0] ?? todayDom());
      }
    } else {
      setEndsKind('never'); setEndsCount('12');
      setDayOfMonth(s.dayOfMonth ?? todayDom());
      setMonthlyMode('dom');
    }
  }

  const FREQ_TABS: { key: RecurrenceFreq; label: string }[] = [
    { key: 'daily',   label: 'Daily' },
    { key: 'weekly',  label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
    { key: 'yearly',  label: 'Annual' },
  ];

  return (
    <div>
      <div className="flex justify-between items-start mb-5 gap-4">
        <div className="min-w-0">
          <h1 className="display-italic text-4xl text-ink mb-1.5">Recurring</h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            Auto-generated bills, subscriptions &amp; salary · {schedules.length} schedule{schedules.length === 1 ? '' : 's'}
          </p>
        </div>
        <button className="btn-primary flex-shrink-0" onClick={() => { resetForm(); setEditing(null); setOpen(true); }}>+ Add Schedule</button>
      </div>

      {/* Board M5 — upcoming-7-day strip: what's about to post, with a countdown. */}
      {upcoming.length > 0 && (
        <div className="mb-5">
          <div className="mono-label mb-2">Next 7 days</div>
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
            {upcoming.map(s => {
              const d = daysUntil(s.nextDueDate);
              const cat = getCat(s.transactionTemplate.category);
              const isIncome = s.transactionTemplate.type === 'income';
              return (
                <div key={s.id} className="min-w-[152px] flex-shrink-0 rounded-r3 p-3.5" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-lg leading-none">{cat.icon}</span>
                    <span className="num text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-md"
                      style={{ background: d <= 1 ? 'color-mix(in srgb, hsl(var(--honey)) 18%, transparent)' : 'var(--sunken)', color: d <= 1 ? 'hsl(var(--honey))' : 'var(--ff-ink-3)' }}>
                      {countdownLabel(d)}
                    </span>
                  </div>
                  <div className="font-display font-semibold text-[13.5px] text-ink truncate">{s.transactionTemplate.description}</div>
                  <Money amount={s.transactionTemplate.amount} currency={s.transactionTemplate.currency}
                    className={`num text-[15px] font-bold ${isIncome ? 'text-sage' : 'text-ink'}`} signed={isIncome} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Panel title="Active Schedules">
        {schedules.length === 0
          ? <EmptyState icon={<Repeat size={36} />} message="No recurring schedules yet — set up rent, salary, subscriptions" />
          : schedules.map(s => {
              const cat = getCat(s.transactionTemplate.category);
              return (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3 border-b border-line last:border-b-0">
                  <div className="w-9 h-9 rounded-md flex items-center justify-center text-base flex-shrink-0" style={{ background: cat.color + '22' }}>
                    {cat.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-ink truncate">{s.transactionTemplate.description}</div>
                    {/* Board B — schedules read as human sentences ("Monthly on
                        the 16th"), not raw frequency codes. Legacy rows without
                        an rrule fall back to the frequency word. */}
                    <div className="font-mono text-[0.62rem] text-ink-dim mt-px truncate">
                      {(() => {
                        try { return s.rrule ? describeRRule(parseRRule(s.rrule)) : s.frequency; }
                        catch { return s.frequency; }
                      })()} · next {formatDate(s.nextDueDate, dateFormat)} · {s.autoConfirm ? 'auto' : 'pending confirm'}
                    </div>
                  </div>
                  <div className={`text-[0.86rem] font-medium ${s.transactionTemplate.type === 'income' ? 'text-sage' : 'text-terra'}`}>
                    <Money amount={s.transactionTemplate.amount} currency={s.transactionTemplate.currency} className="font-medium" signed={s.transactionTemplate.type === 'income'} />
                  </div>
                  <button onClick={() => { if (confirm('Delete this schedule?')) { remove(s.id); toast('Schedule deleted', 'info'); } }} className="row-action danger" aria-label="Delete schedule" title="Delete">
                    <Trash2 size={14} strokeWidth={1.6} />
                  </button>
                  <button onClick={() => { populateFromSchedule(s); setOpen(true); }} className="row-action" aria-label="Edit schedule" title="Edit">
                    <Pencil size={14} strokeWidth={1.6} />
                  </button>
                </div>
              );
            })
        }
      </Panel>

      <HalfSheet open={open} onClose={() => { setOpen(false); setEditing(null); }} title={editing ? 'Edit Recurring Schedule' : 'Add Recurring Schedule'}
        footer={
          <div>
            <button type="button" onClick={save}
              className="btn-primary w-full h-[50px] text-[15.5px] rounded-[15px]">
              {editing ? 'Update schedule' : 'Save schedule'}
            </button>
            <div className="text-center mt-2">
              <button type="button" onClick={() => { setOpen(false); setEditing(null); }}
                className="font-mono text-[9px] tracking-[0.15em] uppercase text-ink-dim hover:text-ink">
                Cancel
              </button>
            </div>
          </div>
        }
      >
        {/* Track chips — centered, matches Add Transaction's board M4 row. */}
        <div className="flex gap-1.5 flex-wrap justify-center mb-3">
          {(['expense', 'income', 'investment'] as const).map(t => (
            <Chip key={t} on={type === t} onClick={() => setType(t)}>
              <span aria-hidden>{TYPE_META[t].emoji}</span>{TYPE_META[t].label}
            </Chip>
          ))}
        </div>

        {/* Amount hero — bare, same as Add Transaction. */}
        <div className="py-1 mb-1">
          <AmountField value={amount} currencySymbol={CURRENCIES[baseCur]?.symbol ?? '$'} onChange={setAmount} />
        </div>

        <div className="mt-4">
          <div className="mono-label mb-1.5">Description</div>
          <input className="input w-full" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Rent · Salary · SIP" aria-label="Description" />
        </div>

        {/* Category tiles — expense/income only (investment carries no category). */}
        {type !== 'investment' && (
          <div className="mt-4">
            <div className="mono-label mb-1.5">Category</div>
            <div className="flex gap-1.5 flex-wrap">
              {(type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).map(c => (
                <CategoryChip key={c.id} emoji={c.icon} label={c.label}
                  on={c.id === category} onClick={() => setCategory(c.id)} />
              ))}
            </div>
          </div>
        )}

        {/* Owner — member initial chips, matches Add Transaction's member row. */}
        <div className="mt-4">
          <div className="mono-label mb-1.5">
            Owner {type === 'investment' ? <span className="text-ink-dim">·attributed to</span> : null}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <Chip on={!ownerMemberId} onClick={() => setOwnerMemberId('')}>Household</Chip>
            {members.map(m => (
              <Chip key={m.id} on={m.id === ownerMemberId} onClick={() => setOwnerMemberId(m.id)}>
                {memberInitials(m.name)}
              </Chip>
            ))}
          </div>
        </div>

        {/* Recurrence frequency */}
        <div className="mt-4">
          <div className="mono-label mb-1.5">Recurrence</div>
          <div className="flex gap-1.5 flex-wrap">
            {FREQ_TABS.map(({ key, label }) => (
              <Chip key={key} on={freq === key} onClick={() => setFreq(key)}>{label}</Chip>
            ))}
          </div>
        </div>

        {/* Weekly — day-of-week chips */}
        {freq === 'weekly' && (
          <div className="mt-4">
            <div className="mono-label mb-1.5">Repeat on</div>
            <div className="flex gap-1.5 flex-wrap">
              {WEEKDAYS.map((d, i) => (
                <Chip key={i} on={weekDays.includes(i)} onClick={() => toggleWeekday(i)}>{d}</Chip>
              ))}
            </div>
          </div>
        )}

        {/* Monthly — DOM or Nth weekday */}
        {(freq === 'monthly' || freq === 'custom_day') && (
          <div className="mt-4">
            <div className="mono-label mb-1.5">Repeat on</div>
            <div className="flex gap-1.5 mb-2">
              <Chip on={monthlyMode === 'dom'} onClick={() => setMonthlyMode('dom')}>Day of month</Chip>
              <Chip on={monthlyMode === 'nth'} onClick={() => setMonthlyMode('nth')}>Nth weekday</Chip>
            </div>
            {monthlyMode === 'dom' ? (
              <div className="flex items-center gap-2">
                <span className="text-[0.84rem] text-ink-mid">Day</span>
                <input type="number" min={1} max={31} value={dayOfMonth}
                  onChange={e => setDayOfMonth(Math.max(1, Math.min(31, parseInt(e.target.value) || 1)))}
                  className="input h-[34px] py-0 px-2.5 text-[12.5px] w-20" aria-label="Day of month" />
                <span className="text-[0.84rem] text-ink-mid">of each month</span>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex gap-1.5 flex-wrap">
                  {NTH_LABELS.map((lab, i) => (
                    <Chip key={lab} on={nthWeek === NTH_VALUES[i]} onClick={() => setNthWeek(NTH_VALUES[i])}>{lab}</Chip>
                  ))}
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {WEEKDAYS.map((d, i) => (
                    <Chip key={i} on={nthWeekday === i} onClick={() => setNthWeekday(i)}>{d}</Chip>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Annual — month + day */}
        {freq === 'yearly' && (
          <div className="mt-4">
            <div className="mono-label mb-1.5">Repeat on</div>
            <div className="flex gap-1.5 flex-wrap mb-2">
              {MONTH_NAMES.map((m, i) => (
                <Chip key={i} on={annualMonth === i + 1} onClick={() => setAnnualMonth(i + 1)}>{m}</Chip>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[0.84rem] text-ink-mid">Day</span>
              <input type="number" min={1} max={31} value={annualDay}
                onChange={e => setAnnualDay(Math.max(1, Math.min(31, parseInt(e.target.value) || 1)))}
                className="input h-[34px] py-0 px-2.5 text-[12.5px] w-20" aria-label="Day of month" />
            </div>
          </div>
        )}

        {/* Ends */}
        <div className="mt-4">
          <div className="mono-label mb-1.5">Ends</div>
          <div className="flex gap-1.5 flex-wrap items-center">
            <Chip on={endsKind === 'never'} onClick={() => setEndsKind('never')}>Never</Chip>
            <Chip on={endsKind === 'count'} onClick={() => setEndsKind('count')}>After N times</Chip>
            {endsKind === 'count' && (
              <input type="number" min={1} value={endsCount} onChange={e => setEndsCount(e.target.value)}
                placeholder="12" aria-label="Number of occurrences"
                className="input h-[34px] py-0 px-2.5 text-[12.5px] w-20" />
            )}
          </div>
        </div>

        {/* Reminder lead time */}
        <div className="mt-4">
          <div className="mono-label mb-1.5">Remind me</div>
          <div className="flex gap-1.5 flex-wrap">
            {([1, 3, 7] as const).map(n => (
              <Chip key={n} on={reminderLead === n} onClick={() => setReminderLead(n)}>{n} day{n > 1 ? 's' : ''} before</Chip>
            ))}
          </div>
        </div>

        {/* Auto-approve — same inline switch as Add Transaction's split toggle. */}
        <div className="mt-3">
          <div className="flex items-center gap-2.5 py-2.5">
            <span className="font-display font-semibold text-[13px] text-ink">Auto-approve</span>
            <span className="text-[10.5px] text-ink-dim">
              {autoConfirm ? 'posts automatically' : 'you confirm each time'}
            </span>
            <button
              type="button" role="switch" aria-checked={autoConfirm} aria-label="Auto-approve this schedule"
              onClick={() => setAutoConfirm(a => !a)}
              className="ml-auto relative w-[44px] h-[26px] rounded-pill border-none cursor-pointer flex-shrink-0"
              style={{
                background: autoConfirm ? 'color-mix(in srgb, hsl(var(--sage)) 40%, var(--sunken))' : 'var(--sunken)',
                boxShadow: 'var(--neu-inset)',
              }}
            >
              <i aria-hidden className="absolute top-[3px] w-5 h-5 rounded-full transition-[left] duration-150"
                style={{
                  left: autoConfirm ? 21 : 3,
                  background: autoConfirm ? 'hsl(var(--sage))' : 'var(--ff-ink-3)',
                  boxShadow: '0 1px 3px rgba(0,0,0,.3)',
                }} />
            </button>
          </div>
        </div>
      </HalfSheet>
    </div>
  );
}
