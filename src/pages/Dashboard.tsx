// Dashboard — Track ▸ Overview (Batch A fidelity pass · board M1/D1).
// Mobile: pace banner → cash-flow hero (inline 6-mo trend + scrub tooltip) →
// pulse ring + component meters → budget progress → recent. Desktop: greeting
// + Add-transaction header → cash-flow/net-worth hero pair → pulse card +
// metric tiles + insight spine-cards → 3-col panels. Every number reuses the
// SAME aggregates as before (monthlyData/pulse/spendByCategory) — this pass
// changes presentation only.
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store';
import { useTranslation } from '../hooks';
import { Panel } from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import { CategoryDonut } from '../components/charts/DonutCharts';
import {
  selectMonthlyData, selectPulse, selectInsights,
  selectSpendByCategory, selectRecentTxns, selectTotalAssets, selectTotalLiabilities,
  selectMonthlyDebtPayment,
} from '../lib/selectors';
import { fmtShort, monthName, nowMonthKey, convert, today, formatDate } from '../lib/format';
import { budgetLines, monthlyData } from '../lib/calculations';
import Money from '../components/ui/Money';
import AnimatedMoney from '../components/ui/AnimatedMoney';
import StartingBaselineBand from '../components/dashboard/StartingBaselineBand';
import { Pip } from '../components/layout/Brand';
import { motion } from 'framer-motion';
import { staggerContainer, staggerItem } from '../lib/motion';
import { getCat } from '../constants';
import { ArrowRight } from 'lucide-react';
import type { PulseScore } from '../lib/calculations';
import type { Transaction } from '../types';

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

  // Board M1 pace banner — month-to-date spend vs the current-month budget,
  // pro-rated by day. Pure arithmetic over the existing aggregates; hidden when
  // no current-month budget exists (never fabricate a pace).
  const pace = useMemo(() => {
    const now = new Date();
    const row = budgets.find(b => b.scope === 'month'
      && b.periodYear === now.getFullYear() && b.periodMonth === now.getMonth() + 1);
    if (!row) return null;
    const limitBase = convert(row.limit, row.currency, baseCur, rates);
    if (limitBase <= 0) return null;
    const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const expected = limitBase * (now.getDate() / daysIn);
    const diff = expected - month.expense;
    return { under: diff >= 0, amt: Math.abs(diff) };
  }, [budgets, baseCur, rates, month.expense]);

  const advice = pulseAdvice(pulse);

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
          <>You've kept <b style={{ color: 'hsl(var(--sage))' }}>{fmtShort(saved, baseCur)}</b> this month — {rate}% of income.</>
        ) : (
          <>You've overspent <b style={{ color: 'hsl(var(--honey))' }}>{fmtShort(-saved, baseCur)}</b> this month.</>
        ),
      };
    }
    return null;
  }, [pace, month.income, month.expense, rate, baseCur]);

  return (
    <div>
      {/* Desktop page header (board D1) — mobile identity lives in MobileHeader. */}
      <div className="hidden sm:flex mb-5 items-end justify-between gap-3">
        <div>
          <h1 className="display-italic text-4xl text-ink mb-1.5">
            {(() => { const who = (profile.name || '').trim().split(/\s+/)[0]; return who ? `${greet()}, ${who}` : greet(); })()}
          </h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            Family finance overview · {monthName(mk)}
          </p>
        </div>
        <button className="btn-primary flex-shrink-0" onClick={() => openAddTxn()}>+ Add transaction</button>
      </div>

      {/* v9.7 — estimated starting picture from onboarding; clears as real data lands. */}
      <StartingBaselineBand />

      {/* Board M1 — mobile status banner (desktop carries this in the insight
          cards). Budget-pace nudge when a current-month budget exists, else a
          this-month savings status. */}
      {banner && (
        <div
          className="sm:hidden flex items-center gap-2.5 rounded-[13px] px-3.5 py-2.5 mb-3.5"
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
      <div className="flex sm:grid sm:grid-cols-2 gap-3.5 mb-3.5 overflow-x-auto sm:overflow-visible snap-x snap-mandatory sm:snap-none [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
        <div className="snap-start shrink-0 basis-[86%] sm:basis-auto sm:shrink">
          <CashFlowHero series={netSeries} month={month} rate={rate} baseCur={baseCur} mk={mk} />
        </div>
        <div className="snap-start shrink-0 basis-[86%] sm:basis-auto sm:shrink">
          <NetWorthHero ta={ta} tl={tl} baseCur={baseCur} />
        </div>
      </div>

      {/* Pulse + desktop metric tiles / insight spine-cards (board D1). */}
      <div className="grid sm:grid-cols-[230px_1fr] gap-3.5 mb-3.5">
        <div>
          <PulseBlock pulse={pulse} />
          {/* #7 — actionable next step; board mobile keeps this as the one nudge line. */}
          <Link to={advice.to} className="sm:hidden mt-2 flex items-start gap-1.5 text-[0.76rem] text-ink-mid hover:text-ink px-1">
            <span>{advice.text}</span><ArrowRight size={13} className="text-coral shrink-0 mt-0.5" />
          </Link>
        </div>
        <div className="hidden sm:flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
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
            <motion.div className="grid grid-cols-2 gap-3" variants={staggerContainer} initial="hidden" animate="visible">
              {insights.slice(0, 4).map((c, i) => {
                const tone = c.cls === 'chip-good' ? 'hsl(var(--sage))'
                           : c.cls === 'chip-warn' ? 'hsl(var(--honey))'
                           : c.cls === 'chip-alert' ? 'hsl(var(--terra))'
                           :                          'hsl(var(--denim))';
                const body = (
                  <div className="relative rounded-r2 py-3 pr-4 pl-[18px] h-full overflow-hidden"
                    style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
                    <span aria-hidden className="absolute left-0 top-[10px] bottom-[10px] w-[3px] rounded-r" style={{ background: tone }} />
                    <div className="text-[13px] font-medium text-ink leading-snug">{c.icon} {c.text}</div>
                    {c.detail && <div className="text-[11.5px] text-ink-dim mt-0.5 leading-snug">{c.detail}</div>}
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
      <div className="grid lg:grid-cols-3 gap-3.5 mb-3.5">
        <Panel
          title={t('budget-progress')}
          action={<Link to="/budgets" className="font-mono text-[0.6rem] tracking-wider uppercase text-coral hover:opacity-70">{t('view-all')}</Link>}
        >
          {budgetView.length === 0 ? (
            <EmptyState icon="◎" message="No budgets yet" />
          ) : (
            <div className="px-4 pt-2.5 pb-1.5">
              {budgetView.slice(0, 5).map(b => {
                const cat = getCat(b.category ?? '');
                const limitBase = convert(b.limit, b.currency, baseCur, rates);
                const spent = spend[b.category ?? ''] || 0;
                const pct = limitBase > 0 ? Math.min(100, Math.round(spent / limitBase * 100)) : 0;
                // Board trough bands: <80 good · 80–99 warn · 100 crit.
                const color = pct >= 100 ? 'hsl(var(--terra))' : pct >= 80 ? 'hsl(var(--honey))' : 'hsl(var(--sage))';
                return (
                  <div key={b.id} className="mb-3 last:mb-1.5">
                    <div className="flex justify-between items-center mb-1.5 text-[12.5px]">
                      <span className="text-ink">{cat.icon} {cat.label}</span>
                      <span className="num text-ink-mid">{fmtShort(spent, baseCur)} / {fmtShort(limitBase, baseCur)}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
                      <div className="h-full rounded-full chart-grow transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel
          title={t('recent-transactions')}
          action={<Link to="/transactions" className="font-mono text-[0.6rem] tracking-wider uppercase text-coral hover:opacity-70">{t('view-all')}</Link>}
        >
          {recent.length === 0 ? (
            <EmptyState icon={<Pip size={44} />} message="No transactions yet" />
          ) : (
            recent.map(txn => <RecentRow key={txn.id} txn={txn} onEdit={openEditTxn} />)
          )}
        </Panel>

        <Panel title={t('spending-by-category')} sub={t('this-month')}
          action={<Link to="/reports" className="font-mono text-[0.6rem] tracking-wider uppercase text-coral hover:opacity-70">View All →</Link>}>
          {donutData.length === 0
            ? <EmptyState icon="🥯" message="No expenses this month" />
            : <CategoryDonut data={donutData} currency={baseCur} monthKey={mk} />
          }
        </Panel>
      </div>

      {/* Debt overview. */}
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
          className="glass-panel absolute top-0 z-[2] px-2.5 py-1.5 rounded-[10px] text-center whitespace-nowrap pointer-events-none"
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

/** Board pulse composite — conic ring + the four component meters. Mobile is
 *  the bare ring-beside-meters row (M1); desktop is the titled card (D1). */
function PulseBlock({ pulse }: { pulse: PulseScore }) {
  const score = pulse.total;
  const colorOf = (v: number) => v >= 70 ? 'hsl(var(--sage))' : v >= 40 ? 'hsl(var(--honey))' : 'hsl(var(--terra))';
  const band = score == null ? 'No data yet' : score >= 80 ? 'Excellent' : score >= 60 ? 'On track' : score >= 40 ? 'Watch' : 'At risk';
  const deg = ((score ?? 0) / 100) * 360;

  const ring = (size: number, fontSize: number) => (
    <div className="rounded-full flex-shrink-0" style={{ width: size, height: size, padding: 7, boxShadow: 'var(--neu-inset)' }}>
      <div className="w-full h-full rounded-full relative flex items-center justify-center"
        style={{ background: score == null ? 'var(--sunken)' : `conic-gradient(${colorOf(score)} ${deg}deg, var(--sunken) ${deg}deg)` }}>
        <div aria-hidden className="absolute rounded-full" style={{ inset: 10, background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }} />
        <div className="relative z-[1] text-center">
          <div className="num font-display font-bold leading-none" style={{ fontSize, color: score == null ? 'var(--ff-ink-3)' : colorOf(score) }}>
            {score ?? '—'}
          </div>
          <div className="font-mono text-[7.5px] tracking-[0.15em] uppercase text-ink-dim mt-1">{band}</div>
        </div>
      </div>
    </div>
  );

  const rows: [string, number, boolean][] = [
    ['Budgets', pulse.components.budget, pulse.applicable.budget],
    ['Savings', pulse.components.savings, pulse.applicable.savings],
    ['Trend',   pulse.components.trend,   pulse.applicable.trend],
    ['Debt',    pulse.components.debt,    pulse.applicable.debt],
  ];
  const meters = (gap: string) => (
    <div className={`flex flex-col ${gap}`}>
      {rows.map(([label, v, applicable]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="font-mono text-[8.5px] tracking-[0.15em] uppercase text-ink-dim w-[52px] flex-shrink-0">{label}</span>
          <div className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
            {applicable && <i className="block h-full rounded-full chart-grow" style={{ width: `${v}%`, background: colorOf(v) }} />}
          </div>
          <span className="num text-[11px] w-6 text-right" style={{ color: applicable ? colorOf(v) : 'var(--ff-ink-3)' }}>
            {applicable ? v : '—'}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* M1 — bare composite: ring left, meters right. */}
      <div className="sm:hidden flex items-center gap-3">
        <Link to="/reports" aria-label={`Family Pulse ${score ?? '—'} of 100 — open reports`} className="rounded-full">
          {ring(108, 28)}
        </Link>
        <div className="flex-1 min-w-0">{meters('gap-1.5')}</div>
      </div>
      {/* D1 — titled pulse card. */}
      <div className="hidden sm:block rounded-r3 p-4 text-center h-full" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
        <div className="font-mono text-[8.5px] tracking-[0.15em] uppercase mb-3" style={{ color: 'var(--accent)' }}>Family Pulse Score™</div>
        <Link to="/reports" aria-label={`Family Pulse ${score ?? '—'} of 100 — open reports`} className="inline-block rounded-full mb-3">
          {ring(118, 32)}
        </Link>
        <div className="text-left">{meters('gap-[5px]')}</div>
      </div>
    </>
  );
}

/** Board D1 §.metric — KPI tile with a bottom accent bar. */
function MetricTile({ label, value, spine, to }: { label: string; value: ReactNode; spine: string; to: string }) {
  return (
    <Link to={to} className="relative block rounded-r2 px-4 py-3.5 overflow-hidden"
      style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
      <span aria-hidden className="absolute left-0 right-0 bottom-0 h-[3px]" style={{ background: spine }} />
      <div className="font-mono text-[8.5px] tracking-[0.15em] uppercase text-ink-dim mb-2">{label}</div>
      <div className="num font-bold text-[22px] leading-tight text-ink">{value}</div>
    </Link>
  );
}

/** Board M1 recent row — tinted category tile · name + "category · when" · amount. */
function RecentRow({ txn, onEdit }: { txn: Transaction; onEdit: (t: Transaction) => void }) {
  const cat = getCat(txn.category ?? '');
  const emoji = txn.type === 'transfer' ? '🔄' : txn.type === 'investment' ? '📈' : cat.icon;
  const catLabel = txn.type === 'transfer' ? 'Transfer' : txn.type === 'investment' ? 'Investment' : cat.label;
  const when = txn.date === today() ? 'Today' : formatDate(txn.date);
  const isIncome = txn.type === 'income';
  const isExpense = txn.type === 'expense';
  return (
    <button type="button" onClick={() => onEdit(txn)}
      className="w-full flex items-center gap-[11px] px-4 py-[11px] border-b border-line last:border-b-0 text-left hover:bg-bg3 transition-colors cursor-pointer">
      <div className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center text-[16px] flex-shrink-0"
        style={{ background: `color-mix(in srgb, ${cat.color || 'hsl(var(--denim))'} 15%, transparent)`, boxShadow: 'var(--neu-sm)' }} aria-hidden>
        {emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[13.5px] text-ink truncate">{txn.description || catLabel}</div>
        <div className="num text-[10px] text-ink-dim">{catLabel} · {when}</div>
      </div>
      <span className={`num font-semibold text-[13.5px] flex-shrink-0 ${isIncome ? 'text-sage' : 'text-ink'}`}>
        {isExpense ? '−' : isIncome ? '+' : ''}<Money amount={txn.split?.isSplit ? txn.split.yourShare : txn.amount} currency={txn.currency} maxChars={9} />
      </span>
    </button>
  );
}
