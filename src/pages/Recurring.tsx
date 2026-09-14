import { useState } from 'react';
import { Repeat, Trash2, Pencil } from 'lucide-react';
import { useStore } from '../store';
import { Panel } from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import Money from '../components/ui/Money';
import Chip from '../components/ui/Chip';
import CategoryPicker from '../components/ui/CategoryPicker';
import { Field, Select } from '../components/ui/Input';
import { AmountField } from '../components/ui/NumericKeypad';
import HalfSheet from '../components/ui/HalfSheet';
import BillCalendar from '../components/recurring/BillCalendar';
import { formatDate } from '../lib/format';
import { getCat, CURRENCIES } from '../constants';
import type { RecurrenceFreq, RecurringSchedule } from '../types';
import { nextDueAfterSave } from '../lib/recurring';
import { formatRRule, parseRRule, describeRRule } from '../lib/rrule';

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
/** Clamp a day-of-month to 1–31, falling back to today for anything unusable
 *  (empty field, NaN, a stray minus). Applied on blur and submit — never on
 *  keystroke, which is what made the field impossible to retype. */
function clampDom(n: number): number {
  if (!Number.isFinite(n)) return todayDom();
  return Math.max(1, Math.min(31, Math.trunc(n)));
}
function todayMonth(): number { return new Date().getMonth() + 1; }

