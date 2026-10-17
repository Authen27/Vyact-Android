// Vyact v10.16 — standalone Add/Edit Split form.
//
// Splits used to be a section of the Add-Transaction sheet. They now live in
// their own form, but remain **transaction-backed**: saving creates/updates a
// real `Transaction` carrying `SplitInfo`, so only *your share* counts toward
// Cash Flow / budgets / accounts (via `effectiveDinero`) and the who-owes view
// (`splitsOutstanding`) stays true. The owner always paid (`paidBy: 'me'`);
// participants owe the owner. In cloud mode, emailed participants also get
// `shared_splits` rows (cross-household visibility + email).
//
// Editing is allowed **only while nothing is paid/settled** — split-level fields
// lock once any participant has paid, and an individual participant's row locks
// once that person pays/settles.
//
// v10.28.0 — rendered as the /splits/new and /splits/:txnId/edit pages.
import { useEffect, useMemo, useState } from 'react';
import FormPage from '../ui/FormPage';
import Chip from '../ui/Chip';
import CategoryPicker from '../ui/CategoryPicker';
import SegmentedControl from '../ui/SegmentedControl';
import { Field, Select } from '../ui/Input';
import { AmountField } from '../ui/NumericKeypad';
import { parseAmount } from '../../lib/amountInput';
import Button from '../ui/Button';
import { useStore } from '../../store';
import { uid, today, nowTime, fmt, addDaysISO } from '../../lib/format';
import { recentCategories, suggestCategory, type CategorySuggestion } from '../../lib/categorySuggest';
import { confirmSheet } from '../../lib/confirmSheet';
import { deleteSplitRequest } from '../../lib/confirmCopy';
import { CURRENCIES } from '../../constants';
import { buildAccounts, buildAccountsFromStore, ACCOUNT_REQUIRED_TYPES, notInvestment } from '../../lib/accounts';
import { getMoneyMapMode } from '../../lib/featureFlags';
import { resolveParticipantNames } from '../../lib/sharedSplits';
import { participantEmailProblem, needsConfirmation, confirmQuestion, paidOnFor, type ConfirmItem } from '../../lib/splitParticipants';
import { editPatch } from '../../lib/txnEdit';
import Modal from '../ui/Modal';
import type { Transaction } from '../../types';

interface Props {
  open?: boolean;
  initial?: Transaction | null;
  /** W4c (D18) — a new split pre-filled from Pip's capture (total, category, how many ways). */
  seed?: Partial<Transaction> | null;
  onClose: () => void;
}

type SplitType = 'expense' | 'income';

interface PForm {
  name: string;
  share: string;      // text input
  isYou: boolean;
  email?: string;
  paid: boolean;      // settled? (from cloud share or local participant)
  shareId?: string;   // matched shared_split_shares.id (cloud, edit)
}

interface FormState {
  type: SplitType;
  amount: string;     // the TOTAL bill
  currency: string;
  date: string;
  description: string;
  category: string;
  paymentMethod: string;
  participants: PForm[];
  auto: boolean;      // keep shares auto-even until hand-edited
}

const acctEmoji = (kind?: string) =>
  kind === 'card' ? '💳' : kind === 'bank' ? '🏦' : kind === 'investment' ? '📈' : '💵';

// Aurora 4.0 FS2 — the transaction form's rules (CAT1): a shared bill starts on "Choose category".
const defaultCat = (type: SplitType) => (type === 'income' ? 'salary' : '');

const defaultParticipants = (): PForm[] => ([
  { name: 'You', share: '', isYou: true, paid: true },
  { name: '', share: '', isYou: false, paid: false },
]);

const blank = (currency: string): FormState => ({
  type: 'expense',
  amount: '',
  currency,
  date: today(),
  description: '',
  category: defaultCat('expense'),
  paymentMethod: '',
  participants: defaultParticipants(),
  auto: true,
});

// Even split of `bill` across `n`; rounding remainder goes to the first.
function evenShares(bill: number, n: number): string[] {
  if (n < 1) return [];
  const base = Math.floor((bill / n) * 100) / 100;
  const shares = Array(n).fill(base);
  const remainder = Math.round((bill - base * n) * 100) / 100;
  shares[0] = Math.round((shares[0] + remainder) * 100) / 100;
  return shares.map(s => (bill > 0 ? s.toFixed(2) : ''));
}

