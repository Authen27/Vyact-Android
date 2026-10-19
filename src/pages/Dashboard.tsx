// Dashboard — Track ▸ Overview (Batch A fidelity pass · board M1/D1).
// Mobile: pace banner → cash-flow hero (inline 6-mo trend + scrub tooltip) →
// budget progress → recent. Desktop: greeting + Add-transaction header →
// cash-flow/net-worth hero pair → metric tiles + insight spine-cards → 3-col
// panels. Every number reuses the SAME aggregates as before (monthlyData /
// spendByCategory) — this pass changes presentation only. v10.109.0 (owner,
// 16 Oct 2026): the Pulse Score is archived; its ring, meters and advice line are gone.
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store';
import { useTranslation } from '../hooks';
import { Panel } from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import { CategoryDonut } from '../components/charts/DonutCharts';
import {
  selectMonthlyData, selectInsights,
  selectSpendByCategory, selectRecentTxns, selectNetWorth,
  selectMonthlyDebtPayment,
} from '../lib/selectors';
import { fmtShort, monthName, nowMonthKey, today, formatDate } from '../lib/format';
import { monthlyData } from '../lib/calculations';
import { budgetLinesNow, budgetPace } from '../lib/budgetProgress';
import { debtToIncomePct, pctLabel } from '../lib/ratios';
import Money from '../components/ui/Money';
import AnimatedMoney from '../components/ui/AnimatedMoney';
import EstimateHero, { useStartingBaseline } from '../components/dashboard/EstimateHero';
import SetupChecklist from '../components/dashboard/SetupChecklist';
import { can } from '../lib/permissions';
import { motion } from 'framer-motion';
import { staggerContainer, staggerItem } from '../lib/motion';
import { getCat } from '../constants';
import { FEATURES } from '../config/features';
import type { Transaction } from '../types';
import PageHead from '../components/ui/PageHead';

// The "Learn in a minute" shelf carries the lesson library (a large JSON): loaded after the Dashboard
// renders, never in its first paint.
const LearnShelf = lazy(() => import('../components/dashboard/LearnShelf'));

const greet = (): string => {
  const h = new Date().getHours();
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
};