export default function Recurring() {
  const schedules = useStore(s => s.recurringSchedules);
  const members = useStore(s => s.members);
  const accounts = useStore(s => s.accounts);
  // v10.26.0 (R4) — an investment schedule puts money into a Net Worth asset.
  const investmentAssets = useStore(s => s.assets).filter(a => a.type === 'investment');
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
  // v10.20.6 — the account the schedule moves money through. Absent until now,
  // which made every form-created schedule generate un-syncable transactions.
  const [accountId, setAccountId] = useState<string>('');
  const [toAccountId, setToAccountId] = useState<string>('');
  const [endsKind, setEndsKind] = useState<EndsKind>('never');
  const [endsCount, setEndsCount] = useState('12');
  // Weekly
  const [weekDays, setWeekDays] = useState<number[]>([todayWeekday()]);
  // Monthly
  const [monthlyMode, setMonthlyMode] = useState<MonthlyMode>('dom');
  // DAY OF MONTH — the raw text is the state, the number is derived.
  //
  // This used to be `useState<number>` fed by an onChange that clamped on every
  // keystroke: `Math.max(1, Math.min(31, parseInt(e.target.value) || 1))`.
  // Backspacing to empty gives NaN, `|| 1` turns that into 1, and the field
  // re-renders as "1" — so the box can never be transiently blank and fights
  // you the moment you try to retype it. Typing a leading 0 collapsed the same
  // way. Reproduced live: clearing the field showed "1", "0" showed "1".
  //
  // Holding the text lets the input be empty or mid-typing; the clamp moves to
  // blur and submit, where it belongs. `dayOfMonth` stays a number for every
  // consumer below, so nothing else changes.
  const [domText, setDomText] = useState<string>(String(todayDom()));
  const dayOfMonth = clampDom(parseInt(domText, 10));
  const setDayOfMonth = (n: number) => setDomText(String(clampDom(n)));
  const [nthWeek, setNthWeek] = useState<number>(1);
  const [nthWeekday, setNthWeekday] = useState<number>(1); // Monday
  // Annual
  const [annualMonth, setAnnualMonth] = useState<number>(todayMonth());
  const [annualDay, setAnnualDay] = useState<number>(todayDom());

  function resetForm() {
    setType('expense'); setFreq('monthly'); setName(''); setAmount('');
    setCategory('rent_mortgage'); setAutoConfirm(true); setReminderLead(3);
    setOwnerMemberId(''); setEndsKind('never'); setEndsCount('12');
    setAccountId(''); setToAccountId('');
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
    // Refuse to save a schedule that cannot produce a storable transaction.
    // `ck_txn_accounts_by_type` rejects an account-less row with 23514, and the
    // failure used to surface only as a transaction that silently never synced.
    if (!accountId) { toast('Choose an account for this schedule', 'error'); return; }
    if (type === 'investment' && !toAccountId) {
      toast('Choose the investment to put this into', 'error'); return;
    }
    const startDate = editing?.startDate || new Date().toISOString().split('T')[0];
    const rrule = buildRruleStr();
    const dom = (freq === 'monthly' || freq === 'custom_day') && monthlyMode === 'dom' ? dayOfMonth : undefined;
    // v10.20.6 — was `computeNextDueDate(freq, startDate, undefined, dom ?? 1)`,
    // which always steps ONE period on from its base. Two bugs came out of that:
    //
    //   CREATE picking the 20th on the 8th → 2026-10-20, silently skipping the
    //   20th of THIS month.
    //
    //   EDIT was worse. `startDate` is the schedule's ORIGINAL start and
    //   lastGenerated was passed as undefined, so saving an edit to a schedule
    //   that began 2026-05-22 set nextDueDate to 2026-06-02 — months in the
    //   PAST. The engine then treated it as due and materialised a back-dated
    //   transaction on every refresh. That is the "recurring schedule shows up
    //   as a transaction for today" report.
    //
    // nextDueAfterSave answers the question actually being asked: the next
    // occurrence on or after today that has not already been generated.
    const next = nextDueAfterSave(freq, {
      startDate,
      dayOfMonth: dom,
      weekday: editing?.weekday,
      lastGenerated: editing?.lastGenerated,
    });
    const schedule = {
      ...(editing || {}),
      transactionTemplate: {
        ...(editing?.transactionTemplate || {}),
        type, amount: parseFloat(amount), description: name,
        category: type === 'investment' ? '' : category,
        currency: baseCur, recurring: freq === 'custom_day' ? 'monthly' : freq,
        memberId: ownerMemberId || undefined,
        // The per-type matrix `ck_txn_accounts_by_type` enforces: an expense
        // moves FROM an account, income moves TO one, an investment does both.
        // Written as undefined rather than null — a NOT-NULL column with a DB
        // default is omitted, never sent as explicit null.
        // v10.26.0 (R4) — an investment moves money FROM an account INTO an
        // asset, so it names `assetId`, never a second account.
        accountId:   type === 'income' ? undefined : (accountId || undefined),
        toAccountId: type === 'income' ? (accountId || undefined) : undefined,
        assetId:     type === 'investment' ? (toAccountId || undefined) : undefined,
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
    setAccountId(s.transactionTemplate.accountId ?? '');
    setToAccountId(s.transactionTemplate.assetId ?? s.transactionTemplate.toAccountId ?? '');
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

      {/* v10.32.0 — the approval-aware bill calendar replaces the 7-day strip. */}
      <BillCalendar />

      <Panel title="Active Schedules">
        {schedules.length === 0
          ? <EmptyState icon={<Repeat size={36} />} message="No recurring schedules yet — set up rent, salary, subscriptions" />
          : schedules.map(s => {
              const cat = getCat(s.transactionTemplate.category);
              return (
                <div key={s.id} data-testid="schedule-row"
                  className="flex items-center gap-3 px-4 py-3 border-b border-line last:border-b-0">
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
                  {/* The delete used to be `remove(s.id); toast('Schedule
                      deleted')` — fire-and-forget, with the success toast on the
                      very next line regardless of what happened. Any rejection
                      became an unhandled promise rejection: invisible in the UI,
                      invisible in the console for most users, and the toast
                      claimed success anyway.
                      That is why this read as "deletion doesn't work" with no
                      error to go on. Await it, and only claim success when the
                      write actually succeeded. */}
                  <button onClick={async () => {
                    if (!confirm('Delete this schedule?')) return;
                    try {
                      await remove(s.id);
                      toast('Schedule deleted', 'info');
                    } catch (e) {
                      toast(`Could not delete: ${(e as Error).message}`, 'error');
                    }
                  }} className="row-action danger" aria-label="Delete schedule" title="Delete">
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

        {type !== 'investment' && (
          <div className="mt-4">
            <CategoryPicker type={type} value={category} onChange={setCategory} />
          </div>
        )}

        {/* Account — v10.20.6. THE FORM HAD NO ACCOUNT FIELD AT ALL.
            Every transaction moves an account (binding money-model rule), and
            the DB enforces it per type via `ck_txn_accounts_by_type`. A schedule
            created here carried no account, so the transaction the engine
            generated from it was rejected by the cloud with 23514 and lived only
            on the device that made it — verified against production. Backfilled
            schedules inherited an account from their source transaction, which
            is why only form-created ones were affected. */}
        <div className="mt-4">
          <Field label={type === 'income' ? 'Deposit to' : type === 'investment' ? 'Invest from' : 'Pay from'}>
          <Select value={accountId} onChange={event => setAccountId(event.target.value)} required>
            <option value="">Choose account</option>
            {accounts.filter(a => a.isArchived !== true).map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
          </Field>
          {!accountId && (
            <div className="mt-1.5 text-[0.7rem] text-terra">
              Pick an account — without one this schedule&apos;s transactions cannot sync.
            </div>
          )}
        </div>

        {/* An investment is spend-neutral: it moves money BETWEEN two accounts,
            so it needs a destination as well as a source. */}
        {type === 'investment' && (
          <div className="mt-4">
            <Field label="Invest into" hint={investmentAssets.length === 0 ? 'Add an investment in Net Worth first.' : undefined}>
            <Select value={toAccountId} onChange={event => setToAccountId(event.target.value)} required disabled={investmentAssets.length === 0}>
              <option value="">Choose investment</option>
              {investmentAssets.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
            </Field>
          </div>
        )}

        <div className="mt-4">
          <Field label="Owner" hint={type === 'investment' ? 'Attributed to' : undefined}>
          <Select value={ownerMemberId} onChange={event => setOwnerMemberId(event.target.value)}>
            <option value="">Household</option>
            {members.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>
          </Field>
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
                <input type="number" min={1} max={31} value={domText}
                  onChange={e => setDomText(e.target.value)}
                  onBlur={() => setDomText(String(clampDom(parseInt(domText, 10))))}
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
