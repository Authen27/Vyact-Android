// Vyact v9.1 §4 — Budgets page (rebuilt for the container + allocations model).
// A budget renders its EXPLICIT identity (month+year / year / custom name), its
// per-category allocation bars, and an overall bar. Clicking a budget (or a
// category within it) deep-links to the pre-filtered Transactions view (§8).

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Trash2, Sparkles } from 'lucide-react';
import { useStore } from '../store';
import { can } from '../lib/permissions';
import { useTranslation } from '../hooks';
import { Panel } from '../components/ui/Card';
import { convert } from '../lib/format';
import { spendByCategoryInRange } from '../lib/calculations';

import { getCat } from '../constants';
import Money from '../components/ui/Money';
import type { Budget } from '../types';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function budgetTitle(b: Budget): string {
  if (b.scope === 'annual') return `${b.periodYear}`;
  if (b.scope === 'month' && b.periodMonth) return `${MONTHS[b.periodMonth - 1]} ${b.periodYear}`;
  // legacy fallback
  return b.periodStart ? `${b.periodStart} → ${b.periodEnd}` : 'Budget';
}
function pct(spent: number, limit: number) { return limit > 0 ? Math.min((spent / limit) * 100, 100) : 0; }
function barCls(p: number) { return p >= 100 ? 'bg-terra' : p >= 80 ? 'bg-honey' : 'bg-sage'; }

export default function Budgets() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const budgets       = useStore(s => s.budgets);
  const allocations   = useStore(s => s.budgetAllocations);
  const transactions  = useStore(s => s.transactions);
  const profile       = useStore(s => s.profile);
  const rates         = useStore(s => s.rates);
  const openAddBudget  = useStore(s => s.openAddBudget);
  const openEditBudget = useStore(s => s.openEditBudget);
  const removeBudget   = useStore(s => s.removeBudget);
  const toast          = useStore(s => s.toast);
  const myRole         = useStore(s => s.myRole);
  // v9.5.0 — budgets are managed only by the household owner/admin; members view.
  const canManage      = can(myRole, 'manage_budgets');

  const cur = profile.baseCurrency;

  // per-budget resolved view: total, allocations with spend, overall spend.
  const rows = useMemo(() => budgets.map(b => {
    const start = b.periodStart || '';
    const end = b.periodEnd || '';
    const spendMap = start && end ? spendByCategoryInRange(transactions, start, end, cur, rates) : {};
    const allocs = allocations.filter(a => a.budgetId === b.id).map(a => ({
      ...a,
      limitBase: convert(a.amount, b.currency, cur, rates),
      spent: spendMap[a.category] || 0,
    }));
    const totalBase = convert(b.limit, b.currency, cur, rates);
    const spent = allocs.reduce((s, a) => s + a.spent, 0);
    return { b, allocs, totalBase, spent };
  }), [budgets, allocations, transactions, cur, rates]);

  // §4.2 — nudge: no budget for the CURRENT month.
  const now = new Date();
  const hasCurrentMonth = budgets.some(b => b.scope === 'month'
    && b.periodYear === now.getFullYear() && b.periodMonth === now.getMonth() + 1);

  async function del(id: string) {
    if (!confirm('Delete this budget?')) return;
    await removeBudget(id);
    toast('Budget removed', 'info');
  }

  return (
    <div>
      <div className="flex justify-between items-start mb-5 gap-4">
        <div className="min-w-0">
          <h1 className="display-italic text-4xl text-ink mb-1.5">{t('budgets')}</h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            Month, annual &amp; custom plans · per-category allocations
          </p>
        </div>
        {canManage
          ? <button className="btn-primary flex-shrink-0" onClick={openAddBudget}>+ Add Budget</button>
          : <span className="flex-shrink-0 font-mono text-[0.6rem] tracking-[0.12em] uppercase text-ink-dim border border-line rounded-md px-2.5 py-1.5 self-center" title="Budgets are managed by the household owner or admin">View only</span>}
      </div>

      {/* §4.2 — create nudge for the current month (owner/admin only) */}
      {!hasCurrentMonth && canManage && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-coral/30 bg-coral/[0.06] px-4 py-3">
          <span className="text-[0.86rem] text-ink">
            <Sparkles size={14} className="inline mr-1.5 -mt-0.5 text-coral" />
            No budget for {MONTHS[now.getMonth()]} {now.getFullYear()} yet.
          </span>
          <button className="btn-secondary text-sm" onClick={openAddBudget}>Create {MONTHS[now.getMonth()]} {now.getFullYear()}</button>
        </div>
      )}

      {rows.length === 0 ? (
        <Panel>
          <div className="px-6 py-14 text-center">
            <div className="text-4xl mb-3 opacity-60">◎</div>
            <p className="text-ink-mid mb-4">{canManage ? 'No budgets yet. Add one to start tracking your spending.' : 'No budgets yet. The household owner or admin can add one.'}</p>
            {canManage && <button className="btn-primary" onClick={openAddBudget}>Add First Budget</button>}
          </div>
        </Panel>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          {rows.map(({ b, allocs, totalBase, spent }) => {
            const overall = pct(spent, totalBase);
            return (
              <div key={b.id} className="bg-bg border border-line rounded-xl p-4 min-w-0">
                <div className="flex items-start justify-between mb-2 gap-2">
                  <button onClick={() => navigate(`/transactions?budgetId=${b.id}`)}
                    className="font-semibold text-ink text-[0.95rem] truncate hover:text-coral text-left" title="View transactions">
                    {budgetTitle(b)}
                  </button>
                  {canManage && (
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => openEditBudget(b)} className="row-action" aria-label="Edit budget" title="Edit"><Pencil size={14} strokeWidth={1.6} /></button>
                      <button onClick={() => del(b.id)} className="row-action danger" aria-label="Delete budget" title="Delete"><Trash2 size={14} strokeWidth={1.6} /></button>
                    </div>
                  )}
                </div>
                {/* overall */}
                <div className="flex justify-between items-center text-[0.8rem] mb-1">
                  <span className="text-ink-mid">
                    <Money amount={spent} currency={cur} className="font-semibold text-ink" maxChars={9} />
                    <span className="text-ink-dim"> / </span>
                    <Money amount={totalBase} currency={cur} maxChars={9} />
                  </span>
                  <span className={overall >= 100 ? 'text-terra font-medium' : 'text-ink-dim'}>{Math.round(overall)}%</span>
                </div>
                <div className="h-2 bg-bg3 rounded-full mb-3 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${barCls(overall)}`} style={{ width: `${overall}%` }} />
                </div>
                {/* allocations */}
                {allocs.length === 0 ? (
                  <p className="text-[0.74rem] text-ink-dim">No category allocations — edit to add some.</p>
                ) : (
                  <div className="space-y-1.5">
                    {allocs.map(a => {
                      const ap = pct(a.spent, a.limitBase);
                      const c = getCat(a.category);
                      return (
                        <button key={a.id} onClick={() => navigate(`/transactions?budgetId=${b.id}&cat=${a.category}`)}
                          className="w-full text-left group">
                          <div className="flex justify-between items-center text-[0.74rem] mb-0.5">
                            <span className="text-ink-mid group-hover:text-coral truncate">{c.icon} {c.label}</span>
                            <span className="text-ink-dim flex-shrink-0">
                              <Money amount={a.spent} currency={cur} maxChars={7} /> / <Money amount={a.limitBase} currency={cur} maxChars={7} />
                            </span>
                          </div>
                          <div className="h-1.5 bg-bg3 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${barCls(ap)}`} style={{ width: `${ap}%` }} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
