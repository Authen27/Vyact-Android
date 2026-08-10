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
import { useEffect, useMemo, useState } from 'react';
import HalfSheet from '../ui/HalfSheet';
import Chip, { CategoryChip } from '../ui/Chip';
import { AmountField } from '../ui/NumericKeypad';
import Button from '../ui/Button';
import { useStore } from '../../store';
import { uid, today, nowTime } from '../../lib/format';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, CURRENCIES } from '../../constants';
import { buildAccounts, buildAccountsFromStore, ACCOUNT_REQUIRED_TYPES, notInvestment } from '../../lib/accounts';
import { getMoneyMapMode } from '../../lib/featureFlags';
import { resolveParticipantNames } from '../../lib/sharedSplits';
import type { Transaction } from '../../types';

interface Props {
  open?: boolean;
  initial?: Transaction | null;
  onClose?: () => void;
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

const catsFor = (type: SplitType) => (type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES);
const defaultCat = (type: SplitType) => (type === 'income' ? 'salary' : 'food_dining');

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

  const storeOpen    = useStore(s => s.splitModalOpen);
  const storeInitial = useStore(s => s.editingSplit);
  const storeClose   = useStore(s => s.closeSplitModal);
  const open         = props.open    ?? storeOpen;
  const initial      = props.initial ?? storeInitial;
  const onClose      = props.onClose ?? storeClose;

  const defaultMemberId = useMemo(() => {
    if (session?.user?.id) {
      const mine = members.find(m => m.userId === session.user.id);
      if (mine) return mine.id;
    }
    return members[0]?.id ?? '';
  }, [members, session?.user?.id]);

  const [form, setForm]   = useState<FormState>(blank(profile.baseCurrency));
  const [saving, setSaving] = useState(false);
  const [showAllCats, setShowAllCats] = useState(false);
  // email → display-name resolution (cloud): string = has account, '' = no account, undefined = unresolved.
  const [resolvedNames, setResolvedNames] = useState<Record<string, string>>({});

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
    setShowAllCats(false);
    setResolvedNames({});
    const sp = initial?.split;
    if (initial && sp?.isSplit) {
      const matched = sharedSplitsOwned.find(s => s.txnId === initial.id);
      setForm({
        type: initial.type === 'income' ? 'income' : 'expense',
        amount: String(sp.totalAmount),
        currency: initial.currency,
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
    } else {
      setForm(blank(profile.baseCurrency));
    }
  }, [open, initial, sharedSplitsOwned, profile.baseCurrency]);

