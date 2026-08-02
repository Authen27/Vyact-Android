// Vyact v7.1.3 — Accounts page
//
// Surfaces the first-class `accounts` table from the v7.1 Money Map
// migration as a real CRUD list. Gated by `getMoneyMapMode() !== 'off'`
// at the route level — when the flag is off the route renders an
// empty-state explaining why.
//
// The list shows every non-deleted account; archived ones are dimmed
// and grouped under a collapsed section. Default-per-currency is shown
// as a chip. Linked to a backfilled asset/debt? We surface that with a
// small caption so the user understands where the row came from.

import { useMemo, useState, useEffect } from 'react';
import { useStore } from '../store';
import { Panel } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Money from '../components/ui/Money';
import { Plus, Pencil, Archive, ArchiveRestore, Link as LinkIcon } from 'lucide-react';
import type { Account, AccountKind, Transaction } from '../types';
import { getMoneyMapMode } from '../lib/featureFlags';
import { computeAccountBalance, accountValueOf, debitAccountOf, creditAccountOf } from '../lib/accountBalance';
import { effectiveAmount } from '../lib/calculations';
import { fmt } from '../lib/format';
import { getCat } from '../constants';

// Board M5 — the four wallet types shown in the totals strip (loan accounts are
// system-only and never surface here). Tapping a tile filters the wallet.
const WALLET_KINDS: { kind: AccountKind; label: string }[] = [
  { kind: 'bank',        label: 'Bank' },
  { kind: 'credit_card', label: 'Cards' },
  { kind: 'investment',  label: 'Invest' },
  { kind: 'cash',        label: 'Cash' },
];

// v9 — strict kind enum (txn-redesign §2.2).
const KIND_LABEL: Record<AccountKind, string> = {
  bank: 'Bank',
  cash: 'Cash',
  credit_card: 'Credit Card',
  investment: 'Investment',
  loan: 'Loan',
};
const KIND_ICON: Record<AccountKind, string> = {
  bank: '🏦', cash: '💵', credit_card: '💳', investment: '📈', loan: '🏛️',
};

