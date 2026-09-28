// Vyact v10.24.0 (Accounts R2) — the Accounts screen (design frames M1 / D1).
//
// Scope is narrowed to SPENDABLE accounts — the ones a transaction can be paid
// from. Cash in Hand has its own summary, followed by two account groups:
//   Bank         bank accounts
//   Credit Card  cards, each showing what is free of its limit and when it's due
// Loans are money you owe and live in Debts; investments are things you own and
// live in Net Worth. Both are linked from here so the narrower scope stays legible.
//
// Every figure is computed from the ledger (computeAccountBalance) or derived
// from it (lib/accountsView.ts). A balance that has not been checked against a
// statement for a while says so in words — "not reconciled in 41 days" —
// instead of wearing a badge, and reconciling clears it.
//
// This screen used to sit behind the `money_map` feature flag. That flag was
// meant to retire in v7.3; accounts have been the money model's foundation since
// v9, so the gate is gone.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, type Variants } from 'framer-motion';
import { Banknote, ClipboardCheck, List, Pencil, Plus } from 'lucide-react';
import { useStore } from '../store';
import Button from '../components/ui/Button';
import AnimatedMoney from '../components/ui/AnimatedMoney';
import { formPath } from '../lib/formRoutes';
import { computeAccountBalance, accountValueOf, debitAccountOf, creditAccountOf } from '../lib/accountBalance';
import { effectiveAmount } from '../lib/calculations';
import { fmt } from '../lib/format';
import { getCat, CURRENCIES } from '../constants';
import { spring } from '../lib/motion';
import {
  PAYMENT_MODE_LABEL, STALE_AFTER_DAYS, accountGroup, accountsSummary, cardFigures, nextDueDate, staleDays,
} from '../lib/accountsView';
import type { Account, Transaction } from '../types';

const round2 = (n: number) => Math.round(n * 100) / 100;
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
/**
 * Row entrance. Each row owns its own initial → animate, staggered by index.
 * Not staggerContainer/staggerItem: accounts arrive after hydration, so the rows
 * mount under a container whose entrance already settled — an inherited
 * "hidden" is never animated out and the rows stay at opacity 0.
 */
const rowIn: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { ...spring, delay: Math.min(i, 8) * 0.05 } }),
};
const iconOf = (a: Account) => (a.kind === 'credit_card' ? '💳' : a.kind === 'cash' ? '💵' : '🏦');
/** A card's balance shown as what it owes. */
const signedMoney = (a: Account, balance: number, currency: string) =>
  a.kind === 'credit_card' && balance < 0 ? `−${fmt(-balance, currency)}` : fmt(balance, currency);

