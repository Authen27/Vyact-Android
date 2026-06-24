// v7.3 — Money Map Item #5 (M-tier).
//
// Drawer that lets a single transaction be split across multiple accounts
// (e.g. partly cash + partly credit card). Renders inline below the
// primary account picker on TransactionFormModal. Persisted onto
// `Transaction.accountSplits`. Sum of split amounts MUST equal the
// transaction total — the drawer surfaces a delta indicator and the
// parent form blocks save when the split is enabled and unbalanced.

import { useMemo } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, AlertTriangle, Check } from 'lucide-react';
import type { AccountOption } from '../../lib/accounts';
import type { AccountSplit } from '../../types';

export interface AccountDrawerProps {
  total: number;
  accounts: AccountOption[];
  splits: AccountSplit[];
  onChange: (splits: AccountSplit[]) => void;
  /** When true, the drawer is expanded and persistance is active. */
  enabled: boolean;
  onToggleEnabled: (next: boolean) => void;
}

const EPSILON = 0.01;

export function AccountDrawer({
  total, accounts, splits, onChange, enabled, onToggleEnabled,
}: AccountDrawerProps) {
  const sum = useMemo(() => splits.reduce((s, r) => s + (Number(r.amount) || 0), 0), [splits]);
  const remaining = +(total - sum).toFixed(2);
  const balanced = Math.abs(remaining) < EPSILON;

  const setRow = (i: number, patch: Partial<AccountSplit>) => {
    onChange(splits.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };
  const addRow = () => {
    const used = new Set(splits.map(s => s.accountId));
    const next = accounts.find(a => !used.has(a.value));
    onChange([...splits, { accountId: next?.value ?? '', amount: Math.max(0, remaining) }]);
  };
  const removeRow = (i: number) => onChange(splits.filter((_, idx) => idx !== i));
  const distributeRemaining = () => {
    if (!splits.length || balanced) return;
    const last = splits.length - 1;
    onChange(splits.map((r, i) => i === last ? { ...r, amount: +(r.amount + remaining).toFixed(2) } : r));
  };

  return (
    <div className="border border-line rounded-md bg-bg2">
      <button
        type="button"
        onClick={() => onToggleEnabled(!enabled)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-bg3"
        aria-expanded={enabled}
      >
        {enabled ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="font-medium">Split across accounts</span>
        {enabled && (
          balanced
            ? <span className="ml-auto inline-flex items-center gap-1 text-xs text-sage"><Check size={12} />Balanced</span>
            : <span className="ml-auto inline-flex items-center gap-1 text-xs text-honey"><AlertTriangle size={12} />Off by {remaining.toFixed(2)}</span>
        )}
      </button>

      {enabled && (
        <div className="px-3 pb-3 pt-1 space-y-2">
          {splits.length === 0 && (
            <p className="text-xs text-ink-dim">
              Add two or more accounts to split this transaction.
            </p>
          )}
          {splits.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={row.accountId}
                onChange={e => setRow(i, { accountId: e.target.value })}
                className="input flex-1 min-w-[140px]"
                aria-label={`Account ${i + 1}`}
              >
                <option value="">Choose account</option>
                {accounts.map(a => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={Number.isFinite(row.amount) ? row.amount : ''}
                onChange={e => setRow(i, { amount: parseFloat(e.target.value) || 0 })}
                className="input w-28"
                aria-label={`Amount ${i + 1}`}
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label={`Remove split ${i + 1}`}
                className="p-1.5 rounded text-ink-dim hover:text-terra hover:bg-bg3"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-1 text-xs text-coral hover:underline"
            >
              <Plus size={12} /> Add Account
            </button>
            {!balanced && splits.length > 0 && (
              <button
                type="button"
                onClick={distributeRemaining}
                className="text-xs text-coral hover:underline"
              >
                Apply remaining to last row
              </button>
            )}
          </div>

          <div className="flex justify-between text-xs text-ink-mid pt-1 border-t border-line">
            <span>Sum: {sum.toFixed(2)}</span>
            <span>Total: {total.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default AccountDrawer;
