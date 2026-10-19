import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import FormPage from '../ui/FormPage';
import Chip from '../ui/Chip';
import { Field, Select } from '../ui/Input';
import SegmentedControl from '../ui/SegmentedControl';
import CategoryPicker from '../ui/CategoryPicker';
import { AmountField } from '../ui/NumericKeypad';
import { parseAmount } from '../../lib/amountInput';
import { useStore } from '../../store';
import { nowTime, uid, today, addDaysISO, fmt } from '../../lib/format';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  CATEGORIES_BY_TYPE,
  CURRENCIES,
  getCat,
} from '../../constants';
import { buildAccountsFromStore, resolveAccount, editSeedAccount, ACCOUNT_REQUIRED_TYPES, notInvestment, txnAccountLabel } from '../../lib/accounts';
import { confirmSheet } from '../../lib/confirmSheet';
import { deleteTransactionRequest } from '../../lib/confirmCopy';
import TimeDial from '../ui/TimeDial';
import { accountValueOf } from '../../lib/accountBalance';
import { PAYMENT_MODE_LABEL } from '../../lib/accountsView';
import { LoanPaymentRefused, loanErrorMessage } from '../../lib/loanSchedule';
import { recentCategories, suggestCategory, type CategorySuggestion } from '../../lib/categorySuggest';
import { buildTxn, undoableNewTxn } from '../../lib/txnBuild';
import type { Transaction, TxnType, Recurrence, PaymentMode, LoanDue } from '../../types';

interface Props {
  /** v10.28.0 — rendered as the /transactions/new and /transactions/:id/edit
   *  pages (pages/FormPages.tsx); a routed page is always open. */
  open?: boolean;
  initial?: Transaction | null;
  /** v7.4.5 — partial values from Ask Vyact or a notification (router state). */
  seed?: Partial<Transaction> | null;
  onClose: () => void;
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
  /** v10.25.0 (R3) — how the paying account was used; '' = not stated. */
  paymentMode: PaymentMode | '';
  // v9 §4.3 — investment direction ('added' = money in, 'withdrew' = money out).
  direction: 'added' | 'withdrew';
  // v9 §4.1 — the loan an EMI pays (required when category = loan_emi).
  linkedDebtId: string;
  // v9.4.2 — part-payment strategy when EMI amount exceeds the minimum payment.
  /** v7.3 — Money Map Item #5. When `splitAcrossAccounts` is true the
   *  primary `paymentMethod` is treated as informational only; the actual
   *  source-of-funds is the multi-account `accountSplitRows` array. */
  splitAcrossAccounts: boolean;
  accountSplitRows: { accountId: string; amount: number }[];
  recurring: Recurrence | '';
  excluded: boolean;
}

// v9 txn-redesign §3 — type-scoped defaults. Transfers and investments carry NO
// category (CK_txn_category_by_type); '' is the client-side sentinel for null.
// Aurora 4.0 CAT1 — an expense has NO default: it starts on "Choose category" and needs a pick (or an
// accepted suggestion). Every new expense used to start on Food & Dining, so a forgotten pick filed
// rent or fuel as dining. Income keeps Salary (most income is pay).
const DEFAULT_CAT_BY_TYPE: Record<TxnType, string> = {
  expense:    '',
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
  paymentMode: '',
  direction: 'added',
  linkedDebtId: '',
  splitAcrossAccounts: false,
  accountSplitRows: [],
  recurring: '',
  excluded: false,
});

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

