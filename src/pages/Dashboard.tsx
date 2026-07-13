import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store';
import { useTranslation } from '../hooks';
import { Card, Panel } from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import PulseGauge from '../components/charts/PulseGauge';
import { CategoryDonut } from '../components/charts/DonutCharts';
import TxnRow from '../components/transactions/TxnRow';
import {
  selectMonthlyData, selectPulse, selectInsights,
  selectSpendByCategory, selectRecentTxns, selectTotalAssets, selectTotalLiabilities,
  selectMonthlyDebtPayment,
} from '../lib/selectors';
import { fmtShort, monthName, nowMonthKey, convert } from '../lib/format';
import { budgetLines, monthlyData } from '../lib/calculations';
import Money from '../components/ui/Money';
import AnimatedMoney from '../components/ui/AnimatedMoney';
import StartingBaselineBand from '../components/dashboard/StartingBaselineBand';
import { Pip } from '../components/layout/Brand';
import { motion } from 'framer-motion';
import { staggerContainer, staggerItem } from '../lib/motion';
import { getCat } from '../constants';
import { ArrowDownRight, ArrowUpRight, Scale, ArrowRight } from 'lucide-react';
import type { PulseScore } from '../lib/calculations';

/** #7 — one actionable line under the Pulse: point at the weakest applicable
 *  component so the user always knows what to do next. */
function pulseAdvice(p: PulseScore): { text: string; to: string } {
  if (p.total === null) return { text: 'Add income and a budget to start your Pulse.', to: '/budgets' };
  const comps: [number, boolean, string, string][] = [
    [p.components.budget,  p.applicable.budget,  'A budget is over — review and adjust it.', '/budgets'],
    [p.components.savings, p.applicable.savings, 'Lift your savings rate — trim a discretionary category.', '/budgets'],
    [p.components.trend,   p.applicable.trend,   'Spending is trending up — see what changed.', '/reports'],
    [p.components.debt,    p.applicable.debt,    'Bring your debt-to-income down.', '/debts'],
  ];
  const weakest = comps.filter(c => c[1]).sort((a, b) => a[0] - b[0])[0];
  if (!weakest || weakest[0] >= 80) return { text: "You're in good shape — keep it up.", to: '/reports' };
  return { text: weakest[2], to: weakest[3] };
}

