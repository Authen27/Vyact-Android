// Vyact v6.4.1 — AssetFormModal
//
// Modal-driven Asset create/edit form. Mirrors TransactionFormModal /
// GoalFormModal / BudgetFormModal / DebtFormModal so the creation
// surfaces feel consistent. Replaces the inline panel form previously
// rendered inside pages/NetWorth.tsx.

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Input, Select, Field, FieldRow } from '../ui/Input';
import { useStore } from '../../store';
import { uid, today } from '../../lib/format';
import { ASSET_TYPES, CURRENCIES } from '../../constants';
import type { Asset } from '../../types';

interface Props {
  open?: boolean;
  initial?: Asset | null;
  onClose?: () => void;
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
  const profile     = useStore(s => s.profile);
  const upsertAsset = useStore(s => s.upsertAsset);
  const removeAsset = useStore(s => s.removeAsset);
  const toast       = useStore(s => s.toast);

  const storeOpen    = useStore(s => s.assetModalOpen);
  const storeInitial = useStore(s => s.editingAsset);
  const storeClose   = useStore(s => s.closeAssetModal);
  const open         = props.open    ?? storeOpen;
  const initial      = props.initial ?? storeInitial;
  const onClose      = props.onClose ?? storeClose;

  const [form, setForm]     = useState<FormState>(blank(profile.baseCurrency));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        type: initial.type,
        name: initial.name,
        value: String(initial.value),
        currency: initial.currency,
        liquidity: initial.liquidity,
        note: initial.note ?? '',
      });
    } else {
      setForm(blank(profile.baseCurrency));
    }
  }, [open, initial, profile.baseCurrency]);

  async function save() {
    const value = parseFloat(form.value);
    if (!form.name.trim()) { toast('Name is required', 'error'); return; }
    if (isNaN(value) || value < 0) { toast('Enter a valid value', 'error'); return; }

    setSaving(true);
    try {
      const asset: Partial<Asset> = {
        id: initial?.id ?? uid(),
        type: form.type,
        name: form.name.trim(),
        value,
        currency: form.currency,
        liquidity: form.liquidity,
        note: form.note.trim() || undefined,
        lastUpdated: today(),
      };
      await upsertAsset(asset);
      toast(initial ? 'Asset updated' : 'Asset added', 'success');
      onClose();
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!initial) return;
    if (!confirm('Delete this asset?')) return;
    try {
      await removeAsset(initial.id);
      toast('Asset deleted', 'info');
      onClose();
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, 'error');
    }
  }

  return (
    <Modal open={open} title={initial ? 'Edit Asset' : 'Add Asset'} onClose={onClose}>
      <FieldRow>
        <Field label="Type">
          <Select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            {Object.entries(ASSET_TYPES).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Liquidity">
          <Select
            value={form.liquidity}
            onChange={e => setForm(f => ({ ...f, liquidity: e.target.value as Asset['liquidity'] }))}
          >
            {LIQUIDITIES.map(l => (
              <option key={l.key} value={l.key}>{l.label} — {l.desc}</option>
            ))}
          </Select>
        </Field>
      </FieldRow>

      <Field label="Name">
        <Input
          autoFocus
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Chase Savings"
        />
      </Field>

      <FieldRow>
        <Field label="Current value">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.value}
            onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
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

      <Field label="Note" hint="optional">
        <Input
          value={form.note}
          onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
          placeholder="Account number, institution, etc."
        />
      </Field>

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
