// Vyact v9.1 §4 — BudgetFormModal (rebuilt).
//
// A budget now has a STRICT identity (scope + year + month) so it is the SAME
// budget on every device (fixes the item-2 cross-device divergence). It is a
// PERIOD CONTAINER whose total is split into per-category allocation child rows
// (cloud-synced, not jsonb). A read-only recurring-forecast line shows what's
// already committed via recurring schedules over the period (money-model A8).

import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import HalfSheet from '../ui/HalfSheet';
import { Input, Select } from '../ui/Input';
import Chip from '../ui/Chip';
import { AmountField } from '../ui/NumericKeypad';
import { useStore } from '../../store';
import { fmt } from '../../lib/format';
import { resolveBudgetPeriod, recurringForecastByCategory } from '../../lib/calculations';
import { suggestBudget } from '../../lib/budgetIntel';
import { EXPENSE_CATEGORIES, getCat, deterministicColor, CURRENCIES as CURRENCY_MAP } from '../../constants';
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

  const currencySymbol = CURRENCY_MAP[form.currency]?.symbol ?? '$';

  // Board M2 — period is a chip row: the next six months + two annual years.
  // If the form is bound to a period outside that window (e.g. editing an
  // older budget) we prepend its chip so the selection stays representable.
  const periodChips = useMemo(() => {
    const base = new Date();
    const out: { scope: BudgetScope; year: number; month?: number; label: string }[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      out.push({ scope: 'month', year: d.getFullYear(), month: d.getMonth() + 1, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` });
    }
    out.push({ scope: 'annual', year: base.getFullYear(), label: `Annual ${base.getFullYear()}` });
    out.push({ scope: 'annual', year: base.getFullYear() + 1, label: `Annual ${base.getFullYear() + 1}` });
    const selMatch = out.some(o => o.scope === form.scope && o.year === Number(form.periodYear)
      && (o.scope === 'annual' || o.month === Number(form.periodMonth)));
    if (!selMatch) {
      out.unshift(form.scope === 'annual'
        ? { scope: 'annual', year: Number(form.periodYear), label: `Annual ${form.periodYear}` }
        : { scope: 'month', year: Number(form.periodYear), month: Number(form.periodMonth), label: `${MONTHS[Number(form.periodMonth) - 1]} ${form.periodYear}` });
    }
    return out;
  }, [form.scope, form.periodYear, form.periodMonth]);

  // Board M2 footer — a single full-width primary that names the allocated
  // total, with the "stays flexible" honesty note (create) or Delete (edit)
  // as a quiet cap below.
  const footer = (
    <div>
      <button type="button" onClick={save} disabled={saving}
        className="btn-primary w-full h-[50px] text-[15.5px] rounded-[15px] disabled:opacity-60">
        {saving ? 'Saving…' : initial ? 'Update budget' : `Create budget · ${fmt(allocSum, form.currency)} allocated`}
      </button>
      <div className="text-center mt-2">
        {initial ? (
          <button type="button" onClick={del}
            className="font-mono text-[9px] tracking-[0.15em] uppercase text-terra hover:underline">
            Delete
          </button>
        ) : (
          <span className="font-mono text-[8.5px] tracking-[0.12em] uppercase text-ink-dim">
            {remaining >= 0
              ? `${fmt(remaining, form.currency)} stays flexible — allocate any time`
              : `over by ${fmt(-remaining, form.currency)}`}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <HalfSheet open={open} title={initial ? 'Edit Budget' : 'Add Budget'} onClose={onClose} footer={footer}>
      {/* Board M2 — period chips (forms doctrine: chips, not scope buttons +
          month/year dropdowns). */}
      <div className="mb-4">
        <div className="mono-label mb-1.5">Period</div>
        <div className="flex gap-1.5 flex-wrap">
          {periodChips.map(p => {
            const on = form.scope === p.scope && Number(form.periodYear) === p.year
              && (p.scope === 'annual' || Number(form.periodMonth) === p.month);
            return (
              <Chip key={`${p.scope}-${p.year}-${p.month ?? 'y'}`} on={on}
                onClick={() => setForm(f => ({ ...f, scope: p.scope, periodYear: String(p.year), periodMonth: String(p.month ?? f.periodMonth) }))}>
                {p.label}
              </Chip>
            );
          })}
        </div>
      </div>

      {/* Board M2 — one big total (amount hero). */}
      <div className="mb-1">
        <div className="mono-label mb-1.5">Total</div>
        <div className="py-1">
          <AmountField value={form.limit} currencySymbol={currencySymbol}
            onChange={v => setForm(f => ({ ...f, limit: v }))} />
        </div>
        {form.currency !== profile.baseCurrency && (
          <p className="text-center text-[0.72rem] text-ink-dim">Recorded in {form.currency}.</p>
        )}
      </div>

      {/* Board M2 — allocations as tappable neu rows (pip suggests via Suggest). */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="mono-label">Allocations</span>
          <button type="button" onClick={applySuggestions} title="Suggest from spending history"
            className="flex items-center gap-1 text-coral text-[0.72rem] hover:opacity-70">
            <Sparkles size={12} /> Suggest
          </button>
        </div>
        <div className="space-y-2">
          {form.allocs.map((r, i) => {
            const c = getCat(r.category);
            return (
              <div key={i} className="flex items-center gap-2.5 px-3 py-2.5 rounded-r2" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
                <span className="text-base leading-none flex-shrink-0" aria-hidden>{c.icon}</span>
                <Select value={r.category} onChange={e => setAlloc(i, { category: e.target.value })}
                  className="flex-1 min-w-0 !h-[32px] !py-0 text-[12.5px]">
                  {EXPENSE_CATEGORIES.map(cc => <option key={cc.id} value={cc.id}>{cc.icon} {cc.label}</option>)}
                </Select>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-ink-dim text-[12.5px]">{currencySymbol}</span>
                  <Input type="number" min="0" step="0.01" value={r.amount} placeholder="0"
                    onChange={e => setAlloc(i, { amount: e.target.value })}
                    className="!h-[32px] !py-0 !w-[84px] text-right num text-[12.5px]" />
                </div>
                <button type="button" onClick={() => removeAlloc(i)} aria-label="Remove allocation"
                  className="text-ink-dim hover:text-terra px-0.5 flex-shrink-0">✕</button>
              </div>
            );
          })}
          <button type="button" onClick={addAlloc}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-r2 text-coral font-display font-semibold text-[12.5px] border-none cursor-pointer"
            style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
            ＋ Add category
          </button>
        </div>
        <div className={`text-[0.72rem] mt-2 ${remaining < -0.001 ? 'text-terra' : 'text-ink-dim'}`}>
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

    </HalfSheet>
  );
}
