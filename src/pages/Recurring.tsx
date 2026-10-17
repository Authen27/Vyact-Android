import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Repeat, Trash2, Pencil, ChevronRight } from 'lucide-react';
import CategoryTile from '../components/ui/CategoryTile';
import { useStore } from '../store';
import { Panel } from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import Money from '../components/ui/Money';
import Chip from '../components/ui/Chip';
import CategoryPicker from '../components/ui/CategoryPicker';
import { Field, Select } from '../components/ui/Input';
import { AmountField } from '../components/ui/NumericKeypad';
import { parseAmount } from '../lib/amountInput';
import HalfSheet from '../components/ui/HalfSheet';
import FormSection from '../components/ui/FormSection';
import SegmentedControl from '../components/ui/SegmentedControl';
import { scheduleSummary } from '../lib/scheduleSummary';
import BillCalendar from '../components/recurring/BillCalendar';
import { formatDate, today, addDaysISO, fmt } from '../lib/format';
import { getCat, CURRENCIES } from '../constants';
import type { RecurrenceFreq, RecurringSchedule } from '../types';
import type { RecurringSeed } from '../lib/askVyactResponses';
import { scheduleDatesAfterSave, ruleOf, isLoanEmiSchedule } from '../lib/recurring';
import { formatRRule, describeRRule, type RRule, type ShortMonthPolicy } from '../lib/rrule';
import { runExclusive } from '../lib/exclusive';
import { loanEmiRows, type LoanEmiRow } from '../lib/loanRecurring';
import { clearsLabel } from '../lib/loanSchedule';
import PageHead from '../components/ui/PageHead';
import { writeSetupFlag } from '../lib/setupChecklist';
import { confirmSheet } from '../lib/confirmSheet';
import { deleteScheduleRequest } from '../lib/confirmCopy';

type SchedType = 'expense' | 'income' | 'investment';
type MonthlyMode = 'dom' | 'nth';
type EndsKind = 'never' | 'count' | 'until';

