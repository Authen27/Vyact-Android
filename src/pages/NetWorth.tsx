import { useStore } from '../store';
import { useEffect } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from '../hooks';
import { Panel } from '../components/ui/Card';
import { fmt, convert, nowMonthKey } from '../lib/format';
import Money from '../components/ui/Money';
import { totalAssets, totalLiabilities, totalReceivables, liquidAssets, totalMonthlyDebtPayment, monthlyData } from '../lib/calculations';
import { ASSET_TYPES, DEBT_TYPES } from '../constants';
import type { Asset } from '../types';

const LIQUIDITIES = [
  { key: 'liquid', label: 'Liquid',     desc: 'Cash, checking, savings' },
  { key: 'short',  label: 'Short-term', desc: 'Investments, receivables' },
  { key: 'long',   label: 'Long-term',  desc: 'Real estate, retirement' },
] as const;

export default function NetWorth() {
  const { t } = useTranslation();
  const assets       = useStore(s => s.assets);
  const debts        = useStore(s => s.debts);
  const transactions = useStore(s => s.transactions);
  const profile      = useStore(s => s.profile);
  const rates        = useStore(s => s.rates);
  const removeAsset  = useStore(s => s.removeAsset);
  const toast        = useStore(s => s.toast);
  const openAddAsset  = useStore(s => s.openAddAsset);
  const openEditAsset = useStore(s => s.openEditAsset);

  // Remind once per mount if any liquid (bank/cash) balance is stale (>30 days).
  useEffect(() => {
    const now = Date.now();
    const stale = assets.some(a => {
      const kind = ASSET_TYPES[a.type]?.liquidity;
      if (kind !== 'liquid' && kind !== 'short') return false;
      if (!a.lastUpdated) return true;
      const days = (now - new Date(a.lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
      return days > 30;
    });
    if (stale) {
      toast('Some bank or card balances haven’t been updated in over 30 days — review your accounts for accuracy.', 'warning');
    }
    // Run once on mount; re-running on every asset edit would spam the toast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const c   = profile.baseCurrency;
  const ta  = totalAssets(assets, c, rates);
  const tl  = totalLiabilities(debts, c, rates);
  // v7.1 Money Map — receivables (`direction === 'owed_to_me'`) are
  // money owed back to the household. They count toward Net Worth but
  // surface as a separate line item rather than being merged into
  // Assets, per the spec's privacy / clarity requirement (U-3).
  const tr  = totalReceivables(debts, c, rates);
  const nw  = ta + tr - tl;
  const la  = liquidAssets(assets, c, rates);
  const tdp = totalMonthlyDebtPayment(debts, c, rates);
  const { income, expense } = monthlyData(transactions, nowMonthKey(), c, rates);
  const monthlyIncome = income || 1;

  // Financial ratios
  const liquidityRatio   = expense > 0 ? la / expense : 0;
  const debtToAsset      = ta > 0 ? tl / ta * 100 : 0;
  const emergencyCover   = expense > 0 ? la / expense : 0;
  const savingsRatio     = monthlyIncome > 0 ? ((monthlyIncome - expense) / monthlyIncome) * 100 : 0;

  function openAdd() { openAddAsset(); }
  function openEdit(a: Asset) { openEditAsset(a); }

  async function del(id: string) {
    if (!confirm('Delete this asset?')) return;
    await removeAsset(id);
    toast('Asset removed', 'info');
  }

  const byLiquidity = (liq: Asset['liquidity']) =>
    assets.filter(a => a.liquidity === liq);

  return (
    <div>
      <div className="flex justify-between items-start mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="display-italic text-4xl text-ink mb-1.5">{t('networth')}</h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            Balance sheet · assets vs liabilities
          </p>
        </div>
        <button className="btn-primary" onClick={openAdd}>+ Add Asset</button>
      </div>

      {/* Net Worth hero */}
      <div className={`rounded-2xl p-7 mb-4 text-center border ${nw >= 0 ? 'bg-sage/8 border-sage/20' : 'bg-terra/8 border-terra/20'}`}>
        <div className="font-mono text-[0.65rem] tracking-[0.2em] uppercase text-ink-dim mb-2">Net Worth</div>
        <div className={`text-5xl font-bold mb-1 ${nw >= 0 ? 'text-sage' : 'text-terra'}`}>
          <Money amount={nw} currency={c} maxChars={11} />
        </div>
        <div className="flex justify-center gap-6 mt-4 text-sm flex-wrap">
          <div className="text-center">
            <div className="font-semibold text-sage"><Money amount={ta} currency={c} maxChars={11} /></div>
            <div className="font-mono text-[0.6rem] tracking-widest text-ink-dim uppercase">Assets</div>
          </div>
          {tr > 0 && (
            <>
              <div className="text-ink-dim self-center text-lg">+</div>
              <div className="text-center">
                <div className="font-semibold text-denim"><Money amount={tr} currency={c} maxChars={11} /></div>
                <div className="font-mono text-[0.6rem] tracking-widest text-ink-dim uppercase">Owed to me</div>
              </div>
            </>
          )}
          <div className="text-ink-dim self-center text-lg">−</div>
          <div className="text-center">
            <div className="font-semibold text-terra"><Money amount={tl} currency={c} maxChars={11} /></div>
            <div className="font-mono text-[0.6rem] tracking-widest text-ink-dim uppercase">Liabilities</div>
          </div>
        </div>
      </div>

      {/* Financial ratios */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          {
            label: 'Liquidity Ratio',
            value: `${liquidityRatio.toFixed(1)}x`,
            sub: 'months liquid coverage',
            good: liquidityRatio >= 3,
            warn: liquidityRatio >= 1,
          },
          {
            label: 'Debt-to-Asset',
            value: `${debtToAsset.toFixed(1)}%`,
            sub: 'leverage ratio',
            good: debtToAsset < 30,
            warn: debtToAsset < 50,
          },
          {
            label: 'Emergency Cover',
            value: `${emergencyCover.toFixed(1)}mo`,
            sub: 'months of expenses',
            good: emergencyCover >= 6,
            warn: emergencyCover >= 3,
          },
          {
            label: 'Savings Ratio',
            value: `${savingsRatio.toFixed(1)}%`,
            sub: 'income saved this month',
            good: savingsRatio >= 20,
            warn: savingsRatio >= 10,
          },
        ].map(r => (
          <div key={r.label} className="bg-bg border border-line rounded-xl p-4">
            <div className={`text-xl font-semibold mb-0.5 ${r.good ? 'text-sage' : r.warn ? 'text-honey' : 'text-terra'}`}>
              {r.value}
            </div>
            <div className="text-[0.78rem] font-semibold text-ink mb-0.5">{r.label}</div>
            <div className="font-mono text-[0.58rem] tracking-wider text-ink-dim uppercase">{r.sub}</div>
          </div>
        ))}
      </div>

      {/* Add/Edit form lives in <AssetFormModal /> mounted at App root */}

      {/* Balance sheet split */}
      <div className="grid sm:grid-cols-2 gap-4">
        {/* Assets column */}
        <div>
          <h2 className="display-italic text-2xl text-ink mb-3">Assets</h2>
          {assets.length === 0 ? (
            <Panel>
              <div className="px-6 py-10 text-center">
                <p className="text-ink-mid text-sm mb-3">No assets added yet.</p>
                <button className="btn-primary text-sm" onClick={openAdd}>Add Asset</button>
              </div>
            </Panel>
          ) : (
            <div className="space-y-2">
              {LIQUIDITIES.map(liq => {
                const group = byLiquidity(liq.key as Asset['liquidity']);
                if (!group.length) return null;
                const groupTotal = group.reduce((s, a) => s + convert(a.value, a.currency, c, rates), 0);
                return (
                  <div key={liq.key}>
                    <div className="font-mono text-[0.6rem] tracking-widest text-ink-dim uppercase px-1 mb-1.5">
                      {liq.label} · {fmt(groupTotal, c)}
                    </div>
                    {group.map(a => {
                      const meta = ASSET_TYPES[a.type] || ASSET_TYPES.cash;
                      const valBase = convert(a.value, a.currency, c, rates);
                      return (
                        <div key={a.id} className="bg-bg border border-line rounded-lg px-4 py-3 flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <span>{meta.icon}</span>
                            <div>
                              <div className="text-[0.84rem] font-semibold text-ink">{a.name}</div>
                              {a.note && <div className="font-mono text-[0.6rem] tracking-wider text-ink-dim">{a.note}</div>}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="text-right min-w-0">
                              <Money amount={valBase} currency={c} maxChars={11} className="font-semibold text-sage text-[0.9rem]" />
                              {a.currency !== c && <div className="font-mono text-[0.58rem] text-ink-dim">{fmt(a.value, a.currency)}</div>}
                            </div>
                            <div className="flex gap-1">
                              <button className="row-action" aria-label={`Edit ${a.name}`} title="Edit" onClick={() => openEdit(a)}>
                                <Pencil size={14} strokeWidth={1.6} />
                              </button>
                              <button className="row-action danger" aria-label={`Delete ${a.name}`} title="Delete" onClick={() => del(a.id)}>
                                <Trash2 size={14} strokeWidth={1.6} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <div className="bg-sage/8 border border-sage/20 rounded-lg px-4 py-3 flex justify-between items-center min-w-0 gap-2">
                <span className="font-semibold text-sage">Total Assets</span>
                <Money amount={ta} currency={c} maxChars={12} className="font-semibold text-sage text-lg" />
              </div>
            </div>
          )}
        </div>

        {/* Liabilities column */}
        <div>
          <h2 className="display-italic text-2xl text-ink mb-3">Liabilities</h2>
          {debts.length === 0 ? (
            <Panel>
              <div className="px-6 py-10 text-center">
                <p className="text-ink-mid text-sm">No debts tracked. Go to Debts to add.</p>
              </div>
            </Panel>
          ) : (
            <div className="space-y-2">
              {debts.filter(d => (d.direction || 'owed_by_me') !== 'owed_to_me').map(d => {
                const { icon, label } = DEBT_TYPES[d.type] || DEBT_TYPES.other;
                const balBase = convert(d.currentBalance, d.currency, c, rates);
                return (
                  <div key={d.id} className="bg-bg border border-line rounded-lg px-4 py-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span>{icon}</span>
                      <div className="min-w-0">
                        <div className="text-[0.84rem] font-semibold text-ink truncate">{d.name}</div>
                        <div className="font-mono text-[0.6rem] tracking-wider text-ink-dim">{label} · {d.interestRate}% APR</div>
                      </div>
                    </div>
                    <div className="text-right min-w-0">
                      <Money amount={balBase} currency={c} maxChars={11} className="font-semibold text-terra text-[0.9rem]" />
                      {d.currency !== c && <div className="font-mono text-[0.58rem] text-ink-dim">{fmt(d.currentBalance, d.currency)}</div>}
                    </div>
                  </div>
                );
              })}
              <div className="bg-terra/8 border border-terra/20 rounded-lg px-4 py-3 flex justify-between items-center min-w-0 gap-2">
                <span className="font-semibold text-terra">Total Liabilities</span>
                <Money amount={tl} currency={c} maxChars={12} className="font-semibold text-terra text-lg" />
              </div>

              {/* v7.1 Money Map — receivables shown as a separate sub-list. */}
              {tr > 0 && (
                <>
                  <div className="font-mono text-[0.6rem] tracking-widest text-ink-dim uppercase px-1 mt-3 mb-1.5">
                    Owed to me · {fmt(tr, c)}
                  </div>
                  {debts.filter(d => d.direction === 'owed_to_me').map(d => {
                    const { icon, label } = DEBT_TYPES[d.type] || DEBT_TYPES.other;
                    const balBase = convert(d.currentBalance, d.currency, c, rates);
                    return (
                      <div key={d.id} className="bg-bg border border-denim/30 rounded-lg px-4 py-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span>{icon}</span>
                          <div className="min-w-0">
                            <div className="text-[0.84rem] font-semibold text-ink truncate">
                              {d.name}{d.counterpartyName ? ` · ${d.counterpartyName}` : ''}
                            </div>
                            <div className="font-mono text-[0.6rem] tracking-wider text-ink-dim">{label} · receivable</div>
                          </div>
                        </div>
                        <div className="text-right min-w-0">
                          <Money amount={balBase} currency={c} maxChars={11} className="font-semibold text-denim text-[0.9rem]" />
                          {d.currency !== c && <div className="font-mono text-[0.58rem] text-ink-dim">{fmt(d.currentBalance, d.currency)}</div>}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
