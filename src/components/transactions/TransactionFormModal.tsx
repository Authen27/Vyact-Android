import { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Input, Select, Field, FieldRow } from '../ui/Input';
import TrackPicker, { TRACKS } from './TrackPicker';
import { useStore } from '../../store';
import { normalizeTimeInput, nowTime, uid, today } from '../../lib/format';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  CATEGORIES_BY_TYPE,
  CURRENCIES,
} from '../../constants';
import { buildAccounts, buildAccountsFromStore, resolveAccount, ACCOUNT_REQUIRED_TYPES } from '../../lib/accounts';
import { computeNextDueDate } from '../../lib/recurring';
import { isFlagOn, getMoneyMapMode } from '../../lib/featureFlags';
import { FEATURES } from '../../config/features';
import { trackFlagExposure } from '../../lib/analytics';
import type { Transaction, TxnType, Recurrence, RecurrenceFreq, AccountSplit, PartPaymentChoice } from '../../types';

interface Props {
  /** Optional override props — when omitted, the modal binds to the global store
   *  state (txnModalOpen / editingTxn / closeTxnModal). Used at App root. */
  open?: boolean;
  initial?: Transaction | null;
  onClose?: () => void;
}

interface SplitParticipantForm {
  name: string;
  share: string;
  isYou: boolean;
  paid: boolean;
  paidOn?: string | null;
}

interface FormState {
  type: TxnType;
  amount: string;
  currency: string;
  date: string;
  time: string;
  description: string;
  category: string;
  note: string;
  memberId: string;
  paymentMethod: string;
  // v7.0.3 — destination account for transfer + investment tracks.
  paymentMethodTo: string;
  // v9 §4.3 — investment direction ('added' = money in, 'withdrew' = money out).
  direction: 'added' | 'withdrew';
  // v9 §4.1 — the loan an EMI pays (required when category = loan_emi).
  linkedDebtId: string;
  // v9.4.2 — part-payment strategy when EMI amount exceeds the minimum payment.
  partPaymentChoice: PartPaymentChoice;
  /** v7.3 — Money Map Item #5. When `splitAcrossAccounts` is true the
   *  primary `paymentMethod` is treated as informational only; the actual
   *  source-of-funds is the multi-account `accountSplitRows` array. */
  splitAcrossAccounts: boolean;
  accountSplitRows: { accountId: string; amount: number }[];
  recurring: Recurrence | '';
  excluded: boolean;
  // ── split ──
  splitEnabled: boolean;
  splitPaidBy: 'me' | 'external';
  splitParticipants: SplitParticipantForm[];
  // When true, shares are kept auto-balanced to an even split; flips to false the
  // moment the user edits a share by hand (so manual amounts are never clobbered).
  splitAuto: boolean;
}

const defaultParticipants = (): SplitParticipantForm[] => ([
  { name: 'You', share: '', isYou: true,  paid: true },
  { name: '',    share: '', isYou: false, paid: false },
]);

// v9 txn-redesign §3 — type-scoped defaults. Transfers and investments carry NO
// category (CK_txn_category_by_type); '' is the client-side sentinel for null.
const DEFAULT_CAT_BY_TYPE: Record<TxnType, string> = {
  expense:    'food_dining',
  income:     'salary',
  investment: '',
  transfer:   '',
};

// v7.0.3 — remember the last track the user picked so the next add-modal
// can skip the picker if they always go to the same place. Stored
// per-household; falls back to 'expense' if absent or invalid.
const LAST_TRACK_KEY = 'vt_last_track';
const VALID_TRACKS: TxnType[] = ['expense', 'income', 'transfer', 'investment'];
function readLastTrack(hid: string): TxnType | null {
  try {
    const raw = localStorage.getItem(`${LAST_TRACK_KEY}_${hid}`);
    return VALID_TRACKS.includes(raw as TxnType) ? (raw as TxnType) : null;
  } catch { return null; }
}
function writeLastTrack(hid: string, track: TxnType): void {
  try { localStorage.setItem(`${LAST_TRACK_KEY}_${hid}`, track); } catch { /* quota — ignore */ }
}

const blank = (currency: string, memberId = '', type: TxnType = 'expense'): FormState => ({
  type,
  amount: '',
  currency,
  date: today(),
  time: nowTime(),
  description: '',
  category: DEFAULT_CAT_BY_TYPE[type],
  note: '',
  memberId,
  paymentMethod: '',
  paymentMethodTo: '',
  direction: 'added',
  linkedDebtId: '',
  partPaymentChoice: 'reduce_tenure',
  splitAcrossAccounts: false,
  accountSplitRows: [],
  recurring: '',
  excluded: false,
  splitEnabled: false,
  splitPaidBy: 'me',
  splitParticipants: defaultParticipants(),
  splitAuto: true,
});

