// Vyact v9.1 §4 — BudgetFormModal (rebuilt).
//
// A budget now has a STRICT identity (scope + year + month) so it is the SAME
// budget on every device (fixes the item-2 cross-device divergence). It is a
// PERIOD CONTAINER whose total is split into per-category allocation child rows
// (cloud-synced, not jsonb). A read-only recurring-forecast line shows what's
// already committed via recurring schedules over the period (money-model A8).

import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import FormPage from '../ui/FormPage';
import { Input } from '../ui/Input';
import Chip from '../ui/Chip';
import { AmountField } from '../ui/NumericKeypad';
import { parseAmount } from '../../lib/amountInput';
import { useStore } from '../../store';
import { fmt } from '../../lib/format';
import { resolveBudgetPeriod, recurringForecastByCategory } from '../../lib/calculations';
import { suggestBudget, budgetCategoryOf } from '../../lib/budgetIntel';
import { loanEmiForecast } from '../../lib/loanRecurring';
import { EXPENSE_CATEGORIES, getCat, deterministicColor, CURRENCIES as CURRENCY_MAP } from '../../constants';
import type { Budget, BudgetScope, BudgetAllocation } from '../../types';
import { confirmSheet } from '../../lib/confirmSheet';
import { deleteBudgetRequest } from '../../lib/confirmCopy';
import { budgetTitle, trimAllocations } from '../../lib/budgetForm';

