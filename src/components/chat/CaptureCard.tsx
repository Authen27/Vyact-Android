// Aurora 4.0 PIP2 — confirm in the chat. Pip shows the entry it understood as a card: the amount, what
// and when, the account it moves (picked here), Save, and Edit in form. The full form opens only when
// asked. Save builds and checks exactly as the transaction form does (lib/txnBuild.ts) and writes the
// same way: a plain upsert, or payLoan for a Loan / EMI entry. A transfer or investment needs a
// destination Pip cannot know, so it goes to the form.
import { useMemo, useRef, useState } from 'react';
import { Check, PencilLine } from 'lucide-react';
import { useStore } from '../../store';
import { Select } from '../ui/Input';
import { buildAccountsFromStore, notInvestment } from '../../lib/accounts';
import { accountValueOf } from '../../lib/accountBalance';
import { buildTxn, defaultMemberIdFor, undoableNewTxn, type TxnFormInput } from '../../lib/txnBuild';
import { fmt, formatDate, nowTime, today, uid } from '../../lib/format';
import { runExclusive } from '../../lib/exclusive';
import { LoanPaymentRefused, loanErrorMessage } from '../../lib/loanSchedule';
import { getCat } from '../../constants';
import type { Transaction } from '../../types';

export default function CaptureCard({ seed, saved, onSaved, onEdit }: {
  seed: Partial<Transaction>;
  saved: boolean;
  onSaved: () => void;
  onEdit: () => void;
}) {
  const accountsState     = useStore(s => s.accounts);
  const members           = useStore(s => s.members);
  const session           = useStore(s => s.session);
  const profile           = useStore(s => s.profile);
  const upsertTransaction = useStore(s => s.upsertTransaction);
  const payLoan           = useStore(s => s.payLoan);
  const removeTransaction = useStore(s => s.removeTransaction);
  const toast             = useStore(s => s.toast);

  const type = seed.type ?? 'expense';
  const inline = type === 'expense' || type === 'income';
  const options = useMemo(() => buildAccountsFromStore(accountsState, { filter: notInvestment }), [accountsState]);
  // The account the message named, else the household's default account; always shown and changeable.
  const [account, setAccount] = useState(() => {
    const named = seed.accountId ? accountsState.find(a => a.id === seed.accountId) : undefined;
    const preferred = named ?? accountsState.find(a => a.isDefault && !a.isArchived && a.kind !== 'loan');
    const value = preferred ? accountValueOf(preferred) : '';
    return options.some(o => o.value === value) ? value : '';
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const slot = useRef(false);
  const loanOperation = useRef<string | null>(null);

  const currency = profile.baseCurrency;
  const category = seed.category ?? '';
  const what = seed.description?.trim() || (category ? getCat(category).label : type === 'income' ? 'Income' : 'Expense');
  const date = seed.date ?? today();

  async function save() {
    const paying = accountsState.find(a => a.id === account || accountValueOf(a) === account);
    const modes = paying?.paymentModes ?? [];
    const form: TxnFormInput = {
      type, amount: String(seed.amount ?? ''), currency, date, time: nowTime(),
      description: seed.description ?? '', category, note: '',
      memberId: defaultMemberIdFor(members, session?.user?.id, profile.name),
      paymentMethod: account, paymentMethodTo: '',
      // As on the form: a new entry takes the paying account's first mode.
      paymentMode: modes[0] ?? '', direction: 'added',
      linkedDebtId: seed.linkedDebtId ?? '', recurring: '', excluded: false,
    };
    const built = buildTxn(form, { initial: null, payingModes: modes, newId: uid });
    if (!built.ok) { setError(built.error); return; }
    setError(null);
    await runExclusive(slot, async () => {
      setSaving(true);
      try {
        if (built.loan) {
          loanOperation.current ??= uid();
          const res = await payLoan({ operationId: loanOperation.current, kind: 'emi', ...built.loan });
          loanOperation.current = null;
          toast(res.closesInstalment
            ? `EMI #${res.instalmentNo} recorded — ${fmt(res.interest, currency)} interest, ${fmt(res.principal, currency)} off the loan`
            : `Part of EMI #${res.instalmentNo} recorded. The rest is still due.`, 'success');
        } else {
          await upsertTransaction(built.txn);
          const id = built.txn.id;
          toast('Transaction added', 'success', undoableNewTxn(null, type, category)
            ? { label: 'Undo', run: () => { void removeTransaction(id); } } : undefined);
        }
        onSaved();
      } catch (e) {
        setError(e instanceof LoanPaymentRefused
          ? loanErrorMessage(e.code, e.figure, n => fmt(n, currency))
          : `Not saved: ${(e as Error).message}`);
      } finally {
        setSaving(false);
      }
    });
  }

  return (
    <div className="card-raised p-3.5 mt-2 max-w-[85%] min-w-0" data-testid="pip-capture">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold text-ink truncate">{what}</div>
          <div className="text-[12px] text-ink-dim">
            {type === 'income' ? 'Income' : type === 'expense' ? 'Expense' : type === 'transfer' ? 'Transfer' : 'Investment'}
            {category ? ` · ${getCat(category).label}` : ''} · {formatDate(date, profile.dateFormat)}
          </div>
        </div>
        <div className="num font-semibold text-[16px] text-ink flex-shrink-0">{seed.amount != null ? fmt(seed.amount, currency) : '—'}</div>
      </div>

      {saved ? (
        <div className="mt-2.5 text-[13px] font-medium flex items-center gap-1.5" style={{ color: 'var(--good-text)' }}>
          <Check size={15} aria-hidden /> Saved
        </div>
      ) : (
        <>
          {inline && (
            <label className="block mt-2.5">
              <span className="ui-label block mb-1">{type === 'income' ? 'Paid into' : 'Paid from'}</span>
              <Select value={account} onChange={e => { setAccount(e.target.value); setError(null); }} aria-label={type === 'income' ? 'Paid into' : 'Paid from'}>
                <option value="">Choose account</option>
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </label>
          )}
          {!inline && <p className="mt-2 text-[12px] text-ink-mid">Pick where it went in the form.</p>}
          {error && <p role="alert" className="mt-2 text-[12px]" style={{ color: 'var(--crit-text)' }}>{error}</p>}
          <div className="flex gap-2 mt-2.5">
            {inline && (
              <button type="button" className="btn-primary flex-1 disabled:opacity-60" onClick={() => void save()} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
            <button type="button" className="btn-ghost flex-1" onClick={onEdit}>
              <PencilLine size={14} aria-hidden /> Edit in form
            </button>
          </div>
        </>
      )}
    </div>
  );
}
