import { useStore } from '../store';
import { useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from '../hooks';
import { Panel } from '../components/ui/Card';
import { fmt, convert, nowMonthKey } from '../lib/format';
import Money from '../components/ui/Money';
import { totalLiabilities, totalReceivables, monthlyData } from '../lib/calculations';
import { liveAssetRows, liveTotalAssets, type LiveAssetRow } from '../lib/accountBalance';
import { ASSET_TYPES, DEBT_TYPES } from '../constants';
import type { Asset, AccountKind } from '../types';

const KIND_ICON: Record<AccountKind, string> = {
  bank: '🏦', cash: '💵', credit_card: '💳', investment: '📈', loan: '🏛️',
};

const LIQUIDITIES = [
  { key: 'liquid', label: 'Liquid',     desc: 'Cash, checking, savings' },
  { key: 'short',  label: 'Short-term', desc: 'Investments, receivables' },
  { key: 'long',   label: 'Long-term',  desc: 'Real estate, retirement' },
] as const;

export default function NetWorth() {
  const { t } = useTranslation();
  const assets       = useStore(s => s.assets);
  const accountsState = useStore(s => s.accounts);
  const debts        = useStore(s => s.debts);
  const transactions = useStore(s => s.transactions);
  const profile      = useStore(s => s.profile);
  const rates        = useStore(s => s.rates);
  const removeAsset  = useStore(s => s.removeAsset);
  const toast        = useStore(s => s.toast);
  const openAddAsset  = useStore(s => s.openAddAsset);
  const openEditAsset = useStore(s => s.openEditAsset);

  const c = profile.baseCurrency;

  // Money-Model — Net Worth's asset side is LIVE: every spendable account
  // (cash/bank/investment) contributes its computed balance (opening + ledger
  // folds + reconciliation offset), not a frozen linked-asset snapshot. See
  // lib/accountBalance.ts `liveAssetRows` for the de-dup rule.
  const liveRows = useMemo(
    () => liveAssetRows(assets, accountsState, transactions, c, rates),
    [assets, accountsState, transactions, c, rates],
  );

  // Remind once per mount if any legacy (account-less) asset is stale (>30
  // days). Account-sourced rows are computed live from the ledger on every
  // render, so they can't go stale the way a hand-typed asset value can.
  useEffect(() => {
    const now = Date.now();
    const stale = assets.some(a => {
      if (liveRows.find(r => r.id === a.id)?.source !== 'asset') return false;
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

  const ta  = liveTotalAssets(liveRows);
  const tl  = totalLiabilities(debts, c, rates);
  // v7.1 Money Map — receivables (`direction === 'owed_to_me'`) are
  // money owed back to the household. They count toward Net Worth but
  // surface as a separate line item rather than being merged into
  // Assets, per the spec's privacy / clarity requirement (U-3).
  const tr  = totalReceivables(debts, c, rates);
  const nw  = ta + tr - tl;
  const la  = liveRows.filter(r => r.liquidity === 'liquid').reduce((s, r) => s + r.value, 0);
  const { income, expense } = monthlyData(transactions, nowMonthKey(), c, rates);
  const monthlyIncome = income || 1;

  // Financial ratios
  const liquidityRatio   = expense > 0 ? la / expense : 0;
  const debtToAsset      = ta > 0 ? tl / ta * 100 : 0;
  const emergencyCover   = expense > 0 ? la / expense : 0;
  const savingsRatio     = monthlyIncome > 0 ? ((monthlyIncome - expense) / monthlyIncome) * 100 : 0;

  // Board C — liquidity stacked bar totals (presentation of existing values).
  const liqMix = { liquid: 0, short: 0, long: 0 };
  for (const r of liveRows) {
    if (r.liquidity === 'liquid') liqMix.liquid += r.value;
    else if (r.liquidity === 'short') liqMix.short += r.value;
    else if (r.liquidity === 'long') liqMix.long += r.value;
  }
  const liqTot = liqMix.liquid + liqMix.short + liqMix.long || 1;
  const pct = (n: number) => `${(n / liqTot) * 100}%`;

  function openAdd() { openAddAsset(); }
  function openEdit(a: Asset) { openEditAsset(a); }

  async function del(id: string) {
    if (!confirm('Delete this asset?')) return;
    await removeAsset(id);
    toast('Asset removed', 'info');
  }

  const byLiquidity = (liq: LiveAssetRow['liquidity']) =>
    liveRows.filter(r => r.liquidity === liq);

  // Board M4 — a liquid/short LEGACY asset (no live account behind it) not
  // touched in 30+ days rides an inline dashed-honey "update?" chip (same
  // rule as the mount-time stale toast). Account-sourced rows never qualify.
  const isStale = (row: LiveAssetRow) => {
    if (row.source !== 'asset' || !row.asset) return false;
    const a = row.asset;
    const kind = ASSET_TYPES[a.type]?.liquidity;
    if (kind !== 'liquid' && kind !== 'short') return false;
    if (!a.lastUpdated) return true;
    return (Date.now() - new Date(a.lastUpdated).getTime()) / (1000 * 60 * 60 * 24) > 30;
  };

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

      {/* Board D3 desktop — the waterfall hero and the four ratios sit side by
          side (1fr · 340px); the balance sheet follows below. Mobile stacks. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-4 lg:items-start">
      <div className="min-w-0">

      {/* Board M4 — the equation is a WATERFALL you read at a glance: the full
          assets(+owed) bar, the slice liabilities take from it, and the net-worth
          remainder. Denim spine, net worth in neutral ink. */}
      {(() => {
        const gross = ta + tr;                                  // assets + owed
        const libPct = gross > 0 ? Math.min(100, (tl / gross) * 100) : 0;
        const nwPct  = gross > 0 ? Math.max(0, Math.min(100, (nw / gross) * 100)) : 0;
        const barRow = (barWidth: string, barStyle: CSSProperties, alignEnd: boolean, label: ReactNode) => (
          <div className="flex items-center gap-2">
            <div className={`flex-[0_0_56%] flex ${alignEnd ? 'justify-end' : ''}`}>
              <div className="h-[15px] rounded-[5px] chart-grow" style={{ width: barWidth, ...barStyle }} />
            </div>
            <span className="text-[10.5px] text-ink-mid whitespace-nowrap">{label}</span>
          </div>
        );
        return (
          <div className="relative rounded-r3 p-5 mb-4 overflow-hidden" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
            <span className="absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded-full" style={{ background: 'hsl(var(--denim))' }} />
            <div className="mono-label mb-1">Net worth · today</div>
            <Money amount={nw} currency={c} maxChars={12}
              className={`num text-[30px] font-bold leading-tight ${nw >= 0 ? 'text-ink' : 'text-terra'}`} />
            <div className="flex flex-col gap-1.5 mt-3">
              {barRow('100%', { background: 'hsl(var(--sage))', boxShadow: 'var(--neu-sm)' }, false,
                <>Assets {tr > 0 ? '＋ owed ' : ''}<b className="num text-ink-mid">{fmt(gross, c)}</b></>)}
              {barRow(`${libPct}%`, { background: 'var(--sunken)', boxShadow: 'var(--neu-inset), inset 0 0 0 1px hsl(var(--line2))' }, true,
                <>− Liabilities <b className="num text-ink-mid">{fmt(tl, c)}</b></>)}
              {barRow(`${nwPct}%`, { background: 'hsl(var(--denim))', boxShadow: 'var(--neu-sm)' }, false,
                <>= Net worth <b className="num text-ink-mid">{fmt(nw, c)}</b></>)}
            </div>
          </div>
        );
      })()}

      {/* Board C — liquidity stacked bar. */}
      {ta > 0 && (
        <div className="rounded-r3 p-4 mb-4" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
          <div className="mono-label mb-2">Liquidity mix</div>
          <div className="flex h-3.5 rounded-lg overflow-hidden" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }} aria-hidden>
            <div className="chart-grow" style={{ width: pct(liqMix.liquid), background: 'hsl(var(--sage))' }} />
            <div className="chart-grow" style={{ width: pct(liqMix.short), background: 'hsl(var(--denim))', animationDelay: '60ms' }} />
            <div className="chart-grow" style={{ width: pct(liqMix.long), background: 'var(--fore)', animationDelay: '120ms' }} />
          </div>
          <div className="flex gap-4 flex-wrap mt-2.5">
            {([['Liquid', liqMix.liquid, 'hsl(var(--sage))'], ['Short-term', liqMix.short, 'hsl(var(--denim))'], ['Long-term', liqMix.long, 'var(--fore)']] as [string, number, string][])
              .filter(([, v]) => v > 0).map(([lbl, v, col]) => (
                <span key={lbl} className="mono-label flex items-center gap-1.5">
                  <i className="inline-block w-[7px] h-[7px] rounded-full" style={{ background: col }} />{lbl} {fmt(v, c)}
                </span>
              ))}
          </div>
        </div>
      )}
      </div>{/* /left column (hero + liquidity) */}

      {/* Financial ratios — 2×2 in the desktop right column (board D3). */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-3 mb-4 lg:mb-0">
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
          <div key={r.label} className="rounded-r3 p-4" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
            <div className={`num text-xl font-semibold mb-0.5 ${r.good ? 'text-sage' : r.warn ? 'text-honey' : 'text-terra'}`}>
              {r.value}
            </div>
            <div className="text-[0.78rem] font-semibold text-ink mb-0.5">{r.label}</div>
            <div className="font-mono text-[0.58rem] tracking-wider text-ink-dim uppercase">{r.sub}</div>
          </div>
        ))}
      </div>
      </div>{/* /hero + ratios desktop grid */}

      {/* Add/Edit form lives in <AssetFormModal /> mounted at App root */}

      {/* Balance sheet split — board D3: Assets (1fr) | Liabilities + Owed (1fr),
          each a neu card.
          `grid-cols-1` is load-bearing: without an explicit track the implicit
          column sizes to max-content, and an asset row's right group (the
          `update?` badge is flex-shrink-0, plus the edit/delete buttons) can't
          shrink — so the column outgrows the viewport and the page scrolls
          sideways on phones. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        {/* Assets column */}
        <div>
          <h2 className="display-italic text-2xl text-ink mb-3">Assets</h2>
          {liveRows.length === 0 ? (
            <Panel>
              <div className="px-6 py-10 text-center">
                <p className="text-ink-mid text-sm mb-3">No assets added yet.</p>
                <button className="btn-primary text-sm" onClick={openAdd}>Add Asset</button>
              </div>
            </Panel>
          ) : (
            <div className="space-y-2">
              {LIQUIDITIES.map(liq => {
                const group = byLiquidity(liq.key);
                if (!group.length) return null;
                const groupTotal = group.reduce((s, r) => s + r.value, 0);
                return (
                  <div key={liq.key}>
                    <div className="font-mono text-[0.6rem] tracking-widest text-ink-dim uppercase px-1 mb-1.5">
                      {liq.label} · {fmt(groupTotal, c)}
                    </div>
                    {group.map(row => {
                      // Board D3 — live account rows are display-only here (no
                      // edit/delete): they're managed on the Accounts page, and
                      // can't go stale since they're computed fresh every render.
                      if (row.source === 'account' && row.account) {
                        const acc = row.account;
                        return (
                          <div key={row.id} className="bg-bg border border-line rounded-lg px-4 py-3 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span>{KIND_ICON[acc.kind] ?? '💵'}</span>
                              <div className="min-w-0">
                                <div className="text-[0.84rem] font-semibold text-ink truncate">{acc.name}</div>
                                <div className="font-mono text-[0.6rem] tracking-wider text-ink-dim">{liq.label.toLowerCase()}</div>
                              </div>
                            </div>
                            <Money amount={row.value} currency={c} maxChars={11} className="font-semibold text-sage text-[0.9rem] flex-shrink-0" />
                          </div>
                        );
                      }
                      const a = row.asset!;
                      const meta = ASSET_TYPES[a.type] || ASSET_TYPES.cash;
                      return (
                        <div key={a.id} className="bg-bg border border-line rounded-lg px-4 py-3 flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <span>{meta.icon}</span>
                            <div>
                              <div className="text-[0.84rem] font-semibold text-ink">{a.name}</div>
                              {a.note && <div className="font-mono text-[0.6rem] tracking-wider text-ink-dim">{a.note}</div>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2.5 min-w-0">
                            {isStale(row) && (
                              <button type="button" onClick={() => openEdit(a)} title="This balance is over 30 days old — update it"
                                className="font-mono text-[8.5px] tracking-[0.1em] uppercase px-1.5 py-0.5 rounded-md flex-shrink-0"
                                style={{ border: '1px dashed color-mix(in srgb, hsl(var(--honey)) 55%, transparent)', color: 'hsl(var(--honey))' }}>
                                update?
                              </button>
                            )}
                            <div className="text-right min-w-0">
                              <Money amount={row.value} currency={c} maxChars={11} className="font-semibold text-sage text-[0.9rem]" />
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