/** v10.28.0 — rendered as the /budgets/new and /budgets/:id/edit pages. */
interface Props { open?: boolean; initial?: Budget | null; onClose: () => void; }

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
  const budgets      = useStore(s => s.budgets);
  const transactions = useStore(s => s.transactions);
  const debts        = useStore(s => s.debts);
  const accounts     = useStore(s => s.accounts);
  const saveBudgetWithAllocations = useStore(s => s.saveBudgetWithAllocations);
  const removeBudget = useStore(s => s.removeBudget);
  const manualRefresh = useStore(s => s.manualRefresh);
  const toast        = useStore(s => s.toast);

  const open    = props.open ?? true;
  const initial = props.initial ?? null;
  const onClose = props.onClose;

  const [form, setForm]     = useState<FormState>(blank(profile.baseCurrency));
  const [saving, setSaving] = useState(false);

  // 🔴 HYDRATE ON OPEN ONLY.
  //
  // `allocations` used to be a dependency here. It is the store's
  // budgetAllocations array, which takes a NEW IDENTITY on every sync poll, so
  // this effect re-ran mid-edit and called setForm() — wiping whatever the user
  // had typed. For a new budget that meant setForm(blank()). That is the
  // reported "adding budget by category ... reset the already filled info".
  //
  // The allocations are read imperatively instead, so they are still current at
  // the moment the sheet opens without making the form hostage to store churn.
  useEffect(() => {
    if (!open) return;
    const currentAllocations = useStore.getState().budgetAllocations;
    if (initial) {
      // W4h (D27): only categories the form shows. A legacy id is read as its current one (summed into
      // it); a line the form cannot show (`savings` from the retired Goals, an income id) is not
      // carried — it was counted in "Allocated" and saved again without ever being visible.
      const byCategory = new Map<string, number>();
      for (const a of currentAllocations.filter(x => x.budgetId === initial.id)) {
        const category = budgetCategoryOf(a.category);
        if (category) byCategory.set(category, (byCategory.get(category) ?? 0) + a.amount);
      }
      const rows = [...byCategory].map(([category, amount]) => ({ category, amount: String(Math.round(amount * 100) / 100) }));
      setForm({
        // Coerce any legacy 'custom' row to 'month' (custom budgets removed).
        scope: initial.scope === 'annual' ? 'annual' : 'month',
        periodYear: String(initial.periodYear ?? new Date().getFullYear()),
        periodMonth: String(initial.periodMonth ?? new Date().getMonth() + 1),
        limit: String(initial.limit ?? ''),
        currency: profile.baseCurrency,   // W3b: one currency per household
        allocs: rows,
      });
    } else {
      setForm(blank(profile.baseCurrency));
    }
    // Deliberately NOT depending on `allocations` — see above. `initial` is a
    // store object whose identity also churns, so key on its id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id, profile.baseCurrency]);

  // resolved period range for the current form state
  const period = useMemo(
    () => resolveBudgetPeriod(form.scope, Number(form.periodYear), Number(form.periodMonth)),
    [form.scope, form.periodYear, form.periodMonth],
  );

  const allocSum = form.allocs.reduce((s, r) => s + (parseAmount(r.amount) || 0), 0);
  const total = parseAmount(form.limit) || 0;
  const remaining = total - allocSum;

  // §4.2 — read-only recurring forecast: committed-by-recurring per category.
  // Track E, E6a (owner, E-4): each live loan's EMIs on their real dates in the period join it, under
  // Loan / EMI, now that Recurring shows them (lib/loanRecurring; a loan is never a schedule).
  const forecast = useMemo(() => {
    if (!period.periodStart || !period.periodEnd) return {} as Record<string, number>;
    const byCategory = recurringForecastByCategory(recurring, period.periodStart, period.periodEnd, form.currency, rates);
    const emis = loanEmiForecast(debts, accounts, transactions, period.periodStart, period.periodEnd, form.currency);
    return emis > 0 ? { ...byCategory, loan_emi: Math.round(((byCategory.loan_emi ?? 0) + emis) * 100) / 100 } : byCategory;
  }, [recurring, debts, accounts, transactions, period.periodStart, period.periodEnd, form.currency, rates]);
  const forecastTotal = Object.values(forecast).reduce((s, n) => s + n, 0);

  // Defect 3 — every expense category is present, always. The old model made
  // you press "＋ Add category" for each one and pick it from a dropdown, which
  // is why budgets ended up covering a handful of categories: the interaction
  // cost scaled with how thorough you were.
  //
  // It also made a DUPLICATE category reachable — `addAlloc` fell back to
  // 'other_expense' once every category was used, and two rows with the same
  // category violate `uq_balloc_cat` at save time (23505). One row per
  // category makes that unrepresentable rather than merely unlikely.
  function setAmountFor(category: string, amount: string) {
    setForm(f => {
      const i = f.allocs.findIndex(r => r.category === category);
      if (i === -1) return { ...f, allocs: [...f.allocs, { category, amount }] };
      return { ...f, allocs: f.allocs.map((r, idx) => idx === i ? { ...r, amount } : r) };
    });
  }
  // FB1 — the two fixes the over-total note offers.
  const raiseTotal = () => setForm(f => ({ ...f, limit: String(Math.round(allocSum * 100) / 100) }));
  const trimToTotal = () => setForm(f => {
    const trimmed = trimAllocations(f.allocs.map(r => parseAmount(r.amount) || 0), total);
    return { ...f, allocs: f.allocs.map((r, i) => ({ ...r, amount: trimmed[i] > 0 ? String(trimmed[i]) : r.amount && parseAmount(r.amount) > 0 ? '0' : r.amount })) };
  });
  const amountFor = (category: string) =>
    form.allocs.find(r => r.category === category)?.amount ?? '';
  // W4h (owner decision D27) — applying a proposal sets the TOTAL to what it allocates. Keeping a total
  // typed earlier (`f.limit || …`) is how a large total met a small split; it stays editable afterwards,
  // and whatever is not allocated shows as Unallocated.
  function prefillFromForecast() {
    const byCategory = new Map<string, number>();
    for (const [raw, amount] of Object.entries(forecast)) {
      const category = budgetCategoryOf(raw);
      if (category) byCategory.set(category, (byCategory.get(category) ?? 0) + Math.round(amount));
    }
    const rows: AllocRow[] = [...byCategory].map(([category, amount]) => ({ category, amount: String(amount) }));
    if (rows.length) setForm(f => ({ ...f, allocs: rows, limit: String([...byCategory.values()].reduce((s, n) => s + n, 0)) }));
  }

  function applySuggestions() {
    const suggestions = suggestBudget({ transactions, debts, recurring, baseCurrency: form.currency, rates });
    if (!suggestions.length) { toast('Not enough spending history to suggest yet', 'info'); return; }
    const rows: AllocRow[] = suggestions.map(s => ({ category: s.category, amount: String(s.limit) }));
    const suggestedTotal = suggestions.reduce((sum, s) => sum + s.limit, 0);
    setForm(f => ({ ...f, allocs: rows, limit: String(suggestedTotal) }));
    toast('Allocations suggested from your bills, loans and spending. The total is their sum — change it if you like.', 'info');
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
    // Aurora 4.0 FB1 — going over the total is shown while editing (the amber note with Raise total /
    // Trim allocations), so Save no longer stops to ask "Save anyway?". It still saves as typed.
    setSaving(true);
    try {
      // Budget-sync fix — write the budget AND its allocations in ONE atomic,
      // online-synchronous RPC. The old two-step (upsertBudget, then a per-row
      // setBudgetAllocations through the optimistic queue) could land the parent
      // but silently dead-letter the children, so allocations never reached the
      // cloud / other devices. The DB still owns identity/dedup (create rejects a
      // taken slot with BUDGET_EXISTS); allocation ids are minted server-side.
      // W4h (D27): never a row the form does not show.
      const rows: Partial<BudgetAllocation>[] = form.allocs
        .filter(r => parseAmount(r.amount) > 0 && budgetCategoryOf(r.category) === r.category)
        .map(r => ({ category: r.category, amount: parseAmount(r.amount) }));
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
        try { await manualRefresh(); } catch { /* fault-ok: a refresh only re-reads; the next poll reads again */ }
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
    // Aurora 4.0 CF6.
    const allocations = useStore.getState().budgetAllocations.filter(a => a.budgetId === initial.id && a.amount > 0).length;
    if (!(await confirmSheet(deleteBudgetRequest({ label: budgetTitle(initial), allocations })))) return;
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
        className="btn-primary w-full h-[50px] text-[15.5px] rounded-r3 disabled:opacity-60">
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
    <FormPage open={open} title={initial ? 'Edit Budget' : 'Add Budget'} onClose={onClose} footer={footer} helpTopicId="budget">
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
        <div className="space-y-1.5">
          {EXPENSE_CATEGORIES.map((cc) => {
            const value = amountFor(cc.id);
            const filled = (parseFloat(value) || 0) > 0;
            return (
              <div key={cc.id}
                className="flex items-center gap-2.5 px-3 py-2 rounded-r2"
                style={{
                  background: 'var(--canvas)',
                  boxShadow: filled ? 'var(--neu-inset)' : 'var(--neu-sm)',
                }}>
                <span className="text-base leading-none flex-shrink-0" aria-hidden>{cc.icon}</span>
                <span className={`flex-1 min-w-0 text-[14px] leading-snug ${filled ? 'text-ink font-medium' : 'text-ink-mid'}`}>
                  {cc.label}
                </span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-ink-dim text-[12.5px]">{currencySymbol}</span>
                  <Input type="number" min="0" step="0.01" value={value} placeholder="0"
                    aria-label={`Budget for ${cc.label}`}
                    onChange={e => setAmountFor(cc.id, e.target.value)}
                    className="!h-[32px] !py-0 !w-[92px] text-right num text-[12.5px]" />
                </div>
              </div>
            );
          })}
        </div>
        {/* W4h (owner decision D27) — what the total leaves unallocated, as a line of its own. */}
        <div className="flex items-center gap-2.5 px-3 py-2 mt-1.5 rounded-r2" data-testid="budget-unallocated"
          style={{ background: 'var(--well-bg)', boxShadow: 'var(--well-shadow)', border: '1px solid var(--well-border)' }}>
          <span className="text-base leading-none flex-shrink-0" aria-hidden>{remaining < -0.001 ? '⚠️' : '◌'}</span>
          <span className={`flex-1 text-[14px] ${remaining < -0.001 ? 'text-terra font-medium' : 'text-ink-mid'}`}>
            {remaining < -0.001 ? 'Over the total by' : 'Unallocated'}
          </span>
          <span className={`num text-[13px] ${remaining < -0.001 ? 'text-terra' : 'text-ink'}`}>{fmt(Math.abs(remaining), form.currency)}</span>
        </div>
        <div className="text-[0.72rem] mt-1.5 text-ink-dim">
          Allocated {fmt(allocSum, form.currency)} of {fmt(total, form.currency)}
        </div>
        {remaining < -0.001 && total > 0 && (
          <div role="status" data-testid="budget-over-total" className="mt-2 rounded-r2 px-3 py-2.5 text-[13px]"
            style={{ background: 'color-mix(in srgb, hsl(var(--honey)) 12%, transparent)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, hsl(var(--honey)) 28%, transparent)' }}>
            <p className="text-ink">Allocations are {fmt(-remaining, form.currency)} over the total.</p>
            <div className="flex flex-wrap gap-x-4 mt-1">
              <button type="button" onClick={raiseTotal} className="min-h-[44px] font-medium" style={{ color: 'var(--warn-text)' }}>
                Raise total to {fmt(allocSum, form.currency)}
              </button>
              <button type="button" onClick={trimToTotal} className="min-h-[44px] font-medium" style={{ color: 'var(--warn-text)' }}>
                Trim allocations
              </button>
            </div>
          </div>
        )}
      </div>

      {/* §4.2 — recurring forecast (read-only, A8) */}
      {forecastTotal > 0 && (
        <div className="mt-2 rounded-md border border-line bg-bg2 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[0.78rem] text-ink-mid">
              {fmt(Math.round(forecastTotal), form.currency)} already committed via recurring bills and loan EMIs this period
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

    </FormPage>
  );
}