// Must share today()'s basis (lib/format.ts — the device's local day since W3a). It is string
// arithmetic on today(), so Today and Yesterday can never collide into the same date.
function yesterdayStr(): string {
  return addDaysISO(today(), -1);
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
  const payLoan           = useStore(s => s.payLoan);
  const loanDue           = useStore(s => s.loanDue);
  const removeTransaction = useStore(s => s.removeTransaction);
  const toast             = useStore(s => s.toast);
  // v10.26.0 (R4) — investments live in Net Worth; the empty state adds one there.
  const openAddAsset      = useStore(s => s.openAddAsset);

  const open          = props.open ?? true;
  const initial       = props.initial ?? null;
  const seedProp      = props.seed ?? null;
  const onClose       = props.onClose;

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
  const loanOperation = useRef<string | null>(null);
  const [showTimeDial, setShowTimeDial] = useState(false); // v10.17 — circular 24h picker panel
  // Aurora 4.0 FRM2 — member and the exclude switch sit behind one "More details" row.
  const [showDetails, setShowDetails] = useState(false);
  // CAT2 — the suggestion from the description, until the person picks a category themselves.
  const [suggestion, setSuggestion] = useState<CategorySuggestion | null>(null);
  const [catPicked, setCatPicked] = useState(false);
  const [catMissing, setCatMissing] = useState(false);
  // W4f (D19) — the loans an EMI can pay (not receivables, not closed), and what the chosen one has due.
  const payableLoans = useMemo(() => debts.filter(d => (d.direction ?? 'owed_by_me') === 'owed_by_me' && !d.paidOffAt), [debts]);
  const [emiDue, setEmiDue] = useState<LoanDue | null>(null);
  useEffect(() => {
    setEmiDue(null);
    if (!open || form.category !== 'loan_emi' || !form.linkedDebtId) return;
    let live = true;
    loanDue(form.linkedDebtId).then(due => { if (live) setEmiDue(due); }).catch(() => { /* fault-ok: the form still saves; the server decides what is due */ });
    return () => { live = false; };
  }, [open, form.category, form.linkedDebtId, loanDue]);

  // The household's accounts (Accounts screen), in the ledger's own encoding.
  // T5b (v10.121.0; audit XC-ARC-08) — the retired Money Map flag no longer picks the list: in local-only
  // builds it chose the legacy assets + debts derivation, whose bank-asset options moved no account at all.
  // v10.17 — the cash-side picker never offers investment accounts; they are
  // walled off to the Investment track only (`notInvestment` predicate).
  const accounts = useMemo(
    () => buildAccountsFromStore(accountsState, { filter: notInvestment }),
    [accountsState],
  );
  // For transfer + investment, the destination dropdown excludes the source
  // so a user can't pick the same account on both sides — and (v10.17) never
  // lists investment accounts either.
  const accountsTo = useMemo(
    () => buildAccountsFromStore(accountsState, { excludeId: form.paymentMethod || undefined, filter: notInvestment }),
    [accountsState, form.paymentMethod],
  );
  // v9 §4.3 — the Investment form's destination picker shows ONLY
  // type='investment' ASSETS (value = the asset id) — v10.26.0 (R4): an
  // investment moves money between an account and a Net Worth asset.
  const investmentAssets = useMemo(
    () => assets.filter(a => a.type === 'investment'),
    [assets],
  );
  const accountRequired = ACCOUNT_REQUIRED_TYPES.includes(
    form.type as (typeof ACCOUNT_REQUIRED_TYPES)[number],
  );
  const isTransfer   = form.type === 'transfer';
  const isInvestment = form.type === 'investment';
  const isIncome     = form.type === 'income';
  // Context-matched Help & Guide entry for the info icon — transfer/investment
  // have their own FAQ; expense and income share one ("expense-income").
  const helpTopicId = isTransfer ? 'transfer' : isInvestment ? 'investment' : 'expense-income';
  const needsToAccount = isTransfer || isInvestment;
  // v10.17 §2 — "Took money out" reorients the pickers: the FROM slot shows
  // the investment account (bound to `paymentMethodTo`) and the destination
  // slot shows the bank/cash account (bound to `paymentMethod`). The stored
  // from/to is byte-identical to before (the persist swap is unchanged).
  const isWithdraw = isInvestment && form.direction === 'withdrew';
  // Account-field label varies by track: expense flows out of an account,
  // income lands in one, transfer/investment have both sides.
  const accountLabel = needsToAccount ? 'From account' : isIncome ? 'To account' : 'Account';

  // v10.25.0 (R3) — the account the money is paid with (income: paid into) and
  // the modes it is used with. Only those modes are offered; investments carry none.
  const payingAccount = useMemo(
    () => (isInvestment || !form.paymentMethod) ? undefined
      : accountsState.find(a => a.id === form.paymentMethod || accountValueOf(a) === form.paymentMethod),
    [isInvestment, form.paymentMethod, accountsState],
  );
  const payingModes = useMemo(() => payingAccount?.paymentModes ?? [], [payingAccount]);
  // A new transaction preselects the account's first mode. An edit never gains a
  // mode the user did not choose (honest data) — it only loses one the newly
  // picked account does not use.
  //
  // v10.27.0 — the mode is now a dropdown with "Not specified". Preselect only
  // when the paying ACCOUNT changes; re-applying it whenever the mode is empty
  // snapped "Not specified" straight back to the first mode.
  const payingId = payingAccount?.id;
  const lastPayingId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!open) { lastPayingId.current = undefined; return; }
    const accountChanged = lastPayingId.current !== payingId;
    lastPayingId.current = payingId;
    if (payingModes.length === 0) return;
    if (form.paymentMode && !payingModes.includes(form.paymentMode)) {
      setForm(f => ({ ...f, paymentMode: initial ? '' : payingModes[0] }));
    } else if (accountChanged && !initial && !form.paymentMode) {
      setForm(f => ({ ...f, paymentMode: payingModes[0] }));
    }
  }, [open, initial, payingId, payingModes, form.paymentMode]);

  useEffect(() => {
    if (!open) return;
    loanOperation.current = null;
    setShowTimeDial(false);
    setShowDetails(false);
    setSuggestion(null);
    setCatMissing(false);
    // An opened row or a seed that names a category keeps it: only a blank pick takes suggestions.
    setCatPicked(Boolean(initial || seedProp?.category));
    if (initial) {
      const initialTime = deriveInitialTime(initial);
      setForm({
        type: initial.type,
        amount: String(initial.amount),
        currency: profile.baseCurrency,   // W3b: an old row's label is not kept — one currency
        date: initial.date,
        time: initialTime,
        description: initial.description,
        category: initial.category,
        note: initial.note ?? '',
        memberId: initial.memberId ?? defaultMemberId,
        // v10.26.0 (R4) — an asset-based investment binds the asset to
        // paymentMethodTo and the bank/cash side to paymentMethod (encoded like
        // the picker's chips); a withdrawal reopens on "Took money out".
        paymentMethod: initial.assetId
          ? (initial.paymentMethod ?? (() => {
              const id = initial.accountId ?? initial.toAccountId;
              const acc = accountsState.find(a => a.id === id);
              return acc ? accountValueOf(acc) : (id ?? '');
            })())
          : editSeedAccount(initial, accountsState),   // W8a (FE-UIC-05): the FK first, like the ledger
        paymentMethodTo: initial.assetId ?? initial.toAccountId ?? initial.linkedToAssetId ?? '',
        paymentMode: initial.paymentMode ?? '',
        direction: initial.assetId && initial.toAccountId && !initial.accountId ? 'withdrew' : 'added',
        linkedDebtId: initial.emiSplit?.debt_id ?? initial.linkedDebtId ?? '',
        splitAcrossAccounts: Boolean(initial.accountSplits && initial.accountSplits.length),
        accountSplitRows: initial.accountSplits ? initial.accountSplits.map(s => ({ accountId: s.accountId, amount: s.amount })) : [],
        recurring: initial.recurring ?? '',
        excluded: Boolean(initial.excluded),
      });
    } else {
      // v7.4.5 — `seed` (from Ask Vyact's two-tap flow, or a notification
      // deep-action like "Record payment") pre-fills the form and names a track.
      const seed = seedProp ?? undefined;
      const initialType: TxnType = (seed?.type as TxnType) ?? 'expense';
      const base = blank(profile.baseCurrency, defaultMemberId, initialType);
      const blankForm: FormState = {
        ...base,
        amount: seed?.amount != null ? String(seed.amount) : base.amount,
        currency: base.currency,           // W3b: a seed's currency never overrides the household's
        description: seed?.description ?? base.description,
        category: seed?.category ?? base.category,
        note: seed?.note ?? base.note,
        date: seed?.date ?? base.date,
        // v10.38 — the paying account an Ask Vyact capture identified (a card named
        // in a bank message, say). `paymentMethod` IS the account field here.
        paymentMethod: seed?.accountId ?? base.paymentMethod,
        linkedDebtId: seed?.linkedDebtId ?? seed?.debtId ?? base.linkedDebtId,
      };
      // CAT2 — a seeded description with no category gets the same suggestion typing would.
      const seeded = seed?.category ? null : suggestCategory(blankForm.description, initialType);
      if (seeded) blankForm.category = seeded.category;
      setSuggestion(seeded);
      setForm(blankForm);
    }
    // Audit 6.4 — hydrate ONLY on the open event / the row being edited. The
    // dependency list deliberately EXCLUDES the live `profile.baseCurrency` and
    // `defaultMemberId` values: a background sync that refreshed those used to
    // re-run this effect and wipe an in-progress draft. The base-currency /
    // default-member values are CAPTURED at open (read once, above) and the
    // form is an explicit editor keyed on what it's editing, not a live mirror.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id, seedProp]);

  function setType(type: TxnType) {
    // A type change re-reads the description for the new type (CAT2); a pick made for the old type
    // does not carry over.
    const next = suggestCategory(form.description, type);
    setCatPicked(false);
    setCatMissing(false);
    setSuggestion(next);
    setForm(f => ({ ...f, type, category: next?.category ?? DEFAULT_CAT_BY_TYPE[type] }));
  }

  // CAT2 — typing a description fills the category with its suggestion, until the person picks one.
  function setDescription(description: string) {
    if (catPicked || isTransfer || isInvestment) { setForm(f => ({ ...f, description })); return; }
    const next = suggestCategory(description, form.type);
    setSuggestion(next);
    if (next) setCatMissing(false);
    setForm(f => ({ ...f, description, category: next?.category ?? DEFAULT_CAT_BY_TYPE[f.type] }));
  }

  function pickCategory(category: string) {
    setCatPicked(true);
    setSuggestion(null);
    setCatMissing(false);
    setForm(f => ({ ...f, category }));
  }

  const cats = categoriesFor(form.type);
  // CAT3 — the household's most used categories of this type, listed first.
  const recent = useMemo(() => recentCategories(transactions, form.type, today()), [transactions, form.type]);

  // Reset category to a valid one if type change orphans it ('' is "Choose category", never orphaned).
  useEffect(() => {
    if (form.category && !cats.find(c => c.id === form.category)) {
      setForm(f => ({ ...f, category: DEFAULT_CAT_BY_TYPE[f.type] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.type]);

  // Reset for a rapid "Save & add another" — keep the track, currency, member,
  // date and account so the next entry only needs an amount.
  function resetForNext() {
    setCatPicked(false);
    setSuggestion(null);
    setCatMissing(false);
    setForm(f => ({ ...blank(f.currency, f.memberId, f.type), date: f.date, paymentMethod: f.paymentMethod }));
  }

  // The single money-critical save path. `addAnother` only changes what happens
  // AFTER a successful upsert (reset-in-place vs close); the transaction it
  // builds — including the transfer/investment swap matrix and split model —
  // is identical and unchanged from the pre-Aurora form.
  async function persist(addAnother: boolean) {
    // Aurora 4.0 PIP2 — the build-and-check lives in lib/txnBuild.ts (moved unchanged), so Pip's inline
    // Save card refuses and builds exactly what this form does.
    const built = buildTxn(form, { initial, payingModes, newId: uid });
    if (!built.ok) {
      if (built.field === 'category') setCatMissing(true);
      toast(built.error, 'error');
      return;
    }
    const { txn, loan } = built;

    setSaving(true);
    try {
      // Audit F2 — a NEW loan EMI is an explicit financial command, not a
      // generic upsert. W4f (D19): the SERVER computes the split (pay_loan: interest first, then
      // principal, for the instalment due). An amount above what is due is refused — the extra is a
      // prepayment, recorded from the loan (owner). Edits of an existing EMI leg are refused by the
      // store: a payment is undone from the loan, as a whole.
      if (loan) {
        loanOperation.current ??= uid();
        try {
          const res = await payLoan({ operationId: loanOperation.current, kind: 'emi', ...loan });
          toast(res.closesInstalment
            ? `EMI #${res.instalmentNo} recorded — ${fmt(res.interest, form.currency)} interest, ${fmt(res.principal, form.currency)} off the loan`
            : `Part of EMI #${res.instalmentNo} recorded. The rest is still due.`, 'success');
        } catch (e) {
          if (e instanceof LoanPaymentRefused) {
            toast(loanErrorMessage(e.code, e.figure, n => fmt(n, form.currency)), 'error');
            return;
          }
          throw e;
        }
        loanOperation.current = null;
        if (addAnother) resetForNext(); else onClose();
        return;
      }
      await upsertTransaction(txn);

      // v9.1 §5 — recurrence is authored ONLY in the Recurring section now;
      // the Transaction form no longer mirrors a schedule.

      // Offer Undo only for a freshly-added PLAIN expense/income row — those
      // delete cleanly. System-split rows (loan_emi, transfer, investment)
      // create linked legs, so we never one-tap-undo them.
      const undoable = undoableNewTxn(initial, form.type, form.category);
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
    // Aurora 4.0 CF3 — a sheet naming the entry and where it comes off.
    const st = useStore.getState();
    const category = initial.category && initial.type !== 'transfer' && initial.type !== 'investment' ? getCat(initial.category).label : null;
    const where = [category, txnAccountLabel(initial, st.accounts, st.assets, st.debts)].filter(Boolean).join(' and ');
    const ok = await confirmSheet(deleteTransactionRequest({
      name: initial.description?.trim() ?? '', amount: fmt(Math.abs(initial.amount), initial.currency), where,
    }));
    if (!ok) return;
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


  /* Aurora 4.0 F2 — "Save {type}" with "Save & add another" as a secondary button beside it (was a
     plain-text link under it). An edit keeps Delete as the quiet link below. */
  const footer = (
    <div>
      <div className="flex gap-2">
        <button type="button" onClick={() => persist(false)} disabled={saving}
          className="btn-primary flex-1 disabled:opacity-60">
          {saving ? 'Saving…' : initial ? `Update ${form.type}` : `Save ${form.type}`}
        </button>
        {!initial && (
          <button type="button" onClick={() => persist(true)} disabled={saving}
            className="btn-secondary flex-1 disabled:opacity-60">
            Save &amp; add another
          </button>
        )}
      </div>
      {initial && (
        <div className="text-center mt-2">
          <button type="button" onClick={del}
            className="ui-action text-terra hover:underline min-h-[44px]">
            Delete
          </button>
        </div>
      )}
    </div>
  );
  const member = members.find(m => m.id === form.memberId);
  const detailsLine = [
    member ? (member.id === defaultMemberId ? 'You' : member.name) : 'No member',
    form.excluded ? 'not in totals' : 'counted in totals',
  ].join(' · ');

  return (
    <FormPage open={open} onClose={onClose} title={modalTitle} footer={footer} className="ui-pilot" helpTopicId={helpTopicId}>
      <div className="ui-form-stack">
      {/* Aurora 4.0 F1 — the amount first: most entries never change the type. */}
      <div className="py-1 mb-1">
        <AmountField value={form.amount} currencySymbol={currencySymbol}
          onChange={v => setForm(f => ({ ...f, amount: v }))} />
      </div>

      <SegmentedControl label="Transaction type" value={form.type} onChange={setType}
        options={TYPE_CHIPS.map(item => ({ value: item.type, label: item.label,
          disabled: !!initial && item.type !== form.type, testId: `txn-type-${item.type}` }))} />

      {/* CAT2 (B′) — the description comes before the category and suggests it. */}
      <div className="mt-4">
        <div className="mono-label mb-1.5">Description {isTransfer ? <span className="text-ink-dim">·optional</span> : null}</div>
        <input
          className="input w-full"
          value={form.description}
          aria-label="Description"
          onChange={e => setDescription(e.target.value)}
          placeholder={isTransfer ? 'e.g. Move savings to brokerage' : isIncome ? 'e.g. July salary' : 'e.g. Tesco grocery run'}
        />
      </div>

      {/* CAT1/CAT2/CAT3 — one select: "Choose category" until picked or suggested, the most used first. */}
      {!isTransfer && !isInvestment && (
        <CategoryPicker type={form.type} testId="txn-category" value={form.category} onChange={pickCategory}
          recent={recent}
          error={catMissing ? 'Choose a category for this entry' : undefined}
          hint={suggestion && form.category === suggestion.category
            ? `Suggested from “${suggestion.word}” · change it if that’s wrong` : undefined} />
      )}

      {/* v9 §4.1 — loan_emi loan picker (required) */}
      {form.type === 'expense' && form.category === 'loan_emi' && (
        <div className="mt-4">
          {payableLoans.length ? (
            <Field label="Loan">
              <Select value={form.linkedDebtId} required onChange={e => setForm(f => ({ ...f, linkedDebtId: e.target.value }))}>
                <option value="">Choose loan</option>
                {payableLoans.map(debt => <option key={debt.id} value={debt.id}>{debt.name}</option>)}
              </Select>
            </Field>
          ) : (
            <p className="text-[0.72rem] text-ink-dim">No loans yet — add one on the Debts page first.</p>
          )}
          {/* W4f (D19) — what is due, exactly as the server will accept it. */}
          {!initial && emiDue && !emiDue.paidOff && (
            <div className="mt-2 text-[0.72rem] text-ink-mid flex items-center gap-2 flex-wrap">
              <span>EMI #{emiDue.instalmentNo}{emiDue.dueDate ? ` due ${emiDue.dueDate}` : ''}: {fmt(emiDue.remaining, form.currency)}{emiDue.started ? ' left' : ''}</span>
              {parseAmount(form.amount) !== emiDue.remaining && (
                <button type="button" className="underline text-accent"
                  onClick={() => setForm(f => ({ ...f, amount: String(emiDue.remaining) }))}>Use {fmt(emiDue.remaining, form.currency)}</button>
              )}
              <span className="text-ink-dim">Paying extra? Use Prepay on the loan.</span>
            </div>
          )}
        </div>
      )}

      {/* v9 §4.3 — investment direction */}
      {isInvestment && (
        <SegmentedControl label="Direction" value={form.direction} onChange={direction => setForm(f => ({ ...f, direction }))}
          options={[{ value: 'added', label: 'Added money' }, { value: 'withdrew', label: 'Took money out' }]} />
      )}

      {/* Board M4 "Date · paid with" — date/time pickers and the source
          account share ONE labeled row. The time chip opens the circular 24h
          TimeDial (v10.17 item 14); the board's 📅 Pick chip IS the date input.
          v10.17 §2: "Took money out" puts the INVESTMENT account in this FROM
          slot (bound to `paymentMethodTo`); every other track puts the
          bank/cash source here (bound to `paymentMethod`, investment walled). */}
      <div className="mt-4">
        <div className="mono-label mb-related">Date and time</div>
        {/* Aurora 4.0 FRM1 — the shortcuts on their own row, then date and time as two equal 44px fields
            (they shared one wrapping row, and the time dropped to its own line on phones). */}
        <div className="flex gap-1.5 items-center mb-2">
          <Chip on={form.date === todayStr} onClick={() => setForm(f => ({ ...f, date: todayStr }))}>Today</Chip>
          <Chip on={form.date === yStr} onClick={() => setForm(f => ({ ...f, date: yStr }))}>Yesterday</Chip>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input type="date" value={form.date}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            className="input h-[44px] py-0 px-3 w-full min-w-0" aria-label="Pick a date" />
          <button type="button" onClick={() => setShowTimeDial(v => !v)}
            className="input h-[44px] py-0 px-3 w-full min-w-0 flex items-center justify-center gap-1.5 num"
            aria-label="Pick a time" aria-expanded={showTimeDial}>
            <span aria-hidden>🕑</span>{form.time || '--:--'}
          </button>
        </div>
        {showTimeDial && (
          <div className="mt-3 flex justify-center rounded-r3 border border-line py-4"
            style={{ background: 'var(--elevated)' }}>
            <TimeDial value={form.time || nowTime()} onChange={v => setForm(f => ({ ...f, time: v }))} />
          </div>
        )}
      </div>

      <Field label={isWithdraw ? 'Investment' : accountLabel}>
        <Select data-testid="txn-source" value={isWithdraw ? form.paymentMethodTo : form.paymentMethod}
          required={accountRequired} onChange={e => setForm(f => isWithdraw
            ? { ...f, paymentMethodTo: e.target.value } : { ...f, paymentMethod: e.target.value })}>
          <option value="">{isWithdraw ? 'Choose investment' : 'Choose account'}</option>
          {isWithdraw
            ? investmentAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)
            : accounts.map(account => <option key={account.value} value={account.value}>{account.label}</option>)}
          {!isWithdraw && form.paymentMethod && !currentInList &&
            <option value={form.paymentMethod}>{currentAccount?.label ?? form.paymentMethod} (legacy)</option>}
        </Select>
      </Field>
      {payingModes.length > 0 && <Field label="Payment mode">
        <Select value={form.paymentMode} onChange={e => setForm(f => ({ ...f, paymentMode: e.target.value as PaymentMode | '' }))}>
          <option value="">Not specified</option>
          {payingModes.map(mode => <option key={mode} value={mode}>{PAYMENT_MODE_LABEL[mode]}</option>)}
        </Select>
      </Field>}

      {/* Destination account (transfer/investment) — required.
          transfer → bank/cash (paymentMethodTo, investment walled);
          investment "added" → the investment account (paymentMethodTo);
          investment "withdrew" → bank/cash destination (paymentMethod). */}
      {needsToAccount && (
        <Field label={isInvestment && !isWithdraw ? 'Investment' : 'To account'}>
          <Select data-testid="txn-destination" value={isWithdraw ? form.paymentMethod : form.paymentMethodTo} required
            onChange={e => setForm(f => isWithdraw ? { ...f, paymentMethod: e.target.value } : { ...f, paymentMethodTo: e.target.value })}>
            <option value="">{isInvestment && !isWithdraw ? 'Choose investment' : 'Choose account'}</option>
            {isInvestment && !isWithdraw
              ? investmentAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)
              : (isWithdraw ? accounts : accountsTo).map(account => <option key={account.value} value={account.value}>{account.label}</option>)}
          </Select>
        </Field>
      )}
      {isInvestment && investmentAssets.length === 0 &&
        <button type="button" onClick={() => openAddAsset()} className="btn-ghost">Add an investment</button>}

      {/* Aurora 4.0 FRM2 — the member (almost always you) and the exclude switch are rarely changed:
          one "More details" row shows their current values and opens in place. */}
      <div className="mt-4">
        <button type="button" data-testid="txn-all-details" aria-expanded={showDetails}
          onClick={() => setShowDetails(v => !v)}
          className="well w-full min-h-[48px] px-3.5 py-2 flex items-center justify-between gap-3 text-left">
          <span className="min-w-0">
            <span className="block text-[13.5px] font-medium text-ink">More details</span>
            <span className="block text-[12px] text-ink-dim truncate">{detailsLine}</span>
          </span>
          <ChevronDown size={16} aria-hidden className={`text-ink-dim flex-shrink-0 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
        </button>
        {showDetails && (
          <div className="mt-3">
            <Field label="Member" hint={isTransfer ? 'Optional' : undefined}>
              <Select data-testid="txn-member" value={form.memberId} onChange={e => setForm(f => ({ ...f, memberId: e.target.value }))}>
                <option value="">{isTransfer ? 'None' : 'Choose member'}</option>
                {members.map(member => <option key={member.id} value={member.id}>{member.name}{member.id === defaultMemberId ? ' (You)' : ''}</option>)}
              </Select>
            </Field>

            {/* W3b (v10.66.0; owner decision D14) — every transaction is in the household's currency; an
                edited legacy row is saved in it too (it already counted at face value). Nothing converts. */}
            <div className="mt-4">
              <label className="flex items-center gap-2 text-[0.84rem] text-ink-mid cursor-pointer select-none min-h-[44px]">
                <input type="checkbox" checked={form.excluded}
                  onChange={e => setForm(f => ({ ...f, excluded: e.target.checked }))} />
                <span>Exclude from household totals and charts</span>
              </label>
              {/* W0 (FE-PUB-01) — this used to say "🔒 Private", but the entry stays visible to
                  every member; only the totals leave it out. Say exactly that. */}
              <p className="ml-6 text-[12px] text-ink-dim leading-snug">
                Everyone in the household can still see this entry.
              </p>
            </div>
          </div>
        )}
      </div>

      </div>
    </FormPage>
  );
}
