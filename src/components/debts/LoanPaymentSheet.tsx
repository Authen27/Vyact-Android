// Vyact W4f (v10.75.0; owner decision D19) — paying a loan.
//
// One sheet for the four ways money pays a loan, each prefilled with what the SERVER will accept
// (loan_due), so a normal EMI never comes back "payment_out_of_range" (the live bug this replaces):
//   EMI #k        the instalment due — a short amount is fine (the instalment stays open);
//   Prepay        all principal; finish sooner (keep the EMI) or lower the EMI (keep the end date);
//   Pay off       exactly the outstanding + the open instalment's interest — closes the loan;
//   Bank figures  the bank's own interest / principal for the due instalment.
// The split itself is computed by pay_loan; this sheet only says what kind of payment it is.
import { useEffect, useMemo, useState } from 'react';
import HalfSheet from '../ui/HalfSheet';
import SegmentedControl from '../ui/SegmentedControl';
import { Field, Select, Input } from '../ui/Input';
import { AmountField } from '../ui/NumericKeypad';
import { parseAmount } from '../../lib/amountInput';
import { useStore } from '../../store';
import { fmt, today, uid } from '../../lib/format';
import { CURRENCIES } from '../../constants';
import { LoanPaymentRefused, loanErrorMessage, type LoanPaymentKind, type PrepaymentChoice } from '../../lib/loanSchedule';
import type { Debt, LoanDue } from '../../types';

interface Props { debt: Debt | null; open: boolean; onClose: () => void }

