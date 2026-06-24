import { useState } from 'react';
import { Repeat, Trash2, Pencil } from 'lucide-react';
import { useStore } from '../store';
import { Panel } from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import Money from '../components/ui/Money';
import { Input, Select, Field, FieldRow } from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import { formatDate } from '../lib/format';
import { getCat, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../constants';
import type { RecurrenceFreq, RecurringSchedule } from '../types';
import { computeNextDueDate } from '../lib/recurring';
import { formatRRule, parseRRule } from '../lib/rrule';

type SchedType = 'expense' | 'income' | 'investment';
type MonthlyMode = 'dom' | 'nth';
type EndsKind = 'never' | 'count';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const NTH_LABELS = ['1st', '2nd', '3rd', '4th', 'Last'];
const NTH_VALUES = [1, 2, 3, 4, -1];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function todayWeekday(): number { return new Date().getDay(); }
function todayDom(): number { return new Date().getDate(); }
function todayMonth(): number { return new Date().getMonth() + 1; }

export default function Recurring() {
  const schedules = useStore(s => s.recurringSchedules);
  const members = useStore(s => s.members);
  const upsert = useStore(s => s.upsertRecurring);
  const remove = useStore(s => s.removeRecurring);
  const baseCur = useStore(s => s.profile.baseCurrency);
  const dateFormat = useStore(s => s.profile.dateFormat);
  const toast = useStore(s => s.toast);

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
                    <div className="font-mono text-[0.62rem] text-ink-dim mt-px">
                      {s.frequency.toUpperCase()} · next {formatDate(s.nextDueDate, dateFormat)} · {s.autoConfirm ? 'auto' : 'pending confirm'}
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

      <Modal open={open} onClose={() => { setOpen(false); setEditing(null); }} title={editing ? 'Edit Recurring Schedule' : 'Add Recurring Schedule'}>
        <div>
          {/* Type */}
          <Field label="Type">
            <div className="grid grid-cols-3 gap-1 bg-bg3 p-1 rounded-md">
              {(['expense','income','investment'] as const).map(t => (
                <button key={t} type="button" onClick={() => setType(t)}
                  className={`py-2 font-mono text-[0.62rem] tracking-wider uppercase rounded transition ${type === t ? (t === 'expense' ? 'bg-terra/15 text-terra' : t === 'income' ? 'bg-sage/15 text-olive' : 'bg-denim/15 text-denim') : 'text-ink-mid'}`}>
                  {t}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Description"><Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Rent · Salary · SIP" /></Field>
          <FieldRow>
            <Field label="Amount"><Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></Field>
            {type === 'investment' ? (
              <Field label="Owner" hint="attributed to">
                <Select value={ownerMemberId} onChange={e => setOwnerMemberId(e.target.value)}>
                  <option value="">— Household —</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </Field>
            ) : (
              <Field label="Category">
                <Select value={category} onChange={e => setCategory(e.target.value)}>
                  {(type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).map(c =>
                    <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
                  )}
                </Select>
              </Field>
            )}
          </FieldRow>
          {type !== 'investment' && (
            <Field label="Owner" hint="generated transactions are attributed to">
              <Select value={ownerMemberId} onChange={e => setOwnerMemberId(e.target.value)}>
                <option value="">— Household —</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
          )}

          {/* Recurrence frequency tabs */}
          <Field label="Recurrence">
            <div className="flex gap-1 bg-bg3 p-1 rounded-md">
              {FREQ_TABS.map(({ key, label }) => (
                <button key={key} type="button" onClick={() => setFreq(key)}
                  className={`flex-1 py-2 font-mono text-[0.62rem] tracking-wider uppercase rounded transition ${freq === key ? 'bg-bg border border-line text-ink font-semibold shadow-sm' : 'text-ink-mid hover:text-ink'}`}>
                  {label}
                </button>
              ))}
            </div>
          </Field>

          {/* Daily — no sub-options, just ends */}

          {/* Weekly — day-of-week chips */}
          {freq === 'weekly' && (
            <Field label="Repeat on">
              <div className="flex gap-1.5 flex-wrap">
                {WEEKDAYS.map((d, i) => (
                  <button key={i} type="button" onClick={() => toggleWeekday(i)}
                    className={`w-9 h-9 rounded-full font-mono text-[0.68rem] border transition ${weekDays.includes(i) ? 'bg-coral text-white border-coral' : 'border-line text-ink-mid hover:border-coral/50'}`}>
                    {d}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {/* Monthly — DOM or Nth weekday */}
          {(freq === 'monthly' || freq === 'custom_day') && (
            <Field label="Repeat on">
              <div className="flex gap-2 mb-2">
                {(['dom', 'nth'] as MonthlyMode[]).map(m => (
                  <label key={m} className="flex items-center gap-1.5 text-[0.84rem] text-ink cursor-pointer">
                    <input type="radio" name="monthlyMode" checked={monthlyMode === m} onChange={() => setMonthlyMode(m)} className="accent-coral" />
                    {m === 'dom' ? 'Day of month' : 'Nth weekday'}
                  </label>
                ))}
              </div>
              {monthlyMode === 'dom' ? (
                <div className="flex items-center gap-2">
                  <span className="text-[0.84rem] text-ink-mid">Day</span>
                  <Input type="number" min={1} max={31} value={dayOfMonth}
                    onChange={e => setDayOfMonth(Math.max(1, Math.min(31, parseInt(e.target.value) || 1)))}
                    className="w-20" />
                  <span className="text-[0.84rem] text-ink-mid">of each month</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <Select value={nthWeek} onChange={e => setNthWeek(Number(e.target.value))} className="w-auto">
                    {NTH_VALUES.map((v, i) => <option key={v} value={v}>{NTH_LABELS[i]}</option>)}
                  </Select>
                  <Select value={nthWeekday} onChange={e => setNthWeekday(Number(e.target.value))} className="w-auto">
                    {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </Select>
                  <span className="text-[0.84rem] text-ink-mid">of each month</span>
                </div>
              )}
            </Field>
          )}

          {/* Annual — month + day */}
          {freq === 'yearly' && (
            <Field label="Repeat on">
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={annualMonth} onChange={e => setAnnualMonth(Number(e.target.value))} className="w-auto">
                  {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </Select>
                <Input type="number" min={1} max={31} value={annualDay}
                  onChange={e => setAnnualDay(Math.max(1, Math.min(31, parseInt(e.target.value) || 1)))}
                  className="w-20" />
              </div>
            </Field>
          )}

          {/* Ends */}
          <FieldRow>
            <Field label="Ends">
              <Select value={endsKind} onChange={e => setEndsKind(e.target.value as EndsKind)}>
                <option value="never">Never</option>
                <option value="count">After N occurrences</option>
              </Select>
            </Field>
            {endsKind === 'count' && (
              <Field label="Occurrences">
                <Input type="number" min={1} value={endsCount} onChange={e => setEndsCount(e.target.value)} placeholder="12" />
              </Field>
            )}
          </FieldRow>

          <FieldRow>
            <Field label="Reminder lead time">
              <Select value={reminderLead} onChange={e => setReminderLead(parseInt(e.target.value) as 1|3|7)}>
                <option value="1">1 day before</option>
                <option value="3">3 days before</option>
                <option value="7">7 days before</option>
              </Select>
            </Field>
            <Field label="Confirmation">
              <label className="flex items-center gap-2 mt-2.5 text-[0.84rem] text-ink cursor-pointer">
                <input type="checkbox" checked={autoConfirm} onChange={e => setAutoConfirm(e.target.checked)} className="accent-coral" />
                Auto-approve (uncheck to review manually)
              </label>
            </Field>
          </FieldRow>

          <div className="flex gap-2 mt-5 pt-4 border-t border-line">
            <Button variant="ghost" onClick={() => { setOpen(false); setEditing(null); }} full>Cancel</Button>
            <Button onClick={save} full>{editing ? 'Update Schedule' : 'Save Schedule'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
