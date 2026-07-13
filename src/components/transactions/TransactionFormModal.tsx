import { useEffect, useMemo, useState } from 'react';
import HalfSheet from '../ui/HalfSheet';
import Chip, { CategoryChip } from '../ui/Chip';
import NumericKeypad, { AmountField, applyKey } from '../ui/NumericKeypad';
import { useStore } from '../../store';
import { normalizeTimeInput, nowTime, uid, today } from '../../lib/format';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  CATEGORIES_BY_TYPE,
  CURRENCIES,
} from '../../constants';
import { buildAccounts, buildAccountsFromStore, resolveAccount, ACCOUNT_REQUIRED_TYPES } from '../../lib/accounts';
import { getMoneyMapMode } from '../../lib/featureFlags';
import { FEATURES } from '../../config/features';
import type { Transaction, TxnType, Recurrence, PartPaymentChoice } from '../../types';

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

// Aurora type-chip metadata (v10.1) — the amount-first sheet replaces the
// old 4-card TrackPicker / Track <Select> with a single chip row.
const TYPE_CHIPS: { type: TxnType; label: string; emoji: string }[] = [
  { type: 'expense',    label: 'Expense',    emoji: '💸' },
  { type: 'income',     label: 'Income',     emoji: '💰' },
  { type: 'transfer',   label: 'Transfer',   emoji: '🔄' },
  { type: 'investment', label: 'Investment', emoji: '📈' },
];