export default function LoanPaymentSheet({ debt, open, onClose }: Props) {
  const accounts = useStore(s => s.accounts);
  const currency = useStore(s => s.profile.baseCurrency);
  const loanDue = useStore(s => s.loanDue);
  const payLoan = useStore(s => s.payLoan);
  const toast = useStore(s => s.toast);

  const funding = useMemo(() => accounts.filter(a => (a.kind === 'bank' || a.kind === 'cash') && !a.isArchived), [accounts]);
  const [due, setDue] = useState<LoanDue | null>(null);
  const [kind, setKind] = useState<LoanPaymentKind>('emi');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [fundingId, setFundingId] = useState('');
  const [choice, setChoice] = useState<PrepaymentChoice>('reduce_tenure');
  const [bankInterest, setBankInterest] = useState('');
  const [bankPrincipal, setBankPrincipal] = useState('');
  const [operationId, setOperationId] = useState(uid());
  const [saving, setSaving] = useState(false);
  const money = (n: number) => fmt(n, currency);

  useEffect(() => {
    if (!open || !debt) return;
    setDue(null); setKind('emi'); setDate(today()); setChoice('reduce_tenure'); setBankInterest(''); setBankPrincipal('');
    setOperationId(uid());
    setFundingId(debt.fundingAccountId && funding.some(a => a.id === debt.fundingAccountId)
      ? debt.fundingAccountId
      : (funding.find(a => a.isDefault) ?? funding.find(a => a.kind === 'bank') ?? funding[0])?.id ?? '');
    let live = true;
    loanDue(debt.id).then(d => {
      if (!live) return;
      setDue(d);
      setAmount(d.remaining > 0 ? String(d.remaining) : '');
    }).catch(() => { if (live) setDue(null); });
    return () => { live = false; };
    // Fill once per opening; accounts changing underneath should not reset what was typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debt?.id]);

  function pickKind(next: LoanPaymentKind) {
    setKind(next);
    if (!due) return;
    if (next === 'emi') setAmount(due.remaining > 0 ? String(due.remaining) : '');
    else if (next === 'payoff') setAmount(String(due.payoff));
    else if (next === 'prepayment') setAmount('');
    else { setAmount(''); setBankInterest(''); setBankPrincipal(''); }
  }

  const bankTotal = Math.round(((Number(bankInterest) || 0) + (Number(bankPrincipal) || 0)) * 100) / 100;
  const value = kind === 'bank_override' ? bankTotal : parseAmount(amount);

  async function save() {
    if (!debt) return;
    if (!(value > 0)) { toast('Enter an amount greater than 0', 'error'); return; }
    if (!fundingId) { toast('Choose a bank or cash account to pay from', 'error'); return; }
    setSaving(true);
    try {
      const res = await payLoan({
        operationId, debtId: debt.id, kind, amount: value, date, fundingAccountId: fundingId,
        choice: kind === 'prepayment' ? choice : undefined,
        bankInterest: kind === 'bank_override' ? Number(bankInterest) || 0 : undefined,
        bankPrincipal: kind === 'bank_override' ? Number(bankPrincipal) || 0 : undefined,
      });
      toast(res.paidOff ? `${debt.name} is paid off 🎉`
        : kind === 'prepayment' ? (choice === 'reduce_emi' ? `Prepaid ${money(res.principal)} — EMI is now ${money(res.emiAfter)}` : `Prepaid ${money(res.principal)} — you'll finish sooner`)
        : res.closesInstalment ? `EMI #${res.instalmentNo} recorded — ${money(res.interest)} interest, ${money(res.principal)} off the loan`
        : `Part of EMI #${res.instalmentNo} recorded. The rest is still due.`, 'success');
      onClose();
    } catch (e) {
      if (e instanceof LoanPaymentRefused) toast(loanErrorMessage(e.code, e.figure, money), 'error');
      else toast(`Payment failed: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  const symbol = CURRENCIES[currency]?.symbol ?? '';
  const footer = (
    <button type="button" onClick={save} disabled={saving || !due || due.paidOff}
      className="btn-primary w-full h-[50px] text-[15.5px] rounded-r3 disabled:opacity-60">
      {saving ? 'Saving…' : kind === 'payoff' ? 'Pay off the loan' : kind === 'prepayment' ? 'Record prepayment' : 'Record payment'}
    </button>
  );

  return (
    <HalfSheet open={open} onClose={onClose} title={debt ? `Pay ${debt.name}` : 'Pay loan'} footer={footer}>
      {!due ? (
        <p className="text-sm text-ink-dim py-6 text-center">Working out what's due…</p>
      ) : due.paidOff ? (
        <p className="text-sm text-ink-mid py-6 text-center">This loan is paid off.</p>
      ) : (
        <div className="space-y-4">
          <SegmentedControl label="Payment" value={kind} onChange={pickKind}
            options={[
              { value: 'emi', label: `EMI #${due.instalmentNo}` },
              { value: 'prepayment', label: 'Prepay' },
              { value: 'payoff', label: 'Pay off' },
              { value: 'bank_override', label: 'Bank figures' },
            ]} />

          <p className="text-[0.78rem] text-ink-mid leading-snug" data-testid="loan-pay-explainer">
            {kind === 'emi' && (due.started
              ? <>EMI #{due.instalmentNo} has {money(due.remaining)} left{due.dueDate ? ` (due ${due.dueDate})` : ''}. Paying less keeps it open.</>
              : <>EMI #{due.instalmentNo}{due.dueDate ? ` due ${due.dueDate}` : ''}: {money(due.due)} — {money(due.interest)} interest, {money(Math.max(0, Math.round((due.due - due.interest) * 100) / 100))} off the loan. Paying less keeps it open.</>)}
            {kind === 'prepayment' && (due.started
              ? <>Finish EMI #{due.instalmentNo} first ({money(due.remaining)} left), then prepay.</>
              : <>All of it comes off the {money(due.outstanding)} outstanding.</>)}
            {kind === 'payoff' && <>Closes the loan: {money(due.outstanding)} outstanding{due.payoff > due.outstanding ? ` + ${money(Math.round((due.payoff - due.outstanding) * 100) / 100)} interest on the EMI already started` : ''}.</>}
            {kind === 'bank_override' && <>Enter the interest and principal exactly as your bank shows them for EMI #{due.instalmentNo}.</>}
          </p>

          {kind === 'bank_override' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Interest"><Input type="number" min="0" step="0.01" value={bankInterest} onChange={e => setBankInterest(e.target.value)} /></Field>
              <Field label="Principal"><Input type="number" min="0" step="0.01" value={bankPrincipal} onChange={e => setBankPrincipal(e.target.value)} /></Field>
              <div className="col-span-2 text-[0.78rem] text-ink-mid">Total {money(bankTotal)}</div>
            </div>
          ) : kind === 'payoff' ? (
            <div className="num text-[28px] font-bold text-ink text-center py-1" data-testid="loan-payoff-amount">{money(due.payoff)}</div>
          ) : (
            <AmountField value={amount} currencySymbol={symbol} onChange={setAmount} />
          )}

          {kind === 'prepayment' && !due.started && (
            <SegmentedControl label="After the prepayment" value={choice} onChange={setChoice}
              options={[{ value: 'reduce_tenure', label: 'Finish sooner' }, { value: 'reduce_emi', label: 'Lower the EMI' }]} />
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Pay from">
              <Select value={fundingId} onChange={e => setFundingId(e.target.value)} required>
                <option value="">Choose account</option>
                {funding.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
            <Field label="Date"><Input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} /></Field>
          </div>
        </div>
      )}
    </HalfSheet>
  );
}
