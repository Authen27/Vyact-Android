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
import { fmt, fmtShort, today } from '../lib/format';
import { cumulativeSpendSeries } from '../lib/calculations';
import { budgetProgress } from '../lib/budgetProgress';

import { getCat } from '../constants';
import Money from '../components/ui/Money';
import BudgetPaceChart from '../components/budgets/BudgetPaceChart';
import { sortBudgetsForDisplay } from '../lib/budgetOrdering';
import PageHead from '../components/ui/PageHead';
import EmptyState from '../components/ui/EmptyState';
import { confirmSheet } from '../lib/confirmSheet';
import { deleteBudgetRequest } from '../lib/confirmCopy';
import { budgetTitle } from '../lib/budgetForm';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// v10.22.1 — the displayed percentage and the bar width are NOT the same number.
//
// `pct` used to clamp at 100 and feed both, so ₹350 spent against a ₹300 budget
// read "100%" — identical to spending exactly ₹300. The magnitude of an overrun,
// which is the one thing a budget card exists to tell you, was invisible; only
// the terra tint distinguished the two.
//
// The clamp was there for the bar (a width over 100% overflows its trough), so
// it stays — on the bar alone. The number now tells the truth.
function pct(spent: number, limit: number) { return limit > 0 ? (spent / limit) * 100 : 0; }
function barPct(p: number) { return Math.min(p, 100); }
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

  // §4.2 — nudge: no budget for the CURRENT month.
  const now = new Date();
  const nowKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

  // per-budget resolved view: total, allocations with spend, overall spend.
  // v10.27.2 — budgets run current month → oldest (lib/budgetOrdering), and the
  // categories inside each run most-utilised first. Display order only.
  // Track E, E5 (owner, E-6): the ONE budget-progress basis (lib/budgetProgress.ts). The total counts ALL
  // spending in the budget's period (it used to subtract only allocated spending from the full total), each
  // line is measured over the budget's own period, and spending nothing was allocated to is listed as
  // "not planned".
  const rows = useMemo(() => sortBudgetsForDisplay(budgets, new Date()).map(b => ({
    b,
    p: budgetProgress(b, allocations, transactions, { baseCurrency: cur, rates }),
    allocationCount: allocations.filter(a => a.budgetId === b.id).length,
    // nowKey re-sorts when the month rolls over while the page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [budgets, allocations, transactions, cur, rates, nowKey]);
  const hasCurrentMonth = budgets.some(b => b.scope === 'month'
    && b.periodYear === now.getFullYear() && b.periodMonth === now.getMonth() + 1);
  // Board C — the current-month budget drives the pace hero.
  const currentMonthRow = rows.find(r => r.b.scope === 'month'
    && r.b.periodYear === now.getFullYear() && r.b.periodMonth === now.getMonth() + 1);

  // Aurora 4.0 CF6 — names the budget, its allocations, and that the spending stays.
  async function del(id: string) {
    const row = rows.find(r => r.b.id === id);
    if (!row) return;
    const ok = await confirmSheet(deleteBudgetRequest({
      label: budgetTitle(row.b),
      allocations: row.allocationCount,
      spent: row.p.spent > 0 ? fmt(row.p.spent, cur) : undefined,
      period: row.b.scope === 'annual' ? `${row.b.periodYear} spending` : `${budgetTitle(row.b)} spending`,
    }));
    if (!ok) return;
    await removeBudget(id);
    toast('Budget removed', 'info');
  }

  return (
    <div className="ui-pilot">
      <PageHead
        title={t('budgets')}
        subtitle="Month and annual plans · per-category allocations"
        action={canManage ? { label: '+ Add Budget', entity: 'budget', onClick: openAddBudget } : undefined}
        aside={!canManage && (
          <span className="ui-label well px-2.5 py-1.5" title="Budgets are managed by the household owner or admin">View only</span>
        )}
      />

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
        const { b, p } = currentMonthRow;
        const totalBase = p.limit;
        const spent = p.spent;
        const overall = p.pct;
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const daysLeft = Math.max(1, daysInMonth - now.getDate() + 1);
        const remaining = p.left;
        const perDay = remaining / daysLeft;
        // Cumulative series of ALL spending (the total's basis, E5), day 1 → today.
        const todayStr = today();
        const upto = todayStr > p.end ? p.end : todayStr;
        const series = cumulativeSpendSeries(transactions, null, p.start, upto, cur, rates);
        const dayNum = series.length || now.getDate();
        const lastCum = series.length ? series[series.length - 1].cumulative : spent;
        const projectedEnd = dayNum ? (lastCum / dayNum) * daysInMonth : 0;
        const projUnder = totalBase - projectedEnd;
        const status = overall >= 100 ? { label: 'over', tone: 'terra' }
          : overall >= 80 ? { label: 'watch', tone: 'honey' }
          : { label: 'on pace', tone: 'sage' };
        return (
          <div className="card-raised p-5 mb-4 overflow-hidden" data-testid="budget-hero">
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
                  <div className="flex justify-end gap-1 mt-1.5">
                    <button onClick={() => openEditBudget(b)} className="row-action" aria-label={`Edit the ${budgetTitle(b)} budget`} title="Edit"><Pencil size={14} strokeWidth={1.6} /></button>
                    <button onClick={() => del(b.id)} className="row-action danger" aria-label={`Delete the ${budgetTitle(b)} budget`} title="Delete"><Trash2 size={14} strokeWidth={1.6} /></button>
                  </div>
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
            <div className="flex justify-between gap-2 text-[11px] text-ink-dim mt-1 mb-2">
              <span>{MONTHS[now.getMonth()]} 1</span>
              <span className={projUnder >= 0 ? 'text-sage' : 'text-terra'}>
                projected · lands {fmtShort(Math.abs(projUnder), cur)} {projUnder >= 0 ? 'under' : 'over'}
              </span>
              <span>{MONTHS[now.getMonth()]} {daysInMonth}</span>
            </div>
            <div className="trough h-1.5">
              <div className={`h-full rounded-full chart-grow ${barCls(overall)}`} style={{ width: `${barPct(overall)}%` }} />
            </div>
          </div>
        );
      })()}

      {rows.length === 0 ? (
        <Panel>
          <EmptyState icon="🎯" title="No budgets yet"
            message={canManage ? 'Set one for this month and each category shows what is left as you spend.' : 'The household owner or an admin can set one; it shows here when they do.'}
            action={canManage ? { label: 'Set a budget', onClick: openAddBudget } : undefined}
            hint={canManage ? 'or ask Pip: "suggest a budget from last month"' : undefined} />
        </Panel>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          {rows.map(({ b, p }) => {
            const { limit: totalBase, spent, lines: allocs, notPlanned } = p;
            const overall = p.pct;
            return (
              <div key={b.id} data-testid="budget-card" className="tile !rounded-r3 p-4 min-w-0">
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
                <div className="trough h-2 mb-3">
                  <div className={`h-full rounded-full chart-grow transition-all ${barCls(overall)}`} style={{ width: `${barPct(overall)}%` }} />
                </div>
                {/* allocations */}
                {allocs.length === 0 && (
                  <p className="text-[0.74rem] text-ink-dim mb-1.5">No category allocations — edit to add some.</p>
                )}
                {(allocs.length > 0 || notPlanned.length > 0) && (
                  <div className="space-y-1.5">
                    {allocs.map((a, ai) => {
                      const ap = pct(a.spent, a.limit);
                      const c = getCat(a.category);
                      return (
                        <button key={a.category} onClick={() => navigate(`/transactions?budgetId=${b.id}&cat=${a.category}`)}
                          className="w-full text-left group">
                          <div className="flex justify-between items-center text-[0.74rem] mb-0.5">
                            <span className="text-ink-mid group-hover:text-coral truncate">{c.icon} {c.label}</span>
                            <span className="text-ink-dim flex-shrink-0">
                              <Money amount={a.spent} currency={cur} maxChars={7} /> / <Money amount={a.limit} currency={cur} maxChars={7} />
                            </span>
                          </div>
                          <div className="trough h-1.5">
                            <div className={`h-full rounded-full chart-grow ${barCls(ap)}`} style={{ width: `${barPct(ap)}%`, animationDelay: `${ai * 60}ms` }} />
                          </div>
                        </button>
                      );
                    })}
                    {/* E5 (owner): spending in a category with nothing allocated — always over, after the plan. */}
                    {notPlanned.map(a => {
                      const c = getCat(a.category);
                      return (
                        <button key={`np-${a.category}`} data-testid="budget-not-planned"
                          onClick={() => navigate(`/transactions?budgetId=${b.id}&cat=${a.category}`)}
                          className="w-full text-left group">
                          <div className="flex justify-between items-center text-[0.74rem] mb-0.5 gap-2">
                            <span className="text-ink-mid group-hover:text-coral truncate">{c.icon} {c.label}</span>
                            <span className="text-terra flex-shrink-0">
                              <Money amount={a.spent} currency={cur} maxChars={7} /> over · not planned
                            </span>
                          </div>
                          <div className="trough h-1.5">
                            <div className="h-full rounded-full chart-grow bg-terra" style={{ width: '100%' }} />
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