const acctEmoji = (kind?: string) =>
  kind === 'card' ? '💳' : kind === 'bank' ? '🏦' : kind === 'investment' ? '📈' : '💵';

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

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TransactionFormModal(props: Props) {
  const profile           = useStore(s => s.profile);
  const members           = useStore(s => s.members);
  const session           = useStore(s => s.session);
  const assets            = useStore(s => s.assets);
  const debts             = useStore(s => s.debts);
  const accountsState     = useStore(s => s.accounts);
  const transactions      = useStore(s => s.transactions);
  const upsertTransaction = useStore(s => s.upsertTransaction);
  const removeTransaction = useStore(s => s.removeTransaction);
  const toast             = useStore(s => s.toast);
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
  const [showMore, setShowMore] = useState(false);   // "All details" disclosure
  const [timeInput, setTimeInput] = useState<TimeInputState>(() => splitTimeForInput(nowTime()));

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
  // Account-field label varies by track: expense flows out of an account,
  // income lands in one, transfer/investment have both sides.
  const accountLabel = needsToAccount ? 'From account' : isIncome ? 'To account' : 'Account';

  useEffect(() => {
    if (!open) return;
    setShowMore(false);   // each open starts with secondary fields collapsed
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
    } else {
      // v7.4.5 — `storeSeed` (from Ask Vyact's two-tap flow, or a notification
      // deep-action like "Record payment") pre-fills the form and names a track.
      const seed = storeSeed ?? undefined;
      const initialType: TxnType = (seed?.type as TxnType) ?? 'expense';
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
    }
  }, [open, initial, storeSeed, profile.baseCurrency, defaultMemberId]);

  function setType(type: TxnType) {
    setForm(f => ({ ...f, type, category: DEFAULT_CAT_BY_TYPE[type] }));
  }

  const cats = categoriesFor(form.type);

  // Reset category to a valid one if type change orphans it
  useEffect(() => {
    if (!cats.find(c => c.id === form.category)) {
      setForm(f => ({ ...f, category: cats[0]?.id ?? f.category }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.type]);

  // Categories ordered recents-first (the 8 most recently-used for this track,
  // then the rest of the type-scoped set) so the common picks lead.
  const orderedCats = useMemo(() => {
    if (isTransfer || isInvestment) return [] as typeof cats;
    const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
    const recent: string[] = [];
    for (const t of sorted) {
      if (t.type !== form.type || !t.category) continue;
      if (!recent.includes(t.category)) recent.push(t.category);
      if (recent.length >= 8) break;
    }
    const byId = new Map(cats.map(c => [c.id, c] as const));
    const head = recent.map(id => byId.get(id)).filter(Boolean) as typeof cats;
    const tail = cats.filter(c => !recent.includes(c.id));
    return [...head, ...tail];
  }, [transactions, form.type, cats, isTransfer, isInvestment]);

  // Recent descriptions for this track — offered as an autocomplete datalist.
  const recentDescriptions = useMemo(() => {
    const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
    const out: string[] = [];
    for (const t of sorted) {
      if (t.type !== form.type) continue;
      const d = t.description?.trim();
      if (d && !out.includes(d)) out.push(d);
      if (out.length >= 8) break;
    }
    return out;
  }, [transactions, form.type]);

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

  // Reset for a rapid "Save & add another" — keep the track, currency, member,
  // date and account so the next entry only needs an amount.
  function resetForNext() {
    setForm(f => ({ ...blank(f.currency, f.memberId, f.type), date: f.date, paymentMethod: f.paymentMethod }));
    setTimeInput(splitTimeForInput(nowTime()));
    setShowMore(false);
  }

  // The single money-critical save path. `addAnother` only changes what happens
  // AFTER a successful upsert (reset-in-place vs close); the transaction it
  // builds — including the transfer/investment swap matrix and split model —
  // is identical and unchanged from the pre-Aurora form.
  async function persist(addAnother: boolean) {
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

      // Offer Undo only for a freshly-added PLAIN expense/income row — those
      // delete cleanly. System-split rows (loan_emi, transfer, investment) and
      // people-splits create linked legs/IOUs, so we never one-tap-undo them.
      const undoable = !initial
        && (form.type === 'expense' || form.type === 'income')
        && form.category !== 'loan_emi'
        && !form.splitEnabled;
      const createdId = txn.id;
      toast(
        initial ? 'Transaction updated' : 'Transaction added',
        'success',
        undoable ? { label: 'Undo', run: () => { void removeTransaction(createdId); } } : undefined,
      );
      if (addAnother && !initial) {
        resetForNext();
      } else {
        onClose();
      }
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
  const typeMeta = TYPE_CHIPS.find(t => t.type === form.type);
  const modalTitle = `${initial ? 'Edit' : 'Add'} ${typeMeta?.label ?? 'transaction'}`;
  const currencySymbol = CURRENCIES[form.currency]?.symbol ?? '$';
  const todayStr = today();
  const yStr = yesterdayStr();

  const linkedDebt = debts.find(d => d.id === form.linkedDebtId);
  const enteredAmt = parseFloat(form.amount) || 0;
  const showPartPayment = form.type === 'expense' && form.category === 'loan_emi'
    && !!linkedDebt && enteredAmt > linkedDebt.minimumPayment;

  const footer = (
    <div className="flex items-center gap-2">
      {initial ? (
        <button type="button" onClick={del}
          className="font-mono text-[0.62rem] tracking-wider uppercase text-terra hover:underline mr-auto">
          Delete
        </button>
      ) : null}
      {!initial && (
        <button type="button" onClick={() => persist(true)} disabled={saving}
          className="btn-secondary flex-1 disabled:opacity-60">
          Save &amp; add another
        </button>
      )}
      <button type="button" onClick={() => persist(false)} disabled={saving}
        className="btn-primary flex-1 disabled:opacity-60">
        {saving ? 'Saving…' : initial ? 'Update' : 'Save'}
      </button>
    </div>
  );

  return (
    <HalfSheet open={open} onClose={onClose} title={modalTitle} footer={footer}>
      {/* Track chips (amount-first sheet — replaces the Track dropdown) */}
      <div className="flex gap-1.5 flex-wrap mb-3">
        {TYPE_CHIPS.map(t => (
          <Chip key={t.type} on={t.type === form.type} onClick={() => !initial && setType(t.type)}
            testId={`txn-type-${t.type}`}
            className={initial && t.type !== form.type ? 'opacity-40 pointer-events-none' : ''}>
            <span aria-hidden>{t.emoji}</span>{t.label}
          </Chip>
        ))}
      </div>

      {/* Amount hero + in-sheet keypad */}
      <div className="rounded-r3 py-1.5 mb-1" style={{ boxShadow: 'var(--neu-inset)', background: 'var(--sunken)' }}>
        <AmountField value={form.amount} currencySymbol={currencySymbol} />
      </div>
      <NumericKeypad onKey={k => setForm(f => ({ ...f, amount: applyKey(f.amount, k) }))} />

      {/* Category tiles (expense/income) — recents first */}
      {!isTransfer && !isInvestment && (
        <div className="mt-4">
          <div className="mono-label mb-1.5">Category</div>
          <div className="flex gap-2 overflow-x-auto pb-1.5 -mx-1 px-1">
            {orderedCats.map(c => (
              <CategoryChip key={c.id} emoji={c.icon} label={c.label} testId={`txn-cat-${c.id}`}
                on={c.id === form.category}
                onClick={() => setForm(f => ({ ...f, category: c.id }))} />
            ))}
          </div>
        </div>
      )}

      {/* v9 §4.1 — loan_emi loan picker (required) */}
      {form.type === 'expense' && form.category === 'loan_emi' && (
        <div className="mt-4">
          <div className="mono-label mb-1.5">Which loan? <span className="text-terra">·required</span></div>
          {debts.length ? (
            <div className="flex gap-1.5 flex-wrap">
              {debts.map(d => (
                <Chip key={d.id} on={d.id === form.linkedDebtId} testId={`txn-loan-${d.id}`}
                  onClick={() => setForm(f => ({ ...f, linkedDebtId: d.id }))}>{d.name}</Chip>
              ))}
            </div>
          ) : (
            <p className="text-[0.72rem] text-ink-dim">No loans yet — add one on the Debts page first.</p>
          )}
        </div>
      )}

      {/* v9.4.2 — part-payment strategy (excess over the minimum EMI) */}
      {showPartPayment && (
        <div className="mt-3">
          <div className="mono-label mb-1.5">Apply excess to</div>
          <div className="flex gap-1.5 flex-wrap">
            {(['reduce_tenure', 'reduce_emi', 'apply_advance'] as PartPaymentChoice[]).map(ch => (
              <Chip key={ch} on={form.partPaymentChoice === ch}
                onClick={() => setForm(f => ({ ...f, partPaymentChoice: ch }))}>
                {ch === 'reduce_tenure' ? 'Reduce tenure' : ch === 'reduce_emi' ? 'Reduce EMI' : 'Apply advance'}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {/* v9 §4.3 — investment direction */}
      {isInvestment && (
        <div className="mt-4">
          <div className="mono-label mb-1.5">Direction</div>
          <div className="flex gap-1.5">
            {(['added', 'withdrew'] as const).map(d => (
              <Chip key={d} on={form.direction === d}
                onClick={() => setForm(f => ({ ...f, direction: d }))}>
                {d === 'added' ? '↑ Added money' : '↓ Took money out'}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {/* Description with recent-value autocomplete */}
      <div className="mt-4">
        <div className="mono-label mb-1.5">Description {isTransfer ? <span className="text-ink-dim">·optional</span> : null}</div>
        <input
          className="input w-full"
          value={form.description}
          list="txn-desc-suggestions"
          aria-label="Description"
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder={isTransfer ? 'e.g. Move savings to brokerage' : isIncome ? 'e.g. July salary' : 'e.g. Tesco grocery run'}
        />
        <datalist id="txn-desc-suggestions">
          {recentDescriptions.map(d => <option key={d} value={d} />)}
        </datalist>
      </div>

      {/* Date quick-chips */}
      <div className="mt-4">
        <div className="mono-label mb-1.5">Date</div>
        <div className="flex gap-1.5 items-center flex-wrap">
          <Chip on={form.date === todayStr} onClick={() => setForm(f => ({ ...f, date: todayStr }))}>Today</Chip>
          <Chip on={form.date === yStr} onClick={() => setForm(f => ({ ...f, date: yStr }))}>Yesterday</Chip>
          <input type="date" value={form.date}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            className="input h-[34px] py-0 px-2.5 text-[12.5px] w-[150px]" aria-label="Pick a date" />
        </div>
      </div>

      {/* Source account chips */}
      <div className="mt-4">
        <div className="mono-label mb-1.5">
          {accountLabel} {accountRequired ? <span className="text-terra">·required</span> : <span className="text-ink-dim">·optional</span>}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {accounts.map(a => (
            <Chip key={a.value} on={a.value === form.paymentMethod} testId={`txn-acct-${a.value}`}
              onClick={() => setForm(f => ({ ...f, paymentMethod: a.value }))}>
              <span aria-hidden>{acctEmoji(a.kind)}</span>{a.label}
            </Chip>
          ))}
          {form.paymentMethod && !currentInList && (
            <Chip on onClick={() => { /* keep legacy value selectable */ }}>
              {currentAccount ? currentAccount.label : form.paymentMethod} (legacy)
            </Chip>
          )}
        </div>
        {accountRequired && accounts.length <= 1 && (
          <p className="mt-1.5 text-[0.7rem] text-ink-dim leading-snug">
            Tip: add your bank accounts and credit cards on the <strong>Net Worth</strong> page to
            spend from them here. Only Cash is available until then.
          </p>
        )}
      </div>

      {/* Destination account (transfer/investment) — required */}
      {needsToAccount && (
        <div className="mt-4">
          <div className="mono-label mb-1.5">
            {isTransfer ? 'To account' : 'Investment account'} <span className="text-terra">·required</span>
          </div>
          {isInvestment && investmentAccounts.length === 0 ? (
            <div>
              <p className="text-[0.72rem] text-ink-dim leading-snug mb-1.5">No investment accounts yet.</p>
              <button type="button" onClick={() => { openAddAccount?.(); }} className="btn-ghost btn-sm text-[0.72rem]">
                + Create investment account
              </button>
            </div>
          ) : (
            <div className="flex gap-1.5 flex-wrap">
              {isInvestment
                ? investmentAccounts.map(a => (
                    <Chip key={a.id} on={a.id === form.paymentMethodTo} testId={`txn-to-${a.id}`}
                      onClick={() => setForm(f => ({ ...f, paymentMethodTo: a.id }))}>
                      <span aria-hidden>📈</span>{a.name}
                    </Chip>
                  ))
                : accountsTo.map(a => (
                    <Chip key={a.value} on={a.value === form.paymentMethodTo} testId={`txn-to-${a.value}`}
                      onClick={() => setForm(f => ({ ...f, paymentMethodTo: a.value }))}>
                      <span aria-hidden>{acctEmoji(a.kind)}</span>{a.label}
                    </Chip>
                  ))}
            </div>
          )}
        </div>
      )}

      {/* "All details" disclosure */}
      {!showMore ? (
        <button type="button" onClick={() => setShowMore(true)} data-testid="txn-all-details"
          className="mt-4 font-mono text-[0.62rem] tracking-wider uppercase text-coral hover:underline">
          All details ▾
        </button>
      ) : (
        <div className="mt-4 pt-4 border-t border-line space-y-4">
          {/* Currency */}
          <div>
            <div className="mono-label mb-1.5">Currency</div>
            <div className="flex gap-1.5 flex-wrap">
              {Object.entries(CURRENCIES).map(([code, c]) => (
                <Chip key={code} on={code === form.currency} testId={`txn-cur-${code}`} onClick={() => setForm(f => ({ ...f, currency: code }))}>
                  {c.symbol} {code}
                </Chip>
              ))}
            </div>
          </div>

          {/* Member */}
          <div>
            <div className="mono-label mb-1.5">Member {isTransfer ? <span className="text-ink-dim">·optional</span> : null}</div>
            <div className="flex gap-1.5 flex-wrap">
              {isTransfer && (
                <Chip on={!form.memberId} testId="txn-member-none" onClick={() => setForm(f => ({ ...f, memberId: '' }))}>None</Chip>
              )}
              {members.map(m => (
                <Chip key={m.id} on={m.id === form.memberId} testId={`txn-member-${m.id}`} onClick={() => setForm(f => ({ ...f, memberId: m.id }))}>
                  {m.name}
                </Chip>
              ))}
            </div>
          </div>

          {/* Time */}
          <div>
            <div className="mono-label mb-1.5">Time</div>
            <div className="flex gap-2 items-center">
              <input inputMode="numeric" value={timeInput.clock} maxLength={5} placeholder="hh:mm"
                onChange={e => setTimeInput(t => ({ ...t, clock: e.target.value }))}
                className="input w-[110px]" aria-label="Time" />
              {(['AM', 'PM'] as Meridiem[]).map(m => (
                <Chip key={m} on={timeInput.meridiem === m} onClick={() => setTimeInput(t => ({ ...t, meridiem: m }))}>{m}</Chip>
              ))}
            </div>
          </div>

          {/* Note */}
          <div>
            <div className="mono-label mb-1.5">Note <span className="text-ink-dim">·optional</span></div>
            <input className="input w-full" value={form.note} aria-label="Note"
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="" />
          </div>

          {/* Private */}
          <label className="flex items-center gap-2 text-[0.84rem] text-ink-mid cursor-pointer select-none">
            <input type="checkbox" checked={form.excluded}
              onChange={e => setForm(f => ({ ...f, excluded: e.target.checked }))} />
            <span>🔒 Private — exclude from totals, charts and Pulse Score</span>
          </label>

          {/* Split a bill / shared income */}
          {(form.type === 'expense' || form.type === 'income') && (
            <div className="border border-line rounded-lg overflow-hidden">
              <label className="flex items-center gap-2 px-3 py-2.5 bg-bg3 text-[0.84rem] text-ink cursor-pointer select-none">
                <input type="checkbox" checked={form.splitEnabled}
                  onChange={e => setForm(f => ({ ...f, splitEnabled: e.target.checked, splitAuto: e.target.checked ? true : f.splitAuto }))} />
                <span>{form.type === 'income' ? '🤝 Share this income with others' : '🤝 Split this bill with others'}</span>
              </label>

              {form.splitEnabled && (
                <div className="p-3 space-y-3">
                  <div>
                    <div className="mono-label mb-1.5">{form.type === 'income' ? 'Who received the money?' : 'Who paid the bill?'}</div>
                    <div className="flex gap-1.5 flex-wrap">
                      <Chip on={form.splitPaidBy === 'me'} onClick={() => setForm(f => ({ ...f, splitPaidBy: 'me' }))}>
                        {form.type === 'income' ? 'You received it' : 'You paid'}
                      </Chip>
                      <Chip on={form.splitPaidBy === 'external'} onClick={() => setForm(f => ({ ...f, splitPaidBy: 'external' }))}>
                        {form.type === 'income' ? 'Someone else received it' : 'Someone else paid'}
                      </Chip>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="mono-label">Participants &amp; shares ({form.currency})</label>
                      <div className="flex gap-2">
                        <button type="button" onClick={resetEvenSplit}
                          className={`font-mono text-[0.6rem] tracking-wider uppercase hover:underline ${form.splitAuto ? 'text-sage' : 'text-ink-dim'}`}
                          title="Reset to an even split">
                          {form.splitAuto ? '⚖ Even (auto)' : '⚖ Even split'}
                        </button>
                        <button type="button" onClick={addParticipant}
                          className="font-mono text-[0.6rem] tracking-wider uppercase text-coral hover:underline">
                          + Add person
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {form.splitParticipants.map((p, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input className="input flex-1 py-1.5" value={p.isYou ? 'You' : p.name} disabled={p.isYou} placeholder="Name"
                            onChange={e => updateName(i, e.target.value)}
                            onKeyDown={e => {
                              if (!p.isYou && (e.key === 'Backspace' || e.key === 'Delete') && !p.name && form.splitParticipants.length > 2) {
                                e.preventDefault();
                                removeParticipant(i);
                              }
                            }} />
                          <input className="input w-28 py-1.5 text-right" type="number" min="0" step="0.01" value={p.share} placeholder="0.00"
                            onChange={e => editShare(i, e.target.value)} />
                          {!p.isYou ? (
                            <button type="button" onClick={() => removeParticipant(i)}
                              className="text-ink-dim hover:text-terra w-7 flex-shrink-0 text-center" aria-label="Remove participant">✕</button>
                          ) : <span className="w-7 flex-shrink-0" />}
                        </div>
                      ))}
                    </div>
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
        </div>
      )}
    </HalfSheet>
  );
}