export default function SplitFormModal(props: Props) {
  const profile           = useStore(s => s.profile);
  const members           = useStore(s => s.members);
  const session           = useStore(s => s.session);
  const assets            = useStore(s => s.assets);
  const debts             = useStore(s => s.debts);
  const transactions      = useStore(s => s.transactions);
  const accountsState     = useStore(s => s.accounts);
  const upsertTransaction = useStore(s => s.upsertTransaction);
  const removeTransaction = useStore(s => s.removeTransaction);
  const toast             = useStore(s => s.toast);
  const cloudEnabled          = useStore(s => s.cloudEnabled);
  const currentHouseholdId    = useStore(s => s.currentHouseholdId);
  const sharedSplitsOwned     = useStore(s => s.sharedSplitsOwned);
  const createSharedSplitForTxn = useStore(s => s.createSharedSplitForTxn);
  const updateSharedSplitForTxn = useStore(s => s.updateSharedSplitForTxn);
  const deleteSharedSplitForTxn = useStore(s => s.deleteSharedSplitForTxn);
  const cloudActive = cloudEnabled && currentHouseholdId !== 'local';

  const open         = props.open ?? true;
  const initial      = props.initial ?? null;
  const seed         = props.seed ?? null;
  const onClose      = props.onClose;

  const defaultMemberId = useMemo(() => {
    if (session?.user?.id) {
      const mine = members.find(m => m.userId === session.user.id);
      if (mine) return mine.id;
    }
    return members[0]?.id ?? '';
  }, [members, session?.user?.id]);

  const [form, setForm]   = useState<FormState>(blank(profile.baseCurrency));
  const [saving, setSaving] = useState(false);
  // email → display-name resolution (cloud): string = has account, '' = no account, undefined = unresolved.
  const [resolvedNames, setResolvedNames] = useState<Record<string, string>>({});
  // v10.59.0 (owner) — the people to confirm before saving, and the answers given.
  const [confirmItems, setConfirmItems] = useState<ConfirmItem[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  // FS2 — the description suggests the category (CAT2), until a category is picked.
  const [suggestion, setSuggestion] = useState<CategorySuggestion | null>(null);
  const [catPicked, setCatPicked] = useState(false);
  const [catMissing, setCatMissing] = useState(false);
  const ownEmail = session?.user?.email ?? null;

  const useFirstClass = getMoneyMapMode() !== 'off' && accountsState.length > 0;
  // v10.17 item 15 — a split is never paid from an investment account.
  const accounts = useMemo(
    () => useFirstClass ? buildAccountsFromStore(accountsState, { filter: notInvestment }) : buildAccounts(assets, debts),
    [useFirstClass, accountsState, assets, debts],
  );

  // v10.17 item 10 — autocomplete of people you might tag: distinct emails from
  // prior split participants (local transactions + splits you've shared out).
  const emailSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const tx of transactions) {
      for (const p of tx.split?.participants ?? []) {
        if (p.email) set.add(p.email.toLowerCase());
      }
    }
    for (const sp of sharedSplitsOwned) {
      for (const sh of sp.shares) if (sh.email) set.add(sh.email.toLowerCase());
    }
    return [...set].sort();
  }, [transactions, sharedSplitsOwned]);

  // Hydrate on open. Edit uses the backing Transaction's split + (cloud) the
  // matched shared_split to read per-share paid/settled state.
  useEffect(() => {
    if (!open) return;
    setResolvedNames({});
    setSuggestion(null);
    setCatMissing(false);
    setCatPicked(Boolean(initial?.split?.isSplit || seed?.category));
    const sp = initial?.split;
    if (initial && sp?.isSplit) {
      const matched = sharedSplitsOwned.find(s => s.txnId === initial.id);
      setForm({
        type: initial.type === 'income' ? 'income' : 'expense',
        amount: String(sp.totalAmount),
        currency: profile.baseCurrency,   // W3b: one currency per household
        date: initial.date,
        description: initial.description,
        category: initial.category || defaultCat(initial.type === 'income' ? 'income' : 'expense'),
        paymentMethod: initial.paymentMethod ?? initial.accountId ?? '',
        auto: false,
        participants: sp.participants.map(p => {
          const email = (p.email ?? '').toLowerCase();
          const share = email ? matched?.shares.find(s => s.email.toLowerCase() === email) : undefined;
          return {
            name: p.isYou ? 'You' : p.name,
            share: String(p.share),
            isYou: Boolean(p.isYou),
            email: p.email,
            paid: p.isYou ? true : Boolean(share?.paid ?? p.paid),
            shareId: share?.id,
          };
        }),
      });
    } else if (seed) {
      // Pip knows the total and how many ways, not who: the other people are left to fill in, and
      // the shares stay even until one is edited.
      const type: SplitType = seed.type === 'income' ? 'income' : 'expense';
      const ways = Math.max(2, seed.split?.participants?.length ?? 2);
      const total = seed.split?.totalAmount ?? seed.amount;
      setForm({
        ...blank(profile.baseCurrency),
        type,
        amount: total != null ? String(total) : '',
        date: seed.date ?? today(),
        description: seed.description ?? '',
        category: seed.category || defaultCat(type),
        participants: [
          { name: 'You', share: '', isYou: true, paid: true },
          ...Array.from({ length: ways - 1 }, () => ({ name: '', share: '', isYou: false, paid: false })),
        ],
        auto: true,
      });
    } else {
      setForm(blank(profile.baseCurrency));
    }
  }, [open, initial, seed, sharedSplitsOwned, profile.baseCurrency]);

  // Auto-balance while `auto` is on.
  useEffect(() => {
    if (!form.auto) return;
    const bill = parseAmount(form.amount) || 0;
    const shares = evenShares(bill, form.participants.length);
    setForm(f => {
      if (!f.auto) return f;
      if (!f.participants.some((p, i) => p.share !== shares[i])) return f;
      return { ...f, participants: f.participants.map((p, i) => ({ ...p, share: shares[i] })) };
    });
  }, [form.amount, form.auto, form.participants.length]);

  const isIncome = form.type === 'income';
  const editing = Boolean(initial);
  // Per-participant lock: a settled participant's row is frozen. Split-level
  // fields lock once ANY participant has paid/settled.
  const anyPaid = form.participants.some(p => !p.isYou && p.paid);
  const splitLocked = editing && anyPaid;
  const currencySymbol = CURRENCIES[form.currency]?.symbol ?? '$';
  const accountRequired = ACCOUNT_REQUIRED_TYPES.includes(form.type as (typeof ACCOUNT_REQUIRED_TYPES)[number]);
  const idOf = (p: PForm) => (cloudActive ? (p.email ?? '').trim() : p.name.trim());

  function setType(type: SplitType) {
    if (splitLocked) return;
    const next = suggestCategory(form.description, type);
    setCatPicked(false);
    setSuggestion(next);
    setForm(f => ({ ...f, type, category: next?.category ?? defaultCat(type) }));
  }
  function setDescription(description: string) {
    if (catPicked) { setForm(f => ({ ...f, description })); return; }
    const next = suggestCategory(description, form.type);
    setSuggestion(next);
    if (next) setCatMissing(false);
    setForm(f => ({ ...f, description, category: next?.category ?? defaultCat(f.type) }));
  }
  function pickCategory(category: string) {
    setCatPicked(true);
    setSuggestion(null);
    setCatMissing(false);
    setForm(f => ({ ...f, category }));
  }
  const recent = useMemo(() => recentCategories(transactions, form.type, today()), [transactions, form.type]);
  function updateName(i: number, name: string) {
    setForm(f => ({ ...f, participants: f.participants.map((x, j) => j === i ? { ...x, name } : x) }));
  }
  function updateEmail(i: number, email: string) {
    setForm(f => ({ ...f, participants: f.participants.map((x, j) => j === i ? { ...x, email } : x) }));
  }
  async function resolveEmail(email: string) {
    const e = email.trim().toLowerCase();
    if (!e || resolvedNames[e] !== undefined) return;
    try {
      const map = await resolveParticipantNames([e]);
      setResolvedNames(prev => ({ ...prev, [e]: map[e] ?? '' }));
    } catch { /* best-effort */ }
  }
  function editShare(i: number, share: string) {
    setForm(f => ({ ...f, auto: false, participants: f.participants.map((x, j) => j === i ? { ...x, share } : x) }));
  }
  function addParticipant() {
    setForm(f => ({ ...f, participants: [...f.participants, { name: '', share: '', isYou: false, paid: false }] }));
  }
  function removeParticipant(i: number) {
    setForm(f => ({ ...f, participants: f.participants.filter((_, j) => j !== i) }));
  }

  async function save(confirmed = false) {
    const amount = parseAmount(form.amount);
    if (isNaN(amount) || amount <= 0) { toast('Enter a valid total greater than 0', 'error'); return; }
    if (!form.category) { setCatMissing(true); toast('Choose a category', 'error'); return; }
    if (accountRequired && !form.paymentMethod) {
      toast(`Choose an account this was ${isIncome ? 'paid into' : 'paid with'}`, 'error'); return;
    }
    const parts = form.participants
      .map(p => ({ ...p, shareNum: parseFloat(p.share) }))
      .filter(p => (p.isYou || idOf(p)) && !isNaN(p.shareNum) && p.shareNum >= 0);
    const you = parts.find(p => p.isYou);
    if (!you) { toast('A split needs your share', 'error'); return; }
    if (parts.length < 2) { toast('Add at least one other participant', 'error'); return; }
    if (parts.some(p => !p.isYou && !idOf(p))) {
      toast(cloudActive ? 'Every participant needs an email' : 'All participants must have a name', 'error'); return;
    }
    const sum = parts.reduce((s, p) => s + p.shareNum, 0);
    if (Math.abs(sum - amount) > 0.01) {
      toast(`Shares (${sum.toFixed(2)}) must add up to the total (${amount.toFixed(2)})`, 'error'); return;
    }

    // v10.59.0 (owner, items 1–3) — shared by email only, never with yourself, and each new
    // person confirmed before anything is saved.
    if (cloudActive) {
      const others = parts.filter(p => !p.isYou).map(p => (p.email ?? '').trim().toLowerCase());
      for (let i = 0; i < others.length; i++) {
        const problem = participantEmailProblem(others[i], ownEmail, others.slice(0, i));
        if (problem) { toast(`${others[i] || 'A participant'}: ${problem}`, 'error'); return; }
      }
      const before = (initial?.split?.participants ?? []).map(p => p.email ?? '').filter(Boolean);
      const toConfirm = needsConfirmation(others, before);
      if (toConfirm.length && !confirmed) {
        let names: Record<string, string> = {};
        try { names = await resolveParticipantNames(toConfirm); }
        catch { names = Object.fromEntries(toConfirm.filter(e => resolvedNames[e]).map(e => [e, resolvedNames[e]])); }
        setAnswers({});
        setConfirmItems(toConfirm.map(email => ({ email, name: names[email] || null })));
        return;
      }
    }

    const split: Transaction['split'] = {
      isSplit: true,
      totalAmount: amount,
      yourShare: you.shareNum,
      paidBy: 'me',
      participants: parts.map(p => {
        const email = (p.email ?? '').trim().toLowerCase();
        const displayName = p.isYou ? 'You'
          : (cloudActive ? (resolvedNames[email] || p.name.trim() || email) : p.name.trim());
        return {
          name: displayName,
          isYou: p.isYou || undefined,
          share: p.shareNum,
          paid: Boolean(p.isYou || p.paid),
          // W4c (D18) — someone who had already paid keeps the day they paid; only a new payment is today.
          paidOn: p.isYou ? null : paidOnFor(initial?.split?.participants, { email, name: displayName }, Boolean(p.paid), today()),
          email: (!p.isYou && email) ? email : undefined,
        };
      }),
    };

    setSaving(true);
    try {
      // W4c (D18) — a patch over the opened row: its note, payment mode, schedule link and the
      // version the store sends as the edit's precondition are kept.
      const txn: Transaction = editPatch(initial, {
        id: initial?.id ?? uid(),
        type: form.type,
        amount,
        currency: form.currency,
        date: form.date,
        time: initial?.time ?? nowTime(),
        description: form.description.trim(),
        category: form.category,
        memberId: initial?.memberId ?? defaultMemberId,
        paymentMethod: form.paymentMethod || undefined,
        split,
      });
      await upsertTransaction(txn);

      if (cloudActive) {
        const emailed = split.participants.filter(p => !p.isYou && p.email);
        const cloudInput = {
          txnId: txn.id,
          description: txn.description,
          currency: txn.currency,
          totalAmount: amount,
          txnType: form.type,
          date: txn.date,
          participants: emailed.map(p => ({ email: p.email!, share: p.share })),
        };
        try {
          if (editing) await updateSharedSplitForTxn(cloudInput);
          else if (emailed.length) await createSharedSplitForTxn(cloudInput);
        } catch (e) {
          toast(`Split saved, but sharing failed: ${(e as Error).message}`, 'error');
        }
      }

      toast(editing ? 'Split updated' : 'Split added', 'success');
      onClose();
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!initial) return;
    // Aurora 4.0 CF4 — says who is affected (closing a shared split is offered on the Splits page).
    const others = (initial.split?.participants ?? []).filter(p => !p.isYou).map(p => p.name || p.email || '').filter(Boolean);
    if (!(await confirmSheet(deleteSplitRequest({ name: initial.description ?? '', amount: fmt(initial.amount, initial.currency), others, canClose: false })))) return;
    try {
      await removeTransaction(initial.id);
      if (cloudActive) await deleteSharedSplitForTxn(initial.id);
      toast('Split deleted', 'info');
      onClose();
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, 'error');
    }
  }

  const footer = (
    <div className="flex items-center justify-between gap-2">
      {editing ? (
        <button type="button" onClick={del}
          className="ui-action text-terra hover:underline min-h-[44px]">
          Delete
        </button>
      ) : <span />}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save()} disabled={saving}>{saving ? 'Saving…' : editing ? 'Update' : 'Add split'}</Button>
      </div>
    </div>
  );

  const sharesSum = form.participants.reduce((s, p) => s + (parseFloat(p.share) || 0), 0);
  const bill = parseAmount(form.amount) || 0;
  const sharesOk = Math.abs(sharesSum - bill) < 0.01 && bill > 0;

  return (
    <FormPage open={open} onClose={onClose} title={editing ? 'Edit Split' : 'Add Split'} footer={footer} helpTopicId="split" className="ui-pilot">
      {splitLocked && (
        <div className="well mb-3 px-3 py-2 text-[12px] leading-snug text-ink-mid">
          A member has already settled, so the total, type and settled rows are locked. You can still edit unpaid members.
        </div>
      )}

      {/* Type — expense (a bill you split) vs income (a payout you split). */}
      <div className="flex gap-1.5 flex-wrap justify-center mb-3">
        {(['expense', 'income'] as SplitType[]).map(t => (
          <Chip key={t} on={form.type === t} onClick={() => setType(t)}
            className={splitLocked && form.type !== t ? 'opacity-40 pointer-events-none' : ''}>
            <span aria-hidden>{t === 'income' ? '💰' : '💸'}</span>{t === 'income' ? 'Shared income' : 'Shared bill'}
          </Chip>
        ))}
      </div>

      {/* Total amount hero. */}
      <div className="py-1 mb-1">
        <AmountField value={form.amount} currencySymbol={currencySymbol}
          onChange={splitLocked ? () => {} : v => setForm(f => ({ ...f, amount: v }))} />
      </div>
      <div className="text-center mono-label mb-2">Total {isIncome ? 'payout' : 'bill'} — only your share counts toward you</div>

      {/* Aurora 4.0 FS2 — the transaction form's order: Description, then the category it suggests. */}
      <div className="mt-4">
        <div className="mono-label mb-1.5">Description</div>
        <input className="input w-full" value={form.description} aria-label="Description"
          onChange={e => setDescription(e.target.value)}
          placeholder={isIncome ? 'e.g. Group gig payout' : 'e.g. Dinner at Olive'} />
      </div>

      {/* Category (for the backing transaction). */}
      <div className="mt-3">
        <CategoryPicker type={form.type} value={form.category} onChange={pickCategory} recent={recent}
          error={catMissing ? 'Choose a category for this split' : undefined}
          hint={suggestion && form.category === suggestion.category
            ? `Suggested from “${suggestion.word}” · change it if that’s wrong` : undefined} />
      </div>

      {/* FS2 / FRM1 — Today / Yesterday, then the date as a 44px field; then the account. */}
      <div className="mt-4">
        <div className="mono-label mb-1.5">Date</div>
        <div className="flex gap-1.5 items-center mb-2">
          <Chip on={form.date === today()} onClick={() => setForm(f => ({ ...f, date: today() }))}>Today</Chip>
          <Chip on={form.date === addDaysISO(today(), -1)} onClick={() => setForm(f => ({ ...f, date: addDaysISO(today(), -1) }))}>Yesterday</Chip>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input type="date" value={form.date}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            className="input h-[44px] py-0 px-3 w-full min-w-0" aria-label="Pick a date" />
        </div>
        <Field label={isIncome ? 'Paid into' : 'Paid with'}>
          <Select value={form.paymentMethod} required={accountRequired}
            onChange={event => setForm(f => ({ ...f, paymentMethod: event.target.value }))}>
            <option value="">Choose account</option>
            {accounts.map(account => <option key={account.value} value={account.value}>{acctEmoji(account.kind)} {account.label}</option>)}
          </Select>
        </Field>
      </div>

      {/* Participants + shares. Aurora 4.0 FS1 — split equally by default: each share is shown as text,
          and "By amount" turns them into fields (the even-split link under the list is gone). */}
      <div className="mt-4">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="mono-label">{cloudActive ? 'Who’s in · tag by email' : 'People'}</div>
          {cloudActive && (
            <datalist id="split-email-suggestions">
              {emailSuggestions.map(e => <option key={e} value={e} />)}
            </datalist>
          )}
          {!splitLocked && (
            <button type="button" onClick={addParticipant} className="empty-link">+ Add person</button>
          )}
        </div>
        {!splitLocked && (
          <div className="mb-2.5">
            <SegmentedControl label="How to split" value={form.auto ? 'equal' : 'amount'}
              onChange={how => setForm(f => ({ ...f, auto: how === 'equal' }))}
              options={[{ value: 'equal', label: 'Equally', testId: 'split-equally' }, { value: 'amount', label: 'By amount', testId: 'split-by-amount' }]} />
          </div>
        )}
        <div className="space-y-1.5">
          {form.participants.map((p, i) => {
            const emailKey = (p.email ?? '').trim().toLowerCase();
            const resolved = emailKey ? resolvedNames[emailKey] : undefined;
            const rowLocked = !p.isYou && p.paid;   // this member has settled
            return (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-2">
                  {p.isYou ? (
                    <div className="input flex-1 py-1.5 flex items-center text-ink-dim">You</div>
                  ) : cloudActive ? (
                    <input className="input flex-1 py-1.5" type="email" value={p.email ?? ''}
                      placeholder="Tag someone by email — e.g. sam@email.com"
                      list="split-email-suggestions" autoComplete="off"
                      disabled={rowLocked}
                      onChange={e => updateEmail(i, e.target.value)}
                      onBlur={e => resolveEmail(e.target.value)}
                      onKeyDown={e => {
                        if (!rowLocked && (e.key === 'Backspace' || e.key === 'Delete') && !p.email && form.participants.length > 2) {
                          e.preventDefault(); removeParticipant(i);
                        }
                      }} />
                  ) : (
                    <input className="input flex-1 py-1.5" value={p.name} placeholder="Name" disabled={rowLocked}
                      onChange={e => updateName(i, e.target.value)} />
                  )}
                  {form.auto ? (
                    <span className="num w-24 text-right text-ink flex-shrink-0" aria-label={`${p.isYou ? 'Your' : `${p.name || p.email || 'Their'}`} share`}>
                      {p.share ? fmt(parseFloat(p.share) || 0, form.currency) : '—'}
                    </span>
                  ) : (
                    <input className="input w-24 py-1.5 text-right" type="number" min="0" step="0.01" value={p.share}
                      placeholder="0.00" aria-label={p.isYou ? 'Your share' : 'Share'}
                      disabled={rowLocked || (splitLocked && !p.isYou)}
                      onChange={e => editShare(i, e.target.value)} />
                  )}
                  {!p.isYou && !rowLocked ? (
                    <button type="button" onClick={() => removeParticipant(i)}
                      className="text-ink-dim hover:text-terra w-11 h-11 flex-shrink-0 flex items-center justify-center" aria-label="Remove participant">✕</button>
                  ) : <span className="w-11 flex-shrink-0" />}
                </div>
                {rowLocked && (
                  <div className="text-[12px] text-sage pl-1">✓ Settled, so this row is locked</div>
                )}
                {!p.isYou && !rowLocked && cloudActive && emailKey
                  && participantEmailProblem(emailKey, ownEmail) && (
                  <div className="text-[12px] text-terra pl-1">{participantEmailProblem(emailKey, ownEmail)}</div>
                )}
                {!p.isYou && !rowLocked && cloudActive && emailKey && !participantEmailProblem(emailKey, ownEmail) && (
                  resolved
                    ? <div className="text-[12px] text-sage pl-1">✓ {resolved}</div>
                    : resolved === ''
                      ? <div className="text-[12px] text-ink-dim pl-1">Not on Vyact yet — they’ll get an invite email</div>
                      : null
                )}
              </div>
            );
          })}
        </div>
        {!form.auto && (
          <div className="mt-2 text-[12px]" style={{ color: sharesOk ? 'var(--good-text)' : 'var(--warn-text)' }}>
            Shares add up to {fmt(sharesSum, form.currency)} of {fmt(bill, form.currency)}{sharesOk ? ' ✓' : ' — they must match'}
          </div>
        )}
      </div>

      {/* v10.59.0 (owner, item 3) — confirm each new person before the split is saved. */}
      <Modal open={!!confirmItems} onClose={() => setConfirmItems(null)} title="Confirm who this split is with">
        <div className="space-y-3" data-testid="split-confirm">
          {confirmItems?.map(item => (
            <div key={item.email} className="rounded-md border border-line px-3 py-2.5" style={{ background: 'var(--sunken)' }}>
              <p className="text-ink text-[0.88rem] leading-snug">{confirmQuestion(item)}</p>
              {!item.name && (
                <p className="text-[0.75rem] text-ink-dim mt-1">They&apos;ll get an email from Vyact with your name, the split and a link to join and settle it.</p>
              )}
              <div className="flex gap-2 mt-2">
                <Button variant={answers[item.email] === true ? 'primary' : 'ghost'}
                  aria-pressed={answers[item.email] === true}
                  onClick={() => setAnswers(a => ({ ...a, [item.email]: true }))}>
                  {item.name ? 'Yes' : 'Yes, invite'}
                </Button>
                <Button variant={answers[item.email] === false ? 'danger' : 'ghost'}
                  aria-pressed={answers[item.email] === false}
                  onClick={() => setAnswers(a => ({ ...a, [item.email]: false }))}>
                  No
                </Button>
              </div>
            </div>
          ))}
          {(() => {
            const items = confirmItems ?? [];
            const answered = items.length > 0 && items.every(i => answers[i.email] !== undefined);
            const rejected = items.filter(i => answers[i.email] === false).map(i => i.email);
            return (
              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <Button variant="ghost" onClick={() => setConfirmItems(null)}>Back</Button>
                {rejected.length > 0 ? (
                  <Button disabled={!answered} onClick={() => {
                    setForm(f => ({ ...f, auto: false, participants: f.participants.filter(p => p.isYou || !rejected.includes((p.email ?? '').trim().toLowerCase())) }));
                    setConfirmItems(null);
                    toast(`Removed ${rejected.join(', ')}. Check the shares still add up to the total.`, 'info');
                  }}>Remove and go back</Button>
                ) : (
                  <Button disabled={!answered || saving} onClick={() => { setConfirmItems(null); void save(true); }}>
                    {editing ? 'Update split' : 'Save split'}
                  </Button>
                )}
              </div>
            );
          })()}
        </div>
      </Modal>
    </FormPage>
  );
}
