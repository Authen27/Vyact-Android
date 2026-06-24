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

import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Panel } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Money from '../components/ui/Money';
import { Plus, Pencil, Star, Archive, ArchiveRestore, Link as LinkIcon, Scale, ChevronDown, ChevronRight } from 'lucide-react';
import type { Account, AccountKind, Transaction } from '../types';
import { getMoneyMapMode } from '../lib/featureFlags';
import { computeAccountBalance, accountValueOf, debitAccountOf, creditAccountOf } from '../lib/accountBalance';
import { effectiveAmount } from '../lib/calculations';
import { getCat } from '../constants';

// v9 — strict kind enum (txn-redesign §2.2).
const KIND_LABEL: Record<AccountKind, string> = {
  bank: 'Bank',
  cash: 'Cash',
  credit_card: 'Credit Card',
  investment: 'Investment',
  loan: 'Loan',
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

      {!flagOff && active.length > 0 && (
        <Panel>
          <div className="divide-y divide-line">
            {active.map(acc => (
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
          </div>
        </Panel>
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
            <Panel>
              <div className="divide-y divide-line opacity-70">
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
            </Panel>
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

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-ink font-medium truncate">{acc.name}</span>
            <span className="font-mono text-[0.6rem] tracking-wider uppercase text-ink-dim">
              {KIND_LABEL[acc.kind]} · {acc.currency}
            </span>
            {acc.isDefault && (
              <span className="inline-flex items-center gap-1 font-mono text-[0.6rem] tracking-wider uppercase text-coral">
                <Star size={10} /> Default
              </span>
            )}
            {balance !== null && estimated && (
              <span className="font-mono text-[0.55rem] tracking-wider uppercase text-honey border border-honey/40 rounded px-1">est</span>
            )}
          </div>
          {linkLabel && (
            <div className="flex items-center gap-1 mt-0.5 text-[0.7rem] text-ink-dim">
              <LinkIcon size={10} /> {linkLabel}
            </div>
          )}
        </div>
        {balance !== null && (
          <div className="text-right mr-1">
            <Money amount={balance} currency={baseCur} maxChars={10} className={balance < 0 ? 'text-terra' : 'text-ink'} />
          </div>
        )}
        {ledgerEnabled && (
          <button type="button" onClick={() => setShowLedger(s => !s)}
            className="text-ink-mid hover:text-ink p-1.5 rounded hover:bg-bg3" aria-label="Toggle ledger" title="Ledger">
            {showLedger ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        {onReconcile && (
          <button type="button" onClick={() => { setFixing(f => !f); setFixVal(balance != null ? String(balance) : ''); }}
            className="text-ink-mid hover:text-ink p-1.5 rounded hover:bg-bg3"
            aria-label={acc.kind === 'investment' ? 'Update value' : 'Fix balance'}
            title={acc.kind === 'investment' ? 'Update value' : 'Fix balance'}>
            <Scale size={14} />
          </button>
        )}
        <button type="button" onClick={onEdit}
          className="text-ink-mid hover:text-ink p-1.5 rounded hover:bg-bg3" aria-label="Edit account" title="Edit">
          <Pencil size={14} />
        </button>
        <button type="button" onClick={onArchive}
          className="text-ink-mid hover:text-ink p-1.5 rounded hover:bg-bg3"
          aria-label={acc.isArchived ? 'Restore account' : 'Archive account'} title={acc.isArchived ? 'Restore' : 'Archive'}>
          {acc.isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
        </button>
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