export default function Accounts() {
  const accounts        = useStore(s => s.accounts);
  const assets          = useStore(s => s.assets);
  const debts           = useStore(s => s.debts);
  const transactions    = useStore(s => s.transactions);
  const profile         = useStore(s => s.profile);
  const rates           = useStore(s => s.rates);
  const openAddAccount  = useStore(s => s.openAddAccount);
  const openEditAccount = useStore(s => s.openEditAccount);
  const upsertAccount   = useStore(s => s.upsertAccount);
  const reconcileAccount = useStore(s => s.reconcileAccount);
  const toast           = useStore(s => s.toast);
  const [showArchived, setShowArchived] = useState(false);
  const [kindFilter, setKindFilter] = useState<AccountKind | 'all'>('all');

  const mode = getMoneyMapMode();
  const flagOff = mode === 'off';

  // Money-Model Epic 1 — computed balances, Fix-balance reconcile, and the
  // per-account ledger are permanent.
  const baseCur = profile.baseCurrency;
  // v9 R-AGG-4 — balance includes the reconciliation offset (D2).
  const balanceOf = (acc: Account): number =>
    computeAccountBalance(acc, transactions, baseCur, rates);

  async function handleReconcile(acc: Account, real: number) {
    try {
      const delta = await reconcileAccount(acc, real);
      const noun = acc.kind === 'investment' ? 'Value updated' : 'Balance fixed';
      toast(delta === 0 ? 'Already up to date' : `${noun} (${delta > 0 ? '+' : ''}${delta})`, 'success');
    } catch (e) {
      toast(`Reconcile failed: ${(e as Error).message}`, 'error');
    }
  }

  const { active, archived } = useMemo(() => {
    const a: Account[] = [];
    const ar: Account[] = [];
    for (const acc of accounts) (acc.isArchived ? ar : a).push(acc);
    a.sort((x, y) => x.name.localeCompare(y.name));
    ar.sort((x, y) => x.name.localeCompare(y.name));
    return { active: a, archived: ar };
  }, [accounts]);

  // Board M5 — per-type totals for the wallet strip (computed from the ledger,
  // like every balance on this page).
  const kindTotals = useMemo(() => {
    const tot: Record<string, number> = { bank: 0, credit_card: 0, investment: 0, cash: 0 };
    const cnt: Record<string, number> = { bank: 0, credit_card: 0, investment: 0, cash: 0 };
    for (const acc of active) {
      if (acc.kind in tot) {
        tot[acc.kind] += computeAccountBalance(acc, transactions, baseCur, rates);
        cnt[acc.kind] += 1;
      }
    }
    return { tot, cnt };
  }, [active, transactions, baseCur, rates]);

  const shownActive = kindFilter === 'all' ? active : active.filter(a => a.kind === kindFilter);

  // Board D4 desktop — which account the right-hand ledger rail shows.
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const selectedAccount = shownActive.find(a => a.id === selectedAccountId) ?? shownActive[0];

  // Resolve assetId → human label so backfilled rows show their origin.
  const linkLabel = (acc: Account): string | null => {
    if (!acc.assetId) return null;
    const ast = assets.find(a => a.id === acc.assetId);
    if (ast) return `Linked to asset · ${ast.name}`;
    const dbt = debts.find(d => d.id === acc.assetId);
    if (dbt) return `Linked to card · ${dbt.name}`;
    return 'Linked (origin removed)';
  };

  async function toggleArchive(acc: Account) {
    try {
      await upsertAccount({ ...acc, isArchived: !acc.isArchived });
      toast(acc.isArchived ? 'Account restored' : 'Account archived', 'success');
    } catch (e) {
      toast(`Failed: ${(e as Error).message}`, 'error');
    }
  }

  return (
    <div>
      <div className="flex justify-between items-start mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="display-italic text-4xl text-ink mb-1.5">Accounts</h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            Money Map · Spendable Accounts
          </p>
        </div>
        {!flagOff && (
          <Button onClick={openAddAccount}>
            <Plus size={14} /> Add Account
          </Button>
        )}
      </div>

      {flagOff && (
        <Panel>
          <div className="p-6 text-center">
            <p className="text-ink-mid mb-2">Money Map is off.</p>
            <p className="text-sm text-ink-dim">
              Enable the <code className="font-mono">money_map</code> flag to manage
              first-class accounts. Until then, the transaction picker continues
              to derive accounts from Net Worth assets and credit cards.
            </p>
          </div>
        </Panel>
      )}

      {!flagOff && active.length === 0 && (
        <Panel>
          <div className="p-6 text-center">
            <p className="text-ink-mid mb-3">No accounts yet.</p>
            <p className="text-sm text-ink-dim mb-4">
              Cloud households are seeded automatically by the Phase 1 backfill.
              If your list is empty, add one manually or refresh after the
              migration runs.
            </p>
            <Button onClick={openAddAccount}>
              <Plus size={14} /> Add Your First Account
            </Button>
          </div>
        </Panel>
      )}

      {/* Board M5 — type-totals strip: bank · cards · investment · cash. Tap a
          tile to filter the wallet to that type (tap again to clear). */}
      {!flagOff && active.length > 0 && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {WALLET_KINDS.map(({ kind, label }) => {
            const on = kindFilter === kind;
            const total = kindTotals.tot[kind] ?? 0;
            return (
              <button key={kind} type="button" onClick={() => setKindFilter(on ? 'all' : kind)}
                aria-pressed={on}
                className="rounded-r2 p-2.5 text-left border-none cursor-pointer transition-[box-shadow] min-w-0"
                style={on
                  ? { background: 'color-mix(in srgb, var(--accent) 10%, var(--canvas))', boxShadow: 'var(--neu-inset)' }
                  : { background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
                <div className="font-mono text-[8px] tracking-wider uppercase text-ink-dim mb-1 truncate">{label} · {kindTotals.cnt[kind] ?? 0}</div>
                <div className={`num text-[13.5px] font-bold truncate ${total < 0 ? 'text-terra' : 'text-ink'}`}>{total < 0 ? '−' : ''}{fmt(total, baseCur)}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* Mobile / tablet — wallet cards with the ledger expanding inline.
          `grid-cols-1` is load-bearing: without an explicit track the implicit
          column sizes to max-content, so a wallet card can't shrink and the
          page scrolls sideways on phones. */}
      {!flagOff && active.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:hidden">
          {shownActive.map(acc => (
            <AccountRow
              key={acc.id}
              acc={acc}
              linkLabel={linkLabel(acc)}
              balance={balanceOf(acc)}
              baseCur={baseCur}
              txns={transactions}
              rates={rates}
              onEdit={() => openEditAccount(acc)}
              onArchive={() => toggleArchive(acc)}
              onReconcile={(real) => handleReconcile(acc, real)}
              ledgerEnabled
            />
          ))}
          {shownActive.length === 0 && (
            <p className="col-span-full text-center text-ink-dim text-sm py-8">No {WALLET_KINDS.find(w => w.kind === kindFilter)?.label.toLowerCase()} accounts.</p>
          )}
        </div>
      )}

      {/* Board D4 desktop — wallet grid (left) + the selected account's ledger
          in a persistent right rail. Clicking a card moves it into the rail. */}
      {!flagOff && active.length > 0 && (
        <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_520px] lg:gap-6 lg:items-start">
          <div className="grid grid-cols-2 gap-3 content-start">
            {shownActive.map(acc => {
              const bal = balanceOf(acc);
              const on = selectedAccount?.id === acc.id;
              const estimated = !!acc.confidence && acc.confidence !== 'confirmed';
              return (
                <button key={acc.id} type="button" onClick={() => setSelectedAccountId(acc.id)}
                  className="text-left rounded-r3 px-4 py-3.5 border-none cursor-pointer"
                  style={on
                    ? { background: 'var(--canvas)', boxShadow: 'var(--neu), 0 0 0 1.5px var(--accent)' }
                    : { background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
                  <div className="flex items-center gap-3">
                    <span className="w-[34px] h-[34px] rounded-r2 flex items-center justify-center text-[15px] flex-shrink-0"
                      style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }} aria-hidden>{KIND_ICON[acc.kind]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-[14px] text-ink truncate">{acc.name}</span>
                        {acc.isDefault && <span className="text-honey text-[12px]" title={`Default for ${acc.currency}`}>★</span>}
                        {estimated && (
                          <span className="font-mono text-[8.5px] tracking-wider uppercase px-1.5 py-px rounded"
                            style={{ border: '1px dashed color-mix(in srgb, hsl(var(--honey)) 55%, transparent)', color: 'hsl(var(--honey))' }}>est</span>
                        )}
                      </div>
                      <div className="num text-[9.5px] text-ink-dim truncate">
                        {WALLET_KINDS.find(w => w.kind === acc.kind)?.label.toLowerCase() ?? acc.kind} · {acc.currency}
                        {linkLabel(acc) ? ` · ${linkLabel(acc)!.toLowerCase()}` : ''}
                      </div>
                    </div>
                    <Money amount={bal} currency={baseCur} maxChars={11}
                      className={`num font-bold text-[16px] flex-shrink-0 ${bal < 0 ? 'text-terra' : 'text-ink'}`} />
                  </div>
                </button>
              );
            })}
            {shownActive.length === 0 && (
              <p className="col-span-full text-center text-ink-dim text-sm py-8">No {WALLET_KINDS.find(w => w.kind === kindFilter)?.label.toLowerCase()} accounts.</p>
            )}
          </div>

          {selectedAccount && (
            <div className="rounded-r3 p-5 lg:sticky lg:top-[124px]" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
              <div className="flex items-center gap-3 mb-3">
                <span className="w-[34px] h-[34px] rounded-r2 flex items-center justify-center text-[15px] flex-shrink-0"
                  style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }} aria-hidden>{KIND_ICON[selectedAccount.kind]}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[15px] text-ink truncate">{selectedAccount.name} · ledger</div>
                  <div className="num text-[10px] text-ink-dim">computed balance · running</div>
                </div>
                <Money amount={balanceOf(selectedAccount)} currency={baseCur} maxChars={11}
                  className={`num font-bold text-[17px] ${balanceOf(selectedAccount) < 0 ? 'text-terra' : 'text-ink'}`} />
              </div>
              <DeskReconcile
                key={selectedAccount.id}
                acc={selectedAccount}
                balance={balanceOf(selectedAccount)}
                onReconcile={(real) => handleReconcile(selectedAccount, real)}
              />
              <AccountLedger
                account={selectedAccount}
                accountValue={accountValueOf(selectedAccount)}
                txns={transactions}
                baseCur={baseCur}
                rates={rates}
              />
              <div className="flex items-center gap-3 pt-3 mt-1 border-t border-line">
                {selectedAccount.isDefault && (
                  <span className="font-mono text-[9px] tracking-wider uppercase text-honey">★ Default for {selectedAccount.currency}</span>
                )}
                <button className="font-mono text-[9px] tracking-wider uppercase text-ink-dim hover:text-ink"
                  onClick={() => openEditAccount(selectedAccount)}>Edit</button>
                <button className="font-mono text-[9px] tracking-wider uppercase text-ink-dim hover:text-ink"
                  onClick={() => toggleArchive(selectedAccount)}>Archive</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Board M5 — the honest note on how balances and the default work. */}
      {!flagOff && active.length > 0 && (
        <p className="text-[11px] text-ink-dim leading-snug mt-4 px-1">
          Balances are computed from the ledger — never typed over. ★ marks the default per currency (it pre-fills Add Transaction); change it from any account's edit sheet.
        </p>
      )}

      {!flagOff && archived.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowArchived(s => !s)}
            className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim hover:text-ink-mid mb-2"
          >
            {showArchived ? '▾' : '▸'} Archived ({archived.length})
          </button>
          {showArchived && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 opacity-70">
              {archived.map(acc => (
                <AccountRow
                  key={acc.id}
                  acc={acc}
                  linkLabel={linkLabel(acc)}
                  balance={null}
                  baseCur={baseCur}
                  txns={transactions}
                  rates={rates}
                  onEdit={() => openEditAccount(acc)}
                  onArchive={() => toggleArchive(acc)}
                  ledgerEnabled={false}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {!flagOff && mode === 'shadow' && (
        <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim mt-6">
          Shadow mode · changes apply to the canonical accounts table; legacy
          assets / debts continue to drive the picker until <code>money_map</code> = on.
        </p>
      )}
    </div>
  );
}

function AccountRow(props: {
  acc: Account;
  linkLabel: string | null;
  balance: number | null;       // null → balance column hidden (flag off / archived)
  baseCur: string;
  txns: Transaction[];
  rates: Record<string, number>;
  onEdit: () => void;
  onArchive: () => void;
  onReconcile?: (real: number) => void;   // undefined → reconcile hidden
  ledgerEnabled: boolean;
}) {
  const { acc, linkLabel, balance, baseCur, txns, rates, onEdit, onArchive, onReconcile, ledgerEnabled } = props;
  const [fixing, setFixing] = useState(false);
  const [fixVal, setFixVal] = useState('');
  const [showLedger, setShowLedger] = useState(false);

  const value = accountValueOf(acc);
  const estimated = acc.confidence && acc.confidence !== 'confirmed';

  // Board M5 — each wallet card footers its own action language: bank/card →
  // ledger, cash → balance check, investment → update value. Cash & investment
  // open the reconcile input; the rest toggle the ledger.
  const isReconcileAction = acc.kind === 'cash' || acc.kind === 'investment';
  const actionLabel = acc.kind === 'cash' ? 'balance check' : acc.kind === 'investment' ? 'update value' : 'ledger';
  const actionColor = acc.kind === 'cash' ? 'hsl(var(--honey))' : 'var(--ff-ink-4)';
  const runAction = () => {
    if (isReconcileAction) { setFixing(f => !f); setFixVal(balance != null ? String(balance) : ''); }
    else setShowLedger(s => !s);
  };
  const actionAvailable = ledgerEnabled && (!isReconcileAction || Boolean(onReconcile));

  return (
    <div className="rounded-r3 p-4 relative" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
      <div className="flex items-center gap-3">
        {/* Board M5 — kind tile (inset). */}
        <span className="w-[34px] h-[34px] rounded-r2 flex items-center justify-center text-[15px] flex-shrink-0"
          style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }} aria-hidden>
          {KIND_ICON[acc.kind]}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-ink font-semibold text-[14.5px] truncate">{acc.name}</span>
            {acc.isDefault && <span className="text-honey text-[12px] flex-shrink-0" title="Default account">★</span>}
            {balance !== null && estimated && (
              <span className="font-mono text-[0.55rem] tracking-wider uppercase text-honey border border-honey/40 rounded px-1 flex-shrink-0">est</span>
            )}
          </div>
          <div className="font-mono text-[10px] text-ink-dim truncate mt-0.5">
            {KIND_LABEL[acc.kind]} · {acc.currency}{acc.isDefault ? ' · ★ default — pre-fills Add Transaction' : ''}
          </div>
          {linkLabel && (
            <div className="flex items-center gap-1 mt-0.5 text-[0.7rem] text-ink-dim">
              <LinkIcon size={10} /> {linkLabel}
            </div>
          )}
        </div>
        {balance !== null && (
          <div className="text-right flex-shrink-0">
            <Money amount={balance} currency={baseCur} maxChars={10} className={`num font-bold text-[17px] ${balance < 0 ? 'text-terra' : 'text-ink'}`} />
            {actionAvailable && (
              <button type="button" onClick={runAction}
                className="block ml-auto font-mono text-[7.5px] tracking-wider uppercase mt-0.5 hover:opacity-70"
                style={{ color: actionColor }}>
                {actionLabel} ▸
              </button>
            )}
          </div>
        )}
        {/* Edit / archive — quiet controls; the action language above is primary. */}
        <div className="flex flex-col gap-1 flex-shrink-0">
          <button type="button" onClick={onEdit}
            className="text-ink-dim hover:text-ink p-1 rounded hover:bg-bg3" aria-label="Edit account" title="Edit">
            <Pencil size={13} />
          </button>
          <button type="button" onClick={onArchive}
            className="text-ink-dim hover:text-ink p-1 rounded hover:bg-bg3"
            aria-label={acc.isArchived ? 'Restore account' : 'Archive account'} title={acc.isArchived ? 'Restore' : 'Archive'}>
            {acc.isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
          </button>
        </div>
      </div>

      {/* v9 D2 — reconcile: enter the real balance / current value → the drift is
          absorbed into the account's reconciliation offset (no transaction). */}
      {fixing && onReconcile && (
        <div className="flex items-center gap-2 mt-2 pl-1">
          <span className="font-mono text-[0.6rem] tracking-wider uppercase text-ink-dim">{acc.kind === 'investment' ? 'Current value' : 'Real balance'}</span>
          <input
            type="number" inputMode="decimal" value={fixVal} onChange={e => setFixVal(e.target.value)}
            className="bg-bg3 border border-line rounded-md px-2 py-1 text-sm num w-32" placeholder="0" />
          <Button onClick={() => { const n = Number(fixVal); if (!isNaN(n)) { onReconcile(n); setFixing(false); } }}>Fix</Button>
          <button type="button" onClick={() => setFixing(false)} className="text-[0.72rem] text-ink-dim hover:text-ink">Cancel</button>
        </div>
      )}

      {/* B1.4 — per-account ledger: reverse-chronological, with running impact. */}
      {showLedger && ledgerEnabled && (
        <AccountLedger account={acc} accountValue={value} txns={txns} baseCur={baseCur} rates={rates} />
      )}
    </div>
  );
}

/** Board D4 — the ledger rail's inline reconcile field. Each kind speaks its
 *  own language ("bank says" → Balance check · investment → Update value); the
 *  drift lands on the account's reconciliation offset, never as a transaction. */
function DeskReconcile({ acc, balance, onReconcile }: {
  acc: Account; balance: number; onReconcile: (real: number) => void;
}) {
  const [val, setVal] = useState(String(Math.round(balance)));
  useEffect(() => { setVal(String(Math.round(balance))); }, [balance]);
  const label = acc.kind === 'investment' ? 'current value' : acc.kind === 'cash' ? 'cash on hand' : 'bank says';
  const cta   = acc.kind === 'investment' ? 'Update value' : 'Balance check';
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="flex-1 flex items-center gap-2 h-[40px] px-3 rounded-r2 min-w-0"
        style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
        <span className="font-mono text-[8px] tracking-wider uppercase text-ink-dim flex-shrink-0">{label}</span>
        <input type="number" inputMode="decimal" value={val} onChange={e => setVal(e.target.value)}
          aria-label={`${label} for ${acc.name}`}
          className="num font-bold text-[14px] bg-transparent border-none outline-none text-ink w-full min-w-0" />
      </div>
      <button type="button" className="btn-primary btn-sm h-[40px] flex-shrink-0"
        onClick={() => { const n = Number(val); if (!isNaN(n)) onReconcile(n); }}>{cta}</button>
    </div>
  );
}

function AccountLedger(props: {
  account: Account; accountValue: string; txns: Transaction[]; baseCur: string; rates: Record<string, number>;
}) {
  const { account, accountValue, txns, baseCur, rates } = props;
  const rows = useMemo(() => {
    // v9 — match by account uuid OR the legacy encoded value; income credits the
    // destination; transfer/investment touch both legs (R-AGG-4).
    const hits = (v: string | undefined) => v === account.id || v === accountValue;
    const mine = txns
      .map(t => {
        const amt = effectiveAmount(t, baseCur, rates);
        let impact = 0;
        if (t.type === 'income' && hits(creditAccountOf(t))) impact = amt;
        else if (t.type === 'expense' && hits(debitAccountOf(t))) impact = -amt;
        else if (t.type === 'transfer' || t.type === 'investment') {
          impact = (hits(creditAccountOf(t)) ? amt : 0) - (hits(debitAccountOf(t)) ? amt : 0);
        }
        return { t, impact };
      })
      .filter(r => r.impact !== 0)
      .sort((a, b) => (a.t.date < b.t.date ? 1 : a.t.date > b.t.date ? -1 : 0));
    // running balance newest→oldest, anchored at current computed balance
    let running = computeAccountBalance(account, txns, baseCur, rates);
    return mine.map(r => { const at = running; running -= r.impact; return { ...r, runningAfter: at }; });
  }, [account, accountValue, txns, baseCur, rates]);

  const recon = (account.reconciliationLog ?? []).slice(-5).reverse();
  if (!rows.length && !recon.length) return <div className="mt-2 pl-1 text-[0.72rem] text-ink-dim">No entries yet.</div>;
  return (
    <div className="mt-2 ml-1 border-l-2 border-line pl-3 space-y-1">
      {/* §2.6 quiet log — reconciliations appear in account history ONLY, never in totals. */}
      {recon.map((e, i) => (
        <div key={`recon-${i}`} className="flex items-center gap-2 text-[0.74rem] text-ink-dim italic">
          <span className="font-mono text-[0.62rem] w-[4.5rem] shrink-0">{e.at.slice(0, 10)}</span>
          <span className="flex-1">
            {e.kind === 'investment' ? 'Value updated' : 'Reconciled'} ({e.delta >= 0 ? '+' : ''}{Math.round(e.delta)})
          </span>
        </div>
      ))}
      {rows.slice(0, 50).map(({ t, impact, runningAfter }) => (
        <div key={t.id} className="flex items-center gap-2 text-[0.78rem]">
          <span className="text-ink-dim font-mono text-[0.62rem] w-[4.5rem] shrink-0">{t.date}</span>
          <span className="flex-1 truncate text-ink-mid">{t.description || getCat(t.category).label}</span>
          <span className={`num ${impact < 0 ? 'text-terra' : 'text-sage'}`}>{impact >= 0 ? '+' : ''}{Math.round(impact)}</span>
          <span className="num text-ink-dim w-20 text-right">{Math.round(runningAfter)}</span>
        </div>
      ))}
    </div>
  );
}
