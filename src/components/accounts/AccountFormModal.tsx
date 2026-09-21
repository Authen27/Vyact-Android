// Vyact v10.24.0 (Accounts R2) — the type-first account form (design M2 / M3 / D2).
//
// v10.28.0 — rendered as the /accounts/new and /accounts/:id/edit pages; its
// Reconcile buttons open the /accounts/:id/reconcile page.
//
// CREATE — two tabs, Bank | Credit Card.
//   Bank:        name · current balance · payment modes
//   Credit card: name · total credit limit · available limit now · billing-cycle
//                day · payment-due day · payment modes. Outstanding and
//                utilisation are CALCULATED live and never asked for.
//   The balance (or, for a card, limit − available) is only the STARTING POINT:
//   it seeds opening_balance, and from then on the ledger keeps it current.
//
// EDIT — the type is fixed (an account does not change what it is). The balance
//   is never typed over: it is shown as the ledger computes it, with Reconcile
//   beside it. Archive and Delete permanently route through the delete guard.
//
// Currency is a household setting (v10.23.0) — there is no currency field.
// Cash in Hand is system-managed: it can be renamed, nothing more. Loan and
// investment accounts do not live on the Accounts screen; if one is opened here
// from elsewhere, only its name is editable.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FormPage from '../ui/FormPage';
import Button from '../ui/Button';
import { Input, Select } from '../ui/Input';
import SegmentedControl from '../ui/SegmentedControl';
import DeleteAccountSheet from './DeleteAccountSheet';
import { useStore } from '../../store';
import { formPath } from '../../lib/formRoutes';
import { uid, fmt } from '../../lib/format';
import { CURRENCIES } from '../../constants';
import { computeAccountBalance } from '../../lib/accountBalance';
import {
  PAYMENT_MODES_BY_KIND, PAYMENT_MODE_LABEL, cardFigures, openingBalanceForCard,
  parseAmountInput, statementWindow,
} from '../../lib/accountsView';
import type { Account, AccountKind, PaymentMode } from '../../types';

interface Props {
  open?: boolean;
  initial?: Account | null;
  onClose: () => void;
}

interface FormState {
  kind: AccountKind;
  name: string;
  balance: string;
  modes: PaymentMode[];
  creditLimit: string;
  availableLimit: string;
  cycleDay: string;
  dueDay: string;
  isDefault: boolean;
}

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const modesFor = (kind: AccountKind): readonly PaymentMode[] =>
  kind === 'credit_card' ? PAYMENT_MODES_BY_KIND.credit_card
    : kind === 'cash' ? PAYMENT_MODES_BY_KIND.cash
    : PAYMENT_MODES_BY_KIND.bank;

const blank = (): FormState => ({
  kind: 'bank', name: '', balance: '', modes: ['upi'],
  creditLimit: '', availableLimit: '', cycleDay: '', dueDay: '', isDefault: false,
});