// Even split of `bill` across `n` people; rounding remainder goes to the first.
function evenShares(bill: number, n: number): string[] {
  if (n < 1) return [];
  const base = Math.floor((bill / n) * 100) / 100;
  const shares = Array(n).fill(base);
  const remainder = Math.round((bill - base * n) * 100) / 100;
  shares[0] = Math.round((shares[0] + remainder) * 100) / 100;
  return shares.map(s => (bill > 0 ? s.toFixed(2) : ''));
}

function categoriesFor(type: TxnType) {
  // v9 §3 — type-scoped sets. Transfers AND investments carry no category
  // (direction is a form control, not a category; INV-8).
  if (type === 'income')  return INCOME_CATEGORIES;
  if (type === 'expense') return EXPENSE_CATEGORIES;
  return CATEGORIES_BY_TYPE.transfer;   // [] for transfer + investment
}

function deriveInitialTime(initial?: Transaction | null): string {
  if (initial?.time) return initial.time;
  if (initial?.created_at) {
    const created = new Date(initial.created_at);
    if (!Number.isNaN(created.getTime())) {
      return `${String(created.getHours()).padStart(2, '0')}:${String(created.getMinutes()).padStart(2, '0')}`;
    }
  }
  return nowTime();
}

type Meridiem = 'AM' | 'PM';

interface TimeInputState {
  clock: string;
  meridiem: Meridiem;
}

function splitTimeForInput(value?: string | null): TimeInputState {
  const normalized = normalizeTimeInput(value) ?? nowTime();
  const [hoursRaw = '00', minutes = '00'] = normalized.split(':');
  const hours24 = Number(hoursRaw);
  const meridiem: Meridiem = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  return {
    clock: `${String(hours12).padStart(2, '0')}:${minutes}`,
    meridiem,
  };
}

