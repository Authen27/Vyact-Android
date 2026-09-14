import { useEffect, useMemo, useRef, useState } from 'react';
import FormPage from '../ui/FormPage';
import Chip from '../ui/Chip';
import { Field, Select } from '../ui/Input';
import SegmentedControl from '../ui/SegmentedControl';
import CategoryPicker from '../ui/CategoryPicker';
import { AmountField } from '../ui/NumericKeypad';
import { useStore } from '../../store';
import { normalizeTimeInput, nowTime, uid, today } from '../../lib/format';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  CATEGORIES_BY_TYPE,
  CURRENCIES,
} from '../../constants';
import { buildAccounts, buildAccountsFromStore, resolveAccount, ACCOUNT_REQUIRED_TYPES, notInvestment } from '../../lib/accounts';
import TimeDial from '../ui/TimeDial';
import { getMoneyMapMode } from '../../lib/featureFlags';
import { FEATURES } from '../../config/features';
import { accountValueOf } from '../../lib/accountBalance';
import { PAYMENT_MODE_LABEL } from '../../lib/accountsView';
import type { Transaction, TxnType, Recurrence, PartPaymentChoice, PaymentMode } from '../../types';

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
  partPaymentChoice: PartPaymentChoice;
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
  partPaymentChoice: 'reduce_tenure',
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