export default function AccountFormModal(props: Props) {
  const baseCurrency  = useStore(s => s.profile.baseCurrency);
  const transactions  = useStore(s => s.transactions);
  const rates         = useStore(s => s.rates);
  const accounts      = useStore(s => s.accounts);
  const upsertAccount = useStore(s => s.upsertAccount);
  const toast         = useStore(s => s.toast);

  const open         = props.open ?? true;
  const initialProp  = props.initial ?? null;
  const onClose      = props.onClose;
  const navigate     = useNavigate();
  // Read the LIVE row, so a reconcile done from here shows on return.
  const initial = initialProp ? (accounts.find(a => a.id === initialProp.id) ?? initialProp) : null;
  const openReconcile = () => { if (initial) navigate(formPath.accountReconcile(initial.id)); };

  const [form, setForm]         = useState<FormState>(blank());
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isEdit   = !!initial;
  const isCash   = initial?.kind === 'cash';
  const isSystem = initial?.kind === 'loan' || initial?.kind === 'investment';
  const isCard   = form.kind === 'credit_card';
  const symbol   = CURRENCIES[baseCurrency]?.symbol ?? '';

  useEffect(() => {
    if (!open) return;
    if (initialProp) {
      setForm({
        kind: initialProp.kind,
        name: initialProp.name,
        balance: '',
        modes: initialProp.paymentModes?.length ? [...initialProp.paymentModes] : [modesFor(initialProp.kind)[0]],
        creditLimit: initialProp.creditLimit != null ? String(initialProp.creditLimit) : '',
        availableLimit: '',
        cycleDay: initialProp.billingCycleDay != null ? String(initialProp.billingCycleDay) : '',
        dueDay: initialProp.paymentDueDay != null ? String(initialProp.paymentDueDay) : '',
        isDefault: !!initialProp.isDefault,
      });
    } else {
      setForm(blank());
    }
  }, [open, initialProp]);

  const liveBalance = initial ? computeAccountBalance(initial, transactions, baseCurrency, rates) : 0;
  const limit     = parseAmountInput(form.creditLimit);
  const available = parseAmountInput(form.availableLimit);
  const balance   = parseAmountInput(form.balance);
  const cycleDay  = form.cycleDay ? Number(form.cycleDay) : null;
  const dueDay    = form.dueDay ? Number(form.dueDay) : null;

  // Card figures: on create from the two typed limits, on edit from the limit and the ledger.
  const figures = isCard && limit
    ? cardFigures(limit, isEdit ? liveBalance : (available !== null ? openingBalanceForCard(limit, available) : 0))
    : null;
  const window = isCard && cycleDay ? statementWindow(cycleDay, new Date()) : null;

  function switchKind(kind: 'bank' | 'credit_card') {
    if (isEdit) return;
    setForm(f => {
      const allowed = modesFor(kind);
      const kept = f.modes.filter(m => allowed.includes(m));
      return { ...f, kind, modes: kept.length ? kept : [allowed[0]] };
    });
  }
  function toggleMode(mode: PaymentMode) {
    setForm(f => ({ ...f, modes: f.modes.includes(mode) ? f.modes.filter(m => m !== mode) : [...f.modes, mode] }));
  }

  const nameOk  = form.name.trim().length > 0;
  const modesOk = isCash || isSystem || form.modes.length > 0;
  const moneyOk = isSystem || isCash
    ? true
    : isCard
      ? !!limit && limit > 0 && (isEdit || (available !== null && available >= 0)) && !!cycleDay && !!dueDay
      : isEdit || balance !== null;
  const canSubmit = nameOk && modesOk && moneyOk && !saving;

  async function save() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const payload: Partial<Account> = {
        id: initial?.id ?? uid(),
        assetId: initial?.assetId,
        kind: form.kind,
        name: form.name.trim(),
        isDefault: form.isDefault,
        updated_at: initial?.updated_at,
      };
      if (!isSystem) payload.paymentModes = isCash ? ['cash'] : form.modes;
      if (!isEdit) {
        payload.openingBalance = isCard ? openingBalanceForCard(limit!, available!) : balance!;
      }
      if (isCard) {
        payload.creditLimit = limit;
        payload.billingCycleDay = cycleDay;
        payload.paymentDueDay = dueDay;
      }
      await upsertAccount(payload);
      toast(isEdit ? 'Account updated' : isCard ? 'Card added' : 'Account added', 'success');
      onClose();
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!initial) return;
    try {
      await upsertAccount({ id: initial.id, isArchived: true });
      toast(`${initial.name} archived — its history stays intact`, 'success');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const title = isEdit ? initial!.name : isCard ? 'Credit card details' : 'What are you adding?';

  const footer = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {isEdit && !isCash && !isSystem && (
        <div className="flex items-center gap-4 flex-wrap">
          <button type="button" onClick={() => setForm(f => ({ ...f, isDefault: !f.isDefault }))}
            aria-pressed={form.isDefault}
            className="ui-action text-ink-mid hover:text-ink">
            {form.isDefault ? '★ Default account' : '☆ Make default account'}
          </button>
          <button type="button" onClick={archive}
            className="ui-action text-ink-mid hover:text-ink">Archive</button>
          <button type="button" onClick={() => setDeleting(true)}
            className="ui-action hover:underline"
            style={{ color: 'hsl(var(--terra))' }}>Delete permanently</button>
        </div>
      )}
      <div className="flex gap-2 sm:ml-auto">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button full onClick={save} disabled={!canSubmit}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : isCard ? 'Add card' : 'Add account'}
        </Button>
      </div>
    </div>
  );

  const nameField = (
    <Labelled label={isCard ? 'Card name' : 'Account name'} htmlFor="acct-name">
      <Input id="acct-name" autoFocus={!isEdit} value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        placeholder={isCash ? 'Cash in Hand' : isCard ? 'e.g. HDFC Regalia ··42' : 'e.g. HDFC savings'}
        required />
    </Labelled>
  );

  const modesField = !isCash && !isSystem && (
    <Labelled label={isCard ? 'Payment modes used on this card' : 'Payment modes used on this account'}>
      <div className="flex flex-wrap gap-[7px]" role="group" aria-label="Payment modes">
        {modesFor(form.kind).map(mode => {
          const on = form.modes.includes(mode);
          return (
            <button key={mode} type="button" aria-pressed={on} onClick={() => toggleMode(mode)}
              className="min-h-[44px] px-3 rounded-md text-[14px] border border-line cursor-pointer transition-colors"
              style={on
                ? { color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 10%, var(--canvas))', fontWeight: 500 }
                : { color: 'var(--ff-ink-2, inherit)', background: 'var(--canvas)' }}>
              {PAYMENT_MODE_LABEL[mode]}
            </button>
          );
        })}
      </div>
      <p className="text-[11.5px] text-ink-dim mt-2 leading-snug">
        {form.modes.length === 0
          ? <span style={{ color: 'hsl(var(--honey))' }}>Choose at least one.</span>
          : 'These become the mode options when you log a spend against this account.'}
      </p>
    </Labelled>
  );

  const bankBalanceField = !isCard && !isSystem && (isEdit ? (
    <Labelled label="Balance">
      <div className="flex items-center gap-3 min-h-[54px] px-4 rounded-r2"
        style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
        <span className="num font-bold text-[20px] text-ink flex-1">{fmt(liveBalance, baseCurrency)}</span>
        <Button variant="ghost" onClick={openReconcile}>Reconcile</Button>
      </div>
      <p className="text-[11.5px] text-ink-dim mt-2 leading-snug">Computed from the ledger. If it disagrees with your statement, reconcile it — it is never typed over.</p>
    </Labelled>
  ) : (
    <Labelled label="Current balance" htmlFor="acct-balance">
      <div className="flex items-center gap-2 min-h-[54px] px-4 rounded-r2"
        style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
        <span className="font-mono text-[16px] text-ink-dim" aria-hidden>{symbol}</span>
        <input id="acct-balance" inputMode="decimal" value={form.balance}
          onChange={e => setForm(f => ({ ...f, balance: e.target.value }))} placeholder="0"
          className="num font-bold text-[22px] bg-transparent border-none outline-none text-ink w-full min-w-0" />
      </div>
      <p className="text-[11.5px] text-ink-dim mt-2 leading-snug">Just the starting point. From here the ledger keeps it current — you&apos;ll reconcile it, never type over it.</p>
    </Labelled>
  ));

  const cardFields = isCard && (
    <>
      <Labelled label="Limits">
        <div className="grid grid-cols-2 gap-[9px]">
          <MoneyField id="card-limit" label="Total credit limit" symbol={symbol} value={form.creditLimit}
            onChange={v => setForm(f => ({ ...f, creditLimit: v }))} />
          {isEdit ? (
            <Calc label="Available now · calculated" value={figures ? fmt(figures.available, baseCurrency) : '—'} />
          ) : (
            <MoneyField id="card-available" label="Available limit now" symbol={symbol} value={form.availableLimit}
              onChange={v => setForm(f => ({ ...f, availableLimit: v }))} />
          )}
          <div className="col-span-2">
            <Calc label="Outstanding · calculated"
              value={figures ? `−${fmt(figures.outstanding, baseCurrency)}` : '—'}
              valueColor="hsl(var(--honey))"
              aside={figures ? `${Math.round(figures.utilisation * 100)}% utilised` : undefined} />
          </div>
        </div>
      </Labelled>
      <Labelled label="Cycle">
        <div className="grid grid-cols-2 gap-[9px]">
          <DayField id="card-cycle" label="Billing cycle starts" value={form.cycleDay}
            onChange={v => setForm(f => ({ ...f, cycleDay: v }))} />
          <DayField id="card-due" label="Payment due" value={form.dueDay} warn
            onChange={v => setForm(f => ({ ...f, dueDay: v }))} />
          {isEdit && window && (
            <div className="col-span-2">
              <Calc label="Statement window · calculated" value={`${fmtDay(window.start)} – ${fmtDay(window.end)}`} />
            </div>
          )}
        </div>
      </Labelled>
      {isEdit ? (
        <Labelled label="Balance">
          <div className="flex items-center gap-3 min-h-[54px] px-4 rounded-r2"
            style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
            <span className="num font-bold text-[20px] flex-1" style={{ color: liveBalance < 0 ? 'hsl(var(--honey))' : undefined }}>
              {liveBalance < 0 ? `−${fmt(-liveBalance, baseCurrency)}` : fmt(liveBalance, baseCurrency)}
            </span>
            <Button variant="ghost" onClick={openReconcile}>Reconcile</Button>
          </div>
          <p className="text-[11.5px] text-ink-dim mt-2 leading-snug">Reconcile against your statement outstanding. A disagreement posts a marked adjustment — never a spend.</p>
        </Labelled>
      ) : (
        <Advice>
          Enter the two limits and I work out what you owe — that&apos;s the number a statement actually shows you.
          The cycle dates decide which spends fall in each statement, and drive the reminder before the due date.
        </Advice>
      )}
    </>
  );

  return (
    <>
      <FormPage open={open} title={title} onClose={onClose} footer={footer} className="ui-pilot" size={isEdit && !isCash && !isSystem ? 'lg' : 'md'} helpTopicId="accounts-cards">
        <div className="ui-form-stack">
        <div className="ui-label">
          {isEdit ? 'Edit account' : 'New account'}
        </div>

        {!isCash && !isSystem && (
          <SegmentedControl label="Account type" value={form.kind === 'credit_card' ? 'credit_card' : 'bank'} onChange={switchKind}
            options={[{ value: 'bank', label: 'Bank', disabled: isEdit && isCard },
              { value: 'credit_card', label: 'Credit Card', disabled: isEdit && !isCard }]} />
        )}
        {(isCash || isSystem) && (
          <p className="text-[0.8rem] text-ink-dim mb-4">
            {isCash
              ? 'Cash in Hand is your household’s one cash account. You can rename it; it can’t be archived or deleted.'
              : `This ${initial?.kind} account is managed from ${initial?.kind === 'loan' ? 'Debts' : 'Net Worth'} — only its name can be changed here.`}
          </p>
        )}

        {isEdit && !isCash && !isSystem ? (
          <div className="grid gap-group sm:grid-cols-2">
            <div className="flex flex-col gap-group">
              {nameField}
              {cardFields}
              {!isCard && bankBalanceField}
            </div>
            <div className="flex flex-col gap-group">
              {modesField}
              <CurrencyAdvice symbol={symbol} code={baseCurrency} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-group">
            {nameField}
            {!isCash && !isSystem && (isCard ? cardFields : bankBalanceField)}
            {modesField}
            {!isCash && !isSystem && <CurrencyAdvice symbol={symbol} code={baseCurrency} />}
          </div>
        )}
        </div>
      </FormPage>

      <DeleteAccountSheet account={initial} open={deleting} onClose={() => setDeleting(false)} onDone={onClose} />
    </>
  );
}

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function Labelled({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      {htmlFor ? <label htmlFor={htmlFor} className="block ui-label mb-related">{label}</label>
        : <div className="ui-label mb-related">{label}</div>}
      {children}
    </div>
  );
}

