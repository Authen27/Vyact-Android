// Vyact v6.4.1 — AssetFormModal
//
// Modal-driven Asset create/edit form. Mirrors TransactionFormModal /
// GoalFormModal / BudgetFormModal / DebtFormModal so the creation
// surfaces feel consistent. Replaces the inline panel form previously
// rendered inside pages/NetWorth.tsx.
//
// v10.26.0 (R4) — an INVESTMENT asset folds like an account: `value` is its
// opening value, buys and withdrawals move it, and "Update value" records a
// dated valuation offset. So on edit this form shows the LIVE value, saves the
// details without touching the opening value, and turns a changed value into
// a value update — never an overwrite, never a transaction. Once money has
// moved through it, its currency and type are locked: re-denominating or
// re-typing it would silently change what those buys are worth.
//
// v10.28.0 — rendered as the /networth/assets/new and /networth/assets/:id/edit pages.

import { useEffect, useMemo, useState } from 'react';
import FormPage from '../ui/FormPage';
import Button from '../ui/Button';
import { Input, Select, Field, FieldRow } from '../ui/Input';
import { useStore } from '../../store';
import { uid, today } from '../../lib/format';
import { computeAssetValue } from '../../lib/accountBalance';
import { ASSET_TYPES } from '../../constants';
import type { Asset } from '../../types';
import { fmt } from '../../lib/format';
import { confirmSheet } from '../../lib/confirmSheet';
import { deleteAssetRequest } from '../../lib/confirmCopy';

interface Props {
  open?: boolean;
  initial?: Asset | null;
  onClose: () => void;
}

interface FormState {
  type: string;
  name: string;
  value: string;
  currency: string;
  liquidity: Asset['liquidity'];
  note: string;
}

const blank = (currency: string): FormState => ({
  type: 'savings',
  name: '',
  value: '',
  currency,
  liquidity: 'liquid',
  note: '',
});

const LIQUIDITIES: { key: Asset['liquidity']; label: string; desc: string }[] = [
  { key: 'liquid', label: 'Liquid',     desc: 'Cash, checking, savings' },
  { key: 'short',  label: 'Short-term', desc: 'Investments, receivables' },
  { key: 'long',   label: 'Long-term',  desc: 'Real estate, retirement' },
];