// Must share today()'s UTC basis (lib/format.ts) — mixing a local-time
// yesterday with a UTC-based today collided into the same string west of
// UTC in the early-morning local hours, making Today/Yesterday impossible
// to tell apart or un-select.
function yesterdayStr(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

export default function TransactionFormModal(props: Props) {
  const profile           = useStore(s => s.profile);
  const members           = useStore(s => s.members);
  const session           = useStore(s => s.session);
  const assets            = useStore(s => s.assets);
  const debts             = useStore(s => s.debts);
  const accountsState     = useStore(s => s.accounts);
  const upsertTransaction = useStore(s => s.upsertTransaction);
  const recordLoanPayment = useStore(s => s.recordLoanPayment);
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

  // Linked spending accounts. With `money_map` flag on (or in shadow) and
  // a populated `accounts` store, source options from the canonical table;
  // otherwise fall back to the legacy assets+debts derivation so off-mode
  // and pre-backfill households keep working unchanged.
  const useFirstClassAccounts = getMoneyMapMode() !== 'off' && accountsState.length > 0;
  // v10.17 — the cash-side picker never offers investment accounts; they are
  // walled off to the Investment track only (`notInvestment` predicate).
  const accounts = useMemo(
    () => useFirstClassAccounts
      ? buildAccountsFromStore(accountsState, { filter: notInvestment })
      : buildAccounts(assets, debts),
    [useFirstClassAccounts, accountsState, assets, debts],
  );
  // For transfer + investment, the destination dropdown excludes the source
  // so a user can't pick the same account on both sides — and (v10.17) never
  // lists investment accounts either.
  const accountsTo = useMemo(
    () => useFirstClassAccounts
      ? buildAccountsFromStore(accountsState, { excludeId: form.paymentMethod || undefined, filter: notInvestment })
      : buildAccounts(assets, debts, { excludeId: form.paymentMethod || undefined }),
    [useFirstClassAccounts, accountsState, assets, debts, form.paymentMethod],
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
    if (initial) {
      const initialTime = deriveInitialTime(initial);
      setForm({
        type: initial.type,
        amount: String(initial.amount),
        currency: initial.currency,
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
          : (initial.paymentMethod ?? initial.accountId ?? ''),
        paymentMethodTo: initial.assetId ?? initial.toAccountId ?? initial.linkedToAssetId ?? '',
        paymentMode: initial.paymentMode ?? '',
        direction: initial.assetId && initial.toAccountId && !initial.accountId ? 'withdrew' : 'added',
        linkedDebtId: initial.emiSplit?.debt_id ?? initial.linkedDebtId ?? '',
        partPaymentChoice: initial.emiSplit?.partPaymentChoice ?? 'reduce_tenure',
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
        currency: seed?.currency ?? base.currency,
        description: seed?.description ?? base.description,
        category: seed?.category ?? base.category,
        note: seed?.note ?? base.note,
        date: seed?.date ?? base.date,
        linkedDebtId: seed?.linkedDebtId ?? seed?.debtId ?? base.linkedDebtId,
      };
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

  // Reset for a rapid "Save & add another" — keep the track, currency, member,
  // date and account so the next entry only needs an amount.
  function resetForNext() {
    setForm(f => ({ ...blank(f.currency, f.memberId, f.type), date: f.date, paymentMethod: f.paymentMethod }));
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
    const normalizedTime = normalizeTimeInput(form.time);
    if (!normalizedTime) {
      toast('Pick a time for this transaction', 'error');
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

    // Splits are authored in the standalone Split form (v10.16); a plain
    // transaction never carries a `split`.
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
        // v10.26.0 (R4) — an investment names the asset plus ONE account: the
        // paying account for a buy, the receiving account for a withdrawal.
        paymentMethod: isInvestment ? (isWithdraw ? undefined : form.paymentMethod || undefined) : (fromEncoded || undefined),
        ...(isInvestment ? {
          assetId: form.paymentMethodTo || undefined,
          accountId: undefined,
          toAccountId: isWithdraw ? form.paymentMethod || undefined : undefined,
        } : {}),
        // v10.25.0 — undefined when the account's modes are unknown, so an edit
        // never erases a stored mode it could not display.
        // An investment only ever CLEARS a mode it already had — sending null on
        // every investment would name a column a lagging schema does not have yet.
        paymentMode: isInvestment ? (initial?.paymentMode ? null : undefined)
          : payingModes.length ? (form.paymentMode || null) : undefined,
        recurring: form.recurring || undefined,
        excluded: form.excluded || undefined,
        linkedToAssetId: isInvestment ? undefined : needsToAccount ? toEncoded || undefined : initial?.linkedToAssetId,
        linkedDebtId: (form.category === 'loan_emi' ? form.linkedDebtId : undefined) ?? initial?.linkedDebtId,
        // v9.4.2 — thread part-payment choice so the loan_emi path can re-amortise.
        // Stored transiently on the emiSplit object; the store reads it on create.
        ...(form.category === 'loan_emi' && form.linkedDebtId ? {
          _partPaymentChoice: form.partPaymentChoice,
        } : {}),
        linkedTxnId:   initial?.linkedTxnId,
        // Audit F7 — carry the read version through the edit so the store can
        // pass it as the optimistic-concurrency precondition. Without this the
        // edit fell back to last-write-wins.
        updated_at:    initial?.updated_at,
      };

      // Audit F2 — a NEW loan EMI is an explicit financial command, not a
      // generic upsert. The store performs the system split (interest expense
      // + principal transfer) via the atomic record_loan_payment RPC when
      // online. Edits of an existing EMI leg stay on the plain path — the
      // store recognises the known id and skips re-decomposition.
      if (!initial && form.category === 'loan_emi' && form.linkedDebtId) {
        loanOperation.current ??= uid();
        await recordLoanPayment({
          operationId: loanOperation.current,
          debtId: form.linkedDebtId,
          fundingAccountId: fromEncoded || undefined,
          amount,
          currency: form.currency,
          date: form.date,
          description: form.description.trim() || undefined,
          memberId: form.memberId,
          partPaymentChoice: form.partPaymentChoice,
        });
        // The store surfaces the re-amortisation message itself; no undo —
        // system-split rows create linked legs and never one-tap-undo.
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
      const undoable = !initial
        && (form.type === 'expense' || form.type === 'income')
        && form.category !== 'loan_emi';
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

  /* Board M4 footer — one full-width primary "Save {type}", with
     "Save & add another" (create) or Delete (edit) as a quiet cap link below. */
  const footer = (
    <div>
      <button type="button" onClick={() => persist(false)} disabled={saving}
        className="btn-primary w-full disabled:opacity-60">
        {saving ? 'Saving…' : initial ? `Update ${form.type}` : `Save ${form.type}`}
      </button>
      <div className="text-center mt-2">
        {initial ? (
          <button type="button" onClick={del}
            className="ui-action text-terra hover:underline">
            Delete
          </button>
        ) : (
          <button type="button" onClick={() => persist(true)} disabled={saving}
            className="ui-action text-ink-mid hover:text-ink disabled:opacity-60">
            Save &amp; add another
          </button>
        )}
      </div>
    </div>
  );

  return (
    <FormPage open={open} onClose={onClose} title={modalTitle} footer={footer} className="ui-pilot" helpTopicId={helpTopicId}>
      <div className="ui-form-stack">
      {/* Track chips — centered row per board M4. */}
      <SegmentedControl label="Transaction type" value={form.type} onChange={setType}
        options={TYPE_CHIPS.map(item => ({ value: item.type, label: item.label,
          disabled: !!initial && item.type !== form.type, testId: `txn-type-${item.type}` }))} />

      {/* Amount hero — bare on the sheet per board M4 (no field chrome). */}
      <div className="py-1 mb-1">
        <AmountField value={form.amount} currencySymbol={currencySymbol}
          onChange={v => setForm(f => ({ ...f, amount: v }))} />
      </div>

      {/* Category tiles (expense/income) — board M4: a WRAPPED grid of the 7
          most recent + a "⌕ More" tile, not a horizontal scroller. The selected
          category is always kept visible in the collapsed set. */}
      {!isTransfer && !isInvestment && (
        <CategoryPicker type={form.type} testId="txn-category" value={form.category}
          onChange={category => setForm(f => ({ ...f, category }))} />
      )}

      {/* v9 §4.1 — loan_emi loan picker (required) */}
      {form.type === 'expense' && form.category === 'loan_emi' && (
        <div className="mt-4">
          {debts.length ? (
            <Field label="Loan">
              <Select value={form.linkedDebtId} required onChange={e => setForm(f => ({ ...f, linkedDebtId: e.target.value }))}>
                <option value="">Choose loan</option>
                {debts.map(debt => <option key={debt.id} value={debt.id}>{debt.name}</option>)}
              </Select>
            </Field>
          ) : (
            <p className="text-[0.72rem] text-ink-dim">No loans yet — add one on the Debts page first.</p>
          )}
        </div>
      )}

      {/* v9.4.2 — part-payment strategy (excess over the minimum EMI) */}
      {showPartPayment && (
        <div className="mt-3">
          <SegmentedControl label="Apply excess to" value={form.partPaymentChoice}
            onChange={partPaymentChoice => setForm(f => ({ ...f, partPaymentChoice }))}
            options={[{ value: 'reduce_tenure', label: 'Reduce tenure' }, { value: 'reduce_emi', label: 'Reduce EMI' }, { value: 'apply_advance', label: 'Apply advance' }]} />
        </div>
      )}

      {/* v9 §4.3 — investment direction */}
      {isInvestment && (
        <SegmentedControl label="Direction" value={form.direction} onChange={direction => setForm(f => ({ ...f, direction }))}
          options={[{ value: 'added', label: 'Added money' }, { value: 'withdrew', label: 'Took money out' }]} />
      )}

      {/* Description — a plain open field (v10.17 item 1: the recent-value
          dropdown was removed per request). */}
      <div className="mt-4">
        <div className="mono-label mb-1.5">Description {isTransfer ? <span className="text-ink-dim">·optional</span> : null}</div>
        <input
          className="input w-full"
          value={form.description}
          aria-label="Description"
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder={isTransfer ? 'e.g. Move savings to brokerage' : isIncome ? 'e.g. July salary' : 'e.g. Tesco grocery run'}
        />
      </div>

      {/* Board M4 "Date · paid with" — date/time pickers and the source
          account share ONE labeled row. The time chip opens the circular 24h
          TimeDial (v10.17 item 14); the board's 📅 Pick chip IS the date input.
          v10.17 §2: "Took money out" puts the INVESTMENT account in this FROM
          slot (bound to `paymentMethodTo`); every other track puts the
          bank/cash source here (bound to `paymentMethod`, investment walled). */}
      <div className="mt-4">
        <div className="mono-label mb-related">Date and time</div>
        <div className="flex gap-1.5 items-center flex-wrap">
          <Chip on={form.date === todayStr} onClick={() => setForm(f => ({ ...f, date: todayStr }))}>Today</Chip>
          <Chip on={form.date === yStr} onClick={() => setForm(f => ({ ...f, date: yStr }))}>Yesterday</Chip>
          {/* Inner non-wrapping group — the date input and the time chip always
              stay side by side even when the chip row wraps on narrow sheets. */}
          <div className="flex gap-1.5 items-center">
            <input type="date" value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              className="input h-[34px] py-0 px-2.5 text-[12.5px] w-[132px]" aria-label="Pick a date" />
            <button type="button" onClick={() => setShowTimeDial(v => !v)}
              className="input h-[34px] py-0 px-2.5 text-[12.5px] w-[96px] flex items-center justify-center gap-1 font-mono"
              aria-label="Pick a time" aria-expanded={showTimeDial}>
              <span aria-hidden>🕑</span>{form.time || '--:--'}
            </button>
          </div>
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

      {/* Board M4 — member row lives on the MAIN sheet (initials chips,
          "MR · You" for yourself), not behind the disclosure. */}
      <Field label="Member" hint={isTransfer ? 'Optional' : undefined}>
        <Select data-testid="txn-member" value={form.memberId} onChange={e => setForm(f => ({ ...f, memberId: e.target.value }))}>
          <option value="">{isTransfer ? 'None' : 'Choose member'}</option>
          {members.map(member => <option key={member.id} value={member.id}>{member.name}{member.id === defaultMemberId ? ' (You)' : ''}</option>)}
        </Select>
      </Field>

      {/* Currency selection removed (v10.5.5) — every transaction uses the
          household's base currency. Edits of a legacy foreign-currency row
          keep its stored currency untouched (form.currency still carries it
          through persist); there's just no control to change it. Only one
          field lived behind "All details" (Private) — promoted to the main
          sheet since a one-item disclosure was pure friction. */}
      <div className="mt-4">
        {form.currency !== profile.baseCurrency && (
          <p className="mb-2 text-[0.72rem] text-ink-dim leading-snug">
            Recorded in {form.currency}; reports convert to {profile.baseCurrency}.
          </p>
        )}
        <label className="flex items-center gap-2 text-[0.84rem] text-ink-mid cursor-pointer select-none">
          <input type="checkbox" checked={form.excluded}
            onChange={e => setForm(f => ({ ...f, excluded: e.target.checked }))} />
          <span>🔒 Private — exclude from totals, charts and Pulse Score</span>
        </label>
      </div>

      </div>
    </FormPage>
  );
}