function MoneyField({ id, label, symbol, value, onChange }: {
  id: string; label: string; symbol: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block ui-label mb-related">{label} ({symbol})</label>
      <Input id={id} inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} placeholder="0" className="num" />
    </div>
  );
}

function DayField({ id, label, value, onChange, warn }: {
  id: string; label: string; value: string; onChange: (v: string) => void; warn?: boolean;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block ui-label mb-related">{label}</label>
      <Select id={id} value={value} onChange={e => onChange(e.target.value)}
        style={{ color: warn && value ? 'hsl(var(--honey))' : undefined }}>
        <option value="">Choose day…</option>
        {DAYS.map(d => <option key={d} value={d}>{ordinal(d)} monthly</option>)}
      </Select>
    </div>
  );
}

function Calc({ label, value, valueColor, aside }: { label: string; value: string; valueColor?: string; aside?: string }) {
  return (
    <div className="py-3 border-b border-line" aria-live="polite">
      <div className="ui-label mb-related">{label}</div>
      <div className="flex items-baseline gap-3">
        <span className="num font-semibold text-[15px] text-ink" style={valueColor ? { color: valueColor } : undefined}>{value}</span>
        {aside && <span className="font-mono text-[12px] text-ink-dim">{aside}</span>}
      </div>
    </div>
  );
}

function Advice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[13px] px-[13px] py-[11px] text-[0.74rem] leading-relaxed text-ink-mid"
      style={{ background: 'color-mix(in srgb, hsl(var(--denim)) 14%, transparent)' }}>
      {children}
    </p>
  );
}

function CurrencyAdvice({ symbol, code }: { symbol: string; code: string }) {
  return (
    <Advice>
      Currency comes from your household — <strong className="text-ink">{symbol} {code}</strong>. Change it in
      Settings ▸ Language &amp; currency and every account follows.
    </Advice>
  );
}