export default function TransactionFormModal(props: Props) {
  const profile           = useStore(s => s.profile);
  const members           = useStore(s => s.members);
  const session           = useStore(s => s.session);
  const assets            = useStore(s => s.assets);
  const debts             = useStore(s => s.debts);
  const accountsState     = useStore(s => s.accounts);
  const upsertTransaction = useStore(s => s.upsertTransaction);
  const removeTransaction = useStore(s => s.removeTransaction);
  const upsertRecurring   = useStore(s => s.upsertRecurring);
  const toast             = useStore(s => s.toast);
  const currentHouseholdId = useStore(s => s.currentHouseholdId);
  const openAddAccount    = useStore(s => s.openAddAccount);

  // Bind to the global store unless explicit props are passed
  const storeOpen     = useStore(s => s.txnModalOpen);
  const storeInitial  = useStore(s => s.editingTxn);
  const storeSeed     = useStore(s => s.seedTxn);
  const storeClose    = useStore(s => s.closeTxnModal);
  const open          = props.open    ?? storeOpen;
  const initial       = props.initial ?? storeInitial;
  const onClose       = props.onClose ?? storeClose;

  const defaultMemberId = useMemo(() => {
    if (session?.user?.id) {
      const mine = members.find(m => m.userId === session.user.id);
      if (mine) return mine.id;
    }
    if (profile.name) {
      const byName = members.find(m => m.name.trim().toLowerCase() === profile.name.trim().toLowerCase());
      if (byName) return byName.id;
    }
    return members[0]?.id ?? '';
  }, [members, profile.name, session?.user?.id]);

  const [form, setForm]    = useState<FormState>(blank(profile.baseCurrency, defaultMemberId));
  const [saving, setSaving] = useState(false);
  const [showMore, setShowMore] = useState(false);   // B4.2 — "More details" disclosure
  const [timeInput, setTimeInput] = useState<TimeInputState>(() => splitTimeForInput(nowTime()));
  // v7.0.3 — track-picker step. When the flag is on and we're adding (not
  // editing), the modal opens to a 4-card track picker first; choosing a
  // track sets `pickedTrack` and the rest of the form renders.
  // v9 (D3) — the track picker is retired under txn-redesign: the inline
  // Track <Select> (incl. Investment) replaces the 4-card step.
  const trackPickerEnabled = isFlagOn('track_picker') && !FEATURES.txnRedesign.enabled;
  const [pickedTrack, setPickedTrack] = useState<TxnType | null>(null);
  const showPicker = trackPickerEnabled && !initial && !pickedTrack;

  // Fire one feature_flag_exposure per session when the modal opens for an
  // add (edits don't expose the user to the variant in any visible way).
  useEffect(() => {
    if (!open || initial) return;
    trackFlagExposure('vt_feature_track_picker', trackPickerEnabled ? 'on' : 'off');
  }, [open, initial, trackPickerEnabled]);

  // Linked spending accounts. With `money_map` flag on (or in shadow) and
  // a populated `accounts` store, source options from the canonical table;
  // otherwise fall back to the legacy assets+debts derivation so off-mode
  // and pre-backfill households keep working unchanged.
  const useFirstClassAccounts = getMoneyMapMode() !== 'off' && accountsState.length > 0;
  const accounts = useMemo(
    () => useFirstClassAccounts
      ? buildAccountsFromStore(accountsState)
      : buildAccounts(assets, debts),
    [useFirstClassAccounts, accountsState, assets, debts],
  );
  // For transfer + investment, the destination dropdown excludes the source
  // so a user can't pick the same account on both sides.
  const accountsTo = useMemo(
    () => useFirstClassAccounts
      ? buildAccountsFromStore(accountsState, { excludeId: form.paymentMethod || undefined })
      : buildAccounts(assets, debts, { excludeId: form.paymentMethod || undefined }),
    [useFirstClassAccounts, accountsState, assets, debts, form.paymentMethod],
  );
  // v9 §4.3 — the Investment form's destination picker shows ONLY
  // kind='investment' accounts (value = the account uuid).
  const investmentAccounts = useMemo(
    () => accountsState.filter(a => a.kind === 'investment' && !a.isArchived),
    [accountsState],
  );
  const accountRequired = ACCOUNT_REQUIRED_TYPES.includes(
    form.type as (typeof ACCOUNT_REQUIRED_TYPES)[number],
  );
  const isTransfer   = form.type === 'transfer';
  const isInvestment = form.type === 'investment';
  const isIncome     = form.type === 'income';
  const needsToAccount = isTransfer || isInvestment;
  // B4.2/B4.3 — the form is short: secondary fields (time, recurring, note) live
  // behind a "More details" disclosure; time defaults to now (B4.3).
  const shortForm = true;
  const showSecondary = !shortForm || showMore;
  // Account-field label varies by track: expense flows out of an account,
  // income lands in one, transfer/investment have both sides.
  const accountLabel = needsToAccount ? 'From Account' : isIncome ? 'To Account' : 'Account';

  useEffect(() => {
    if (!open) return;
    setShowMore(false);   // B4.2 — each open starts with secondary fields collapsed
    if (initial) {
      const initialTime = deriveInitialTime(initial);
      const sp = initial.split;
      setForm({
        type: initial.type,
        amount: String(sp?.isSplit ? sp.totalAmount : initial.amount),
        currency: initial.currency,
        date: initial.date,
        time: initialTime,
        description: initial.description,
        category: initial.category,
        note: initial.note ?? '',
        memberId: initial.memberId ?? defaultMemberId,
        paymentMethod: initial.paymentMethod ?? initial.accountId ?? '',
        paymentMethodTo: initial.toAccountId ?? initial.linkedToAssetId ?? '',
        direction: 'added',   // edits show the stored from/to as-is
        linkedDebtId: initial.emiSplit?.debt_id ?? initial.linkedDebtId ?? '',
        partPaymentChoice: initial.emiSplit?.partPaymentChoice ?? 'reduce_tenure',
        splitAcrossAccounts: Boolean(initial.accountSplits && initial.accountSplits.length),
        accountSplitRows: initial.accountSplits ? initial.accountSplits.map(s => ({ accountId: s.accountId, amount: s.amount })) : [],
        recurring: initial.recurring ?? '',
        excluded: Boolean(initial.excluded),
        splitEnabled: Boolean(sp?.isSplit),
        splitPaidBy: sp?.paidBy ?? 'me',
        // Existing splits keep their explicit shares (no auto-rebalance);
        // a fresh split starts in auto-even mode.
        splitAuto: !sp?.isSplit,
        splitParticipants: sp?.isSplit && sp.participants.length
          ? sp.participants.map(p => ({
              name: p.isYou ? 'You' : p.name,
              share: String(p.share),
              isYou: Boolean(p.isYou),
              paid: p.paid,
              paidOn: p.paidOn,
            }))
          : defaultParticipants(),
      });
      setTimeInput(splitTimeForInput(initialTime));
      // Edit mode skips the picker — track is locked to the row's type.
      setPickedTrack(initial.type);
    } else {
      // Pre-select the user's last-used track so repeat adds don't have to
      // re-pick every time. The picker is still reachable via "Change".
      // v7.4.5 — `storeSeed` (from Ask Vyact's two-tap flow) wins over the
      // remembered track when present, so the user lands on the right
      // form pre-filled.
      const seed = storeSeed ?? undefined;
      const remembered = trackPickerEnabled ? readLastTrack(currentHouseholdId) : null;
      const initialType: TxnType = (seed?.type as TxnType) ?? remembered ?? 'expense';
      const base = blank(profile.baseCurrency, defaultMemberId, initialType);
      const blankForm: FormState = {
        ...base,
        amount: seed?.amount != null ? String(seed.amount) : base.amount,
        currency: seed?.currency ?? base.currency,
        description: seed?.description ?? base.description,
        category: seed?.category ?? base.category,
        note: seed?.note ?? base.note,
        date: seed?.date ?? base.date,
        linkedDebtId: seed?.linkedDebtId ?? seed?.debtId ?? base.linkedDebtId,
      };
      setForm(blankForm);
      setTimeInput(splitTimeForInput(blankForm.time));
      // When seeded, jump past the picker — the intent already named a track.
      setPickedTrack(seed?.type ? (seed.type as TxnType) : trackPickerEnabled ? remembered : 'expense');
    }
  }, [open, initial, storeSeed, profile.baseCurrency, defaultMemberId, trackPickerEnabled, currentHouseholdId]);

  function pickTrack(type: TxnType) {
    setPickedTrack(type);
    writeLastTrack(currentHouseholdId, type);
    setForm(f => ({
      ...f,
      type,
      category: DEFAULT_CAT_BY_TYPE[type],
    }));
  }

  const cats = categoriesFor(form.type);

  // Reset category to a valid one if type change orphans it
  useEffect(() => {
    if (!cats.find(c => c.id === form.category)) {
      setForm(f => ({ ...f, category: cats[0]?.id ?? f.category }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.type]);

  // ── split helpers ──
  function updateName(i: number, name: string) {
    // Editing a name never disturbs auto-balanced shares.
    setForm(f => ({ ...f, splitParticipants: f.splitParticipants.map((x, j) => j === i ? { ...x, name } : x) }));
  }
  function editShare(i: number, share: string) {
    // Manual edit → leave auto mode so we respect the user's numbers.
    setForm(f => ({ ...f, splitAuto: false, splitParticipants: f.splitParticipants.map((x, j) => j === i ? { ...x, share } : x) }));
  }
  function addParticipant() {
    // Keep whatever mode we're in; the rebalance effect re-evens shares in auto mode.
    setForm(f => ({ ...f, splitParticipants: [...f.splitParticipants, { name: '', share: '', isYou: false, paid: false }] }));
  }
  function removeParticipant(i: number) {
    setForm(f => ({ ...f, splitParticipants: f.splitParticipants.filter((_, j) => j !== i) }));
  }
  function resetEvenSplit() {
    setForm(f => ({ ...f, splitAuto: true }));
  }

  // Auto-balance: while in auto mode, keep every share at an even split of the bill.
  // Re-runs when the bill or the number of participants changes.
  useEffect(() => {
    if (!form.splitEnabled || !form.splitAuto) return;
    const bill = parseFloat(form.amount) || 0;
    const shares = evenShares(bill, form.splitParticipants.length);
    setForm(f => {
      if (!f.splitAuto) return f;
      const changed = f.splitParticipants.some((p, i) => p.share !== shares[i]);
      if (!changed) return f;
      return { ...f, splitParticipants: f.splitParticipants.map((p, i) => ({ ...p, share: shares[i] })) };
    });
  }, [form.amount, form.splitEnabled, form.splitAuto, form.splitParticipants.length]);

  async function save() {
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) {
      toast('Enter a valid amount greater than 0', 'error');
      return;
    }
    // v9 F-VALIDATION — block save only on missing REQUIRED-primary fields.
    // Description and member are 'More details' fields, never required.
    if (!FEATURES.txnRedesign.enabled && !isTransfer && !form.description.trim()) {
      toast('Description is required', 'error');
      return;
    }
    const normalizedTime = normalizeTimeInput(`${timeInput.clock} ${timeInput.meridiem}`);
    if (!normalizedTime) {
      toast('Enter time as hh:mm with AM or PM', 'error');
      return;
    }
    if (!FEATURES.txnRedesign.enabled && !isTransfer && !form.memberId) {
      toast('Choose a member for this transaction', 'error');
      return;
    }
    // v9 §4.1 — loan_emi requires the linked loan (the system split needs it).
    if (FEATURES.txnRedesign.enabled && form.type === 'expense'
        && form.category === 'loan_emi' && !form.linkedDebtId) {
      toast('Choose which loan this EMI pays', 'error');
      return;
    }
    // ── Account required for money that moves in/out of an account ──
    if (accountRequired && !form.paymentMethod) {
      toast('Choose an Account (cash, bank or card) for this transaction', 'error');
      return;
    }
    // v7.0.3 — transfer + investment require a destination account too.
    if (needsToAccount && !form.paymentMethodTo) {
      toast(isTransfer ? 'Choose a destination Account' : 'Choose an Investment Vehicle', 'error');
      return;
    }
    if (needsToAccount && form.paymentMethod && form.paymentMethodTo === form.paymentMethod) {
      toast('Source and destination must be different accounts', 'error');
      return;
    }

    // ── Build split info (expense or income) ──
    let split: Transaction['split'] | undefined = undefined;
    if ((form.type === 'expense' || form.type === 'income') && form.splitEnabled) {
      const parts = form.splitParticipants
        .map(p => ({ ...p, shareNum: parseFloat(p.share) }))
        .filter(p => (p.isYou || p.name.trim()) && !isNaN(p.shareNum) && p.shareNum >= 0);
      const you = parts.find(p => p.isYou);
      if (!you) { toast('A split needs your share', 'error'); return; }
      if (parts.length < 2) { toast('A split needs at least one other participant', 'error'); return; }
      if (parts.some(p => !p.isYou && !p.name.trim())) { toast('All participants must have a name', 'error'); return; }
      const sumShares = parts.reduce((s, p) => s + p.shareNum, 0);
      if (Math.abs(sumShares - amount) > 0.01) {
        toast(`Participant shares (${sumShares.toFixed(2)}) must add up to the total bill (${amount.toFixed(2)})`, 'error');
        return;
      }
      split = {
        isSplit: true,
        totalAmount: amount,
        yourShare: you.shareNum,
        paidBy: form.splitPaidBy,
        participants: parts.map(p => ({
          name: p.isYou ? 'You' : p.name.trim(),
          isYou: p.isYou || undefined,
          share: p.shareNum,
          paid: form.splitPaidBy === 'me' ? Boolean(p.isYou || p.paid) : Boolean(!p.isYou || p.paid),
          paidOn: p.paidOn ?? null,
        })),
      };
    }

    setSaving(true);
    try {
      // v9 §4.3 — investment direction maps the account matrix:
      //   'added'    → from = cash side (paymentMethod), to = investment account
      //   'withdrew' → from = investment account,        to = cash side
      const swap = isInvestment && form.direction === 'withdrew';
      const fromEncoded = swap ? form.paymentMethodTo : form.paymentMethod;
      const toEncoded   = swap ? form.paymentMethod   : form.paymentMethodTo;
      const txn: Transaction = {
        id: initial?.id ?? uid(),
        type: form.type,
        amount,
        currency: form.currency,
        date: form.date,
        time: normalizedTime,
        description: form.description.trim(),
        // transfer-class rows carry no category ('' → null at the adapter).
        category: (isTransfer || isInvestment) ? '' : form.category,
        note: form.note.trim() || undefined,
        memberId: form.memberId,
        paymentMethod: fromEncoded || undefined,
        recurring: form.recurring || undefined,
        excluded: form.excluded || undefined,
        linkedToAssetId: needsToAccount ? toEncoded || undefined : initial?.linkedToAssetId,
        linkedDebtId: (form.category === 'loan_emi' ? form.linkedDebtId : undefined) ?? initial?.linkedDebtId,
        // v9.4.2 — thread part-payment choice so the loan_emi path can re-amortise.
        // Stored transiently on the emiSplit object; the store reads it on create.
        ...(form.category === 'loan_emi' && form.linkedDebtId ? {
          _partPaymentChoice: form.partPaymentChoice,
        } : {}),
        linkedTxnId:   initial?.linkedTxnId,
        split,
      };
      await upsertTransaction(txn);

      // v9.1 §5 — recurrence is authored ONLY in the Recurring section now;
      // the Transaction form no longer mirrors a schedule.

      toast(initial ? 'Transaction updated' : 'Transaction added', 'success');
      onClose();
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!initial) return;
    if (!confirm('Delete this transaction?')) return;
    try {
      await removeTransaction(initial.id);
      toast('Transaction deleted', 'info');
      onClose();
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, 'error');
    }
  }

  // The current value may be a legacy method not in the derived list — keep it selectable.
  const currentAccount = resolveAccount(form.paymentMethod, assets, debts);
  const currentInList = accounts.some(a => a.value === form.paymentMethod);
  const trackMeta = TRACKS.find(t => t.type === form.type);
  const modalTitle = initial
    ? `Edit ${trackMeta?.label ?? 'Transaction'}`
    : showPicker
      ? 'Add Transaction'
      : `Add ${trackMeta?.label ?? 'Transaction'}`;

  return (
    <Modal open={open} title={modalTitle} onClose={onClose}>
      {showPicker ? (
        <TrackPicker onPick={pickTrack} onCancel={onClose} />
      ) : (
      <>
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2.5 mb-3.5">
        <Field label="Track">
          {initial || trackPickerEnabled ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-line bg-bg2">
              <span className="text-[0.85rem] text-ink">{trackMeta?.label ?? form.type}</span>
              {!initial && trackPickerEnabled && (
                <button
                  type="button"
                  onClick={() => setPickedTrack(null)}
                  className="font-mono text-[0.6rem] tracking-wider uppercase text-coral hover:underline"
                >
                  Change
                </button>
              )}
            </div>
          ) : (
            <Select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as TxnType, category: DEFAULT_CAT_BY_TYPE[e.target.value as TxnType] }))}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="investment">Investment</option>
              <option value="transfer">Transfer</option>
            </Select>
          )}
        </Field>
        <Field label="Date">
          <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
        </Field>
        {showSecondary && (
        <Field label="Time">
          <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-2">
            <Input
              inputMode="numeric"
              value={timeInput.clock}
              onChange={e => setTimeInput(t => ({ ...t, clock: e.target.value }))}
              placeholder="hh:mm"
              maxLength={5}
            />
            <Select
              value={timeInput.meridiem}
              onChange={e => setTimeInput(t => ({ ...t, meridiem: e.target.value as Meridiem }))}
            >
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </Select>
          </div>
        </Field>
        )}
      </div>

      {/* B4.1 (alpha 11a) — no auto-focus on open/edit; the keypad no longer
          auto-launches and edits can land on a non-amount field. */}
      <Field label="Description" hint={isTransfer ? 'optional' : undefined}>
        <Input
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder={isTransfer ? 'e.g. Move savings to brokerage' : 'e.g. Tesco grocery run'}
        />
      </Field>

      <FieldRow>
        <Field label="Amount">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            placeholder="0.00"
          />
        </Field>
        <Field label="Currency">
          <Select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
            {Object.entries(CURRENCIES).map(([code, c]) => (
              <option key={code} value={code}>{c.symbol} {code}</option>
            ))}
          </Select>
        </Field>
      </FieldRow>

      {/* v9 §3/INV-8 — only expense & income carry a category; transfers and
          investments show none. */}
      {!isTransfer && !isInvestment && (
        <Field label="Category">
          <Select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
            {cats.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
          </Select>
        </Field>
      )}

      {/* v9 §4.1 — loan_emi reveals the loan picker; the system books the
          interest as spend and a principal transfer leg on save (R-AGG-6). */}
      {form.type === 'expense' && form.category === 'loan_emi' && (
        <Field label="Which loan?" hint="required">
          <Select value={form.linkedDebtId} onChange={e => setForm(f => ({ ...f, linkedDebtId: e.target.value }))}>
            <option value="">— Select a loan —</option>
            {debts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
      )}

      {/* v9.4.2 — part-payment strategy picker. When the entered amount exceeds
          the selected debt's minimum EMI, show a strategy selector so the user
          controls how excess principal is applied (matches the old Debts inline form). */}
      {form.type === 'expense' && form.category === 'loan_emi' && (() => {
        const linkedDebt = debts.find(d => d.id === form.linkedDebtId);
        const enteredAmt = parseFloat(form.amount) || 0;
        if (!linkedDebt || enteredAmt <= linkedDebt.minimumPayment) return null;
        return (
          <div className="mb-3">
            <div className="font-mono text-[0.6rem] tracking-wider text-ink-dim uppercase mb-1.5">
              Part-payment: apply excess to
            </div>
            <div className="flex gap-2 flex-wrap">
              {(['reduce_tenure', 'reduce_emi', 'apply_advance'] as PartPaymentChoice[]).map(ch => (
                <button key={ch} type="button"
                  onClick={() => setForm(f => ({ ...f, partPaymentChoice: ch }))}
                  className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                    form.partPaymentChoice === ch
                      ? 'bg-coral text-white border-coral'
                      : 'bg-bg border-line text-ink-mid hover:border-coral/40'
                  }`}>
                  {ch === 'reduce_tenure' ? 'Reduce tenure' : ch === 'reduce_emi' ? 'Reduce EMI' : 'Apply advance'}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* v9 §4.3 — investment direction toggle (replaces buy/sell/dividend etc.). */}
      {isInvestment && (
        <Field label="Direction">
          <div className="flex gap-2">
            {(['added', 'withdrew'] as const).map(d => (
              <button key={d} type="button"
                onClick={() => setForm(f => ({ ...f, direction: d }))}
                className={`flex-1 px-3 py-2 rounded-md border-2 text-[0.85rem] transition-all ${
                  form.direction === d ? 'border-coral bg-coral-tint text-ink' : 'border-line bg-bg2 text-ink-mid hover:border-line2'
                }`}>
                {d === 'added' ? '↑ Added money' : '↓ Took money out'}
              </button>
            ))}
          </div>
        </Field>
      )}

      <FieldRow>
        <Field label="Member" hint={isTransfer ? 'optional' : undefined}>
          <Select value={form.memberId} onChange={e => setForm(f => ({ ...f, memberId: e.target.value }))}>
            <option value="">{isTransfer ? '— None —' : '— Select a member —'}</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label={accountLabel} hint={accountRequired ? 'required' : 'optional'}>
          <Select value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))}>
            <option value="">{accountRequired ? '— Select an account —' : '— None —'}</option>
            {accounts.map(a => (
              <option key={a.value} value={a.value}>
                {a.kind === 'card' ? '💳 ' : a.kind === 'bank' ? '🏦 ' : '💵 '}{a.label}
              </option>
            ))}
            {/* Preserve a legacy / unlisted value so editing never silently drops it */}
            {form.paymentMethod && !currentInList && (
              <option value={form.paymentMethod}>
                {currentAccount ? currentAccount.label : form.paymentMethod} (legacy)
              </option>
            )}
          </Select>
        </Field>
      </FieldRow>
      {needsToAccount && (
        <FieldRow>
          <Field label={isTransfer ? 'To Account' : 'Investment account'} hint="required">
            <Select value={form.paymentMethodTo} onChange={e => setForm(f => ({ ...f, paymentMethodTo: e.target.value }))}>
              <option value="">{isTransfer ? '— Select destination —' : '— Select investment account —'}</option>
              {isInvestment
                ? investmentAccounts.map(a => (
                    <option key={a.id} value={a.id}>📈 {a.name}</option>
                  ))
                : accountsTo.map(a => (
                    <option key={a.value} value={a.value}>
                      {a.kind === 'card' ? '💳 ' : a.kind === 'bank' ? '🏦 ' : '💵 '}{a.label}
                    </option>
                  ))}
            </Select>
          </Field>
          <span />
        </FieldRow>
      )}
      {isInvestment && investmentAccounts.length === 0 && (
        <div className="-mt-2 mb-3">
          <p className="text-[0.7rem] text-ink-dim leading-snug mb-1.5">
            No investment accounts yet.
          </p>
          <button
            type="button"
            onClick={() => { openAddAccount?.(); }}
            className="btn-ghost btn-sm text-[0.72rem]"
          >
            + Create Investment Account
          </button>
        </div>
      )}
      {accountRequired && accounts.length <= 1 && (
        <p className="-mt-2 mb-3 text-[0.7rem] text-ink-dim leading-snug">
          Tip: add your bank accounts and credit cards on the <strong>Net Worth</strong> page to
          spend from them here. Only Cash is available until then.
        </p>
      )}

      {/* v9.1 §7 — multi-account split removed (rarely used). People-splitting
         (the "Split this bill" section below) is unaffected. */}

      {/* B4.2 — "More details" disclosure: reveals the secondary fields (time
          above, recurring + note here) only when the user wants them. */}
      {shortForm && !showMore && (
        <button type="button" onClick={() => setShowMore(true)}
          className="font-mono text-[0.62rem] tracking-wider uppercase text-coral hover:underline mb-3">
          + More details
        </button>
      )}

      {showSecondary && (
        <Field label="Note" hint="optional">
          <Input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="" />
        </Field>
      )}

      <label className="flex items-center gap-2 mb-3 text-[0.84rem] text-ink-mid cursor-pointer select-none">
        <input
          type="checkbox"
          checked={form.excluded}
          onChange={e => setForm(f => ({ ...f, excluded: e.target.checked }))}
        />
        <span>🔒 Private — exclude from totals, charts and Pulse Score</span>
      </label>

      {/* ── Split a bill / shared income (expense + income) ── */}
      {(form.type === 'expense' || form.type === 'income') && (
        <div className="mb-4 border border-line rounded-lg overflow-hidden">
          <label className="flex items-center gap-2 px-3 py-2.5 bg-bg3 text-[0.84rem] text-ink cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.splitEnabled}
              onChange={e => setForm(f => ({ ...f, splitEnabled: e.target.checked, splitAuto: e.target.checked ? true : f.splitAuto }))}
            />
            <span>{form.type === 'income' ? '🤝 Share this income with others' : '🤝 Split this bill with others'}</span>
          </label>

          {form.splitEnabled && (
            <div className="p-3 space-y-3">
              <Field label={form.type === 'income' ? 'Who received the money?' : 'Who paid the bill?'}>
                <Select
                  value={form.splitPaidBy}
                  onChange={e => setForm(f => ({ ...f, splitPaidBy: e.target.value as 'me' | 'external' }))}
                >
                  {form.type === 'income' ? (
                    <>
                      <option value="me">You received it — you'll forward each person their share</option>
                      <option value="external">Someone else received it — they owe you your share</option>
                    </>
                  ) : (
                    <>
                      <option value="me">You paid — others owe you</option>
                      <option value="external">Someone else paid — you owe your share</option>
                    </>
                  )}
                </Select>
              </Field>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="mono-label">Participants &amp; shares ({form.currency})</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={resetEvenSplit}
                      className={`font-mono text-[0.6rem] tracking-wider uppercase hover:underline ${form.splitAuto ? 'text-sage' : 'text-ink-dim'}`}
                      title="Reset to an even split"
                    >
                      {form.splitAuto ? '⚖ Even (auto)' : '⚖ Even split'}
                    </button>
                    <button
                      type="button"
                      onClick={addParticipant}
                      className="font-mono text-[0.6rem] tracking-wider uppercase text-coral hover:underline"
                    >
                      + Add person
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {form.splitParticipants.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        className="input flex-1 py-1.5"
                        value={p.isYou ? 'You' : p.name}
                        disabled={p.isYou}
                        placeholder="Name"
                        onChange={e => updateName(i, e.target.value)}
                        onKeyDown={e => {
                          if (!p.isYou && (e.key === 'Backspace' || e.key === 'Delete') && !p.name && form.splitParticipants.length > 2) {
                            e.preventDefault();
                            removeParticipant(i);
                          }
                        }}
                      />
                      <input
                        className="input w-28 py-1.5 text-right"
                        type="number" min="0" step="0.01"
                        value={p.share}
                        placeholder="0.00"
                        onChange={e => editShare(i, e.target.value)}
                      />
                      {!p.isYou ? (
                        <button
                          type="button"
                          onClick={() => removeParticipant(i)}
                          className="text-ink-dim hover:text-terra w-7 flex-shrink-0 text-center"
                          aria-label="Remove participant"
                        >✕</button>
                      ) : <span className="w-7 flex-shrink-0" />}
                    </div>
                  ))}
                </div>
                {/* Running total vs bill + live validation */}
                {(() => {
                  const bill = parseFloat(form.amount) || 0;
                  const sum = form.splitParticipants.reduce((s, p) => s + (parseFloat(p.share) || 0), 0);
                  const ok = Math.abs(sum - bill) < 0.01 && bill > 0;
                  let error = '';
                  if (bill === 0) error = 'Enter the total bill amount above.';
                  else if (form.splitParticipants.length < 2) error = 'Add at least one other participant.';
                  else if (form.splitParticipants.some(p => !p.isYou && !p.name.trim())) error = 'All participants must have a name.';
                  else if (!ok) error = `Shares (${sum.toFixed(2)}) must add up to the bill (${bill.toFixed(2)}).`;
                  return (
                    <div className={`mt-2 font-mono text-[0.62rem] tracking-wider ${ok ? 'text-sage' : 'text-honey'}`}>
                      Shares total {sum.toFixed(2)} / bill {bill.toFixed(2)} {ok ? '✓' : '— must match'}
                      {error && <div className="text-terra mt-1 normal-case tracking-normal">{error}</div>}
                    </div>
                  );
                })()}
                <p className="mt-1.5 text-[0.7rem] text-ink-dim leading-snug">
                  Shares default to an <strong>even split</strong> and rebalance as you add people —
                  just type a number to override any share. The <strong>Amount</strong> above is the
                  full {form.type === 'income' ? 'incoming amount' : 'bill'}; only your share counts
                  toward your {form.type === 'income' ? 'income' : 'expenses'}, the rest is tracked
                  as IOUs on the Splits page.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        {initial ? (
          <button
            type="button"
            onClick={del}
            className="font-mono text-[0.62rem] tracking-wider uppercase text-terra hover:underline"
          >
            Delete
          </button>
        ) : <span />}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Update' : 'Add'}
          </Button>
        </div>
      </div>
      </>
      )}
    </Modal>
  );
}
