// Vyact — the loan form (W4f, v10.75.0; owner decisions D19, D17, D30).
//
// A loan is described by its TERMS: what was sanctioned, the rate (a change applies from a date), the
// tenure, the first and the next EMI dates, and the EMI — suggested from the terms with the standard
// formula, editable to the bank's letter. Its OUTSTANDING is not typed here once payments exist: it is
// the loan account's ledger, moved only by payments (and "Mark paid off"). Existing loans arrive with
// estimated terms; saving this form confirms them.
//
// Credit cards are accounts (D30) and are added in Accounts, not here. Money someone owes the household
// is a simple "owed to me" entry: who, and how much.
//
// v10.28.0 — rendered as the /debts/new and /debts/:id/edit pages.
import { useEffect, useMemo, useState } from 'react';
import FormPage from '../ui/FormPage';
import Button from '../ui/Button';
import SegmentedControl from '../ui/SegmentedControl';
import EstimatedTag from '../ui/EstimatedTag';
import FormSection from '../ui/FormSection';
import { Input, Select, Field, FieldRow } from '../ui/Input';
import { useStore } from '../../store';
import { uid, fmt, today } from '../../lib/format';
import { DEBT_TYPES } from '../../constants';
import { loanEmi, loanOutstanding, loanAccountOf, nextInstalmentDate, LoanPaymentRefused, loanErrorMessage } from '../../lib/loanSchedule';
import type { Debt } from '../../types';
import type { LoanSeed } from '../../lib/askVyactResponses';
import { askSheet } from '../../lib/confirmSheet';
import { deleteLoanRequest } from '../../lib/confirmCopy';

interface Props {
  open?: boolean;
  initial?: Debt | null;
  onClose: () => void;
  /**
   * v10.109.0 (owner, 16 Oct 2026; R-1) — an EMI request from Pip or Recurring: a new loan pre-filled, or
   * this loan, with "Record each EMI automatically" switched ON. Nothing is saved until the person saves.
   */
  seed?: LoanSeed | null;
}

/** "Car loan" → auto_loan, "Home loan" → mortgage; anything else keeps the default. */
function loanTypeFor(name: string): string | undefined {
  const n = name.toLowerCase();
  return /\b(car|auto|vehicle|bike|scooter)\b/.test(n) ? 'auto_loan'
    : /\b(home|house|housing|mortgage|flat)\b/.test(n) ? 'mortgage'
    : /\b(student|education|study)\b/.test(n) ? 'student_loan'
    : /\b(business)\b/.test(n) ? 'business_loan'
    : undefined;
}

interface FormState {
  direction: 'owed_by_me' | 'owed_to_me';
  counterpartyName: string;
  type: string;
  name: string;
  lender: string;
  account: string;
  principal: string;
  outstanding: string;
  interestRate: string;
  rateFrom: string;
  emi: string;
  tenureMonths: string;
  firstEmiDate: string;
  nextEmiDate: string;
  /** W4g — the server records each EMI on its date, from this account. */
  autoRecord: boolean;
  fundingAccountId: string;
}

/** Loan types: everything but cards, which are accounts now (D30). */
const LOAN_TYPES = Object.entries(DEBT_TYPES).filter(([k]) => k !== 'credit_card');

const blank = (): FormState => ({
  direction: 'owed_by_me', counterpartyName: '', type: 'personal_loan', name: '', lender: '', account: '',
  principal: '', outstanding: '', interestRate: '', rateFrom: '', emi: '', tenureMonths: '', firstEmiDate: '', nextEmiDate: '',
  autoRecord: false, fundingAccountId: '',
});

/** Instalments between the first EMI and the next one (the next is unpaid). */
function instalmentsBetween(first: string, next: string): number {
  if (!first || !next || next <= first) return 0;
  const anchor = Number(first.slice(8, 10));
  let date = first;
  let n = 0;
  while (date < next && n < 600) { date = nextInstalmentDate(date, anchor); n++; }
  return n;
}

