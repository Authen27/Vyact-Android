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
import { convert, fmt, fmtShort, today } from '../lib/format';
import { spendByCategoryInRange, cumulativeSpendSeries } from '../lib/calculations';

import { getCat } from '../constants';
import Money from '../components/ui/Money';
import BudgetPaceChart from '../components/budgets/BudgetPaceChart';
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
  // Board C — the current-month budget drives the pace hero.
  const currentMonthRow = rows.find(r => r.b.scope === 'month'
    && r.b.periodYear === now.getFullYear() && r.b.periodMonth === now.getMonth() + 1);

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

      {/* Board C M1/D1 — current-month pace hero: a cumulative-spend-vs-limit
          chart (dashed limit line · today dot · dotted run-rate projection)
          over a left accent spine, with a plain-language daily allowance and
          the overall-usage trough beneath. */}
      {currentMonthRow && (() => {
        const { b, allocs, totalBase, spent } = currentMonthRow;
        const overall = pct(spent, totalBase);
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const daysLeft = Math.max(1, daysInMonth - now.getDate() + 1);
        const remaining = totalBase - spent;
        const perDay = remaining / daysLeft;
        // Cumulative series across the budget's allocated categories, day 1 → today.
        const catSet = new Set(allocs.map(a => a.category));
        const todayStr = today();
        const upto = b.periodEnd && todayStr > b.periodEnd ? b.periodEnd : todayStr;
        const series = (b.periodStart && catSet.size)
          ? cumulativeSpendSeries(transactions, catSet, b.periodStart, upto, cur, rates)
          : [];
        const dayNum = series.length || now.getDate();
        const lastCum = series.length ? series[series.length - 1].cumulative : spent;
        const projectedEnd = dayNum ? (lastCum / dayNum) * daysInMonth : 0;
        const projUnder = totalBase - projectedEnd;
        const status = overall >= 100 ? { label: 'over', tone: 'terra' }
          : overall >= 80 ? { label: 'watch', tone: 'honey' }
          : { label: 'on pace', tone: 'sage' };
        return (
          <div className="relative rounded-r3 p-5 mb-4 overflow-hidden" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
            <span className="absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded-full" style={{ background: 'var(--accent)' }} />
            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0">
                <div className="mono-label mb-1.5">{budgetTitle(b)} · month budget</div>
                <div className="num font-bold text-[30px] leading-tight tracking-tight text-ink">{fmt(Math.max(remaining, 0), cur)}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <span className={`inline-flex items-center px-2.5 py-1 rounded-pill text-[11.5px] font-display font-semibold text-${status.tone}`}
                  style={{ background: `color-mix(in srgb, hsl(var(--${status.tone})) 16%, transparent)` }}>
                  {status.label}
                </span>
                {canManage && (
                  <button onClick={() => openEditBudget(b)} className="block ml-auto mt-2 font-mono text-[8.5px] tracking-wider uppercase text-ink-dim hover:text-coral">edit ▸</button>
                )}
              </div>
            </div>
            <div className="text-[12.5px] text-ink-dim mt-1 mb-2">
              left of <b className="num text-ink-mid">{fmt(totalBase, cur)}</b> ·{' '}
              {remaining <= 0
                ? <b className="text-terra">{fmt(Math.abs(remaining), cur)} over</b>
                : <b className="text-sage">{fmt(perDay, cur)}/day keeps you green</b>}
              {' '}· {daysLeft} day{daysLeft === 1 ? '' : 's'} to go
            </div>
            <BudgetPaceChart series={series} limit={totalBase} daysInMonth={daysInMonth} currency={cur} />
            <div className="flex justify-between font-mono text-[8px] tracking-[0.08em] uppercase text-ink-dim mt-1 mb-2">
              <span>{MONTHS[now.getMonth()]} 1</span>
              <span className={projUnder >= 0 ? 'text-sage' : 'text-terra'}>
                projected · lands {fmtShort(Math.abs(projUnder), cur)} {projUnder >= 0 ? 'under' : 'over'}
              </span>
              <span>{MONTHS[now.getMonth()]} {daysInMonth}</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
              <div className={`h-full rounded-full chart-grow ${barCls(overall)}`} style={{ width: `${overall}%` }} />
            </div>
          </div>
        );
      })()}

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
              <div key={b.id} className="rounded-r3 p-4 min-w-0" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
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
                  <div className={`h-full rounded-full chart-grow transition-all ${barCls(overall)}`} style={{ width: `${overall}%` }} />
                </div>
                {/* allocations */}
                {allocs.length === 0 ? (
                  <p className="text-[0.74rem] text-ink-dim">No category allocations — edit to add some.</p>
                ) : (
                  <div className="space-y-1.5">
                    {allocs.map((a, ai) => {
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
                            <div className={`h-full rounded-full chart-grow ${barCls(ap)}`} style={{ width: `${ap}%`, animationDelay: `${ai * 60}ms` }} />
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