export default function Dashboard() {
  const { t } = useTranslation();
  const budgets = useStore(s => s.budgets);
  const budgetAllocations = useStore(s => s.budgetAllocations);
  const debts = useStore(s => s.debts);
  const profile = useStore(s => s.profile);
  const baseCur = profile.baseCurrency;
  const openEditTxn = useStore(s => s.openEditTxn);
  // `rates` stays a live subscription: the selectors return derived values, not
  // raw collections, and the per-row `convert()` calls in the budget list need it.
  const rates = useStore(s => s.rates);

  const mk = nowMonthKey();
  const month = useStore(selectMonthlyData(mk));
  const rate = month.income > 0 ? Math.round((month.income - month.expense) / month.income * 100) : 0;
  const pulse = useStore(selectPulse);
  const insights = useStore(selectInsights);
  const spend = useStore(selectSpendByCategory(mk));
  const donutData = Object.entries(spend).map(([catId, amount]) => ({ catId, amount }));
  const recent = useStore(selectRecentTxns);
  const transactions = useStore(s => s.transactions);

  const ta = useStore(selectTotalAssets);
  const tl = useStore(selectTotalLiabilities);
  const monthlyDebtPmt = useStore(selectMonthlyDebtPayment);
  const dti = month.income > 0 ? (monthlyDebtPmt / month.income) * 100 : 0;
  // v9.1 §4 — flatten container budgets + allocations into per-category lines.
  const budgetView = useMemo(() => budgetLines(budgets, budgetAllocations), [budgets, budgetAllocations]);

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

  return (
    <div>
      {/* Page header — greeting (v7.4.0). The user's name (or a friendly
          fallback) leads the page; the time-of-day prefix gives the dashboard
          a kitchen-table feel rather than a clinical "Dashboard" label.
          v7.4.5 — Add-Transaction button removed; the global AddFab is the
          canonical entry, so the header stays clean. */}
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="display-italic text-4xl text-ink mb-1.5">
            {(() => {
              const h = new Date().getHours();
              const greet = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
              const who = (profile.name || '').trim().split(/\s+/)[0];
              return who ? `${greet}, ${who}` : greet;
            })()}
          </h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            Family Finance Overview · {monthName(mk)}
          </p>
        </div>
        {/* A6 — a glanceable Pulse ring beside the greeting; the full gauge lives below. */}
        <MiniPulse score={pulse.total} />
      </div>

      {/* v9.7 — estimated starting picture from onboarding; clears as real data lands. */}
      <StartingBaselineBand />

      {/* A7 — the two honest numbers. Cash Flow is a FLOW (money in vs out this
          month); Net Worth is a STOCK (assets − liabilities right now). Distinct
          treatment so they never blur. */}
      {/* A6 — Aurora neu hero cards. On mobile they become a full-bleed,
          scroll-snap carousel; on ≥sm they are a 2-up grid. */}
      <div
        className="flex sm:grid sm:grid-cols-2 gap-3.5 mb-3.5 overflow-x-auto sm:overflow-visible snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none' }}
      >
        <Link to={`/transactions?month=${mk}`} aria-label="View cash flow" className="snap-center shrink-0 w-[86%] sm:w-auto block rounded-r4 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2">
          <div className="h-full rounded-r4 p-5" style={{ background: 'var(--elevated)', boxShadow: 'var(--neu)' }}>
            <div className="flex items-center gap-2 font-mono text-[0.6rem] tracking-[0.16em] uppercase text-ink-dim mb-2">
              <ArrowDownRight size={13} className="text-sage" /><ArrowUpRight size={13} className="text-terra" /> Cash Flow · {monthName(mk)}
            </div>
            <AnimatedMoney amount={month.income - month.expense} currency={baseCur} maxChars={12}
              className={`num text-3xl font-semibold ${month.income - month.expense >= 0 ? 'text-sage' : 'text-terra'}`} />
            <div className="flex gap-4 mt-2 text-[0.78rem]">
              <span className="text-ink-mid">In <span className="num text-sage">{fmtShort(month.income, baseCur)}</span></span>
              <span className="text-ink-mid">Out <span className="num text-terra">{fmtShort(month.expense, baseCur)}</span></span>
            </div>
            <TrendSparkline series={netSeries} />
          </div>
        </Link>
        <Link to="/networth" aria-label="View net worth" className="snap-center shrink-0 w-[86%] sm:w-auto block rounded-r4 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2">
          <div className="h-full rounded-r4 p-5" style={{ background: 'var(--elevated)', boxShadow: 'var(--neu)' }}>
            <div className="flex items-center gap-2 font-mono text-[0.6rem] tracking-[0.16em] uppercase text-ink-dim mb-2">
              <Scale size={13} className="text-denim" /> Net Worth · today
            </div>
            <AnimatedMoney amount={ta - tl} currency={baseCur} maxChars={12}
              className={`num text-3xl font-semibold ${ta - tl >= 0 ? 'text-ink' : 'text-terra'}`} />
            <div className="flex gap-4 mt-2 text-[0.78rem]">
              <span className="text-ink-mid">Assets <span className="num text-sage">{fmtShort(ta, baseCur)}</span></span>
              <span className="text-ink-mid">Debts <span className="num text-terra">{fmtShort(tl, baseCur)}</span></span>
            </div>
            {/* Liquidity split mirrors the Cash-Flow sparkline's height so the pair aligns. */}
            <div className="mt-3 h-7 flex items-end">
              <div className="w-full h-1.5 rounded-full overflow-hidden flex" style={{ background: 'var(--sunken)' }} aria-hidden>
                <div className="h-full" style={{ width: `${ta + tl > 0 ? (ta / (ta + tl)) * 100 : 50}%`, background: 'hsl(var(--sage))' }} />
                <div className="h-full" style={{ width: `${ta + tl > 0 ? (tl / (ta + tl)) * 100 : 50}%`, background: 'hsl(var(--terra))' }} />
              </div>
            </div>
          </div>
        </Link>
      </div>

      {/* Pulse + supporting metric cards */}
      <div className="grid lg:grid-cols-[220px_1fr] gap-3.5 mb-3.5">
        <div className="block rounded-md">
          <Link to="/reports" aria-label="Open reports" className="block rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2">
            <PulseGauge score={pulse} />
          </Link>
          {/* #7 — always show one actionable next step under the Pulse. */}
          {(() => { const a = pulseAdvice(pulse); return (
            <Link to={a.to} className="mt-2 flex items-start gap-1.5 text-[0.76rem] text-ink-mid hover:text-ink px-1">
              <span>{a.text}</span><ArrowRight size={13} className="text-coral shrink-0 mt-0.5" />
            </Link>
          ); })()}
        </div>
        {/* v9.5.2 — the lifetime "Total Balance" tile was removed: it showed
            all-time income − expense, which mapped to neither account cash nor net
            worth (yet linked to Net Worth), so consumers couldn't place it. The
            three remaining tiles are all this-month flow metrics. */}
        <motion.div className="grid grid-cols-3 gap-2" variants={staggerContainer} initial="hidden" animate="visible">
          <motion.div variants={staggerItem}>
            <Link to={`/transactions?type=income&month=${mk}`} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 rounded-md" aria-label="View income transactions">
              <Card label={t('monthly-income')}   accent="sage"  value={<AnimatedMoney amount={month.income}  currency={baseCur} maxChars={8} />} sub={t('this-month')} />
            </Link>
          </motion.div>
          <motion.div variants={staggerItem}>
            <Link to={`/transactions?type=expense&month=${mk}`} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 rounded-md" aria-label="View expense transactions">
              <Card label={t('monthly-expenses')} accent="terra" value={<AnimatedMoney amount={month.expense} currency={baseCur} maxChars={8} />} sub={t('this-month')} />
            </Link>
          </motion.div>
          <motion.div variants={staggerItem}>
            <Link to="/reports?from=savings" className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 rounded-md" aria-label="View savings breakdown">
              <Card label={t('savings-rate')}     accent="honey" value={<span className={rate >= 20 ? 'text-sage' : rate >= 0 ? 'text-honey' : 'text-terra'}>{rate}%</span>} sub="of income not spent" />
            </Link>
          </motion.div>
        </motion.div>
      </div>

      {/* Insights — v9.5.2: each carries an inline sub-line that defines the term
          and names the next action, and (when actionable) links to the relevant
          page. Turns a bare fact ("DTI 20% — healthy") into understanding + a path. */}
      {insights.length > 0 && (
        <motion.div className="grid sm:grid-cols-2 gap-2 mb-3.5" variants={staggerContainer} initial="hidden" animate="visible">
          {insights.map((c, i) => {
            const tone = c.cls === 'chip-good' ? 'border-l-sage'
                       : c.cls === 'chip-warn' ? 'border-l-honey'
                       : c.cls === 'chip-alert' ? 'border-l-terra'
                       :                          'border-l-denim';
            const cls = `flex items-start gap-2.5 bg-bg2 border border-line ${tone} border-l-[3px] rounded-md px-3.5 py-2.5 h-full ${c.to ? 'hover:bg-bg3 transition-colors' : ''}`;
            const body = (
              <>
                <span className="text-base flex-shrink-0 leading-5">{c.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[0.8rem] text-ink font-medium">{c.text}</div>
                  {c.detail && <div className="text-[0.72rem] text-ink-dim mt-0.5 leading-snug">{c.detail}</div>}
                </div>
                {c.to && <ArrowRight size={13} className="text-coral shrink-0 mt-0.5" />}
              </>
            );
            return (
              <motion.div key={i} variants={staggerItem}>
                {c.to ? <Link to={c.to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Two-col: Budgets + Recent transactions */}
      <div className="grid lg:grid-cols-2 gap-3.5 mb-3.5">
        <Panel
          title={t('budget-progress')}
          action={<Link to="/budgets" className="font-mono text-[0.6rem] tracking-wider uppercase text-coral hover:opacity-70">{t('view-all')}</Link>}
        >
          {budgetView.length === 0 ? (
            <EmptyState icon="◎" message="No budgets yet" />
          ) : (
            budgetView.slice(0, 5).map(b => {
              const cat = getCat(b.category ?? '');
              const limitBase = convert(b.limit, b.currency, baseCur, rates);
              const spent = spend[b.category ?? ''] || 0;
              const pct = limitBase > 0 ? Math.min(100, Math.round(spent / limitBase * 100)) : 0;
              const color = pct >= 100 ? 'hsl(var(--terra))' : pct >= 80 ? 'hsl(var(--honey))' : (b.color || 'hsl(var(--coral))');
              return (
                <div key={b.id} className="px-4 py-3 border-b border-line last:border-b-0">
                  <div className="flex justify-between mb-1.5">
                    <span className="text-[0.84rem] font-semibold text-ink">{cat.icon} {cat.label}</span>
                    <span className="font-mono text-[0.68rem] text-ink-mid">{fmtShort(spent, baseCur)} / {fmtShort(limitBase, baseCur)}</span>
                  </div>
                  <div className="bg-bg3 h-1.5 rounded-full overflow-hidden mb-1">
                    <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
                  </div>
                  <div className="font-mono text-[0.58rem] text-ink-dim">{pct}% used</div>
                </div>
              );
            })
          )}
        </Panel>

        <Panel
          title={t('recent-transactions')}
          action={<Link to="/transactions" className="font-mono text-[0.6rem] tracking-wider uppercase text-coral hover:opacity-70">{t('view-all')}</Link>}
        >
          {recent.length === 0 ? (
            <EmptyState icon={<Pip size={44} />} message="No transactions yet" />
          ) : (
            recent.map(t => <TxnRow key={t.id} txn={t} showActions onEdit={openEditTxn} />)
          )}
        </Panel>
      </div>

      {/* Category donut (goals panel removed — goals are no longer a module). */}
      <div className="mb-3.5">
          <Panel title={t('spending-by-category')} sub={t('this-month')}
            action={<Link to="/reports" className="font-mono text-[0.6rem] tracking-wider uppercase text-coral hover:opacity-70">View All →</Link>}>
            {donutData.length === 0
              ? <EmptyState icon="🥯" message="No expenses this month" />
              : <CategoryDonut data={donutData} currency={baseCur} monthKey={mk} />
            }
          </Panel>
      </div>

      {/* Debt overview. (The Net Worth snapshot that used to sit here was removed
          in v9.5.1 — it duplicated the "Net Worth · today" hero card at the top of
          the dashboard, which already shows Net Worth with its Assets/Debts split.) */}
      <div>
        <Panel
          title={t('debt-overview')}
          action={<Link to="/debts" className="font-mono text-[0.6rem] tracking-wider uppercase text-coral hover:opacity-70">View →</Link>}
        >
          {debts.length === 0 ? (
            <EmptyState icon={<Pip size={44} />} message="Debt-free — nothing owed" />
          ) : (
            <div className="px-4 py-3 space-y-2">
              <Row label={`Total · ${debts.length} accounts`} value={<Money amount={tl} currency={baseCur} maxChars={11} />} valueClass="text-terra" />
              <Row label="Monthly minimum" value={<Money amount={monthlyDebtPmt} currency={baseCur} maxChars={11} />} valueClass="text-honey" />
              <Row
                label="Debt-to-income"
                value={`${dti.toFixed(0)}%`}
                valueClass={dti <= 25 ? 'text-sage' : dti <= 36 ? 'text-honey' : 'text-terra'}
              />
            </div>
          )}
        </Panel>
      </div>
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

/** A6 — inline 6-month net-flow sparkline for the Cash Flow hero. Zero line is
 *  dashed; the trailing point is dotted in the sign colour (good/crit). */
function TrendSparkline({ series }: { series: { mk: string; net: number }[] }) {
  const W = 132, H = 28, PAD = 3;
  if (series.length < 2) return <div className="mt-3 h-7" />;
  const vals = series.map(s => s.net);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 0);
  const range = max - min || 1;
  const x = (i: number) => PAD + i * ((W - 2 * PAD) / (series.length - 1));
  const y = (v: number) => H - PAD - ((v - min) / range) * (H - 2 * PAD);
  const d = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.net).toFixed(1)}`).join(' ');
  const last = series[series.length - 1].net;
  const stroke = last >= 0 ? 'hsl(var(--sage))' : 'hsl(var(--terra))';
  const zeroY = y(0);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="mt-3 text-ink-dim" role="img" aria-label="Six-month net cash-flow trend">
      <line x1={PAD} x2={W - PAD} y1={zeroY} y2={zeroY} stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(series.length - 1)} cy={y(last)} r="2.3" fill={stroke} />
    </svg>
  );
}

/** A6 — a glanceable Pulse ring beside the greeting. Echoes the full gauge below
 *  at-a-glance; band colour matches the Pulse's own thresholds. */
function MiniPulse({ score }: { score: number | null }) {
  if (score == null) return null;
  const c = score >= 80 ? 'hsl(var(--sage))' : score >= 60 ? 'hsl(var(--honey))' : score >= 40 ? 'hsl(var(--coral))' : 'hsl(var(--terra))';
  const r = 18, circ = 2 * Math.PI * r, off = circ * (1 - score / 100);
  return (
    <Link to="/reports" aria-label={`Family Pulse ${score} of 100 — open reports`}
      className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-coral">
      <svg width="48" height="48" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={r} fill="none" stroke="var(--sunken)" strokeWidth="4" />
        <circle cx="24" cy="24" r={r} fill="none" stroke={c} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={off} transform="rotate(-90 24 24)" />
        <text x="24" y="28" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--ff-ink)" className="num">{score}</text>
      </svg>
    </Link>
  );
}