export default function DebtFormModal(props: Props) {
  const profile      = useStore(s => s.profile);
  const accounts     = useStore(s => s.accounts);
  const transactions = useStore(s => s.transactions);
  const upsertDebt   = useStore(s => s.upsertDebt);
  const deleteDebt   = useStore(s => s.deleteDebt);
  const toast        = useStore(s => s.toast);
  const currency     = profile.baseCurrency;
  const money        = (n: number) => fmt(n, currency);

  const open    = props.open ?? true;
  const initial = props.initial ?? null;
  const onClose = props.onClose;
  const seed    = props.seed ?? null;

  const [form, setForm]     = useState<FormState>(blank());
  const [saving, setSaving] = useState(false);

  // Once the loan has its account, the outstanding is the ledger's — never typed over.
  const ledgerOwned = !!initial && !!loanAccountOf(initial, accounts);
  const ledgerOutstanding = initial ? loanOutstanding(initial, accounts, transactions) : 0;

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        direction: initial.direction ?? 'owed_by_me',
        counterpartyName: initial.counterpartyName ?? '',
        type: initial.type === 'credit_card' ? 'other' : initial.type,
        name: initial.name,
        lender: initial.lender ?? '',
        account: initial.account ?? '',
        principal: initial.principal ? String(initial.principal) : '',
        outstanding: String(initial.currentBalance),
        interestRate: String(initial.interestRate),
        rateFrom: '',
        emi: initial.minimumPayment ? String(initial.minimumPayment) : '',
        tenureMonths: initial.tenureMonths != null ? String(initial.tenureMonths) : '',
        firstEmiDate: initial.firstEmiDate ?? '',
        nextEmiDate: initial.dueDate ?? '',
        autoRecord: seed?.mode === 'edit' ? true : !!initial.autoRecord,
        fundingAccountId: initial.fundingAccountId ?? '',
      });
    } else if (seed?.mode === 'new') {
      setForm({
        ...blank(),
        type: loanTypeFor(seed.name) ?? blank().type,
        name: seed.name === 'Loan' ? '' : seed.name,
        emi: seed.emi != null ? String(seed.emi) : '',
        nextEmiDate: seed.nextEmiDate ?? '',
        autoRecord: true,
      });
    } else {
      setForm(blank());
    }
    // The seed is read once, with the route (FormPages keeps it for the page's life).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const isLoan = form.direction === 'owed_by_me';
  const payFrom = useMemo(() => accounts.filter(a => (a.kind === 'bank' || a.kind === 'cash') && !a.isArchived), [accounts]);
  const rateChanged = !!initial && isLoan && Number(form.interestRate) !== initial.interestRate && form.interestRate !== '';
  const suggested = useMemo(() => {
    const p = Number(form.principal), r = Number(form.interestRate), n = parseInt(form.tenureMonths, 10);
    return p > 0 && r >= 0 && n > 0 ? loanEmi(p, r, n, currency) : null;
  }, [form.principal, form.interestRate, form.tenureMonths, currency]);

  async function save() {
    if (!form.name.trim()) { toast('Name is required', 'error'); return; }
    setSaving(true);
    try {
      if (!isLoan) {
        const owed = parseFloat(form.outstanding);
        if (!(owed >= 0)) { toast('Enter how much is owed', 'error'); return; }
        await upsertDebt({
          ...(initial ?? {}), id: initial?.id ?? uid(), direction: 'owed_to_me', type: initial?.type ?? 'family',
          name: form.name.trim(), counterpartyName: form.counterpartyName.trim() || undefined,
          principal: initial?.principal ?? owed, currentBalance: owed, interestRate: 0, minimumPayment: 0, currency,
        });
        toast(initial ? 'Updated' : 'Added', 'success');
        onClose();
        return;
      }
      const rate = parseFloat(form.interestRate);
      const emi = parseFloat(form.emi);
      const tenure = parseInt(form.tenureMonths, 10);
      const principal = parseFloat(form.principal);
      const outstanding = ledgerOwned ? initial!.currentBalance : parseFloat(form.outstanding || form.principal);
      if (!(outstanding >= 0)) { toast('Enter what is still owed', 'error'); return; }
      if (!(rate >= 0 && rate < 100)) { toast('Enter the interest rate (% a year)', 'error'); return; }
      if (!(emi > 0)) { toast('Enter the EMI (use the suggested one, or your bank letter)', 'error'); return; }
      if (form.autoRecord && !form.fundingAccountId) { toast('Choose the account the EMI is paid from', 'error'); return; }
      if (form.autoRecord && !(form.nextEmiDate || form.firstEmiDate)) { toast('Add the next EMI date so Vyact knows when to record it', 'error'); return; }
      const next = form.nextEmiDate || form.firstEmiDate || undefined;
      const first = form.firstEmiDate || next;

      // A rate change applies from a date: the history keeps every instalment's own rate.
      let rateHistory = initial?.rateHistory ?? [];
      if (rateChanged) {
        const from = form.rateFrom || next || today();
        const base = rateHistory.length ? rateHistory : [{ from: initial!.firstEmiDate ?? '1900-01-01', rate: initial!.interestRate }];
        rateHistory = [...base.filter(c => c.from < from), { from, rate }];
      }

      await upsertDebt({
        // A patch over the loan as it was opened: what the server keeps (instalments paid, paid off)
        // rides through, and the version guards against a payment made meanwhile.
        ...(initial ?? {}),
        id: initial?.id ?? uid(),
        direction: 'owed_by_me',
        counterpartyName: undefined,
        type: form.type,
        name: form.name.trim(),
        lender: form.lender.trim() || undefined,
        account: form.account.trim() || undefined,
        principal: principal > 0 ? principal : outstanding,
        currentBalance: outstanding,
        interestRate: rate,
        rateHistory,
        minimumPayment: emi,
        tenureMonths: tenure > 0 ? tenure : undefined,
        firstEmiDate: first,
        dueDate: next,
        instalmentsPaid: initial ? initial.instalmentsPaid : instalmentsBetween(first ?? '', next ?? ''),
        termsConfirmed: true,
        autoRecord: form.autoRecord,
        fundingAccountId: form.fundingAccountId || undefined,
        currency,   // W3b: one currency per household
      });
      toast(initial ? 'Loan updated' : 'Loan added', 'success');
      onClose();
    } catch (e) {
      toast(e instanceof LoanPaymentRefused ? loanErrorMessage(e.code, e.figure, money) : `Save failed: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!initial) return;
    // Aurora 4.0 CF11 — a cleared loan is pointed to Mark paid off, which keeps it in Net Worth history.
    const payments = new Set(transactions.filter(t => t.debtId === initial.id && t.emiSplit?.operation_id).map(t => t.emiSplit!.operation_id)).size;
    const paidUp = initial.direction !== 'owed_to_me' && !initial.paidOffAt && loanOutstanding(initial, accounts, transactions) <= 0;
    const answer = await askSheet(deleteLoanRequest({ name: initial.name, payments, paidUp }));
    if (!answer.ok) return;
    if (answer.choice === 'paidoff') {
      try { await useStore.getState().markLoanPaidOff(initial.id, undefined); toast(`${initial.name} marked paid off`, 'success'); onClose(); }
      catch (e) { toast(e instanceof LoanPaymentRefused ? loanErrorMessage(e.code, e.figure, money) : `Could not mark paid off: ${(e as Error).message}`, 'error'); }
      return;
    }
    try {
      await deleteDebt(initial.id);
      toast('Deleted', 'info');
      onClose();
    } catch (e) {
      toast(e instanceof LoanPaymentRefused ? loanErrorMessage(e.code, e.figure, money) : `Delete failed: ${(e as Error).message}`, 'error');
    }
  }

  const footer = (
    <div className="flex items-center justify-between gap-2">
      {initial ? (
        <button type="button" onClick={del} className="ui-action text-terra hover:underline min-h-[44px]">Delete</button>
      ) : <span />}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : initial ? 'Update' : 'Add'}</Button>
      </div>
    </div>
  );

  return (
    <FormPage open={open} title={initial ? (isLoan ? 'Edit Loan' : 'Edit') : 'Add Loan'} onClose={onClose} footer={footer} helpTopicId="debt" className="ui-pilot">
      {!initial && (
        <SegmentedControl label="This is" value={form.direction}
          onChange={direction => setForm(f => ({ ...f, direction }))}
          options={[{ value: 'owed_by_me', label: 'A loan I repay' }, { value: 'owed_to_me', label: 'Money owed to me' }]} />
      )}

      {!isLoan ? (
        <>
          <Field label="What for">
            <Input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Lent for the car repair" />
          </Field>
          <FieldRow>
            <Field label="Who owes it"><Input value={form.counterpartyName} onChange={e => setForm(f => ({ ...f, counterpartyName: e.target.value }))} placeholder="Name" /></Field>
            <Field label="Amount owed"><Input type="number" min="0" step="0.01" value={form.outstanding} onChange={e => setForm(f => ({ ...f, outstanding: e.target.value }))} /></Field>
          </FieldRow>
        </>
      ) : (
        <>
          {initial?.termsConfirmed === false && (
            <div className="well p-3 mb-3 text-[0.78rem] text-ink-mid flex items-start gap-2">
              <EstimatedTag confidence="estimated" />
              <span>These terms were worked out from what this loan recorded. Check them against your loan letter and save to confirm.</span>
            </div>
          )}
          {/* Aurora 4.0 FL1 — thirteen fields in three short groups: The loan · Repayment · Paying it. */}
          <FormSection title="The loan">
          <FieldRow>
            <Field label="Type">
              <Select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                {LOAN_TYPES.map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </Select>
            </Field>
            <Field label="Lender" hint="optional"><Input value={form.lender} onChange={e => setForm(f => ({ ...f, lender: e.target.value }))} placeholder="Bank name" /></Field>
          </FieldRow>
          <p className="text-[12px] text-ink-dim -mt-1 mb-3">A credit card is an account — add it in Accounts.</p>

          <FieldRow>
            <Field label="Name"><Input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Car loan" /></Field>
            <Field label="Account" hint="optional"><Input value={form.account} onChange={e => setForm(f => ({ ...f, account: e.target.value }))} placeholder="••••1234" /></Field>
          </FieldRow>

          <FieldRow>
            <Field label="Sanctioned amount"><Input type="number" min="0" step="0.01" value={form.principal} onChange={e => setForm(f => ({ ...f, principal: e.target.value }))} /></Field>
            {ledgerOwned ? (
              <Field label="Outstanding" hint="from your payments">
                <div className="num text-ink py-2" data-testid="loan-outstanding">{money(ledgerOutstanding)}</div>
              </Field>
            ) : (
              <Field label="Still owed" hint="defaults to the sanctioned amount">
                <Input type="number" min="0" step="0.01" value={form.outstanding} onChange={e => setForm(f => ({ ...f, outstanding: e.target.value }))} />
              </Field>
            )}
          </FieldRow>
          </FormSection>

          <FormSection title="Repayment">
          <FieldRow>
            <Field label="Interest rate" hint="% a year"><Input type="number" min="0" step="0.01" value={form.interestRate} onChange={e => setForm(f => ({ ...f, interestRate: e.target.value }))} /></Field>
            <Field label="Tenure" hint="months"><Input type="number" min="1" value={form.tenureMonths} onChange={e => setForm(f => ({ ...f, tenureMonths: e.target.value }))} placeholder="60" /></Field>
          </FieldRow>
          {rateChanged && (
            <Field label="New rate applies from" hint="the instalments from this date">
              <Input type="date" value={form.rateFrom || form.nextEmiDate} onChange={e => setForm(f => ({ ...f, rateFrom: e.target.value }))} />
            </Field>
          )}

          <Field label="EMI" hint={suggested == null ? 'From your loan letter.'
            : Number(form.emi) === suggested ? 'The standard EMI for these terms.'
            : <>The standard EMI for these terms is {money(suggested)}.{' '}
                <button type="button" className="font-medium underline underline-offset-2 min-h-[44px] align-middle"
                  style={{ color: 'var(--accent-text)' }}
                  onClick={() => setForm(f => ({ ...f, emi: String(suggested) }))}>Use {money(suggested)}</button></>}>
            <Input type="number" min="0" step="0.01" value={form.emi} onChange={e => setForm(f => ({ ...f, emi: e.target.value }))} />
          </Field>

          <FieldRow>
            <Field label="First EMI date"><Input type="date" value={form.firstEmiDate} onChange={e => setForm(f => ({ ...f, firstEmiDate: e.target.value }))} /></Field>
            <Field label="Next EMI date" hint={initial ? 'moves on with each EMI' : 'the next one to pay'}>
              <Input type="date" value={form.nextEmiDate} disabled={!!initial && ledgerOwned}
                onChange={e => setForm(f => ({ ...f, nextEmiDate: e.target.value }))} />
            </Field>
          </FieldRow>
          </FormSection>

          <FormSection title="Paying it">
          {/* W4g (D19) — the server records the EMI on its date (interest + principal, split by it). */}
          <div className="flex items-center gap-2.5 py-2.5">
            <span className="font-display font-semibold text-[13px] text-ink">Record each EMI automatically</span>
            <span className="text-[12px] text-ink-dim">{form.autoRecord ? 'on its date' : 'you pay it here'}</span>
            <button type="button" role="switch" aria-checked={form.autoRecord} aria-label="Record each EMI automatically"
              onClick={() => setForm(f => ({ ...f, autoRecord: !f.autoRecord }))}
              className="ml-auto relative w-[44px] h-[26px] rounded-pill border-none cursor-pointer flex-shrink-0"
              style={{ background: form.autoRecord ? 'color-mix(in srgb, hsl(var(--sage)) 40%, var(--sunken))' : 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
              <i aria-hidden className="absolute top-[3px] w-5 h-5 rounded-full transition-[left] duration-150"
                style={{ left: form.autoRecord ? 21 : 3, background: form.autoRecord ? 'hsl(var(--sage))' : 'var(--ff-ink-3)', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
            </button>
          </div>
          {form.autoRecord && (
            <Field label="Paid from">
              <Select value={form.fundingAccountId} onChange={e => setForm(f => ({ ...f, fundingAccountId: e.target.value }))} required>
                <option value="">Choose account</option>
                {payFrom.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
          )}
          </FormSection>
        </>
      )}
    </FormPage>
  );
}
