// Vyact v9.1 §4 — BudgetFormModal (rebuilt).
//
// A budget now has a STRICT identity (scope + year + month) so it is the SAME
// budget on every device (fixes the item-2 cross-device divergence). It is a
// PERIOD CONTAINER whose total is split into per-category allocation child rows
// (cloud-synced, not jsonb). A read-only recurring-forecast line shows what's
// already committed via recurring schedules over the period (money-model A8).

import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Input, Select, Field, FieldRow } from '../ui/Input';
import { useStore } from '../../store';
import { fmt } from '../../lib/format';
import { resolveBudgetPeriod, recurringForecastByCategory } from '../../lib/calculations';
import { suggestBudget } from '../../lib/budgetIntel';
import { EXPENSE_CATEGORIES, getCat, deterministicColor } from '../../constants';
import type { Budget, BudgetScope, BudgetAllocation } from '../../types';

interface Props { open?: boolean; initial?: Budget | null; onClose?: () => void; }

interface AllocRow { id?: string; category: string; amount: string; }
interface FormState {
  scope: BudgetScope;
  periodYear: string;
  periodMonth: string;     // '1'..'12'
  limit: string;
  currency: string;
  allocs: AllocRow[];
}

const CURRENCIES = ['USD','EUR','GBP','INR','JPY','AUD','CAD','CHF','CNY','AED','SGD','BRL'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const blank = (currency: string): FormState => {
  const now = new Date();
  return {
    scope: 'month',
    periodYear: String(now.getFullYear()),
    periodMonth: String(now.getMonth() + 1),
    limit: '',
    currency,
    allocs: [],
  };
};

export default function BudgetFormModal(props: Props) {
  const profile      = useStore(s => s.profile);
  const rates        = useStore(s => s.rates);
  const recurring    = useStore(s => s.recurringSchedules);
  const allocations  = useStore(s => s.budgetAllocations);
  const budgets      = useStore(s => s.budgets);
  const transactions = useStore(s => s.transactions);
  const debts        = useStore(s => s.debts);
  const goals        = useStore(s => s.goals);
  const saveBudgetWithAllocations = useStore(s => s.saveBudgetWithAllocations);
  const removeBudget = useStore(s => s.removeBudget);
  const manualRefresh = useStore(s => s.manualRefresh);
  const toast        = useStore(s => s.toast);

  const storeOpen    = useStore(s => s.budgetModalOpen);
  const storeInitial = useStore(s => s.editingBudget);
  const storeClose   = useStore(s => s.closeBudgetModal);
  const open    = props.open    ?? storeOpen;
  const initial = props.initial ?? storeInitial;
  const onClose = props.onClose ?? storeClose;

  const [form, setForm]     = useState<FormState>(blank(profile.baseCurrency));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      const rows = allocations.filter(a => a.budgetId === initial.id)
        .map(a => ({ id: a.id, category: a.category, amount: String(a.amount) }));
      setForm({
        // Coerce any legacy 'custom' row to 'month' (custom budgets removed).
        scope: initial.scope === 'annual' ? 'annual' : 'month',
        periodYear: String(initial.periodYear ?? new Date().getFullYear()),
        periodMonth: String(initial.periodMonth ?? new Date().getMonth() + 1),
        limit: String(initial.limit ?? ''),
        currency: initial.currency,
        allocs: rows,
      });
    } else {
      setForm(blank(profile.baseCurrency));
    }
  }, [open, initial, profile.baseCurrency, allocations]);

  // resolved period range for the current form state
  const period = useMemo(
    () => resolveBudgetPeriod(form.scope, Number(form.periodYear), Number(form.periodMonth)),
    [form.scope, form.periodYear, form.periodMonth],
  );

  const allocSum = form.allocs.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const total = parseFloat(form.limit) || 0;
  const remaining = total - allocSum;

  // §4.2 — read-only recurring forecast: committed-by-recurring per category.
  const forecast = useMemo(() => {
    if (!period.periodStart || !period.periodEnd) return {} as Record<string, number>;
    return recurringForecastByCategory(recurring, period.periodStart, period.periodEnd, form.currency, rates);
  }, [recurring, period.periodStart, period.periodEnd, form.currency, rates]);
  const forecastTotal = Object.values(forecast).reduce((s, n) => s + n, 0);

  function setAlloc(i: number, patch: Partial<AllocRow>) {
    setForm(f => ({ ...f, allocs: f.allocs.map((r, idx) => idx === i ? { ...r, ...patch } : r) }));
  }
  function addAlloc() {
    const used = new Set(form.allocs.map(r => r.category));
    const next = EXPENSE_CATEGORIES.find(c => !used.has(c.id))?.id ?? 'other_expense';
    setForm(f => ({ ...f, allocs: [...f.allocs, { category: next, amount: '' }] }));
  }
  function removeAlloc(i: number) {
    setForm(f => ({ ...f, allocs: f.allocs.filter((_, idx) => idx !== i) }));
  }
  function prefillFromForecast() {
    const rows: AllocRow[] = Object.entries(forecast).map(([category, amount]) => ({ category, amount: String(Math.round(amount)) }));
    if (rows.length) setForm(f => ({ ...f, allocs: rows, limit: f.limit || String(Math.round(forecastTotal)) }));
  }

  function applySuggestions() {
    const suggestions = suggestBudget({ transactions, debts, goals, recurring, baseCurrency: form.currency, rates });
    if (!suggestions.length) { toast('Not enough spending history to suggest yet', 'info'); return; }
    const rows: AllocRow[] = suggestions.map(s => ({ category: s.category, amount: String(s.limit) }));
    const suggestedTotal = suggestions.reduce((sum, s) => sum + s.limit, 0);
    setForm(f => ({ ...f, allocs: rows, limit: f.limit || String(Math.round(suggestedTotal)) }));
    toast('Allocations suggested from your spending history', 'info');
  }

  async function save() {
    if (total <= 0) { toast('Enter a total greater than 0', 'error'); return; }
    // Uniqueness guard: prevent creating a duplicate budget for the same period.
    if (!initial) {
      if (form.scope === 'month') {
        const dup = budgets.find(b => b.scope === 'month' && b.periodYear === Number(form.periodYear) && b.periodMonth === Number(form.periodMonth));
        if (dup) {
          toast(`A budget for ${MONTHS[Number(form.periodMonth) - 1]} ${form.periodYear} already exists`, 'error');
          return;
        }
      } else if (form.scope === 'annual') {
        const dup = budgets.find(b => b.scope === 'annual' && b.periodYear === Number(form.periodYear));
        if (dup) {
          toast(`An annual budget for ${form.periodYear} already exists`, 'error');
          return;
        }
      }
    }
    // sum-check: warn (do not block) on over-allocation.
    if (allocSum > total + 0.001) {
      if (!confirm(`Allocations (${fmt(allocSum, form.currency)}) exceed the total (${fmt(total, form.currency)}). Save anyway?`)) return;
    }
    setSaving(true);
    try {
      // Budget-sync fix — write the budget AND its allocations in ONE atomic,
      // online-synchronous RPC. The old two-step (upsertBudget, then a per-row
      // setBudgetAllocations through the optimistic queue) could land the parent
      // but silently dead-letter the children, so allocations never reached the
      // cloud / other devices. The DB still owns identity/dedup (create rejects a
      // taken slot with BUDGET_EXISTS); allocation ids are minted server-side.
      const rows: Partial<BudgetAllocation>[] = form.allocs
        .filter(r => parseFloat(r.amount) > 0)
        .map(r => ({ category: r.category, amount: parseFloat(r.amount) }));
      await saveBudgetWithAllocations({
        id: initial?.id,
        scope: form.scope,
        periodYear: Number(form.periodYear),
        periodMonth: form.scope === 'month' ? Number(form.periodMonth) : undefined,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        limit: total,
        currency: form.currency,
        color: deterministicColor(form.allocs[0]?.category ?? 'other_expense'),
      }, rows);
      toast(initial ? 'Budget updated' : 'Budget added', 'success');
      onClose();
    } catch (e) {
      // The DB authority rejected a duplicate slot — most often another member
      // already created this period's budget and it hasn't synced here yet.
      // Pull fresh so it appears, and tell the user plainly (no scary error).
      if ((e as Error)?.name === 'BudgetExistsError') {
        const label = form.scope === 'month' ? `${MONTHS[Number(form.periodMonth) - 1]} ${form.periodYear}` : `${form.periodYear}`;
        toast(`A budget for ${label} already exists in this household — refreshing to show it.`, 'info');
        try { await manualRefresh(); } catch { /* best-effort */ }
        onClose();
      } else {
        toast(`Save failed: ${(e as Error).message}`, 'error');
      }
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!initial) return;
    if (!confirm('Delete this budget?')) return;
    try { await removeBudget(initial.id); toast('Budget deleted', 'info'); onClose(); }
    catch (e) { toast(`Delete failed: ${(e as Error).message}`, 'error'); }
  }

  const yearOpts = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 1, y, y + 1, y + 2];
  }, []);

  return (
    <Modal open={open} title={initial ? 'Edit Budget' : 'Add Budget'} onClose={onClose}>
      {/* §4.2 — scope leads the form (monthly or annual) */}
      <Field label="Scope">
        <div className="flex gap-2">
          {(['month','annual'] as BudgetScope[]).map(s => (
            <button key={s} type="button" onClick={() => setForm(f => ({ ...f, scope: s }))}
              className={`flex-1 py-2 rounded-md border text-sm capitalize transition-colors ${form.scope === s ? 'border-coral bg-coral/10 text-ink font-medium' : 'border-line text-ink-mid hover:bg-bg3'}`}>
              {s}
            </button>
          ))}
        </div>
      </Field>

      {form.scope === 'month' && (
        <FieldRow>
          <Field label="Month">
            <Select value={form.periodMonth} onChange={e => setForm(f => ({ ...f, periodMonth: e.target.value }))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Year">
            <Select value={form.periodYear} onChange={e => setForm(f => ({ ...f, periodYear: e.target.value }))}>
              {yearOpts.map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
          </Field>
        </FieldRow>
      )}
      {form.scope === 'annual' && (
        <Field label="Year">
          <Select value={form.periodYear} onChange={e => setForm(f => ({ ...f, periodYear: e.target.value }))}>
            {yearOpts.map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
        </Field>
      )}

      <FieldRow>
        <Field label="Total">
          <Input type="number" min="0" step="0.01" value={form.limit} placeholder="500"
            onChange={e => setForm(f => ({ ...f, limit: e.target.value }))} />
        </Field>
        <Field label="Currency">
          <Select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
      </FieldRow>

      {/* §4.1/§4.2 — per-category allocations */}
      <div className="mt-1">
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-mono text-[0.6rem] tracking-wider uppercase text-ink-dim">Category allocations</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={applySuggestions} title="Suggest from spending history"
              className="flex items-center gap-1 text-coral text-xs hover:opacity-70">
              <Sparkles size={12} /> Suggest
            </button>
            <button type="button" onClick={addAlloc} className="text-coral text-xs hover:underline">+ Add category</button>
          </div>
        </div>
        {form.allocs.map((r, i) => (
          <div key={i} className="flex items-center gap-2 mb-1.5">
            <Select value={r.category} onChange={e => setAlloc(i, { category: e.target.value })}>
              {EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
            </Select>
            <Input type="number" min="0" step="0.01" value={r.amount} placeholder="0"
              onChange={e => setAlloc(i, { amount: e.target.value })} />
            <button type="button" onClick={() => removeAlloc(i)} className="text-ink-dim hover:text-terra px-1">✕</button>
          </div>
        ))}
        <div className={`text-[0.72rem] mt-1 ${remaining < -0.001 ? 'text-terra' : 'text-ink-mid'}`}>
          Allocated {fmt(allocSum, form.currency)} of {fmt(total, form.currency)}
          {remaining >= 0
            ? ` · ${fmt(remaining, form.currency)} unallocated`
            : ` · over by ${fmt(-remaining, form.currency)}`}
        </div>
      </div>

      {/* §4.2 — recurring forecast (read-only, A8) */}
      {forecastTotal > 0 && (
        <div className="mt-2 rounded-md border border-line bg-bg2 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[0.78rem] text-ink-mid">
              {fmt(Math.round(forecastTotal), form.currency)} already committed via recurring this period
            </span>
            <button type="button" onClick={prefillFromForecast} className="text-coral text-[0.7rem] hover:underline">Use as allocations</button>
          </div>
          {/* Estimates — shown rounded to whole units; "Use as allocations" applies
              the same rounded figures. Paise here is noise, not signal. */}
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {Object.entries(forecast).map(([c, amt]) => (
              <span key={c} className="text-[0.68rem] text-ink-dim">{getCat(c).icon} {fmt(Math.round(amt), form.currency)}</span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-3">
        {initial ? (
          <button type="button" onClick={del} className="font-mono text-[0.62rem] tracking-wider uppercase text-terra hover:underline">Delete</button>
        ) : <span />}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : initial ? 'Update' : 'Add'}</Button>
        </div>
      </div>
    </Modal>
  );
}
