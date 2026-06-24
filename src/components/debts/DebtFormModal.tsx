// Vyact v6.4.1 — DebtFormModal
//
// Modal-driven Debt create/edit form. Mirrors TransactionFormModal /
// GoalFormModal / BudgetFormModal so the creation surfaces feel
// consistent. Replaces the inline panel form previously rendered inside
// pages/Debts.tsx.

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Input, Select, Field, FieldRow } from '../ui/Input';
import { useStore } from '../../store';
import { uid } from '../../lib/format';
import { DEBT_TYPES, CURRENCIES } from '../../constants';
import type { Debt } from '../../types';

interface Props {
  open?: boolean;
  initial?: Debt | null;
  onClose?: () => void;
}

interface FormState {
  direction: 'owed_by_me' | 'owed_to_me';
  counterpartyName: string;
  type: string;
  name: string;
  lender: string;
  account: string;
  principal: string;
  currentBalance: string;
  interestRate: string;
  minimumPayment: string;
  tenureMonths: string;
  dueDate: string;
  currency: string;
}

const blank = (currency: string): FormState => ({
  direction: 'owed_by_me',
  counterpartyName: '',
  type: 'credit_card',
  name: '',
  lender: '',
  account: '',
  principal: '',
  currentBalance: '',
  interestRate: '',
  minimumPayment: '',
  tenureMonths: '',
  dueDate: '',
  currency,
});

export default function DebtFormModal(props: Props) {
  const profile     = useStore(s => s.profile);
  const upsertDebt  = useStore(s => s.upsertDebt);
  const removeDebt  = useStore(s => s.removeDebt);
  const toast       = useStore(s => s.toast);

  const storeOpen    = useStore(s => s.debtModalOpen);
  const storeInitial = useStore(s => s.editingDebt);
  const storeClose   = useStore(s => s.closeDebtModal);
  const open         = props.open    ?? storeOpen;
  const initial      = props.initial ?? storeInitial;
  const onClose      = props.onClose ?? storeClose;

  const [form, setForm]   = useState<FormState>(blank(profile.baseCurrency));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        direction: initial.direction ?? 'owed_by_me',
        counterpartyName: initial.counterpartyName ?? '',
        type: initial.type,
        name: initial.name,
        lender: initial.lender ?? '',
        account: initial.account ?? '',
        principal: String(initial.principal),
        currentBalance: String(initial.currentBalance),
        interestRate: String(initial.interestRate),
        minimumPayment: String(initial.minimumPayment),
        tenureMonths: initial.tenureMonths != null ? String(initial.tenureMonths) : '',
        dueDate: initial.dueDate ?? '',
        currency: initial.currency,
      });
    } else {
      setForm(blank(profile.baseCurrency));
    }
  }, [open, initial, profile.baseCurrency]);

  async function save() {
    const balance = parseFloat(form.currentBalance);
    if (!form.name.trim()) { toast('Name is required', 'error'); return; }
    if (isNaN(balance) || balance < 0) { toast('Enter a valid current balance', 'error'); return; }
    const principal = parseFloat(form.principal);
    const rate      = parseFloat(form.interestRate);
    const minPay    = parseFloat(form.minimumPayment);
    const tenure    = parseInt(form.tenureMonths, 10);

    setSaving(true);
    try {
      const debt: Partial<Debt> = {
        id: initial?.id ?? uid(),
        direction: form.direction,
        counterpartyName: form.direction === 'owed_to_me' ? (form.counterpartyName.trim() || undefined) : undefined,
        type: form.type,
        name: form.name.trim(),
        lender: form.lender.trim() || undefined,
        account: form.account.trim() || undefined,
        principal: isNaN(principal) ? balance : principal,
        currentBalance: balance,
        interestRate: isNaN(rate) ? 0 : rate,
        minimumPayment: isNaN(minPay) ? 0 : minPay,
        tenureMonths: isNaN(tenure) ? undefined : tenure,
        dueDate: form.dueDate || undefined,
        currency: form.currency,
      };
      await upsertDebt(debt);
      toast(initial ? 'Debt updated' : 'Debt added', 'success');
      onClose();
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!initial) return;
    if (!confirm('Delete this debt?')) return;
    try {
      await removeDebt(initial.id);
      toast('Debt deleted', 'info');
      onClose();
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, 'error');
    }
  }

  const isReceivable = form.direction === 'owed_to_me';

  return (
    <Modal open={open} title={initial ? (isReceivable ? 'Edit Receivable' : 'Edit Debt') : (isReceivable ? 'Add Receivable' : 'Add Debt')} onClose={onClose}>
      {/* §6 — direction selector: I owe (liability) vs Owed to me (receivable/asset). */}
      <Field label="Direction">
        <div className="grid grid-cols-2 gap-2">
          {([['owed_by_me', 'I owe'], ['owed_to_me', 'Owed to me']] as const).map(([val, lbl]) => (
            <button
              key={val}
              type="button"
              onClick={() => setForm(f => ({ ...f, direction: val }))}
              className={`py-2 rounded-md text-sm font-medium border transition-colors ${
                form.direction === val ? 'border-coral bg-coral/10 text-coral' : 'border-line text-ink-mid hover:bg-bg3'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </Field>

      <FieldRow>
        <Field label="Type">
          <Select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            {Object.entries(DEBT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Due date" hint="optional">
          <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
        </Field>
      </FieldRow>

      {isReceivable && (
        <Field label="Who owes you" hint="counterparty">
          <Input
            value={form.counterpartyName}
            onChange={e => setForm(f => ({ ...f, counterpartyName: e.target.value }))}
            placeholder="e.g. Sam, Acme Ltd"
          />
        </Field>
      )}

      <Field label="Name">
        <Input
          autoFocus
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Chase Sapphire"
        />
      </Field>

      <FieldRow>
        <Field label="Lender" hint="optional">
          <Input value={form.lender} onChange={e => setForm(f => ({ ...f, lender: e.target.value }))} placeholder="Bank name" />
        </Field>
        <Field label="Account" hint="optional">
          <Input value={form.account} onChange={e => setForm(f => ({ ...f, account: e.target.value }))} placeholder="••••1234" />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label={isReceivable ? 'Amount owed to you' : 'Current balance'}>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.currentBalance}
            onChange={e => setForm(f => ({ ...f, currentBalance: e.target.value }))}
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

      {/* Liability-only fields — a receivable (owed to me) is an asset, so it has
          no APR / minimum payment / tenure. */}
      {!isReceivable && (
        <>
          <FieldRow>
            <Field label="Original principal" hint="optional">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.principal}
                onChange={e => setForm(f => ({ ...f, principal: e.target.value }))}
                placeholder="defaults to balance"
              />
            </Field>
            <Field label="Interest rate" hint="% APR">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.interestRate}
                onChange={e => setForm(f => ({ ...f, interestRate: e.target.value }))}
                placeholder="0.00"
              />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Min. monthly payment">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.minimumPayment}
                onChange={e => setForm(f => ({ ...f, minimumPayment: e.target.value }))}
                placeholder="0.00"
              />
            </Field>
            <Field label="Tenure" hint="months, optional">
              <Input
                type="number"
                min="1"
                value={form.tenureMonths}
                onChange={e => setForm(f => ({ ...f, tenureMonths: e.target.value }))}
                placeholder="36"
              />
            </Field>
          </FieldRow>
        </>
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
    </Modal>
  );
}