export default function Accounts() {
  const accounts        = useStore(s => s.accounts);
  const transactions    = useStore(s => s.transactions);
  const baseCurrency    = useStore(s => s.profile.baseCurrency);
  const rates           = useStore(s => s.rates);
  const openAddAccount  = useStore(s => s.openAddAccount);
  const openEditAccount = useStore(s => s.openEditAccount);
  const upsertAccount   = useStore(s => s.upsertAccount);
  const toast           = useStore(s => s.toast);
  const navigate = useNavigate();

  // v10.28.0 — Reconcile is a page of its own; closing it comes back here.
  const reconcile = (id: string) => navigate(formPath.accountReconcile(id));
  const [ledgerId, setLedgerId]         = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const now = useMemo(() => new Date(), []);

  const view = useMemo(() => {
    const balances = new Map<string, number>();
    for (const a of accounts) balances.set(a.id, computeAccountBalance(a, transactions, baseCurrency, rates));
    const onScreen = accounts.filter(a => accountGroup(a) !== null);
    const live = onScreen.filter(a => !a.isArchived);
    const order = (x: Account, y: Account) =>
      (x.isDefault ? 0 : 1) - (y.isDefault ? 0 : 1) || x.name.localeCompare(y.name);
    const cash = live.filter(a => a.kind === 'cash');
    const banks = live.filter(a => a.kind === 'bank').sort(order);
    const cards = live.filter(a => accountGroup(a) === 'credit_card').sort(order);
    return {
      balances,
      cash,
      banks,
      cards,
      archived: onScreen.filter(a => a.isArchived).sort(order),
      summary: accountsSummary(live, a => balances.get(a.id) ?? 0),
      bankTotal: round2(banks.reduce((sum, a) => sum + (balances.get(a.id) ?? 0), 0)),
      stale: [...cash, ...banks, ...cards]
        .map(a => ({ a, days: staleDays(a, now) }))
        .filter((x): x is { a: Account; days: number } => x.days !== null),
    };
  }, [accounts, transactions, baseCurrency, rates, now]);

  const symbol = CURRENCIES[baseCurrency]?.symbol ?? '';

  async function restore(a: Account) {
    try {
      await upsertAccount({ id: a.id, isArchived: false });
      toast(`${a.name} restored`, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const row = (a: Account, i: number) => (
    <motion.div key={a.id} custom={i} variants={rowIn} initial="hidden" animate="visible">
      <AccountRow
        acc={a}
        balance={view.balances.get(a.id) ?? 0}
        currency={baseCurrency}
        now={now}
        ledgerOpen={ledgerId === a.id}
        onOpen={() => openEditAccount(a)}
        onReconcile={() => reconcile(a.id)}
        onToggleLedger={() => setLedgerId(id => (id === a.id ? null : a.id))}
        transactions={transactions}
        rates={rates}
      />
    </motion.div>
  );

  return (
    <div className="ui-pilot">
      <div className="flex justify-between items-end mb-section gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="ui-label mb-related">
            Plan · {symbol} {baseCurrency} household
          </p>
          <h1 className="display-italic text-4xl text-ink">Accounts</h1>
        </div>
        <Button onClick={openAddAccount} className="flex-shrink-0">
          <Plus size={14} /> Add account
        </Button>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-7 lg:items-start">
        <div className="min-w-0">
          {/* Summary — one card on mobile, three tiles on desktop. */}
          <div className="lg:hidden rounded-r3 px-4 py-3 flex items-center justify-between gap-3"
            style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
            <div className="min-w-0">
              <div className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-dim">Spendable now</div>
              <AnimatedMoney amount={view.summary.spendableNow} currency={baseCurrency} className="num font-bold text-[27px] text-ink" />
            </div>
            <div className="text-right text-[12px] leading-[1.75] text-ink-dim">
              <div>Cash <span className="num font-semibold" style={{ color: 'hsl(var(--sage))' }}>{fmt(view.summary.cashAvailable, baseCurrency)}</span></div>
              <div>On card <span className="num font-semibold" style={{ color: 'hsl(var(--honey))' }}>{fmt(view.summary.cardOutstanding, baseCurrency)}</span></div>
            </div>
          </div>
          <div className="hidden lg:grid grid-cols-3 gap-3">
            <SummaryTile label="Cash available" amount={view.summary.cashAvailable} currency={baseCurrency} tone="sage" />
            <SummaryTile label="Card outstanding" amount={view.summary.cardOutstanding} currency={baseCurrency} tone="honey" />
            <SummaryTile label="Spendable now" amount={view.summary.spendableNow} currency={baseCurrency} />
          </div>

          {view.cash.map(account => (
            <section key={account.id} aria-label="Cash in Hand" className="mt-group py-4 border-y border-line">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <Banknote size={22} className="text-ink-dim shrink-0" aria-hidden />
                  <div className="min-w-0">
                    <h2 className="text-base font-medium text-ink">Cash in Hand</h2>
                    {account.name !== 'Cash in Hand' && <p className="text-sm text-ink-dim break-words">{account.name}</p>}
                    {account.isDefault && <p className="text-xs text-ink-dim">Default account</p>}
                  </div>
                </div>
                <span className="num text-[22px] text-ink break-all">
                  {fmt(view.balances.get(account.id) ?? 0, baseCurrency)}
                </span>
              </div>
              {staleDays(account, now) !== null && (
                <p className="text-sm text-ink-dim mt-related">Not reconciled in {staleDays(account, now)} days</p>
              )}
              <div className="flex items-center gap-2 flex-wrap mt-related">
                <Button variant="ghost" onClick={() => reconcile(account.id)} className="min-h-[44px]">
                  <ClipboardCheck size={16} aria-hidden /> Reconcile
                </Button>
                <Button variant="ghost" onClick={() => setLedgerId(id => id === account.id ? null : account.id)}
                  aria-expanded={ledgerId === account.id} className="min-h-[44px]">
                  <List size={16} aria-hidden /> Ledger
                </Button>
                <button type="button" onClick={() => openEditAccount(account)} aria-label={`Edit ${account.name}`}
                  title={`Edit ${account.name}`} className="ml-auto min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-dim hover:text-ink rounded-r2">
                  <Pencil size={16} aria-hidden />
                </button>
              </div>
              {ledgerId === account.id && <AccountLedger account={account} txns={transactions} baseCur={baseCurrency} rates={rates} />}
            </section>
          ))}

          <section aria-label="Bank">
            <GroupBar icon="🏦" name="Bank" count={view.banks.length} unit={['account', 'accounts']}
              total={fmt(view.bankTotal, baseCurrency)} tone="sage" />
            <div className="flex flex-col gap-3">
              {view.banks.map(row)}
            </div>
            {view.banks.length === 0 && <p className="text-[0.84rem] text-ink-dim px-1">No bank accounts yet.</p>}
          </section>

          <section aria-label="Credit Card">
            <GroupBar icon="💳" name="Credit Card" count={view.cards.length} unit={['card', 'cards']}
              total={view.summary.cardOutstanding > 0 ? `−${fmt(view.summary.cardOutstanding, baseCurrency)}` : fmt(0, baseCurrency)}
              tone="honey" />
            <div className="flex flex-col gap-3">
              {view.cards.map(row)}
            </div>
            {view.cards.length === 0 && <p className="text-[0.84rem] text-ink-dim px-1">No credit cards yet.</p>}
          </section>

          {/* The narrowed scope, made legible: where the other account types went. */}
          <div className="mt-5 lg:grid lg:grid-cols-2 lg:gap-3">
            <CrossLink icon="🏛️" title="Loans" description="Money you owe — in Debts" onClick={() => navigate('/debts')} />
            <CrossLink icon="📈" title="Investments" description="Things you own — in Net Worth" onClick={() => navigate('/networth')} />
          </div>

          {view.archived.length > 0 && (
            <div className="mt-2 lg:mt-3">
              <button type="button" aria-expanded={showArchived} onClick={() => setShowArchived(s => !s)}
                className="w-full flex items-center gap-3 px-1 py-3 text-left text-[13px] text-ink-mid border-t border-line lg:border-0 lg:rounded-r3 lg:px-4 lg:opacity-60 lg:[background:var(--canvas)] lg:[box-shadow:var(--neu-sm)]">
                <span aria-hidden>🗄️</span>
                <span className="font-semibold">Archived · {view.archived.length}</span>
                <span className="text-ink-dim text-[12px] truncate">— {view.archived.map(a => a.name).join(', ')}</span>
                <span className="ml-auto text-ink-dim" aria-hidden>{showArchived ? '▾' : '▸'}</span>
              </button>
              {showArchived && (
                <div className="flex flex-col gap-2 mt-2">
                  {view.archived.map(a => (
                    <div key={a.id} className="flex items-center gap-3 rounded-r3 px-4 py-3 opacity-60"
                      style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
                      <span aria-hidden>{iconOf(a)}</span>
                      <span className="flex-1 min-w-0 truncate text-[0.9rem] text-ink">{a.name}</span>
                      <span className="num text-[0.9rem] text-ink-mid">{signedMoney(a, view.balances.get(a.id) ?? 0, baseCurrency)}</span>
                      <button type="button" onClick={() => restore(a)}
                        className="font-mono text-[9px] tracking-wider uppercase text-ink-dim hover:text-ink">Restore</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Desktop rail. */}
        <aside className="hidden lg:flex flex-col gap-3.5">
          <div className="rounded-[20px] px-[22px] py-5" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
            <div className="font-mono text-[9px] tracking-[0.14em] uppercase mb-3" style={{ color: 'hsl(var(--honey))' }}>
              Needs your attention
            </div>
            {view.stale.length === 0 ? (
              <p className="text-[12.5px] text-ink-dim leading-snug">
                Every balance has been checked against a statement in the last {STALE_AFTER_DAYS} days.
              </p>
            ) : (
              <>
                {view.stale.map(({ a, days }) => (
                  <button key={a.id} type="button" onClick={() => reconcile(a.id)}
                    className="w-full flex items-center gap-2.5 py-2 text-left text-[12.5px] text-ink-mid hover:text-ink">
                    <span aria-hidden>{iconOf(a)}</span>
                    <span className="flex-1 min-w-0 truncate">{a.name} · {days} days stale</span>
                    <span className="font-mono text-[9px] tracking-wider uppercase" style={{ color: 'hsl(var(--honey))' }}>reconcile</span>
                  </button>
                ))}
                <Button full className="mt-3" onClick={() => reconcile(view.stale[0].a.id)}>
                  {view.stale.length === 1 ? 'Reconcile it' : `Reconcile ${view.stale[0].a.name} first`}
                </Button>
              </>
            )}
          </div>

          <div className="rounded-[20px] px-[22px] py-5" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
            <div className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-dim mb-2">Household currency</div>
            <div className="flex items-baseline gap-2.5 mb-2">
              <span className="num font-bold text-[19px] text-ink">{symbol} {baseCurrency}</span>
              <span className="text-[12px] text-ink-dim">
                applies to all {view.cash.length + view.banks.length + view.cards.length} account{view.cash.length + view.banks.length + view.cards.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="text-[12px] text-ink-dim leading-snug">
              Set once for the household, in Settings ▸ Language &amp; currency. Accounts inherit it — there&apos;s no
              per-account currency to keep in sync.
            </p>
          </div>

          <p className="rounded-[13px] px-[13px] py-[11px] text-[0.76rem] leading-relaxed text-ink-mid"
            style={{ background: 'color-mix(in srgb, hsl(var(--denim)) 14%, transparent)' }}>
            Balances stay computed from the ledger. When one hasn&apos;t been checked against a statement in a while,
            the row says so in words — reconciling clears it.
          </p>
        </aside>
      </div>
    </div>
  );
}

function SummaryTile({ label, amount, currency, tone }: { label: string; amount: number; currency: string; tone?: 'sage' | 'honey' }) {
  return (
    <div className="rounded-r3 p-4 min-w-0" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
      <div className="font-mono text-[8.5px] tracking-[0.13em] uppercase text-ink-dim mb-2">{label}</div>
      <span style={tone ? { color: `hsl(var(--${tone}))` } : undefined}>
        <AnimatedMoney amount={amount} currency={currency} className="num font-bold text-[22px]" />
      </span>
    </div>
  );
}

function GroupBar({ icon, name, count, unit, total, tone }: {
  icon: string; name: string; count: number; unit: [string, string]; total: string; tone: 'sage' | 'honey';
}) {
  return (
    <div className="flex items-center gap-3 px-1 pt-4 pb-3">
      <span className="w-[26px] h-[26px] rounded-[8px] flex items-center justify-center text-[13px] flex-shrink-0"
        style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }} aria-hidden>{icon}</span>
      <h2 className="font-bold text-[14px] text-ink">{name}</h2>
      <span className="font-mono text-[9px] tracking-wider uppercase text-ink-dim">{count} {count === 1 ? unit[0] : unit[1]}</span>
      <span className="ml-auto num font-bold text-[15px]" style={{ color: `hsl(var(--${tone}))` }}>{total}</span>
    </div>
  );
}

function CrossLink({ icon, title, description, onClick }: { icon: string; title: string; description: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full flex items-center gap-3 px-1 py-3 text-left text-[13px] text-ink-mid border-t border-line lg:border-0 lg:rounded-r3 lg:p-4 lg:[background:var(--canvas)] lg:[box-shadow:var(--neu-sm)]">
      <span className="text-[14px] lg:w-[34px] lg:h-[34px] lg:rounded-r2 lg:flex lg:items-center lg:justify-center lg:[background:var(--sunken)] lg:[box-shadow:var(--neu-inset)]" aria-hidden>{icon}</span>
      <span className="min-w-0">
        <span className="font-semibold text-ink">{title}</span>
        <span className="text-ink-dim"> — </span>
        <span className="text-ink-dim text-[12px]">{description.replace(/^[^—]*— /, '')}</span>
      </span>
      <span className="ml-auto text-[15px]" style={{ color: 'var(--accent)' }} aria-hidden>→</span>
    </button>
  );
}

function AccountRow({ acc, balance, currency, now, ledgerOpen, onOpen, onReconcile, onToggleLedger, transactions, rates }: {
  acc: Account; balance: number; currency: string; now: Date; ledgerOpen: boolean;
  onOpen: () => void; onReconcile: () => void; onToggleLedger: () => void;
  transactions: Transaction[]; rates: Record<string, number>;
}) {
  const isCard = acc.kind === 'credit_card';
  const days = staleDays(acc, now);
  const figures = isCard ? cardFigures(acc.creditLimit, balance) : null;

  let line: React.ReactNode;
  if (isCard) {
    line = figures
      ? [
          `${fmt(figures.available, currency)} free of ${fmt(figures.limit, currency)}`,
          acc.billingCycleDay ? `cycle ${ordinal(acc.billingCycleDay)}` : null,
          acc.paymentDueDay ? `due ${fmtDay(nextDueDate(acc.paymentDueDay, now))}` : null,
        ].filter(Boolean).join(' · ')
      : 'Add the credit limit to see what’s free';
    if (days !== null) line = <><span style={{ color: 'hsl(var(--honey))' }}>not reconciled in {days} days</span> · {line}</>;
  } else if (days !== null) {
    line = <span style={{ color: 'hsl(var(--honey))' }}>not reconciled in {days} days</span>;
  } else if (acc.kind === 'cash') {
    line = 'Cash in Hand';
  } else {
    line = acc.paymentModes?.length
      ? acc.paymentModes.map(m => PAYMENT_MODE_LABEL[m]).join(' · ')
      : 'Add the payment modes you use';
  }
  const stale = days !== null;

  return (
    <div className="rounded-r3 p-4 min-w-0"
      style={{ background: 'var(--canvas)', boxShadow: acc.isDefault ? 'var(--neu), 0 0 0 1.5px var(--accent)' : 'var(--neu)' }}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onOpen} aria-label={`Edit ${acc.name}`}
          className="flex items-center gap-3 flex-1 min-w-0 text-left bg-transparent border-none cursor-pointer">
          <span className="w-10 h-10 rounded-r2 flex items-center justify-center text-[18px] flex-shrink-0"
            style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }} aria-hidden>{iconOf(acc)}</span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="font-bold text-[15px] text-ink truncate">{acc.name}</span>
              {acc.isDefault && (
                <>
                  <span className="text-[12px]" style={{ color: 'hsl(var(--honey))' }} aria-hidden>★</span>
                  <span className="hidden lg:inline font-mono text-[8px] tracking-[0.14em] uppercase text-ink-dim">default account</span>
                </>
              )}
            </span>
            <span className="block text-[11.5px] text-ink-dim truncate mt-0.5">{line}</span>
          </span>
        </button>

        {figures && (
          <span className="hidden lg:block w-[110px] h-1.5 rounded-full overflow-hidden flex-shrink-0" role="img"
            aria-label={`${Math.round(figures.utilisation * 100)}% of the credit limit used`}
            style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
            <span className="block h-full rounded-full chart-grow"
              style={{ width: `${Math.min(100, figures.utilisation * 100)}%`, background: 'hsl(var(--denim))' }} />
          </span>
        )}

        <div className="text-right flex-shrink-0">
          <div className="num font-bold text-[17px]"
            style={{ color: isCard && balance < 0 ? 'hsl(var(--honey))' : undefined }}>
            {signedMoney(acc, balance, currency)}
          </div>
          <button type="button" onClick={stale ? onReconcile : onToggleLedger}
            aria-expanded={stale ? undefined : ledgerOpen}
            className="block ml-auto font-mono text-[7.5px] lg:text-[9px] tracking-wider uppercase mt-0.5 hover:opacity-70"
            style={{ color: stale ? 'hsl(var(--honey))' : 'var(--ff-ink-4, inherit)' }}>
            {stale ? 'reconcile ▸' : ledgerOpen ? 'ledger ▾' : 'ledger ▸'}
          </button>
        </div>
      </div>
      {ledgerOpen && (
        <>
          <AccountLedger account={acc} txns={transactions} baseCur={currency} rates={rates} />
          <button type="button" onClick={onReconcile}
            className="mt-2 ml-1 font-mono text-[9px] tracking-wider uppercase text-ink-dim hover:text-ink">Reconcile against a statement ▸</button>
        </>
      )}
    </div>
  );
}

/** Per-account ledger: reverse-chronological, with the running balance. */
function AccountLedger({ account, txns, baseCur, rates }: {
  account: Account; txns: Transaction[]; baseCur: string; rates: Record<string, number>;
}) {
  const rows = useMemo(() => {
    const accountValue = accountValueOf(account);
    // Match by account uuid OR the legacy encoded value; income credits the
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
    let running = computeAccountBalance(account, txns, baseCur, rates);
    return mine.map(r => { const at = running; running -= r.impact; return { ...r, runningAfter: at }; });
  }, [account, txns, baseCur, rates]);

  const log = (account.reconciliationLog ?? []).slice(-5).reverse();
  if (!rows.length && !log.length) return <div className="mt-3 pl-1 text-[0.72rem] text-ink-dim">No entries yet.</div>;
  return (
    <div className="mt-3 ml-1 border-l-2 border-line pl-3 space-y-1">
      {/* Reconcile adjustments appear in account history ONLY — never in a spend total. */}
      {log.map((e, i) => (
        <div key={`log-${i}`} className="flex items-center gap-2 text-[0.74rem] text-ink-dim italic">
          <span className="font-mono text-[0.62rem] w-[4.5rem] shrink-0">{e.at.slice(0, 10)}</span>
          <span className="flex-1 truncate">
            {e.kind === 'investment' ? 'Value updated' : e.kind === 'merge' ? (e.note ?? 'History moved in') : 'Reconcile adjustment'}
            {' '}({e.delta >= 0 ? '+' : ''}{Math.round(e.delta)})
          </span>
        </div>
      ))}
      {rows.slice(0, 50).map(({ t, impact, runningAfter }) => (
        <div key={t.id} className="flex items-center gap-2 text-[0.78rem]">
          <span className="text-ink-dim font-mono text-[0.62rem] w-[4.5rem] shrink-0">{t.date}</span>
          <span className="flex-1 truncate text-ink-mid">{t.description || getCat(t.category).label}</span>
          <span className="num" style={{ color: impact < 0 ? 'hsl(var(--terra))' : 'hsl(var(--sage))' }}>
            {impact >= 0 ? '+' : ''}{Math.round(impact)}
          </span>
          <span className="num text-ink-dim w-20 text-right">{Math.round(runningAfter)}</span>
        </div>
      ))}
    </div>
  );
}