export default function Dashboard() {
  const { t } = useTranslation();
  const budgets = useStore(s => s.budgets);
  const budgetAllocations = useStore(s => s.budgetAllocations);
  const debts = useStore(s => s.debts);
  const profile = useStore(s => s.profile);
  const baseCur = profile.baseCurrency;
  const openEditTxn = useStore(s => s.openEditTxn);
  const openAddTxn = useStore(s => s.openAddTxn);
  const openAddBudget = useStore(s => s.openAddBudget);
  const myRole = useStore(s => s.myRole);
  // FR2 — the estimate from setup leads the heroes until real activity replaces it.
  const [baseline, dismissBaseline] = useStartingBaseline();
  // `rates` stays a live subscription: the selectors return derived values, not
  // raw collections, and the budget progress (lib/budgetProgress) reads it.
  const rates = useStore(s => s.rates);

  const mk = nowMonthKey();
  const month = useStore(selectMonthlyData(mk));
  const rate = month.income > 0 ? Math.round((month.income - month.expense) / month.income * 100) : 0;
  const insights = useStore(selectInsights);
  const spend = useStore(selectSpendByCategory(mk));
  const donutData = Object.entries(spend).map(([catId, amount]) => ({ catId, amount }));
  const recent = useStore(selectRecentTxns);
  const transactions = useStore(s => s.transactions);

  // Audit F3 — the dashboard's Net Worth figures come from the ONE canonical
  // projection (live account balances, liabilities, unlinked assets/debts),
  // not the static assets/debts arrays that used to drift from NetWorth.tsx.
  const netWorth = useStore(selectNetWorth);
  const ta = netWorth.totalAssets;
  const tl = netWorth.totalLiabilities;
  const monthlyDebtPmt = useStore(selectMonthlyDebtPayment);
  // W6 (audit FE-UIC-07): one definition with Debts; no income this month reads "—", not a green 0%.
  const dti = debtToIncomePct(monthlyDebtPmt, month.income);
  // v9.1 §4 — flatten container budgets + allocations into per-category lines.
  // Scoped to the CURRENT month. This used to call budgetLines() across every
  // budget the household has ever had and then slice(0, 5), so the month you saw
  // was whichever one happened to sort first in the array — in September it
  // showed August. See budgetLinesForMonth.
  // Track E, E5 (owner, E-6): the ONE budget-progress basis (lib/budgetProgress.ts) — each line over its
  // own budget's period (an annual line over the year, not this month), then this month's not-planned
  // spending; the pace banner reads the month budget's total against ALL its spending.
  const budgetNow = useMemo(
    () => budgetLinesNow(budgets, budgetAllocations, transactions, { baseCurrency: baseCur, rates }),
    // mk re-reads when the month rolls over while the page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [budgets, budgetAllocations, transactions, baseCur, rates, mk],
  );
  // What the Learn shelf picks for: a loan being repaid, a budget over, or no budget yet.
  const learnSituation = useMemo(() => ({
    hasDebt: debts.some(d => (d.direction ?? 'owed_by_me') === 'owed_by_me' && !d.paidOffAt),
    overBudget: budgetNow.lines.some(l => (l.pct ?? 0) >= 100) || budgetNow.notPlanned.length > 0,
    hasBudget: budgets.length > 0,
  }), [debts, budgetNow, budgets.length]);

  // A6 — inline 6-month net trend for the Cash Flow hero. Presentation only:
  // each point reuses the SAME `monthlyData` aggregate the dashboard already
  // trusts, so no new money math is introduced.
  const netSeries = useMemo(() => {
    const [y, m] = mk.split('-').map(Number);
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(y, m - 1 - (5 - i), 1);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const md = monthlyData(transactions, k, baseCur, rates);
      return { mk: k, net: md.income - md.expense };
    });
  }, [transactions, mk, baseCur, rates]);

  // Board M1 pace banner — month-to-date spend vs the current-month budget,
  // pro-rated by day. Pure arithmetic over the existing aggregates; hidden when
  // no current-month budget exists (never fabricate a pace).
  const pace = useMemo(() => {
    const p = budgetPace(budgetNow.month);
    return p ? { under: p.under, amt: p.amount } : null;
  }, [budgetNow]);


  // Board M1 status banner. Prefer the budget-pace nudge; when there's no
  // current-month budget, fall back to a this-month savings status so the
  // banner slot is never empty for users with activity. Both use only the
  // existing aggregates — no new money math. Null only when there's nothing
  // truthful to say (no budget AND no income this month).
  const banner = useMemo((): { good: boolean; text: ReactNode } | null => {
    if (pace) {
      return {
        good: pace.under,
        text: (
          <>
            {pace.under ? "You're on track this month — " : "You're running hot — "}
            <b style={{ color: `hsl(var(${pace.under ? '--sage' : '--honey'}))` }}>
              {fmtShort(pace.amt, baseCur)} {pace.under ? 'under' : 'over'}
            </b>{' '}budget pace.
          </>
        ),
      };
    }
    if (month.income > 0) {
      const saved = month.income - month.expense;
      const good = saved >= 0;
      return {
        good,
        text: good ? (
          <>You've kept <b style={{ color: 'var(--good-text)' }}>{fmtShort(saved, baseCur)}</b> this month — {rate}% of income.</>
        ) : (
          <>You've overspent <b style={{ color: 'var(--warn-text)' }}>{fmtShort(-saved, baseCur)}</b> this month.</>
        ),
      };
    }
    return null;
  }, [pace, month.income, month.expense, rate, baseCur]);

  return (
    <div className="ui-pilot dashboard-stack" data-testid="dashboard-pilot">
      {/* Page header (Aurora 4.0 PageHead) — on phones the identity lives in MobileHeader, and the
          tab bar's + adds a transaction, so there is no header + here. */}
      <PageHead
        flush
        title={(() => { const who = (profile.name || '').trim().split(/\s+/)[0]; return who ? `${greet()}, ${who}` : greet(); })()}
        subtitle={<>Family finance overview · {monthName(mk)}</>}
        action={{ label: 'Add transaction', icon: true, entity: 'transaction', headerPlus: false, onClick: () => openAddTxn() }}
      />


      {/* Board M1 — mobile status banner (desktop carries this in the insight
          cards). Budget-pace nudge when a current-month budget exists, else a
          this-month savings status. */}
      {banner && (
        <div
          className="sm:hidden flex items-center gap-2.5 rounded-r2 px-3.5 py-2.5 mb-3.5"
          style={{
            background: `color-mix(in srgb, hsl(var(${banner.good ? '--sage' : '--honey'})) 12%, transparent)`,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, hsl(var(${banner.good ? '--sage' : '--honey'})) 24%, transparent)`,
          }}
        >
          <span className="text-[15px]" style={{ color: `hsl(var(${banner.good ? '--sage' : '--honey'}))` }}>✦</span>
          <span className="text-[13px] font-medium text-ink">{banner.text}</span>
        </div>
      )}

      {/* Heroes (board M1/D1) — mobile is a horizontal snap-scroll carousel
          (Cash flow, then Net worth peeks in beside it); desktop shows the
          pair side by side. One instance of each hero: flex+snap collapses to
          a 2-col grid at sm. */}
      <div data-testid="dashboard-heroes" className="flex sm:grid sm:grid-cols-2 gap-section-content overflow-x-auto sm:overflow-visible snap-x snap-mandatory sm:snap-none [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
        <div className="snap-start shrink-0 basis-[86%] sm:basis-auto sm:shrink">
          {baseline
            ? <EstimateHero baseline={baseline} onDismiss={dismissBaseline} />
            : <CashFlowHero series={netSeries} month={month} rate={rate} baseCur={baseCur} mk={mk} />}
        </div>
        <div className="snap-start shrink-0 basis-[86%] sm:basis-auto sm:shrink">
          <NetWorthHero ta={ta} tl={tl} baseCur={baseCur} />
        </div>
      </div>

      {/* Aurora 4.0 FR1 — "Finish setting up", after a real onboarding only. */}
      <SetupChecklist />

      {/* Aurora 4.0 D1 — phones: the insight cards are desktop-only below, so phones get the top two
          here as "What to look at", with See all. */}
      {insights.length > 0 && (
        <div className="sm:hidden" data-testid="dashboard-look-at">
          <Panel title="What to look at" action={<Link to="/insights" className="text-[13px] font-medium text-coral hover:opacity-70">See all</Link>}>
            {insights.slice(0, 2).map((c, i) => {
              const tone = c.cls === 'chip-good' ? 'hsl(var(--sage))'
                         : c.cls === 'chip-warn' ? 'hsl(var(--honey))'
                         : c.cls === 'chip-alert' ? 'hsl(var(--terra))'
                         :                          'hsl(var(--denim))';
              const body = (
                <div className={`relative py-3 pr-4 pl-[18px] ${i ? 'border-t border-line' : ''}`}>
                  <span aria-hidden className="absolute left-0 top-[12px] bottom-[12px] w-[3px] rounded-r" style={{ background: tone }} />
                  <div className="text-[13.5px] font-medium text-ink leading-snug">{c.icon} {c.text}</div>
                  {c.detail && <div className="text-[13px] text-ink-mid mt-1 leading-relaxed">{c.detail}</div>}
                </div>
              );
              return c.to ? <Link key={i} to={c.to} className="block">{body}</Link> : <div key={i}>{body}</div>;
            })}
          </Panel>
        </div>
      )}

      {/* Desktop metric tiles / insight spine-cards (board D1). */}
      <div data-testid="dashboard-metrics" className="hidden sm:block">
        <div className="hidden sm:flex flex-col gap-group">
          <div className="grid grid-cols-3 gap-section-content">
            <MetricTile
              to={`/transactions?type=income&month=${mk}`} label={t('monthly-income')}
              spine="hsl(var(--sage))"
              value={<AnimatedMoney amount={month.income} currency={baseCur} maxChars={9} className="text-sage" />}
            />
            <MetricTile
              to={`/transactions?type=expense&month=${mk}`} label={t('monthly-expenses')}
              spine="var(--ff-ink-3)"
              value={<AnimatedMoney amount={month.expense} currency={baseCur} maxChars={9} />}
            />
            <MetricTile
              to="/reports?from=savings" label={t('savings-rate')}
              spine={rate >= 20 ? 'hsl(var(--sage))' : rate >= 0 ? 'hsl(var(--honey))' : 'hsl(var(--terra))'}
              value={<span className={rate >= 20 ? 'text-sage' : rate >= 0 ? 'text-honey' : 'text-terra'}>{rate}%</span>}
            />
          </div>
          {insights.length > 0 && (
            <motion.div className="grid grid-cols-2 gap-section-content" variants={staggerContainer} initial="hidden" animate="visible">
              {insights.slice(0, 4).map((c, i) => {
                const tone = c.cls === 'chip-good' ? 'hsl(var(--sage))'
                           : c.cls === 'chip-warn' ? 'hsl(var(--honey))'
                           : c.cls === 'chip-alert' ? 'hsl(var(--terra))'
                           :                          'hsl(var(--denim))';
                const body = (
                  <div className="relative py-2 pr-4 pl-[18px] h-full">
                    <span aria-hidden className="absolute left-0 top-[10px] bottom-[10px] w-[3px] rounded-r" style={{ background: tone }} />
                    <div className="text-[13px] font-medium text-ink leading-snug">{c.icon} {c.text}</div>
                    {c.detail && <div className="text-[13px] text-ink-mid mt-2 leading-relaxed">{c.detail}</div>}
                  </div>
                );
                return (
                  <motion.div key={i} variants={staggerItem}>
                    {c.to ? <Link to={c.to} className="block h-full">{body}</Link> : body}
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </div>
      </div>

      {/* Panels — board D1 third row is a 3-up (budgets · recent · spending). */}
      <div data-testid="dashboard-details" className="grid lg:grid-cols-3 gap-x-section-content gap-y-section">
        <Panel
          title={t('budget-progress')}
          action={<Link to="/budgets" className="text-[13px] font-medium text-coral hover:opacity-70">{t('view-all')}</Link>}
        >
          {budgetNow.lines.length === 0 && budgetNow.notPlanned.length === 0 ? (
            // Aurora 4.0 FR3 — say what is missing and offer the one action.
            <EmptyState compact
              message={budgetNow.progress.length ? 'This month\'s budget has no category lines yet.' : 'No budget yet.'}
              action={can(myRole, 'manage_budgets')
                ? (budgetNow.progress.length ? { label: 'Add category lines', to: '/budgets' } : { label: 'Set a budget', onClick: openAddBudget })
                : undefined} />
          ) : (
            <div className="px-4 pt-2.5 pb-1.5">
              {/* v10.27.2 — the five most-utilised categories, highest first
                  (lib/budgetOrdering), not the first five the store returned. E5: each over its own
                  budget's period (an annual line says so), then this month's not-planned spending. */}
              {budgetNow.lines.slice(0, 5).map(line => {
                const cat = getCat(line.category);
                const pct = Math.min(100, Math.round(line.pct ?? 0));
                // Board trough bands: <80 good · 80–99 warn · 100 crit.
                const color = pct >= 100 ? 'hsl(var(--terra))' : pct >= 80 ? 'hsl(var(--honey))' : 'hsl(var(--sage))';
                return (
                  <div key={`${line.budgetId}:${line.category}`} className="mb-3 last:mb-1.5">
                    <div className="flex justify-between items-center mb-1.5 text-[12.5px] gap-2">
                      <span className="text-ink truncate">{cat.icon} {cat.label}{line.annual ? <span className="text-ink-dim"> · this year</span> : null}</span>
                      <span className="num text-ink-mid flex-shrink-0">{fmtShort(line.spent, baseCur)} / {fmtShort(line.limit, baseCur)}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
                      <div className="h-full rounded-full chart-grow transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
              {budgetNow.notPlanned.slice(0, 3).map(line => {
                const cat = getCat(line.category);
                return (
                  <div key={`np:${line.category}`} data-testid="dashboard-not-planned" className="mb-3 last:mb-1.5">
                    <div className="flex justify-between items-center mb-1.5 text-[12.5px] gap-2">
                      <span className="text-ink truncate">{cat.icon} {cat.label}</span>
                      <span className="num text-terra flex-shrink-0">{fmtShort(line.spent, baseCur)} over · not planned</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
                      <div className="h-full rounded-full chart-grow transition-[width] duration-500" style={{ width: '100%', background: 'hsl(var(--terra))' }} />
                    </div>
                  </div>
                );
              })}
              {budgetNow.notPlanned.length > 3 && (
                <p className="text-[11.5px] text-ink-dim mb-1.5">
                  +{budgetNow.notPlanned.length - 3} more not planned · <Link to="/budgets" className="text-coral">see Budgets</Link>
                </p>
              )}
            </div>
          )}
        </Panel>

        <Panel
          title={t('recent-transactions')}
          action={<Link to="/transactions" className="text-[13px] font-medium text-coral hover:opacity-70">{t('view-all')}</Link>}
        >
          {recent.length === 0 ? (
            <EmptyState compact message="Nothing logged yet." action={{ label: '+ Add your first expense', onClick: () => openAddTxn({ type: 'expense' }) }} />
          ) : (
            recent.map(txn => <RecentRow key={txn.id} txn={txn} onEdit={openEditTxn} />)
          )}
        </Panel>

        <Panel title={t('spending-by-category')} sub={t('this-month')}
          action={<Link to="/reports" className="text-[13px] font-medium text-coral hover:opacity-70">{t('view-all')}</Link>}>
          {donutData.length === 0
            ? <EmptyState compact message="No spending recorded this month." />
            : <CategoryDonut data={donutData} currency={baseCur} monthKey={mk} />
          }
        </Panel>
      </div>

      {/* Debt overview. */}
      {FEATURES.dashboard.showDebtSummary && <div data-testid="dashboard-debt-summary">
        <Panel
          title={t('debt-overview')}
          action={<Link to="/debts" className="text-[13px] font-medium text-coral hover:opacity-70">{t('view-all')}</Link>}
        >
          {debts.length === 0 ? (
            <EmptyState compact message="Debt-free — nothing owed." />
          ) : (
            <div className="px-4 py-3 space-y-2">
              <Row label={`Total · ${debts.length} accounts`} value={<Money amount={tl} currency={baseCur} maxChars={11} />} valueClass="text-terra" />
              <Row label="Monthly minimum" value={<Money amount={monthlyDebtPmt} currency={baseCur} maxChars={11} />} valueClass="text-honey" />
              <Row
                label="Debt-to-income"
                value={pctLabel(dti, 0)}
                valueClass={dti == null ? 'text-ink-dim' : dti <= 25 ? 'text-sage' : dti <= 36 ? 'text-honey' : 'text-terra'}
              />
            </div>
          )}
        </Panel>
      </div>}

      {/* Owner, 16 Oct 2026 — two or three lessons for what the household is dealing with, readable in
          place, with a shortcut to the library. */}
      <Suspense fallback={null}>
        <LearnShelf situation={learnSituation} todayISO={today()} />
      </Suspense>
    </div>
  );
}

function Row({ label, value, valueClass = '' }: { label: string; value: ReactNode; valueClass?: string }) {
  return (
    <div className="flex justify-between items-center text-[0.84rem] gap-2 min-w-0">
      <span className="text-ink-mid flex-shrink-0">{label}</span>
      <span className={`num ${valueClass}`}>{value}</span>
    </div>
  );
}

/** Board §.hero — cash-flow hero with the 6-month trend INSIDE the card:
 *  spine, big net, "% kept" pill, scrubbable line chart with a pinned glass
 *  tooltip + insight note, month axis, In/Out(+Net worth on mobile) footer. */
function CashFlowHero({ series, month, rate, baseCur, mk }: {
  series: { mk: string; net: number }[];
  month: { income: number; expense: number };
  rate: number;
  baseCur: string;
  mk: string;
}) {
  const [sel, setSel] = useState(series.length - 1);
  const net = month.income - month.expense;
  const good = net >= 0;
  const tone = good ? 'hsl(var(--sage))' : 'hsl(var(--terra))';

  // Chart geometry (board viewBox 0 0 320 96).
  const nets = series.map(s => s.net);
  const min = Math.min(...nets), max = Math.max(...nets);
  const range = max - min || 1;
  const X = (i: number) => 10 + i * 60;
  const Y = (v: number) => 88 - ((v - min) / range) * 76;
  const line = series.map((s, i) => `${i ? 'L' : 'M'}${X(i)} ${Y(s.net).toFixed(1)}`).join(' ');
  const fill = `${line} L310 94 L10 94 Z`;

  const selPt = series[Math.min(sel, series.length - 1)];
  const avg = nets.reduce((a, b) => a + b, 0) / (nets.length || 1);
  const vsAvg = Math.abs(avg) > 1 ? Math.round(((selPt.net - avg) / Math.abs(avg)) * 100) : null;
  const monLabel = (k: string) => monthName(k).split(' ')[0];

  const scrub = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setSel(Math.max(0, Math.min(series.length - 1, Math.round(((clientX - r.left) / r.width) * (series.length - 1)))));
  };

  return (
    <div className="relative rounded-r3 px-5 py-[18px] overflow-hidden h-full" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
      <span aria-hidden className="absolute left-0 top-[14px] bottom-[14px] w-[3px] rounded" style={{ background: tone }} />
      <div className="flex justify-between items-start">
        <Link to={`/transactions?month=${mk}`} className="block min-w-0">
          <div className="mono-label mb-1.5">Cash flow · 6 months</div>
          <div className="num font-bold text-[30px] leading-tight" style={{ color: tone }}>
            {good ? '+' : ''}<AnimatedMoney amount={net} currency={baseCur} maxChars={10} />
          </div>
        </Link>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-pill font-display font-semibold text-[11.5px] flex-shrink-0"
          style={{ background: `color-mix(in srgb, ${rate >= 0 ? 'hsl(var(--sage))' : 'hsl(var(--terra))'} 14%, transparent)`, color: rate >= 0 ? 'hsl(var(--sage))' : 'hsl(var(--terra))' }}>
          {rate >= 0 ? '↗' : '↘'} {Math.abs(rate)}% kept
        </span>
      </div>

      {/* Scrubbable trend — tap or drag anywhere on the chart to pin a month. */}
      <div
        className="relative -mx-1.5 mt-1.5 pt-9 cursor-crosshair touch-none select-none"
        onPointerDown={e => scrub(e.clientX, e.currentTarget)}
        onPointerMove={e => { if (e.buttons > 0) scrub(e.clientX, e.currentTarget); }}
        role="img" aria-label={`Six-month net cash-flow trend, ${monLabel(selPt.mk)} selected`}
      >
        <div
          className="glass-panel absolute top-0 z-[2] px-2.5 py-1.5 rounded-r2 text-center whitespace-nowrap pointer-events-none"
          style={{ left: `${(X(sel) / 320) * 100}%`, transform: `translateX(${sel === 0 ? '-8%' : sel === series.length - 1 ? '-92%' : '-50%'})` }}
        >
          <div className="num text-[12px] font-bold leading-tight" style={{ color: selPt.net >= 0 ? 'hsl(var(--sage))' : 'hsl(var(--terra))' }}>
            {monLabel(selPt.mk)} · {selPt.net >= 0 ? '+' : '−'}{fmtShort(Math.abs(selPt.net), baseCur)}
          </div>
          {vsAvg !== null && (
            <div className="text-[9.5px] text-ink-mid leading-tight">✦ {Math.abs(vsAvg)}% {vsAvg >= 0 ? 'above' : 'below'} your 6-mo average</div>
          )}
        </div>
        <svg viewBox="0 0 320 96" className="block w-full h-[72px] sm:h-[58px]" preserveAspectRatio="none">
          <defs>
            <linearGradient id="cf-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tone} stopOpacity=".22" />
              <stop offset="100%" stopColor={tone} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className="chart-fill" d={fill} fill="url(#cf-fill)" />
          <line x1={X(sel)} y1="10" x2={X(sel)} y2="92" stroke="var(--ff-ink-3)" strokeWidth="1" strokeDasharray="3 3" />
          <path className="chart-line" d={line} fill="none" stroke={tone} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={X(sel)} cy={Y(selPt.net)} r="4.5" fill={tone} stroke="var(--canvas)" strokeWidth="2" />
        </svg>
        <div className="flex justify-between px-0.5 font-mono text-[8.5px] tracking-[0.08em] uppercase text-ink-dim">
          {series.map((s, i) => (
            <span key={s.mk} style={i === sel ? { color: 'var(--ff-ink-2)' } : undefined}>{monLabel(s.mk)}</span>
          ))}
        </div>
      </div>

      <div className="flex gap-[18px] mt-2.5 text-[12.5px] text-ink-mid flex-wrap">
        <span>In <b className="num text-sage">{fmtShort(month.income, baseCur)}</b></span>
        <span>Out <b className="num text-ink">{fmtShort(month.expense, baseCur)}</b></span>
        {/* Net worth is now its own swipeable card beside this one on mobile
            (and the side-by-side hero on desktop), so the folded footer line
            was removed to avoid showing the figure twice. */}
        <span>Savings rate <b className={`num ${rate >= 20 ? 'text-sage' : rate >= 0 ? 'text-honey' : 'text-terra'}`}>{rate}%</b></span>
      </div>
    </div>
  );
}

/** Board D1 — net-worth hero (stock, not flow): info spine, big number,
 *  Assets/Liabilities footer. Desktop: side-by-side with the cash hero;
 *  mobile: the second slide of the swipeable hero carousel. */
function NetWorthHero({ ta, tl, baseCur }: { ta: number; tl: number; baseCur: string }) {
  return (
    <Link to="/networth" aria-label="View net worth"
      className="relative block rounded-r3 px-5 py-[18px] overflow-hidden h-full"
      style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
      <span aria-hidden className="absolute left-0 top-[14px] bottom-[14px] w-[3px] rounded" style={{ background: 'hsl(var(--denim))' }} />
      <div className="mono-label mb-1.5">Net worth · today</div>
      <div className={`num font-bold text-[30px] leading-tight ${ta - tl >= 0 ? 'text-ink' : 'text-terra'}`}>
        <AnimatedMoney amount={ta - tl} currency={baseCur} maxChars={11} />
      </div>
      <div className="flex gap-[18px] mt-2.5 text-[12.5px] text-ink-mid">
        <span>Assets <b className="num text-sage">{fmtShort(ta, baseCur)}</b></span>
        <span>Liabilities <b className="num text-ink">{fmtShort(tl, baseCur)}</b></span>
      </div>
    </Link>
  );
}

/** Board D1 §.metric — KPI tile with a bottom accent bar. */
function MetricTile({ label, value, spine, to }: { label: string; value: ReactNode; spine: string; to: string }) {
  return (
    <Link to={to} className="relative block rounded-r2 px-4 py-3.5 overflow-hidden"
      style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
      <span aria-hidden className="absolute left-0 right-0 bottom-0 h-[3px]" style={{ background: spine }} />
      <div className="ui-label mb-related">{label}</div>
      <div className="num font-bold text-[22px] leading-tight text-ink">{value}</div>
    </Link>
  );
}

/** Board M1 recent row — tinted category tile · name + "category · when" · amount. */
function RecentRow({ txn, onEdit }: { txn: Transaction; onEdit: (t: Transaction) => void }) {
  const baseCur = useStore(s => s.profile.baseCurrency);   // W3b: one currency per household
  const cat = getCat(txn.category ?? '');
  const emoji = txn.type === 'transfer' ? '🔄' : txn.type === 'investment' ? '📈' : cat.icon;
  const catLabel = txn.type === 'transfer' ? 'Transfer' : txn.type === 'investment' ? 'Investment' : cat.label;
  const when = txn.date === today() ? 'Today' : formatDate(txn.date);
  const isIncome = txn.type === 'income';
  const isExpense = txn.type === 'expense';
  return (
    <button type="button" onClick={() => onEdit(txn)}
      className="w-full flex items-center gap-[11px] px-4 py-[11px] border-b border-line last:border-b-0 text-left hover:bg-bg3 transition-colors cursor-pointer">
      <div className="w-[34px] h-[34px] rounded-r2 flex items-center justify-center text-[16px] flex-shrink-0"
        style={{ background: `color-mix(in srgb, ${cat.color || 'hsl(var(--denim))'} 15%, transparent)`, boxShadow: 'var(--neu-sm)' }} aria-hidden>
        {emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-[13.5px] text-ink truncate">{txn.description || catLabel}</div>
        <div className="text-[12px] text-ink-mid">{catLabel} · {when}</div>
      </div>
      <span className={`num font-semibold text-[13.5px] flex-shrink-0 ${isIncome ? 'text-sage' : 'text-ink'}`}>
        {isExpense ? '−' : isIncome ? '+' : ''}<Money amount={txn.split?.isSplit ? txn.split.yourShare : txn.amount} currency={baseCur} maxChars={9} />
      </span>
    </button>
  );
}