const TYPE_META: Record<SchedType, { label: string; emoji: string }> = {
  expense:    { label: 'Expense',    emoji: '💸' },
  income:     { label: 'Income',     emoji: '💰' },
  investment: { label: 'Investment', emoji: '📈' },
};

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const NTH_LABELS = ['1st', '2nd', '3rd', '4th', 'Last'];
const NTH_VALUES = [1, 2, 3, 4, -1];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The most days a month can have (Feb 29 in a leap year) — the annual day is clamped to it. */
const MONTH_MAX_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const WORK_WEEK = [1, 2, 3, 4, 5];

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
  // CF7 — one delete for the row (desktop) and the editor (FIT2: on phones the editor holds it).
  async function deleteSchedule(s: RecurringSchedule): Promise<boolean> {
    const made = useStore.getState().transactions.filter(t => t.recurringScheduleId === s.id).length;
    if (!(await confirmSheet(deleteScheduleRequest({ name: s.transactionTemplate.description || getCat(s.transactionTemplate.category).label, made })))) return false;
    try {
      await remove(s.id);
      toast('Schedule deleted', 'info');
      return true;
    } catch (e) {
      toast(`Could not delete: ${(e as Error).message}`, 'error');
      return false;
    }
  }
  const baseCur = useStore(s => s.profile.baseCurrency);
  const dateFormat = useStore(s => s.profile.dateFormat);
  const toast = useStore(s => s.toast);
  // Aurora 4.0 FR1 — opening Recurring counts as reviewing the bills setup created (the checklist step).
  const householdId = useStore(s => s.currentHouseholdId);
  useEffect(() => { writeSetupFlag(householdId, 'reviewedBills'); }, [householdId]);
  // Track E, E6a (owner, 13 Oct 2026) — each live loan's EMI, mirrored from the loan (lib/loanRecurring).
  const debts = useStore(s => s.debts);
  const transactions = useStore(s => s.transactions);
  const upsertDebt = useStore(s => s.upsertDebt);
  const openEditDebt = useStore(s => s.openEditDebt);
  const loanRows = useMemo(() => loanEmiRows(debts, accounts, transactions, baseCur), [debts, accounts, transactions, baseCur]);
  // E-3: the leftover EMI schedules are retired — never listed beside the loan's own EMI.
  const listed = useMemo(() => schedules.filter(s => !isLoanEmiSchedule(s)), [schedules]);
  const switchSlot = useRef(false);

  /** "Record automatically" is the LOAN's switch; turning it on needs the paying account and the next EMI date. */
  async function toggleAutoRecord(row: LoanEmiRow) {
    if (!row.autoRecord && row.needs.length) {
      toast(row.needs.includes('account')
        ? 'Choose the account the EMI is paid from, then turn on Record each EMI automatically'
        : 'Add the next EMI date, then turn on Record each EMI automatically', 'info');
      openEditDebt(row.debt);
      return;
    }
    await runExclusive(switchSlot, async () => {
      try {
        // A patch over the loan as held; its version guards against a change made elsewhere meanwhile.
        await upsertDebt({ ...row.debt, autoRecord: !row.autoRecord });
        toast(row.autoRecord ? `${row.debt.name}: you pay each EMI from Debts` : `${row.debt.name}: Vyact records each EMI on its date`, 'success');
      } catch (e) {
        toast(`Could not change it: ${(e as Error).message}`, 'error');
      }
    });
  }

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringSchedule | null>(null);
  // W6 (audit FE-UIC-13) — one save at a time: a double tap used to create two schedules.
  const savingSlot = useRef(false);
  const [saving, setSaving] = useState(false);
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
  const [endsUntil, setEndsUntil] = useState(() => addDaysISO(today(), 365));
  // W3e — an edited rule keeps its interval (a quarterly schedule stays quarterly), and the schedule
  // chooses what its 29th–31st does in a shorter month (owner decision D13).
  const [ruleInterval, setRuleInterval] = useState(1);
  const [shortMonthPolicy, setShortMonthPolicy] = useState<ShortMonthPolicy>('last_day');
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
    setEndsUntil(addDaysISO(today(), 365)); setRuleInterval(1); setShortMonthPolicy('last_day');
    setAccountId(''); setToAccountId('');
    setWeekDays([todayWeekday()]); setMonthlyMode('dom');
    setDayOfMonth(todayDom()); setNthWeek(1); setNthWeekday(1);
    setAnnualMonth(todayMonth()); setAnnualDay(todayDom());
  }

  function toggleWeekday(d: number) {
    setWeekDays(ws => ws.includes(d) ? (ws.length > 1 ? ws.filter(x => x !== d) : ws) : [...ws, d].sort());
  }

  /** The annual day, clamped to the chosen month (31 Apr is 30 Apr; Feb allows the 29th). */
  const annualDayFor = (month: number, day: number) => Math.max(1, Math.min(MONTH_MAX_DAY[month - 1], day));

  // A day some months do not have: the schedule chooses where it goes in those months.
  const needsMonthEndRule =
    ((freq === 'monthly' || freq === 'custom_day') && monthlyMode === 'dom' && dayOfMonth >= 29)
    || (freq === 'yearly' && annualMonth === 2 && annualDay === 29);

  /**
   * W3e — the rule the form describes. It is SAVED (the store used to drop it) and it is the one
   * every date is read from: the engine, the server, the bill calendar and the projections.
   */
  function buildRule(): RRule {
    const ends = endsKind === 'count' ? { count: Math.max(1, parseInt(endsCount, 10) || 1) }
      : endsKind === 'until' ? { until: endsUntil } : {};
    const keep = (f: RRule['freq']) => (editing && ruleOf(editing).freq === f ? ruleInterval : 1);
    if (freq === 'daily') return { freq: 'DAILY', interval: keep('DAILY'), ...ends };
    if (freq === 'weekly') return { freq: 'WEEKLY', interval: keep('WEEKLY'), byDay: [...weekDays].sort(), ...ends };
    if (freq === 'yearly') {
      return { freq: 'YEARLY', interval: keep('YEARLY'), byMonth: [annualMonth], byMonthDay: [annualDayFor(annualMonth, annualDay)], ...ends };
    }
    if (monthlyMode === 'nth') {
      return { freq: 'MONTHLY', interval: keep('MONTHLY'), bySetPos: [nthWeek], byDay: [nthWeekday], ...ends };
    }
    return { freq: 'MONTHLY', interval: keep('MONTHLY'), byMonthDay: [dayOfMonth], ...ends };
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
    if (endsKind === 'until' && (!endsUntil || endsUntil < today())) {
      toast('Choose an end date from today on', 'error'); return;
    }
    const rule = buildRule();
    const policy: ShortMonthPolicy = needsMonthEndRule ? shortMonthPolicy : 'last_day';
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
    // The question actually being asked: the next occurrence on or after today that has not
    // already been generated. W3e: asked of the RULE the form describes (weekdays, nth weekday,
    // annual date, the month-end choice), and the schedule restarts there, so "Ends after N times"
    // counts N from the next one (owner decision).
    const dates = scheduleDatesAfterSave(rule, policy, editing);
    if (!dates) { toast('This schedule has no dates left. Check when it ends.', 'error'); return; }
    const schedule = {
      ...(editing || {}),
      transactionTemplate: {
        ...(editing?.transactionTemplate || {}),
        type, amount: parseAmount(amount), description: name,
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
      // The columns stay readable hints; the rule is the source of the dates.
      weekday: freq === 'weekly' ? [...weekDays].sort()[0] : undefined,
      startDate: dates.startDate,
      nextDueDate: dates.nextDueDate,
      autoConfirm,
      active: editing?.active ?? true,
      reminderLeadDays: reminderLead,
      rrule: formatRRule(rule),
      shortMonthPolicy: policy,
      ownerMemberId: ownerMemberId || undefined,
    };
    let saved = false;
    await runExclusive(savingSlot, async () => {
      setSaving(true);
      try {
        await upsert(schedule);
        saved = true;
      } catch (e) {
        toast(`Could not save: ${(e as Error).message}`, 'error');
      } finally {
        setSaving(false);
      }
    });
    if (!saved) return;
    setOpen(false); setEditing(null); resetForm();
    toast(editing ? 'Recurring schedule updated' : 'Recurring schedule created', 'success');
  }

  /** Aurora 4.0 RE1 — what the schedule will do, from the rule the form describes (as save() builds it). */
  function liveSummary(): string {
    try {
      const rule = buildRule();
      const policy: ShortMonthPolicy = needsMonthEndRule ? shortMonthPolicy : 'last_day';
      const n = parseAmount(amount);
      return scheduleSummary({
        amount: n > 0 ? fmt(n, baseCur) : '',
        what: name.trim() || (type === 'investment' ? 'investment' : getCat(category).label),
        rule,
        type,
        account: accounts.find(a => a.id === accountId)?.name,
        into: type === 'investment' ? investmentAssets.find(a => a.id === toAccountId)?.name : undefined,
        autoConfirm,
        nextDue: scheduleDatesAfterSave(rule, policy, editing)?.nextDueDate ?? null,
        todayISO: today(),
      });
    } catch {
      return '';
    }
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
    // Restore the sub-fields from the schedule's rule — its RRULE, or the one its columns describe
    // (W3e: a legacy weekly schedule used to reopen on today's weekday, not its own).
    const r = ruleOf(s);
    setRuleInterval(r.interval);
    setShortMonthPolicy(s.shortMonthPolicy ?? 'last_day');
    setEndsKind(r.count != null ? 'count' : r.until ? 'until' : 'never');
    setEndsCount(r.count != null ? String(r.count) : '12');
    setEndsUntil(r.until ?? addDaysISO(today(), 365));
    if (r.freq === 'WEEKLY') setWeekDays(r.byDay?.length ? [...r.byDay] : [todayWeekday()]);
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
  }

  // v10.39.1 (P21) — an Ask Vyact draft ("add Netflix 649 every month") arrives as
  // router state and opens this sheet pre-filled. It is a DRAFT: the account is left
  // for the user to choose and nothing is saved until they tap Save. The state is
  // cleared at once so a reload or Back does not reopen it.
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const seed = (location.state as { recurringSeed?: RecurringSeed } | null)?.recurringSeed;
    if (!seed) return;
    resetForm();
    setEditing(null);
    setType(seed.type);
    setFreq(seed.frequency);
    setName(seed.name);
    setAmount(String(seed.amount));
    setCategory(seed.category);
    if (seed.dayOfMonth) { setMonthlyMode('dom'); setDayOfMonth(seed.dayOfMonth); }
    setOpen(true);
    navigate(location.pathname, { replace: true, state: null });
    // resetForm and the setters are stable for this purpose; run once per arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const FREQ_TABS: { key: RecurrenceFreq; label: string }[] = [
    { key: 'daily',   label: 'Daily' },
    { key: 'weekly',  label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
    { key: 'yearly',  label: 'Annual' },
  ];

  return (
    <div className="ui-pilot">
      <PageHead
        title="Recurring"
        action={{ label: '+ Add Schedule', entity: 'schedule', onClick: () => { resetForm(); setEditing(null); setOpen(true); } }}
      />

      {/* v10.32.0 — the approval-aware bill calendar replaces the 7-day strip. */}
      <BillCalendar />

      {/* Track E, E6a (owner, 13 Oct 2026) — each live loan's EMI, mirrored from the loan: never a
          schedule, so it can never be scheduled twice. The switch is the loan's own autoRecord. */}
      {loanRows.length > 0 && (
        <Panel title="Loan EMIs" sub="From your loans · paid by the loan, never by a schedule">
          {loanRows.map(row => {
            const cat = getCat('loan_emi');
            const clears = clearsLabel(row.clearsOn);
            return (
              <div key={row.debt.id} data-testid="loan-emi-row"
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-b border-line last:border-b-0">
                <div className="w-9 h-9 rounded-md flex items-center justify-center text-base flex-shrink-0" style={{ background: cat.color + '22' }}>
                  {cat.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ink truncate">{row.debt.name} EMI</div>
                  <div className="text-[12px] text-ink-dim mt-px truncate">
                    {row.date ? `EMI #${row.no} · next ${formatDate(row.date, dateFormat)}` : 'No next EMI date yet'}
                    {row.fundingAccount ? ` · from ${row.fundingAccount.name}` : ''}
                    {clears ? ` · clears ${clears}` : ''}
                  </div>
                </div>
                <div className="text-[0.86rem] font-medium text-terra">
                  <Money amount={row.amount} currency={baseCur} className="font-medium" />
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <span className="text-[11.5px] text-ink-dim">{row.autoRecord ? 'Records on its date' : 'You pay it'}</span>
                  <button type="button" role="switch" aria-checked={row.autoRecord}
                    aria-label={`Record each ${row.debt.name} EMI automatically`}
                    title={row.needs.length && !row.autoRecord ? 'Needs the paying account and the next EMI date — opens the loan' : 'Record each EMI automatically'}
                    onClick={() => toggleAutoRecord(row)}
                    className="relative w-[44px] h-[26px] rounded-pill border-none cursor-pointer flex-shrink-0"
                    style={{ background: row.autoRecord ? 'color-mix(in srgb, hsl(var(--sage)) 40%, var(--sunken))' : 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
                    <i aria-hidden className="absolute top-[3px] w-5 h-5 rounded-full transition-[left] duration-150"
                      style={{ left: row.autoRecord ? 21 : 3, background: row.autoRecord ? 'hsl(var(--sage))' : 'var(--ff-ink-3)', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
                  </button>
                  <button type="button" className="btn-secondary text-sm min-h-[36px] px-3" onClick={() => navigate(`/debts?pay=${row.debt.id}`)}>Pay</button>
                  <button type="button" onClick={() => openEditDebt(row.debt)} className="row-action" aria-label={`Edit ${row.debt.name}`} title="Edit loan">
                    <Pencil size={14} strokeWidth={1.6} />
                  </button>
                </div>
              </div>
            );
          })}
        </Panel>
      )}

      <Panel title="Active Schedules">
        {listed.length === 0
          ? <EmptyState icon={<Repeat size={22} />} title="No recurring schedules yet"
              message="Set up rent, salary and subscriptions once, and each one is posted or asked for on its date."
              action={{ label: '+ Add a schedule', onClick: () => { resetForm(); setEditing(null); setOpen(true); } }} />
          : listed.map(s => {
              const cat = getCat(s.transactionTemplate.category);
              return (
                <div key={s.id} data-testid="schedule-row"
                  className="relative flex items-center gap-3 px-4 py-3 border-b border-line last:border-b-0">
                  {/* FIT2 — on phones the whole row opens the editor (delete lives there); a chevron replaces
                      the two icons that squeezed the name and cut the schedule line. */}
                  <button type="button" className="sm:hidden absolute inset-0 z-[1]" aria-label={`Edit ${s.transactionTemplate.description || cat.label}`}
                    onClick={() => { populateFromSchedule(s); setOpen(true); }} />
                  {/* R2 — the shared 34px raised category tile. */}
                  <CategoryTile icon={cat.icon} color={cat.color} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-ink truncate">{s.transactionTemplate.description}</div>
                    {/* Board B — schedules read as human sentences ("Monthly on
                        the 16th"), not raw frequency codes. Legacy rows without
                        an rrule fall back to the frequency word. */}
                    <div className="text-[12px] text-ink-dim mt-px truncate">
                      {(() => {
                        try { return describeRRule(ruleOf(s)); }
                        catch { return s.frequency; }
                      })()} · next {formatDate(s.nextDueDate, dateFormat)} · {s.autoConfirm ? 'posts automatically' : 'asks first'}
                    </div>
                  </div>
                  <div className={`text-[0.86rem] font-medium ${s.transactionTemplate.type === 'income' ? 'text-sage' : 'text-terra'}`}>
                    <Money amount={s.transactionTemplate.amount} currency={baseCur} className="font-medium" signed={s.transactionTemplate.type === 'income'} />
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
                  <div className="hidden sm:flex gap-1 flex-shrink-0">
                    <button onClick={() => { populateFromSchedule(s); setOpen(true); }} className="row-action" aria-label="Edit schedule" title="Edit">
                      <Pencil size={14} strokeWidth={1.6} />
                    </button>
                    <button onClick={() => { void deleteSchedule(s); }} className="row-action danger" aria-label="Delete schedule" title="Delete">
                      <Trash2 size={14} strokeWidth={1.6} />
                    </button>
                  </div>
                  <ChevronRight size={15} aria-hidden className="sm:hidden text-ink-dim flex-shrink-0" />
                </div>
              );
            })
        }
      </Panel>

      <HalfSheet open={open} onClose={() => { setOpen(false); setEditing(null); }} title={editing ? 'Edit Recurring Schedule' : 'Add Recurring Schedule'}
        footer={
          <div>
            <button type="button" onClick={save} disabled={saving} aria-busy={saving}
              className="btn-primary w-full h-[50px] text-[15.5px] rounded-r3 disabled:opacity-60">
              {saving ? 'Saving…' : editing ? 'Update schedule' : 'Save schedule'}
            </button>
            <div className="flex justify-center gap-6 mt-1">
              <button type="button" onClick={() => { setOpen(false); setEditing(null); }}
                className="min-h-[44px] px-2 text-[13.5px] font-medium text-ink-mid hover:text-ink">
                Cancel
              </button>
              {editing && (
                <button type="button" onClick={async () => { if (await deleteSchedule(editing)) { setOpen(false); setEditing(null); } }}
                  className="min-h-[44px] px-2 text-[13.5px] font-medium" style={{ color: 'var(--crit-text)' }}>
                  Delete schedule
                </button>
              )}
            </div>
          </div>
        }
      >
        {/* Aurora 4.0 RE1 — one live line on what this schedule will do, above ten-plus controls. */}
        {open && (
          <p className="well px-3.5 py-2.5 text-[13px] leading-snug text-ink mb-3" data-testid="schedule-summary" aria-live="polite">
            {liveSummary() || 'Fill in the amount and when it repeats.'}
          </p>
        )}

        {/* RE3 — three short headed groups, as on the loan form: What · When · How. */}
        <FormSection title="What">
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
          <div className="ui-label mb-1.5">Description</div>
          <input className="input w-full" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Rent · Salary · SIP" aria-label="Description" />
        </div>

        {type !== 'investment' && (
          <div className="mt-4">
            <CategoryPicker type={type} value={category} onChange={setCategory} exclude={['loan_emi']} />
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
            <div className="mt-1.5 text-[12px] text-terra">
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
        </FormSection>

        <FormSection title="When">
        {/* Recurrence frequency */}
        <div>
          <div className="ui-label mb-1.5">Repeats</div>
          <div className="flex gap-1.5 flex-wrap">
            {FREQ_TABS.map(({ key, label }) => (
              <Chip key={key} on={freq === key} onClick={() => setFreq(key)}>{label}</Chip>
            ))}
          </div>
        </div>

        {/* Weekly — day-of-week chips */}
        {freq === 'weekly' && (
          <div className="mt-4">
            <div className="ui-label mb-1.5">Repeat on</div>
            <div className="flex gap-1.5 flex-wrap">
              <Chip on={weekDays.length === WORK_WEEK.length && WORK_WEEK.every(d => weekDays.includes(d))}
                onClick={() => setWeekDays([...WORK_WEEK])}>Weekdays</Chip>
              {WEEKDAYS.map((d, i) => (
                <Chip key={i} on={weekDays.includes(i)} onClick={() => toggleWeekday(i)}>{d}</Chip>
              ))}
            </div>
          </div>
        )}

        {/* Monthly — DOM or Nth weekday */}
        {(freq === 'monthly' || freq === 'custom_day') && (
          <div className="mt-4">
            <div className="ui-label mb-1.5">Repeat on</div>
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
                  className="input h-[44px] py-0 px-2.5 w-20" aria-label="Day of month" />
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
            <div className="ui-label mb-1.5">Repeat on</div>
            <div className="flex gap-1.5 flex-wrap mb-2">
              {MONTH_NAMES.map((m, i) => (
                <Chip key={i} on={annualMonth === i + 1}
                  onClick={() => { setAnnualMonth(i + 1); setAnnualDay(d => annualDayFor(i + 1, d)); }}>{m}</Chip>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[0.84rem] text-ink-mid">Day</span>
              <input type="number" min={1} max={MONTH_MAX_DAY[annualMonth - 1]} value={annualDay}
                onChange={e => setAnnualDay(annualDayFor(annualMonth, parseInt(e.target.value) || 1))}
                className="input h-[44px] py-0 px-2.5 w-20" aria-label="Day of month" />
            </div>
          </div>
        )}

        {/* W3e (owner decision D13) — a day some months do not have: the schedule says where it goes. */}
        {needsMonthEndRule && (
          <div className="mt-4">
            <Field label={freq === 'yearly' ? 'In years without 29 Feb' : 'In months without that day'}>
              <Select value={shortMonthPolicy} aria-label="Month-end rule"
                onChange={event => setShortMonthPolicy(event.target.value as ShortMonthPolicy)}>
                <option value="last_day">{freq === 'yearly' ? 'Use 28 Feb' : 'Use the last day of the month'}</option>
                <option value="next_month_first">{freq === 'yearly' ? 'Use 1 Mar' : 'Use the 1st of the next month'}</option>
              </Select>
            </Field>
            {freq !== 'yearly' && shortMonthPolicy === 'next_month_first' && (
              <div className="mt-1.5 text-[12px] text-terra">
                Some months will have two: the {dayOfMonth}th of a shorter month moves to the 1st of the next, which still has its own {dayOfMonth}th.
              </div>
            )}
          </div>
        )}

        {/* Ends */}
        <div className="mt-4">
          <div className="ui-label mb-1.5">Ends</div>
          <div className="flex gap-1.5 flex-wrap items-center">
            <Chip on={endsKind === 'never'} onClick={() => setEndsKind('never')}>Never</Chip>
            <Chip on={endsKind === 'count'} onClick={() => setEndsKind('count')}>After N times</Chip>
            <Chip on={endsKind === 'until'} onClick={() => setEndsKind('until')}>On a date</Chip>
            {endsKind === 'count' && (
              <input type="number" min={1} value={endsCount} onChange={e => setEndsCount(e.target.value)}
                placeholder="12" aria-label="Number of occurrences"
                className="input h-[44px] py-0 px-2.5 w-20" />
            )}
            {endsKind === 'until' && (
              <input type="date" min={today()} value={endsUntil} onChange={e => setEndsUntil(e.target.value)}
                aria-label="Last date" className="input h-[44px] py-0 px-2.5" />
            )}
          </div>
          {endsKind === 'count' && editing && (
            <div className="mt-1.5 text-[12px] text-ink-dim">Counted from the next one.</div>
          )}
        </div>
        </FormSection>

        <FormSection title="How">
        {/* Aurora 4.0 RE2 — two named options in the bill calendar's words (was an "Auto-approve" switch,
            which did not say what happens when it is off). */}
        <SegmentedControl label="When it’s due" value={autoConfirm ? 'auto' : 'ask'}
          onChange={v => setAutoConfirm(v === 'auto')}
          options={[{ value: 'auto', label: 'Post automatically', testId: 'schedule-post-auto' },
            { value: 'ask', label: 'Ask me first', testId: 'schedule-ask-first' }]} />
        <p className="text-[12px] text-ink-dim leading-snug mt-1.5">
          {autoConfirm ? 'Vyact records it on its date.' : 'It waits in the bill calendar and the bell until you approve it.'}
        </p>

        {/* Reminder lead time */}
        <div className="mt-4">
          <div className="ui-label mb-1.5">Remind me</div>
          <div className="flex gap-1.5 flex-wrap">
            {([1, 3, 7] as const).map(n => (
              <Chip key={n} on={reminderLead === n} onClick={() => setReminderLead(n)}>{n} day{n > 1 ? 's' : ''} before</Chip>
            ))}
          </div>
        </div>

        </FormSection>
      </HalfSheet>
    </div>
  );
}
