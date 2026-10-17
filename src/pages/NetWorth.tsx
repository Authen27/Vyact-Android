import { useStore } from '../store';
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from '../hooks';
import { Panel } from '../components/ui/Card';
import { fmt, fmtNet, nowMonthKey } from '../lib/format';
import Money from '../components/ui/Money';
import { monthlyData } from '../lib/calculations';
import { keptThisMonthPct, pctLabel } from '../lib/ratios';
import { computeNetWorth, cardDues } from '../lib/netWorth';
import { liabilityList as liabilityRowsOwed, liabilityRowLabel } from '../lib/liabilityList';
// v10.38.1 — the one spend baseline, shared with Ask Vyact so the two screens
// cannot quote different months of cover for the same household.
import { spendBasis } from '../lib/aiSummary';
import { baselineLabel, monthsOfCover as coverMonths } from '../lib/spendBaseline';
import { netWorthHistory, monthLabel, type NetWorthSnapshot } from '../lib/netWorthSnapshots';
import { NetWorthHistoryChart } from '../components/charts/ReportCharts';
import type { LiveAssetRow } from '../lib/accountBalance';
import { ASSET_TYPES } from '../constants';
import { isAssetValueStale, valueDateLabel } from '../lib/assetStaleness';
import type { Asset, AccountKind } from '../types';
import InfoNote from '../components/ui/InfoNote';
import PageHead from '../components/ui/PageHead';
import EmptyState from '../components/ui/EmptyState';
import { confirmSheet } from '../lib/confirmSheet';
import { deleteAssetRequest } from '../lib/confirmCopy';

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
  const snapshots    = useStore(s => s.netWorthSnapshots);

  const c = profile.baseCurrency;

  // Audit F3 — Net Worth reads THE canonical projection, the same one the
  // Dashboard and Ask Vyact read. Live account balances on both sides
  // (asset accounts + liability accounts), unlinked legacy assets and
  // unlinked debts folded in, receivables excluded, one FX path. The
  // asset-side rows still drive the per-liquidity display below.
  const projection = useMemo(
    () => computeNetWorth(
      { assets, accounts: accountsState, debts, transactions }, c, rates,
    ),
    [assets, accountsState, debts, transactions, c, rates],
  );
  const liveRows = projection.assetRows;

  const ta  = projection.totalAssets;
  const tl  = projection.totalLiabilities;
  const liabilityList = liabilityRowsOwed(projection);
  // v10.17 — "Owed to me" (receivables) is deprecated from the UI. The rows
  // remain in the data model (reversible) but no longer count toward the
  // displayed Net Worth — the projection excludes them, so no addend here.
  const nw  = projection.netWorth;
  const la  = projection.liquidAssets;
  // v10.39.1 (P19) — the card bill is paid from `la`, so what is FREE is less by it.
  // Same helper as the assistant's facts: one figure, whichever screen asks.
  const dues = cardDues(projection);
  const { income, expense } = monthlyData(transactions, nowMonthKey(), c, rates);

  // v10.38.1 — ONE cover figure, on the SAME baseline as everywhere else.
  //
  // There used to be two: `liquidityRatio` and `emergencyCover`, computed from
  // identical expressions (`la / expense`) and rendered as separate tiles — the same
  // number twice, in different units ("2.9x" and "2.9mo"), with different thresholds,
  // so one could read green while the other read amber. And both divided by THIS
  // month's expense, which on the 2nd of a month is barely any spending at all: the
  // page reported enormous cover early in the month and shrinking cover through it.
  //
  // The assistant moved onto `spendBasis` (up to six COMPLETED months) in v10.38 for
  // exactly that reason, so this page was about to quote a different number for the
  // same household. Both now read the one baseline; `askVyactFacts` pins them equal.
  //
  // Track E, E4 (owner, E-9): this tile is the "at your usual spending" figure (all spending), on the
  // shared baseline (lib/spendBaseline.ts: 3 completed months with spending), rounded by the same
  // `monthsOfCover` Pip uses. The Reports runway shows the other one, "on essentials only".
  const basis = useMemo(
    () => spendBasis(transactions, c, rates),
    [transactions, c, rates],
  );
  const typicalMonthly   = basis.averageMonthly;
  const monthsOfCover    = coverMonths(la, typicalMonthly) ?? 0;
  const debtToAsset      = ta > 0 ? tl / ta * 100 : 0;
  // W6 (audit FE-UIC-07): with no income yet this month it said "−499,900%"; now it says "—".
  const savingsRatio     = keptThisMonthPct(income, expense);
  const coverBasisLabel  = basis.partialMonthOnly
    ? 'At your spending so far this month'
    : `At your usual spending of ${fmt(Math.round(typicalMonthly), c)} a month (${baselineLabel(basis.baselineMonths)})`;

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

  // Aurora 4.0 CF12 — names the asset and its effect on net worth.
  async function del(id: string) {
    const row = liveRows.find(r => r.id === id);
    const asset = assets.find(a => a.id === id);
    if (!(await confirmSheet(deleteAssetRequest({ name: asset?.name ?? row?.name ?? '', value: row && row.value > 0 ? fmt(row.value, c) : undefined })))) return;
    // v10.26.0 (R4) — the store refuses an investment with buys recorded against
    // it; that refusal must reach the user, not vanish as an unhandled rejection.
    try {
      await removeAsset(id);
      toast('Asset removed', 'info');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const byLiquidity = (liq: LiveAssetRow['liquidity']) =>
    liveRows.filter(r => r.liquidity === liq);

  // Board M4 — a liquid/short LEGACY asset (no live account behind it) not
  // touched in 30+ days rides an inline dashed-honey chip that says how old its value is
  // ("14 Jun · Update"). Account-sourced rows never qualify. This chip is the ONLY stale
  // notice: the mount-time toast was removed (owner, 16 Oct 2026; see lib/assetStaleness.ts).
  const isStale = (row: LiveAssetRow) =>
    row.source === 'asset' && !!row.asset && isAssetValueStale(row.asset);

  return (
    <div className="ui-pilot">
      <PageHead title={t('networth')} action={{ label: '+ Add Asset', entity: 'asset', onClick: openAdd }} />

      {/* Board D3 desktop — the waterfall hero and the four ratios sit side by
          side (1fr · 340px); the balance sheet follows below. Mobile stacks. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-4 lg:items-start">
      <div className="min-w-0">

      {/* Board M4 — the equation is a WATERFALL you read at a glance: the full
          assets(+owed) bar, the slice liabilities take from it, and the net-worth
          remainder. Denim spine, net worth in neutral ink. */}
      {(() => {
        const gross = ta;                                       // assets
        const libPct = gross > 0 ? Math.min(100, (tl / gross) * 100) : 0;
        const nwPct  = gross > 0 ? Math.max(0, Math.min(100, (nw / gross) * 100)) : 0;
        const barRow = (barWidth: string, barStyle: CSSProperties, alignEnd: boolean, label: ReactNode) => (
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
            <div className={`w-full sm:w-auto sm:flex-[0_0_56%] flex ${alignEnd ? 'justify-end' : ''}`}>
              <div className="h-[15px] rounded-[5px] chart-grow" style={{ width: barWidth, ...barStyle }} />
            </div>
            <span className="text-[12px] text-ink-mid sm:whitespace-nowrap">{label}</span>
          </div>
        );
        return (
          <div className="card-raised p-5 mb-4 overflow-hidden" data-testid="networth-hero">
            <span className="absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded-full" style={{ background: 'hsl(var(--denim))' }} />
            <div className="mono-label mb-1">Net worth · today</div>
            <Money amount={nw} currency={c} maxChars={12}
              className={`num text-[30px] font-bold leading-tight ${nw >= 0 ? 'text-ink' : 'text-terra'}`} />
            <div className="flex flex-col gap-2.5 sm:gap-1.5 mt-3">
              {barRow('100%', { background: 'hsl(var(--sage))', boxShadow: 'var(--neu-sm)' }, false,
                <>Assets <span className="text-ink-dim">(what you own)</span> <b className="num text-ink-mid">{fmt(gross, c)}</b></>)}
              {barRow(`${libPct}%`, { background: 'var(--sunken)', boxShadow: 'var(--neu-inset), inset 0 0 0 1px hsl(var(--line2))' }, true,
                <>− Liabilities <span className="text-ink-dim">(what you owe)</span> <b className="num text-ink-mid">{fmt(tl, c)}</b></>)}
              {barRow(`${nwPct}%`, { background: 'hsl(var(--denim))', boxShadow: 'var(--neu-sm)' }, false,
                <>= Net worth <b className="num text-ink-mid">{fmtNet(nw, c)}</b></>)}
            </div>
          </div>
        );
      })()}

      {/* Board C — liquidity stacked bar. */}
      {ta > 0 && (
        <div className="tile !rounded-r3 p-4 mb-4">
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
          // v10.38.1 — plain words, same figures. "Liquidity Ratio", "leverage
          // ratio" and "Savings Ratio" are analyst vocabulary; a household app
          // should say what it means. Thresholds are unchanged.
          {
            label: 'Liquid assets',
            value: fmtNet(Math.round(la), c),
            sub: dues <= 0 ? 'Cash and savings you could use today'
              : la >= dues
                ? `${fmt(Math.round(la - dues), c)} free after ${fmt(Math.round(dues), c)} card dues`
                : `${fmt(Math.round(dues - la), c)} short of ${fmt(Math.round(dues), c)} card dues`,
            good: la >= typicalMonthly * 6,
            warn: la >= typicalMonthly * 3,
          },
          {
            label: 'How long it would last',
            value: `${monthsOfCover.toFixed(1)} months`,
            sub: coverBasisLabel,
            good: monthsOfCover >= 6,
            warn: monthsOfCover >= 3,
          },
          {
            label: 'What you owe vs own',
            value: `${debtToAsset.toFixed(1)}%`,
            sub: 'Share of what you own that is borrowed',
            good: debtToAsset < 30,
            warn: debtToAsset < 50,
          },
          {
            label: 'Kept this month',
            value: pctLabel(savingsRatio, 1),
            sub: savingsRatio == null ? 'No income recorded this month' : 'Share of this month’s income kept',
            good: savingsRatio != null && savingsRatio >= 20,
            warn: savingsRatio != null && savingsRatio >= 10,
            muted: savingsRatio == null,
          },
        ].map((r: { label: string; value: string; sub: string; good: boolean; warn: boolean; muted?: boolean }) => (
          <div key={r.label} className="card-raised p-4 min-w-0">
            <div className={`num text-xl font-semibold mb-0.5 ${r.muted ? 'text-ink-dim' : r.good ? 'text-sage' : r.warn ? 'text-honey' : 'text-terra'}`}>
              {r.value}
            </div>
            <div className="text-[0.78rem] font-semibold text-ink mb-0.5">{r.label}</div>
            <div className="text-[12px] leading-snug text-ink-dim">{r.sub}</div>
          </div>
        ))}
      </div>
      </div>{/* /hero + ratios desktop grid */}

      <NetWorthHistory snapshots={snapshots} currency={c} />

      {/* Add/Edit is the /networth/assets/new and /networth/assets/:id/edit page (v10.28.0) */}

      {/* Balance sheet split — board D3: Assets (1fr) | Liabilities + Owed (1fr),
          each a neu card.
          `grid-cols-1` is load-bearing: without an explicit track the implicit
          column sizes to max-content, and an asset row's right group (the
          amount and the edit/delete buttons, flex-shrink-0) can't
          shrink — so the column outgrows the viewport and the page scrolls
          sideways on phones. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        {/* Assets column */}
        <div>
          <h2 className="display-italic text-2xl text-ink mb-0.5">Assets</h2>
          {/* v10.59.0 (owner) — the plain-English meaning under each balance-sheet word. */}
          <p className="text-[0.8rem] text-ink-dim mb-3">What you own: cash, savings, investments and property</p>
          {liveRows.length === 0 ? (
            <Panel>
              <EmptyState icon="🏠" title="No assets added yet"
                message="Add what you own outside your accounts (property, gold, investments) and it counts toward your net worth."
                action={{ label: 'Add an asset', onClick: openAdd }} />
            </Panel>
          ) : (
            <div className="space-y-2">
              {LIQUIDITIES.map(liq => {
                const group = byLiquidity(liq.key);
                if (!group.length) return null;
                const groupTotal = group.reduce((s, r) => s + r.value, 0);
                return (
                  <div key={liq.key}>
                    <div className="ui-label px-1 mb-1.5">
                      {liq.label} · {fmtNet(groupTotal, c)}
                    </div>
                    {group.map(row => {
                      // Board D3 — live account rows are display-only here (no
                      // edit/delete): they're managed on the Accounts page, and
                      // can't go stale since they're computed fresh every render.
                      if (row.source === 'account' && row.account) {
                        const acc = row.account;
                        return (
                          <div key={row.id} className="tile px-4 py-3 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span>{KIND_ICON[acc.kind] ?? '💵'}</span>
                              <div className="min-w-0">
                                <div className="text-[0.84rem] font-semibold text-ink truncate">{acc.name}</div>
                                <div className="text-[12px] text-ink-dim">{liq.label}</div>
                              </div>
                            </div>
                            <Money amount={row.value} currency={c} maxChars={11} className="font-semibold text-sage text-[0.9rem] flex-shrink-0" />
                          </div>
                        );
                      }
                      const a = row.asset!;
                      const meta = ASSET_TYPES[a.type] || ASSET_TYPES.cash;
                      return (
                        <div key={a.id} className="tile px-4 py-3 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span>{meta.icon}</span>
                            <div className="min-w-0">
                              <div className="text-[0.84rem] font-semibold text-ink truncate">{a.name}</div>
                              {a.note && <div className="text-[12px] text-ink-dim truncate">{a.note}</div>}
                              {/* 16 Oct 2026 — the stale chip sits under the name, not beside the amount:
                                  with the value date in it, it no longer fits next to the figure and the
                                  row actions on a phone, and the amount ended up under the edit button. */}
                              {isStale(row) && (() => {
                                const since = a.lastUpdated ? valueDateLabel(a.lastUpdated) : null;
                                const hint = since
                                  ? `Value last updated ${since}. Tap to update it`
                                  : 'This value has no date. Tap to update it';
                                return (
                                  <button type="button" onClick={() => openEdit(a)} title={hint} aria-label={`${a.name}: ${hint}`}
                                    data-testid="asset-stale-chip"
                                    className="mt-1 text-[11.5px] font-medium px-2 py-0.5 rounded-r2 whitespace-nowrap"
                                    style={{ border: '1px dashed color-mix(in srgb, hsl(var(--honey)) 55%, transparent)', color: 'var(--warn-text)' }}>
                                    {since ? `${since} · Update` : 'Update?'}
                                  </button>
                                );
                              })()}
                            </div>
                          </div>
                          <div className="flex items-center gap-2.5 flex-shrink-0">
                            <div className="text-right">
                              <Money amount={row.value} currency={c} maxChars={11} className="font-semibold text-sage text-[0.9rem]" />
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
          <h2 className="display-italic text-2xl text-ink mb-0.5">Liabilities</h2>
          <p className="text-[0.8rem] text-ink-dim mb-3">What you owe: loans, card balances and money borrowed</p>
          {/* W6 (audit FE-UIC-06): the list is the projection's own liability rows (cards, loans,
              any other debt), so it adds up to the total below. It used to list `debts` only, said
              there were no debts while a card owed money, and never added up to Total Liabilities. */}
          {liabilityList.length === 0 ? (
            <Panel>
              <div className="px-6 py-10 text-center">
                <p className="text-ink-mid text-sm">Nothing owed. Loans are added in Debts; cards live in Accounts.</p>
              </div>
            </Panel>
          ) : (
            <div className="space-y-2">
              {liabilityList.map(r => {
                const { icon, sub } = liabilityRowLabel(r, debts);
                return (
                  <div key={r.id} className="tile px-4 py-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span>{icon}</span>
                      <div className="min-w-0">
                        <div className="text-[0.84rem] font-semibold text-ink truncate">{r.name}</div>
                        <div className="text-[12px] text-ink-dim">{sub}</div>
                      </div>
                    </div>
                    <div className="text-right min-w-0">
                      <Money amount={r.value} currency={c} maxChars={11} className="font-semibold text-terra text-[0.9rem]" />
                    </div>
                  </div>
                );
              })}
              <div className="bg-terra/8 border border-terra/20 rounded-lg px-4 py-3 flex justify-between items-center min-w-0 gap-2">
                <span className="font-semibold text-terra">Total Liabilities</span>
                <Money amount={tl} currency={c} maxChars={12} className="font-semibold text-terra text-lg" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * v10.30.0 — Net Worth over time, from RECORDED monthly snapshots only. A past
 * position is never rebuilt from today's rows (standalone assets and debts keep
 * only their current value), so the chart waits for two recorded months.
 */
function NetWorthHistory({ snapshots, currency }: { snapshots: NetWorthSnapshot[]; currency: string }) {
  const history = netWorthHistory(snapshots, currency);
  const first = history.points[0];
  return (
    <section aria-label="Net worth history" className="mt-4 min-w-0">
      <Panel title="Net worth history" sub="Recorded once a month · never reconstructed" className="min-w-0">
        {history.ready
          ? <NetWorthHistoryChart data={history.points} currency={currency} />
          : (
            <p className="px-4 py-6 text-sm text-ink-mid">
              {first
                ? `Recording started ${monthLabel(first.month)}. The chart appears once a second month is recorded.`
                : 'Your Net Worth is recorded the first time the household opens Vyact each month. The chart appears once two months are recorded.'}
            </p>
          )}
        <InfoNote className="px-4 pb-2" line="One point per month." label="About net worth history">
          <p>Each point is the Net Worth shown when the month was first recorded, in {currency}. Earlier months are never filled in.</p>
        </InfoNote>
      </Panel>
    </section>
  );
}
