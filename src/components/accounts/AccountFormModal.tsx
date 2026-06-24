// Vyact v7.1.3 — AccountFormModal
//
// Money Map: create / rename / archive a first-class account row.
// Mounted once at App root and toggled by the store's `accountModalOpen`
// slot, mirroring AssetFormModal.
//
// Notes
// -----
// - We don't expose `assetId` in the form. The Phase 1 backfill set it for
//   accounts synthesised from existing assets/cards; user-created accounts
//   leave it null and that's the right default.
// - Archive is a soft-toggle (`isArchived = true`); the UI hides archived
//   accounts from pickers without losing historical references.
// - Hard delete remains available (cloud table soft-deletes server-side via
//   the adapter's `remove`); use it only when the user explicitly wants to
//   wipe a never-used account.

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Input, Select, Field, FieldRow } from '../ui/Input';
import { useStore } from '../../store';
import { uid } from '../../lib/format';
import { CURRENCIES } from '../../constants';
import type { Account, AccountKind } from '../../types';

interface Props {
  open?: boolean;
  initial?: Account | null;
  onClose?: () => void;
}

interface FormState {
  kind: AccountKind;
  name: string;
  currency: string;
  isDefault: boolean;
  isArchived: boolean;
}

// v9 txn-redesign §2.2 — strict kind enum. credit_card and loan are liabilities.
const KINDS: { key: AccountKind; label: string }[] = [
  { key: 'bank',        label: 'Bank' },
  { key: 'cash',        label: 'Cash' },
  { key: 'credit_card', label: 'Credit card' },
  { key: 'investment',  label: 'Investment' },
  { key: 'loan',        label: 'Loan' },
];

const blank = (currency: string): FormState => ({
  kind: 'bank',
  name: '',
  currency,
  isDefault: false,
  isArchived: false,
});

export default function AccountFormModal(props: Props) {
  const profile       = useStore(s => s.profile);
  const upsertAccount = useStore(s => s.upsertAccount);
  const removeAccount = useStore(s => s.removeAccount);
  const toast         = useStore(s => s.toast);

  const storeOpen    = useStore(s => s.accountModalOpen);
  const storeInitial = useStore(s => s.editingAccount);
  const storeClose   = useStore(s => s.closeAccountModal);
  const open         = props.open    ?? storeOpen;
  const initial      = props.initial ?? storeInitial;
  const onClose      = props.onClose ?? storeClose;

  const [form, setForm]     = useState<FormState>(blank(profile.baseCurrency));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        kind: initial.kind,
        name: initial.name,
        currency: initial.currency,
        isDefault: !!initial.isDefault,
        isArchived: !!initial.isArchived,
      });
    } else {
      setForm(blank(profile.baseCurrency));
    }
  }, [open, initial, profile.baseCurrency]);

  async function save() {
    if (!form.name.trim()) { toast('Name is required', 'error'); return; }
    setSaving(true);
    try {
      const acc: Partial<Account> = {
        id: initial?.id ?? uid(),
        // Preserve the backfill-assigned assetId on edits so the FK chain
        // (transaction.account_id → account.asset_id → asset.id) stays
        // intact. New accounts leave it undefined.
        assetId: initial?.assetId,
        kind: form.kind,
        name: form.name.trim(),
        currency: form.currency,
        isDefault: form.isDefault,
        isArchived: form.isArchived,
        updated_at: initial?.updated_at,
      };
      await upsertAccount(acc);
      toast(initial ? 'Account updated' : 'Account added', 'success');
      onClose();
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!initial) return;
    if (!confirm('Delete this account? Transactions linked to it will keep their history but lose the link.')) return;
    try {
      await removeAccount(initial.id);
      toast('Account deleted', 'info');
      onClose();
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, 'error');
    }
  }

  return (
    <Modal open={open} title={initial ? 'Edit Account' : 'Add Account'} onClose={onClose}>
      <FieldRow>
        <Field label="Kind">
          <Select
            value={form.kind}
            onChange={e => setForm(f => ({ ...f, kind: e.target.value as AccountKind }))}
          >
            {KINDS.map(k => (
              <option key={k.key} value={k.key}>{k.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Currency">
          <Select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
            {Object.entries(CURRENCIES).map(([code, c]) => (
              <option key={code} value={code}>{c.symbol} {code}</option>
            ))}
          </Select>
        </Field>
      </FieldRow>

      {/* v9.4.2 — investment account auto-creates a backing Asset on Net Worth */}
      {form.kind === 'investment' && !initial && (
        <p className="-mt-1 mb-1 text-[0.7rem] text-sage leading-snug">
          📈 This will also appear as an asset on your <strong>Net Worth</strong> page.
        </p>
      )}

      <Field label="Name">
        <Input
          autoFocus
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Chase Checking"
        />
      </Field>

      <div className="flex flex-col gap-2 pt-1">
        <label className="flex items-center gap-2 text-[0.86rem] text-ink-mid">
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))}
          />
          Default account for this currency
        </label>
        <label className="flex items-center gap-2 text-[0.86rem] text-ink-mid">
          <input
            type="checkbox"
            checked={form.isArchived}
            onChange={e => setForm(f => ({ ...f, isArchived: e.target.checked }))}
          />
          Archived (hidden from pickers, history retained)
        </label>
      </div>

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