  // Auto-balance while `auto` is on.
  useEffect(() => {
    if (!form.auto) return;
    const bill = parseFloat(form.amount) || 0;
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
  const cats = catsFor(form.type);
  const orderedCats = cats;
  const currencySymbol = CURRENCIES[form.currency]?.symbol ?? '$';
  const accountRequired = ACCOUNT_REQUIRED_TYPES.includes(form.type as (typeof ACCOUNT_REQUIRED_TYPES)[number]);
  const idOf = (p: PForm) => (cloudActive ? (p.email ?? '').trim() : p.name.trim());

  function setType(type: SplitType) {
    if (splitLocked) return;
    setForm(f => ({ ...f, type, category: defaultCat(type) }));
  }
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

  async function save() {
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) { toast('Enter a valid total greater than 0', 'error'); return; }
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
          paidOn: p.isYou ? null : (p.paid ? today() : null),
          email: (!p.isYou && email) ? email : undefined,
        };
      }),
    };

    setSaving(true);
    try {
      const txn: Transaction = {
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
      };
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
    if (!confirm('Delete this split?')) return;
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
          className="font-mono text-[0.62rem] tracking-wider uppercase text-terra hover:underline">
          Delete
        </button>
      ) : <span />}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Update' : 'Add split'}</Button>
      </div>
    </div>
  );

  const sharesSum = form.participants.reduce((s, p) => s + (parseFloat(p.share) || 0), 0);
  const bill = parseFloat(form.amount) || 0;
  const sharesOk = Math.abs(sharesSum - bill) < 0.01 && bill > 0;

  return (
    <HalfSheet open={open} onClose={onClose} title={editing ? 'Edit Split' : 'Add Split'} footer={footer}>
      {splitLocked && (
        <div className="mb-3 rounded-md px-3 py-2 text-[0.72rem] leading-snug border border-line text-ink-mid" style={{ background: 'var(--sunken)' }}>
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
        <AmountField value={form.amount} currencySymbol={currencySymbol} autoFocus={!editing}
          onChange={splitLocked ? () => {} : v => setForm(f => ({ ...f, amount: v }))} />
      </div>
      <div className="text-center mono-label mb-2">Total {isIncome ? 'payout' : 'bill'} — only your share counts toward you</div>

      {/* Category (for the backing transaction). */}
      <div className="mt-3">
        <div className="mono-label mb-1.5">Category</div>
        <div className="flex gap-1.5 flex-wrap">
          {(showAllCats ? orderedCats : orderedCats.slice(0, 7)).map(c => (
            <CategoryChip key={c.id} emoji={c.icon} label={c.label} on={c.id === form.category}
              onClick={() => setForm(f => ({ ...f, category: c.id }))} />
          ))}
          {orderedCats.length > 7 && (
            <CategoryChip emoji={showAllCats ? '▴' : '⌕'} label={showAllCats ? 'Less' : 'More'} on={false}
              onClick={() => setShowAllCats(s => !s)} />
          )}
        </div>
      </div>

      {/* Description. */}
      <div className="mt-4">
        <div className="mono-label mb-1.5">Description</div>
        <input className="input w-full" value={form.description} aria-label="Description"
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder={isIncome ? 'e.g. Group gig payout' : 'e.g. Dinner at Olive'} />
      </div>

      {/* Date + account it was paid with/into. */}
      <div className="mt-4">
        <div className="mono-label mb-1.5">
          Date · {isIncome ? 'paid into' : 'paid with'} {accountRequired ? <span className="text-terra">·required</span> : null}
        </div>
        <div className="flex gap-1.5 items-center flex-wrap">
          <input type="date" value={form.date}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            className="input h-[34px] py-0 px-2.5 text-[12.5px] w-[140px]" aria-label="Pick a date" />
          {accounts.map(a => (
            <Chip key={a.value} on={a.value === form.paymentMethod}
              onClick={() => setForm(f => ({ ...f, paymentMethod: a.value }))}>
              <span aria-hidden>{acctEmoji(a.kind)}</span>{a.label}
            </Chip>
          ))}
        </div>
      </div>

      {/* Participants + shares. */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-1.5">
          <label className="mono-label">{cloudActive ? `Who's in · tag by email & share (${form.currency})` : `People & shares (${form.currency})`}</label>
          {cloudActive && (
            <datalist id="split-email-suggestions">
              {emailSuggestions.map(e => <option key={e} value={e} />)}
            </datalist>
          )}
          <div className="flex gap-2">
            {!splitLocked && (
              <button type="button" onClick={() => setForm(f => ({ ...f, auto: true }))}
                className={`font-mono text-[0.6rem] tracking-wider uppercase hover:underline ${form.auto ? 'text-sage' : 'text-ink-dim'}`}>
                {form.auto ? '⚖ Even (auto)' : '⚖ Even split'}
              </button>
            )}
            {!splitLocked && (
              <button type="button" onClick={addParticipant}
                className="font-mono text-[0.6rem] tracking-wider uppercase text-coral hover:underline">+ Add person</button>
            )}
          </div>
        </div>
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
                  <input className="input w-24 py-1.5 text-right" type="number" min="0" step="0.01" value={p.share}
                    placeholder="0.00" disabled={rowLocked || (splitLocked && !p.isYou)}
                    onChange={e => editShare(i, e.target.value)} />
                  {!p.isYou && !rowLocked ? (
                    <button type="button" onClick={() => removeParticipant(i)}
                      className="text-ink-dim hover:text-terra w-7 flex-shrink-0 text-center" aria-label="Remove participant">✕</button>
                  ) : <span className="w-7 flex-shrink-0" />}
                </div>
                {rowLocked && (
                  <div className="font-mono text-[0.6rem] tracking-wider text-sage pl-1">✓ settled — locked</div>
                )}
                {!p.isYou && !rowLocked && cloudActive && emailKey && (
                  resolved
                    ? <div className="font-mono text-[0.6rem] tracking-wider text-sage pl-1">✓ {resolved}</div>
                    : resolved === ''
                      ? <div className="font-mono text-[0.6rem] tracking-wider text-ink-dim pl-1">Not on Vyact yet — they'll get an invite email</div>
                      : null
                )}
              </div>
            );
          })}
        </div>
        <div className={`mt-2 font-mono text-[0.62rem] tracking-wider ${sharesOk ? 'text-sage' : 'text-honey'}`}>
          Shares total {sharesSum.toFixed(2)} / total {bill.toFixed(2)} {sharesOk ? '✓' : '— must match'}
        </div>
      </div>
    </HalfSheet>
  );
}
