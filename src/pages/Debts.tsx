import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Trash2, ChevronDown, ChevronUp, CreditCard } from 'lucide-react';
import { useStore } from '../store';
import { useTranslation } from '../hooks';
import { Panel } from '../components/ui/Card';
import { fmt, convert, today } from '../lib/format';
import Money from '../components/ui/Money';
import { computeEmi, splitEmiPortions, totalLiabilities, totalReceivables, totalMonthlyDebtPayment } from '../lib/calculations';
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

  const [expandId, setExpandId]   = useState<string | null>(null);
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

  const filtered = showDirectionTabs && tab !== 'all'
    ? debts.filter(d => (d.direction || 'owed_by_me') === tab)
    : debts;

  const activeCount = debts.filter(d => d.currentBalance > 0).length;

  const sorted = [...filtered].sort((a, b) => {
    if (profile.payoffStrategy === 'snowball')
      return convert(a.currentBalance, a.currency, c, rates) - convert(b.currentBalance, b.currency, c, rates);
    return b.interestRate - a.interestRate;
  });

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

      {/* Summary strip */}
      {debts.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: 'Total Debt',     node: <Money amount={totalDebt} currency={c} maxChars={11} className="text-terra" />,                cls: 'text-terra' },
            { label: 'Min. Monthly',   node: <Money amount={totalMinPay} currency={c} maxChars={11} className="text-honey" />,              cls: 'text-honey' },
            { label: 'Debt-to-Income', node: <span>{`${dti.toFixed(1)}%`}</span>,                                                            cls: dti > 36 ? 'text-terra' : dti > 25 ? 'text-honey' : 'text-sage' },
          ].map(s => (
            <div key={s.label} className="bg-bg border border-line rounded-lg p-4 text-center min-w-0">
              <div className={`text-xl font-semibold ${s.cls}`}>{s.node}</div>
              <div className="font-mono text-[0.6rem] tracking-widest text-ink-dim uppercase mt-0.5">{s.label}</div>
            </div>
          ))}
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
        <div className="space-y-3">
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
              <div key={d.id} className="bg-bg border border-line rounded-xl overflow-hidden">
                {/* Priority badge */}
                {i === 0 && (
                  <div className="bg-coral px-4 py-1.5 flex items-center gap-2">
                    <span className="font-mono text-[0.6rem] tracking-widest text-white uppercase">
                      {profile.payoffStrategy === 'avalanche' ? '⚡ Highest APR — pay this first' : '🎯 Smallest balance — pay this first'}
                    </span>
                  </div>
                )}
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl">{meta.icon}</span>
                      <div>
                        <div className="font-semibold text-ink">{d.name}</div>
                        {d.lender && <div className="font-mono text-[0.62rem] tracking-wider text-ink-dim">{d.lender}{d.account ? ` · ${d.account}` : ''}</div>}
                      </div>
                    </div>
                    <div className="text-right min-w-0">
                      <div className="text-lg font-semibold text-terra"><Money amount={balBase} currency={c} maxChars={12} /></div>
                      <div className="font-mono text-[0.62rem] tracking-wider text-ink-dim">{d.interestRate}% APR</div>
                    </div>
                  </div>

                  {/* Payoff progress bar */}
                  <div className="h-1.5 bg-bg3 rounded-full mb-3 overflow-hidden">
                    <div className="h-full rounded-full bg-sage transition-all" style={{ width: `${paidPct}%` }} />
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
      )}
    </div>
  );
}
