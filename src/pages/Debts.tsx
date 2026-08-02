import { useState, useMemo, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Trash2, ChevronDown, ChevronUp, CreditCard } from 'lucide-react';
import { useStore } from '../store';
import { useTranslation } from '../hooks';
import { Panel } from '../components/ui/Card';
import { fmt, convert, today } from '../lib/format';
import Money from '../components/ui/Money';
import { computeEmi, splitEmiPortions, totalLiabilities, totalReceivables, totalMonthlyDebtPayment, simulatePayoffInterest } from '../lib/calculations';
import { DEBT_TYPES } from '../constants';
import { getMoneyMapMode } from '../lib/featureFlags';
import type { Debt } from '../types';

type DebtTab = 'all' | 'owed_by_me' | 'owed_to_me';

export default function Debts() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const debts        = useStore(s => s.debts);
  const profile      = useStore(s => s.profile);
  const rates        = useStore(s => s.rates);
  const transactions = useStore(s => s.transactions);
  const removeDebt   = useStore(s => s.removeDebt);
  // v9.4.2 — debt payment now launches the TransactionFormModal.
  const openAddTxn   = useStore(s => s.openAddTxn);
  const toast        = useStore(s => s.toast);
  const openAddDebt  = useStore(s => s.openAddDebt);
  const openEditDebt = useStore(s => s.openEditDebt);
  const updateProfile = useStore(s => s.updateProfile);

  const [expandId, setExpandId]   = useState<string | null>(null);
  // Board D2 desktop — which debt the right-hand detail panel shows (defaults
  // to the priority debt at the top of the payoff order).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // v7.2 — direction tabs are flag-gated. Off-mode households see the
  // legacy single-list UI; Money Map exposes Owed-by-me / Owed-to-me.
  const showDirectionTabs = getMoneyMapMode() !== 'off';
  const [tab, setTab] = useState<DebtTab>('all');

  const c    = profile.baseCurrency;
  const totalDebt    = totalLiabilities(debts, c, rates);
  const totalOwedToMe = totalReceivables(debts, c, rates);
  const totalMinPay  = totalMonthlyDebtPayment(debts, c, rates);
  const income       = transactions.filter(tx => tx.type === 'income')
    .reduce((s, tx) => s + convert(tx.amount, tx.currency, c, rates), 0) || 1;
  const dti          = (totalMinPay / (income / 12)) * 100;

  // Board M3 — the strategy toggle states its honest trade-off. We simulate the
  // full payoff cascade under BOTH orderings (base currency) and compare total
  // interest; the delta is real, not a guess. Equal minimums with no headroom →
  // no difference, which the sim reflects.
  const strategyTradeoff = useMemo(() => {
    if (debts.filter(d => (d.direction || 'owed_by_me') !== 'owed_to_me' && d.currentBalance > 0).length < 2) return null;
    const av = simulatePayoffInterest(debts, profile.extraPayment, 'avalanche', c, rates);
    const sn = simulatePayoffInterest(debts, profile.extraPayment, 'snowball', c, rates);
    if (!av.terminates || !sn.terminates) return null;
    const sel = profile.payoffStrategy === 'snowball' ? sn : av;
    const oth = profile.payoffStrategy === 'snowball' ? av : sn;
    const delta = oth.totalInterest - sel.totalInterest;   // >0 ⇒ selected saves
    return { delta, sel, oth };
  }, [debts, profile.extraPayment, profile.payoffStrategy, c, rates]);

  const filtered = showDirectionTabs && tab !== 'all'
    ? debts.filter(d => (d.direction || 'owed_by_me') === tab)
    : debts;

  const activeCount = debts.filter(d => d.currentBalance > 0).length;

  const sorted = [...filtered].sort((a, b) => {
    if (profile.payoffStrategy === 'snowball')
      return convert(a.currentBalance, a.currency, c, rates) - convert(b.currentBalance, b.currency, c, rates);
    return b.interestRate - a.interestRate;
  });

  // Desktop detail (D2): the selected debt, falling back to the priority.
  const detailDebt = sorted.find(d => d.id === selectedId) ?? sorted[0];

  function openAdd() { openAddDebt(); }
  function openEdit(d: Debt) { openEditDebt(d); }

  async function del(id: string) {
    if (!confirm('Delete this debt?')) return;
    await removeDebt(id);
    toast('Debt removed', 'info');
  }

  // v9.4.2 — launch TransactionFormModal pre-seeded for this debt's EMI.
  function recordPayment(d: Debt) {
    openAddTxn({
      type: 'expense',
      category: 'loan_emi',
      amount: d.minimumPayment,
      currency: d.currency,
      description: `${d.name} — EMI payment`,
      date: today(),
      linkedDebtId: d.id,
    });
  }

  function monthsToPayoff(d: Debt): number | null {
    if (!d.currentBalance || d.currentBalance <= 0) return 0;
    const r = d.interestRate / 100 / 12;
    const pmt = d.minimumPayment + convert(profile.extraPayment, c, d.currency, rates);
    if (pmt <= 0) return null;
    if (r === 0) return Math.ceil(d.currentBalance / pmt);
    const n = -Math.log(1 - (r * d.currentBalance) / pmt) / Math.log(1 + r);
    return isFinite(n) && n > 0 ? Math.ceil(n) : null;
  }

  return (
    <div>
      <div className="flex justify-between items-start mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="display-italic text-4xl text-ink mb-1.5">{t('debts')}</h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            {profile.payoffStrategy === 'avalanche' ? 'Avalanche strategy · highest APR first' : 'Snowball strategy · smallest balance first'}
          </p>
        </div>
        <button className="btn-primary" onClick={openAdd}>+ Add Debt</button>
      </div>

      {/* Summary strip — board M3: balances in NEUTRAL ink (loss is
          information, not alarm); honey marks the monthly obligation; DTI keeps
          its healthy/watch/high semantic colour. */}
      {debts.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: 'Total Debt',     node: <Money amount={totalDebt} currency={c} maxChars={11} className="text-ink" />,                   cls: 'text-ink' },
            { label: 'Min. Monthly',   node: <Money amount={totalMinPay} currency={c} maxChars={11} className="text-honey" />,              cls: 'text-honey' },
            { label: 'Debt-to-Income', node: <span>{`${dti.toFixed(1)}%`}</span>,                                                            cls: dti > 36 ? 'text-terra' : dti > 25 ? 'text-honey' : 'text-sage' },
          ].map(s => (
            <div key={s.label} className="rounded-r3 p-4 text-center min-w-0" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
              <div className={`num text-xl font-semibold ${s.cls}`}>{s.node}</div>
              <div className="font-mono text-[0.6rem] tracking-widest text-ink-dim uppercase mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Board M3 — on-page strategy toggle: switching resorts the list live and
          restates the trade-off honestly (real interest delta from the payoff
          simulation, not a guess). Previously strategy was only changeable in
          Settings. */}
      {debts.length > 0 && (
        <div className="flex items-center gap-2.5 mb-4 flex-wrap">
          <div className="inline-flex gap-1 p-1 rounded-pill" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}
            role="tablist" aria-label="Payoff strategy">
            {(['avalanche', 'snowball'] as const).map(st => (
              <button key={st} role="tab" aria-selected={profile.payoffStrategy === st}
                onClick={() => updateProfile({ payoffStrategy: st })}
                className="h-[28px] px-4 rounded-pill border-none cursor-pointer font-display font-semibold text-[11.5px] capitalize"
                style={profile.payoffStrategy === st
                  ? { color: 'var(--accent)', boxShadow: 'var(--neu-inset)', background: 'color-mix(in srgb, var(--accent) 10%, var(--canvas))' }
                  : { color: 'var(--ff-ink-3)', background: 'transparent' }}>
                {st}
              </button>
            ))}
          </div>
          {strategyTradeoff && (
            <span className="text-[10.5px]">
              {strategyTradeoff.delta > 1
                ? <span className="text-sage">saves you {fmt(Math.round(strategyTradeoff.delta), c)} in interest</span>
                : strategyTradeoff.delta < -1
                  ? <span className="text-ink-dim">{fmt(Math.round(-strategyTradeoff.delta), c)} more interest — but frees a balance sooner</span>
                  : <span className="text-ink-dim">{profile.payoffStrategy === 'avalanche' ? 'targets the highest APR first' : 'clears the smallest balance first'}</span>}
            </span>
          )}
        </div>
      )}

      {/* v7.2 Money Map — direction tabs. Hidden when the flag is off
          to preserve the legacy single-list UX for un-migrated households. */}
      {showDirectionTabs && debts.length > 0 && (
        <div className="flex items-center bg-bg3 border border-line rounded-md p-0.5 gap-px mb-4">
          {([
            { k: 'all',         label: 'All' },
            { k: 'owed_by_me',  label: 'Owe' },
            { k: 'owed_to_me',  label: `Owed to me${totalOwedToMe > 0 ? ` · ${fmt(totalOwedToMe, c)}` : ''}` },
          ] as { k: DebtTab; label: string }[]).map(opt => (
            <button
              key={opt.k}
              onClick={() => setTab(opt.k)}
              className={`font-mono text-[0.62rem] tracking-[0.1em] uppercase font-medium px-3.5 py-1.5 rounded transition-all ${
                tab === opt.k ? 'bg-coral text-white shadow-1' : 'text-ink-mid hover:text-ink hover:bg-bg4'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <span className="font-mono text-[0.58rem] tracking-wider uppercase text-ink-dim ml-auto px-3">
            {activeCount} active {activeCount === 1 ? 'debt' : 'debts'}
          </span>
        </div>
      )}

      {/* Add/Edit form lives in <DebtFormModal /> mounted at App root */}

      {/* Debt list */}
      {debts.length === 0 ? (
        <Panel>
          <div className="px-6 py-14 text-center">
            <div className="text-4xl mb-3 opacity-60">🏦</div>
            <p className="text-ink-mid mb-4">No debts tracked. Add one to see your payoff plan.</p>
            <button className="btn-primary" onClick={openAdd}>Add First Debt</button>
          </div>
        </Panel>
      ) : sorted.length === 0 ? (
        <Panel>
          <div className="px-6 py-10 text-center">
            <p className="text-ink-mid text-sm">
              {tab === 'owed_to_me'
                ? 'No one owes you money right now.'
                : 'No debts in this view.'}
            </p>
          </div>
        </Panel>
      ) : (
        <>
        {/* Mobile / tablet — full cards list (priority ring inline). */}
        <div className="space-y-3 lg:hidden">
          {sorted.map((d, i) => {
            const balBase   = convert(d.currentBalance, d.currency, c, rates);
            const prinBase  = convert(d.principal, d.currency, c, rates);
            const paidPct   = prinBase > 0 ? Math.min(((prinBase - balBase) / prinBase) * 100, 100) : 0;
            const meta      = DEBT_TYPES[d.type] || DEBT_TYPES.other;
            const months    = monthsToPayoff(d);
            const emi       = computeEmi(d.currentBalance, d.interestRate, d.tenureMonths || months || 12);
            const { interest, principal: prinPay } = splitEmiPortions(d.currentBalance, d.interestRate, d.minimumPayment);
            const expanded  = expandId === d.id;

            return (
              <div key={d.id} className="rounded-r3 overflow-hidden" style={{ background: 'var(--canvas)', boxShadow: i === 0 ? 'var(--neu), 0 0 0 1.5px color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--neu-sm)' }}>
                {/* Priority badge */}
                {i === 0 && (
                  <div className="px-4 py-1.5 flex items-center gap-2" style={{ background: 'var(--accent)' }}>
                    <span className="font-mono text-[0.6rem] tracking-widest uppercase" style={{ color: 'var(--accent-ink)' }}>
                      {profile.payoffStrategy === 'avalanche' ? '⚡ Highest APR — pay this first' : '🎯 Smallest balance — pay this first'}
                    </span>
                  </div>
                )}
                <div className="p-5">
                  {/* Board C — payoff-journey ring on the priority debt. */}
                  {i === 0 && (
                    <div className="flex items-center gap-3.5 mb-4">
                      <PayoffRing pct={paidPct} monthsLeft={months} />
                      <div>
                        <div className="mono-label mb-0.5">Payoff journey</div>
                        <div className="text-[0.82rem] text-ink-mid leading-snug">
                          {fmt(prinBase - balBase, c)} cleared of {fmt(prinBase, c)}.
                          {months !== null && months > 0 ? ` On track to clear in ${months} month${months === 1 ? '' : 's'}.` : months === 0 ? ' Cleared! 🎉' : ''}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl">{meta.icon}</span>
                      <div>
                        <div className="font-semibold text-ink">{d.name}</div>
                        {d.lender && <div className="font-mono text-[0.62rem] tracking-wider text-ink-dim">{d.lender}{d.account ? ` · ${d.account}` : ''}</div>}
                      </div>
                    </div>
                    <div className="text-right min-w-0">
                      {/* Board M3 — balance in neutral ink, not terra. */}
                      <div className="text-lg font-semibold text-ink"><Money amount={balBase} currency={c} maxChars={12} /></div>
                      <div className="font-mono text-[0.62rem] tracking-wider text-ink-dim">{d.interestRate}% APR</div>
                    </div>
                  </div>

                  {/* Payoff progress bar */}
                  <div className="h-1.5 bg-bg3 rounded-full mb-3 overflow-hidden">
                    <div className="h-full rounded-full bg-sage chart-grow transition-all" style={{ width: `${paidPct}%` }} />
                  </div>
                  <div className="text-[0.75rem] text-ink-dim mb-3">
                    {paidPct.toFixed(0)}% paid off · {fmt(prinBase - balBase, c)} cleared
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-bg3 border border-line rounded-md p-2 text-center">
                      <div className="num text-sm font-semibold text-ink">{fmt(convert(d.minimumPayment, d.currency, c, rates), c)}</div>
                      <div className="font-mono text-[0.58rem] tracking-wider text-ink-dim uppercase">Min pay</div>
                    </div>
                    <div className="bg-bg3 border border-line rounded-md p-2 text-center">
                      <div className="num text-sm font-semibold text-honey">{fmt(convert(interest, d.currency, c, rates), c)}</div>
                      <div className="font-mono text-[0.58rem] tracking-wider text-ink-dim uppercase">Interest</div>
                    </div>
                    <div className="bg-bg3 border border-line rounded-md p-2 text-center">
                      <div className="text-sm font-semibold text-sage">{months !== null ? `${months}mo` : '∞'}</div>
                      <div className="font-mono text-[0.58rem] tracking-wider text-ink-dim uppercase">To payoff</div>
                    </div>
                  </div>

                  {/* EMI breakdown expanded */}
                  {expanded && d.tenureMonths && (
                    <div className="bg-bg3 border border-line rounded-md p-3 mb-3 text-[0.82rem]">
                      <div className="font-mono text-[0.6rem] tracking-widest text-ink-dim uppercase mb-2">EMI Breakdown</div>
                      <div className="grid grid-cols-2 gap-y-1">
                        <span className="text-ink-mid">Calculated EMI</span><span className="num text-right font-semibold">{fmt(convert(emi, d.currency, c, rates), c)}</span>
                        <span className="text-ink-mid">Interest portion</span><span className="num text-right text-honey font-semibold">{fmt(convert(interest, d.currency, c, rates), c)}</span>
                        <span className="text-ink-mid">Principal portion</span><span className="num text-right text-sage font-semibold">{fmt(convert(prinPay, d.currency, c, rates), c)}</span>
                        <span className="text-ink-mid">Remaining months</span><span className="text-right font-semibold">{d.remainingMonths ?? d.tenureMonths}</span>
                      </div>
                    </div>
                  )}


                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button className="btn-primary btn-sm" onClick={() => recordPayment(d)}>
                      <CreditCard size={13} strokeWidth={1.8} /> Record Payment
                    </button>
                    <button className="btn-ghost btn-sm" onClick={() => setExpandId(expanded ? null : d.id)}>
                      {expanded ? <><ChevronUp size={13} strokeWidth={1.8}/> Hide Details</> : <><ChevronDown size={13} strokeWidth={1.8}/> EMI Details</>}
                    </button>
                    {/* §8 — debt drill-down: all payments/EMIs (or receivable repayments). */}
                    <button className="btn-ghost btn-sm" onClick={() => navigate(`/transactions?debtId=${d.id}`)}>
                      Payments
                    </button>
                    <div className="ml-auto flex gap-1">
                      <button className="row-action" onClick={() => openEdit(d)} aria-label={`Edit ${d.name}`} title="Edit">
                        <Pencil size={14} strokeWidth={1.6} />
                      </button>
                      <button className="row-action danger" onClick={() => del(d.id)} aria-label={`Delete ${d.name}`} title="Delete">
                        <Trash2 size={14} strokeWidth={1.6} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Board D2 desktop — payoff order (left) + the priority/selected debt
            expanded (right). Clicking a numbered row selects it into the panel. */}
        <div className="hidden lg:grid lg:grid-cols-[minmax(0,440px)_1fr] lg:gap-6 lg:items-start">
          <div className="space-y-2">
            <div className="mono-label mb-1">Payoff order</div>
            {sorted.map((d, i) => {
              const balBase  = convert(d.currentBalance, d.currency, c, rates);
              const prinBase = convert(d.principal, d.currency, c, rates);
              const paidPct  = prinBase > 0 ? Math.min(((prinBase - balBase) / prinBase) * 100, 100) : 0;
              const meta     = DEBT_TYPES[d.type] || DEBT_TYPES.other;
              const active   = d.id === detailDebt.id;
              return (
                <button key={d.id} type="button" onClick={() => setSelectedId(d.id)}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-r2 text-left border-none cursor-pointer"
                  style={active
                    ? { background: 'var(--canvas)', boxShadow: 'var(--neu-sm), 0 0 0 1.5px var(--accent)' }
                    : { background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
                  <span className="num w-[22px] font-bold flex-shrink-0 text-center" style={{ color: i === 0 ? 'var(--accent)' : 'var(--ff-ink-3)' }}>{i + 1}</span>
                  <span className="text-base flex-shrink-0" aria-hidden>{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[13.5px] text-ink truncate">{d.name}</div>
                    <div className="num text-[10px] text-ink-dim">{d.interestRate}% APR{paidPct > 0 ? ` · ${paidPct.toFixed(0)}% paid` : ''}</div>
                  </div>
                  <Money amount={balBase} currency={c} maxChars={10} className="num font-semibold text-ink flex-shrink-0" />
                </button>
              );
            })}
            {totalOwedToMe > 0 && (
              <div className="text-[11px] text-ink-dim px-1 pt-1">
                Owed to me · <b className="num text-denim">{fmt(totalOwedToMe, c)}</b> — receivables, linked from Splits.
              </div>
            )}
          </div>

          {detailDebt && (() => {
            const d        = detailDebt;
            const balBase  = convert(d.currentBalance, d.currency, c, rates);
            const prinBase = convert(d.principal, d.currency, c, rates);
            const paidPct  = prinBase > 0 ? Math.min(((prinBase - balBase) / prinBase) * 100, 100) : 0;
            const months   = monthsToPayoff(d);
            const { interest, principal: prinPay } = splitEmiPortions(d.currentBalance, d.interestRate, d.minimumPayment);
            const cleared  = prinBase - balBase;
            const isPriority = d.id === sorted[0].id;
            const freeBy = months != null && months > 0
              ? new Date(new Date().setMonth(new Date().getMonth() + months)).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
              : null;
            return (
              <div className="rounded-r3 p-5 lg:sticky lg:top-[124px]"
                style={{ background: 'var(--canvas)', boxShadow: 'var(--neu), 0 0 0 1.5px color-mix(in srgb, var(--accent) 40%, transparent)' }}>
                <div className="flex items-center gap-2 mb-4">
                  {isPriority && (
                    <span className="font-mono text-[9.5px] tracking-wider uppercase px-2 py-0.5 rounded-pill"
                      style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent)' }}>⚡ Pay this first</span>
                  )}
                  <span className="mono-label">{profile.payoffStrategy === 'avalanche' ? 'highest APR' : 'smallest balance'}</span>
                  <div className="ml-auto flex gap-1">
                    <button className="row-action" onClick={() => openEdit(d)} aria-label={`Edit ${d.name}`} title="Edit"><Pencil size={14} strokeWidth={1.6} /></button>
                    <button className="row-action danger" onClick={() => del(d.id)} aria-label={`Delete ${d.name}`} title="Delete"><Trash2 size={14} strokeWidth={1.6} /></button>
                  </div>
                </div>
                <div className="flex items-center gap-5 mb-4">
                  <PayoffRing pct={paidPct} monthsLeft={months} />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-[17px] text-ink truncate">{d.name}</div>
                    <div className="num text-[11px] text-ink-dim mb-1">{d.lender ? d.lender + ' · ' : ''}{d.interestRate}% APR</div>
                    <Money amount={balBase} currency={c} maxChars={12} className="num text-[26px] font-bold text-ink" />
                    <div className="text-[12px] text-sage">
                      {freeBy ? `Debt-free by ${freeBy} · ${fmt(cleared, c)} cleared so far` : months === 0 ? 'Cleared! 🎉' : `${fmt(cleared, c)} cleared`}
                    </div>
                  </div>
                  <button className="btn-primary btn-sm self-start flex-shrink-0" onClick={() => recordPayment(d)}>
                    <CreditCard size={13} strokeWidth={1.8} /> Record
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {([
                    ['min pay',      fmt(convert(d.minimumPayment, d.currency, c, rates), c), 'text-ink'],
                    ['interest/mo',  fmt(convert(interest, d.currency, c, rates), c),          'text-honey'],
                    ['principal/mo', fmt(convert(prinPay, d.currency, c, rates), c),           'text-sage'],
                    ['months left',  months != null ? String(months) : '∞',                    'text-sage'],
                  ] as [string, string, string][]).map(([lbl, val, cls]) => (
                    <div key={lbl} className="text-center py-2.5 rounded-r2" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
                      <div className={`num text-[15px] font-bold ${cls}`}>{val}</div>
                      <div className="font-mono text-[7.5px] tracking-wider uppercase text-ink-dim mt-0.5">{lbl}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <button className="btn-ghost btn-sm" onClick={() => navigate(`/transactions?debtId=${d.id}`)}>Payments →</button>
                  {profile.extraPayment > 0 && (
                    <span className="ml-auto font-mono text-[9px] tracking-wider uppercase text-ink-dim">extra payment: {fmt(profile.extraPayment, c)}/mo</span>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
        </>
      )}
    </div>
  );
}

/** Board C — circular payoff-journey ring: % of principal cleared + a projected
 *  debt-free month. Presentation only (paidPct / monthsLeft are already computed). */
function PayoffRing({ pct, monthsLeft }: { pct: number; monthsLeft: number | null }) {
  const r = 30, circ = 2 * Math.PI * r;
  const off = circ * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const free = monthsLeft != null && monthsLeft > 0
    ? (() => { const d = new Date(); d.setMonth(d.getMonth() + monthsLeft); return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }); })()
    : null;
  return (
    <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
      <svg width="76" height="76" viewBox="0 0 76 76">
        <circle cx="38" cy="38" r={r} fill="none" stroke="var(--sunken)" strokeWidth="7" />
        <circle cx="38" cy="38" r={r} fill="none" stroke="hsl(var(--sage))" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={off} transform="rotate(-90 38 38)"
          className="ring-grow" style={{ '--ring-from': circ } as CSSProperties} />
        <text x="38" y="43" textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--ff-ink)" className="num">{Math.round(pct)}%</text>
      </svg>
      {free && <div className="mono-label">by {free}</div>}
    </div>
  );
}