export default function AssetFormModal(props: Props) {
  const profile          = useStore(s => s.profile);
  const upsertAsset      = useStore(s => s.upsertAsset);
  const removeAsset      = useStore(s => s.removeAsset);
  const updateAssetValue = useStore(s => s.updateAssetValue);
  const transactions     = useStore(s => s.transactions);
  const rates            = useStore(s => s.rates);
  const toast            = useStore(s => s.toast);

  const open         = props.open ?? true;
  const initial      = props.initial ?? null;
  const onClose      = props.onClose;

  const [form, setForm]     = useState<FormState>(blank(profile.baseCurrency));
  const [saving, setSaving] = useState(false);
  // Aurora 4.0 FA1 — liquidity follows the type; the select appears only for the rare exception.
  const [changeLiquidity, setChangeLiquidity] = useState(false);

  // Money has moved through this asset — it folds, and its denomination is fixed.
  const hasActivity = useMemo(
    () => !!initial && transactions.some(t => t.type === 'investment' && t.assetId === initial.id),
    [initial, transactions],
  );
  const folds = !!initial && (initial.type === 'investment' || hasActivity);
  const liveValue = initial ? computeAssetValue(initial, transactions, rates) : 0;

  useEffect(() => {
    if (!open) return;
    // An asset saved with a liquidity its type would not give opens with the choice visible.
    setChangeLiquidity(!!initial && ASSET_TYPES[initial.type]?.liquidity !== initial.liquidity);
    if (initial) {
      setForm({
        type: initial.type,
        name: initial.name,
        value: String(folds ? liveValue : initial.value),
        currency: initial.currency,
        liquidity: initial.liquidity,
        note: initial.note ?? '',
      });
    } else {
      setForm(blank(profile.baseCurrency));
    }
    // liveValue/folds derive from `initial` + the ledger; reseeding on every
    // ledger change would clobber what the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, profile.baseCurrency]);

  async function save() {
    const value = parseFloat(form.value);
    if (!form.name.trim()) { toast('Name is required', 'error'); return; }
    if (isNaN(value) || value < 0) { toast('Enter a valid value', 'error'); return; }

    setSaving(true);
    try {
      if (initial && folds) {
        // Details only — the opening value stays exactly as it was.
        const details: Partial<Asset> = {
          ...initial,
          type: hasActivity ? initial.type : form.type,
          name: form.name.trim(),
          currency: profile.baseCurrency,   // W3b: one currency per household
          liquidity: form.liquidity,
          note: form.note.trim() || undefined,
        };
        await upsertAsset(details);
        const changed = Math.round((value - liveValue) * 100) !== 0;
        if (changed) {
          const fresh = useStore.getState().assets.find(a => a.id === initial.id) ?? (details as Asset);
          await updateAssetValue(fresh, value);
        }
        toast(changed ? 'Value updated' : 'Asset updated', 'success');
      } else {
        // W8a (audit FE-UIC-09): an edit is a patch over the row it opened (W4c, D18) — keep its links,
        // provenance and `updated_at` precondition; only the form's own fields change.
        const asset: Partial<Asset> = {
          ...(initial ?? {}),
          id: initial?.id ?? uid(),
          type: form.type,
          name: form.name.trim(),
          value,
          currency: profile.baseCurrency,
          liquidity: form.liquidity,
          note: form.note.trim() || undefined,
          lastUpdated: today(),
        };
        await upsertAsset(asset);
        toast(initial ? 'Asset updated' : 'Asset added', 'success');
      }
      onClose();
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!initial) return;
    // Aurora 4.0 CF12.
    const value = initial.currency ? fmt(liveValue, initial.currency) : undefined;
    if (!(await confirmSheet(deleteAssetRequest({ name: initial.name, value: liveValue > 0 ? value : undefined })))) return;
    try {
      await removeAsset(initial.id);
      toast('Asset deleted', 'info');
      onClose();
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, 'error');
    }
  }

  const footer = (
    <div className="flex items-center justify-between gap-2">
      {initial ? (
        <button
          type="button"
          onClick={del}
          className="ui-action text-terra hover:underline min-h-[44px]"
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
  );

  return (
    <FormPage open={open} title={initial ? 'Edit Asset' : 'Add Asset'} onClose={onClose} footer={footer} helpTopicId="assets" className="ui-pilot">
      {/* Aurora 4.0 FA1 — every type already has a liquidity (ASSET_TYPES), so it is filled from the type
          and shown as a sentence, with Change for the rare exception (were two selects side by side). */}
      <Field label="Type" hint={!changeLiquidity ? (() => {
        const liq = LIQUIDITIES.find(l => l.key === form.liquidity);
        return <>
          Counts as <span className="text-ink font-medium">{liq?.label.toLowerCase() ?? form.liquidity}</span> ({liq?.desc.toLowerCase()}).{' '}
          <button type="button" className="font-medium underline underline-offset-2 min-h-[44px] align-middle"
            style={{ color: 'var(--accent-text)' }} aria-label="Change liquidity"
            onClick={() => setChangeLiquidity(true)}>Change</button>
        </>;
      })() : undefined}>
        <Select value={form.type} disabled={hasActivity}
          onChange={e => {
            const type = e.target.value;
            setForm(f => ({ ...f, type, liquidity: ASSET_TYPES[type]?.liquidity ?? f.liquidity }));
          }}>
          {Object.entries(ASSET_TYPES).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </Select>
      </Field>
      {changeLiquidity && (
        <Field label="Liquidity" hint="How quickly this could become cash. Net Worth groups assets by it.">
          <Select
            value={form.liquidity}
            onChange={e => setForm(f => ({ ...f, liquidity: e.target.value as Asset['liquidity'] }))}
          >
            {LIQUIDITIES.map(l => (
              <option key={l.key} value={l.key}>{l.label} — {l.desc}</option>
            ))}
          </Select>
        </Field>
      )}

      <Field label="Name">
        <Input
          autoFocus
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder={form.type === 'investment' ? 'e.g. Nifty 50 index fund' : 'e.g. Chase Savings'}
        />
      </Field>

      <FieldRow>
        <Field label={initial && folds ? 'Current value' : form.type === 'investment' ? 'Value today' : 'Current value'}>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.value}
            onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
            placeholder="0.00"
          />
        </Field>
      </FieldRow>

      {(form.type === 'investment' || folds) && (
        <p className="text-[12px] text-ink-dim leading-snug -mt-1 mb-3">
          {initial && folds
            ? 'Buys and withdrawals move this value on their own. Changing it records a dated value update — it never becomes a transaction and never touches your spending.'
            : 'Record buys and withdrawals as Investment transactions — each one moves this value and the account it came from by the same amount.'}
          {hasActivity && ' Its type is fixed once money has moved through it.'}
        </p>
      )}

      <Field label="Note" hint="optional">
        <Input
          value={form.note}
          onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
          placeholder="Account number, institution, etc."
        />
      </Field>

    </FormPage>
  );
}
