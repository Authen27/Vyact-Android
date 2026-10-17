// Vyact v10.24.0 (Accounts R2) — the Accounts screen (design frames M1 / D1).
//
// Scope is narrowed to SPENDABLE accounts — the ones a transaction can be paid
// from, in three groups of the same account card (Aurora 4.0 AC1):
//   Cash         Cash in Hand, with Reconcile and Ledger on the card
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
import { ClipboardCheck, List } from 'lucide-react';
import { useStore } from '../store';
import Button from '../components/ui/Button';
import EstimatedTag from '../components/ui/EstimatedTag';
import { isEstimate } from '../lib/onboardingState';
import AnimatedMoney from '../components/ui/AnimatedMoney';
import { formPath } from '../lib/formRoutes';
import { computeAccountBalance } from '../lib/accountBalance';
import { accountLedgerRows } from '../lib/accountLedger';
import { fmt, fmtNet, fmtSigned, dateKeyIn } from '../lib/format';
import { getCat } from '../constants';
import { spring } from '../lib/motion';
import {
  PAYMENT_MODE_LABEL, STALE_AFTER_DAYS, accountGroup, accountsSummary, cardFigures, nextDueDate, staleDays,
} from '../lib/accountsView';
import type { Account, Transaction } from '../types';
import PageHead from '../components/ui/PageHead';

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
/** A balance with its sign: a card's is what it owes, and an overdrawn bank is negative too (W4d,
 *  FE-UIC-04 — only cards used to keep the minus). */
const signedMoney = (_a: Account, balance: number, currency: string) => fmtNet(balance, currency);

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
      <PageHead title="Accounts" action={{ label: 'Add account', icon: true, entity: 'account', onClick: openAddAccount }} />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-7 lg:items-start">
        <div className="min-w-0">
          {/* Summary — one card on mobile, three tiles on desktop. */}
          <div className="lg:hidden rounded-r3 px-4 py-3 flex items-center justify-between gap-3"
            style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
            <div className="min-w-0">
              <div className="ui-label">Spendable now</div>
              <AnimatedMoney amount={view.summary.spendableNow} currency={baseCurrency} className="num font-bold text-[27px] text-ink" />
            </div>
            <div className="text-right text-[12px] leading-[1.75] text-ink-dim">
              <div>Available cash <span className="num font-semibold" style={{ color: 'var(--good-text)' }}>{fmtNet(view.summary.cashAvailable, baseCurrency)}</span></div>
              <div>On card <span className="num font-semibold" style={{ color: 'var(--warn-text)' }}>{fmt(view.summary.cardOutstanding, baseCurrency)}</span></div>
            </div>
          </div>
          <div className="hidden lg:grid grid-cols-3 gap-3">
            <SummaryTile label="Available cash" amount={view.summary.cashAvailable} currency={baseCurrency} tone="sage" />
            <SummaryTile label="Card outstanding" amount={view.summary.cardOutstanding} currency={baseCurrency} tone="honey" />
            <SummaryTile label="Spendable now" amount={view.summary.spendableNow} currency={baseCurrency} />
          </div>

          {/* The region keeps the name "Cash in Hand" (one per household); the group heading says Cash.
              No count or total — the card itself carries the one balance. */}
          {view.cash.length > 0 && (
            <section aria-label="Cash in Hand">
              <GroupBar icon="💵" name="Cash" tone="sage" />
              <div className="flex flex-col gap-3">
                {view.cash.map(row)}
              </div>
            </section>
          )}

          <section aria-label="Bank">
            <GroupBar icon="🏦" name="Bank" count={view.banks.length} unit={['account', 'accounts']}
              total={fmtNet(view.bankTotal, baseCurrency)} tone="sage" />
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
                        className="min-h-[44px] px-1 text-[12px] font-medium text-ink-mid hover:text-ink">Restore</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Desktop rail. */}
        <aside className="hidden lg:flex flex-col gap-3.5">
          <div className="rounded-r3 px-[22px] py-5" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
            <div className="ui-label mb-3" style={{ color: 'var(--warn-text)' }}>
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
                    <span className="text-[12px] font-medium" style={{ color: 'var(--warn-text)' }}>Reconcile</span>
                  </button>
                ))}
                <Button full className="mt-3" onClick={() => reconcile(view.stale[0].a.id)}>
                  {view.stale.length === 1 ? 'Reconcile it' : `Reconcile ${view.stale[0].a.name} first`}
                </Button>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function SummaryTile({ label, amount, currency, tone }: { label: string; amount: number; currency: string; tone?: 'sage' | 'honey' }) {
  return (
    <div className="rounded-r3 p-4 min-w-0" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
      <div className="ui-label mb-2">{label}</div>
      <span style={tone ? { color: `hsl(var(--${tone}))` } : undefined}>
        <AnimatedMoney amount={amount} currency={currency} className="num font-bold text-[22px]" />
      </span>
    </div>
  );
}

function GroupBar({ icon, name, count, unit, total, tone }: {
  icon: string; name: string; count?: number; unit?: [string, string]; total?: string; tone: 'sage' | 'honey';
}) {
  return (
    <div className="flex items-center gap-3 px-1 pt-4 pb-3">
      <span className="w-[26px] h-[26px] rounded-r2 flex items-center justify-center text-[13px] flex-shrink-0"
        style={{ background: 'var(--well-bg)', boxShadow: 'var(--well-shadow)', border: '1px solid var(--well-border)' }} aria-hidden>{icon}</span>
      <h2 className="font-bold text-[14px] text-ink">{name}</h2>
      {count !== undefined && unit && <span className="text-[12px] text-ink-dim">{count} {count === 1 ? unit[0] : unit[1]}</span>}
      {total !== undefined && <span className="ml-auto num font-bold text-[15px]" style={{ color: `hsl(var(--${tone}))` }}>{total}</span>}
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
      <span className="ml-auto text-[15px]" style={{ color: 'var(--accent-text)' }} aria-hidden>→</span>
    </button>
  );
}

function AccountRow({ acc, balance, currency, now, ledgerOpen, onOpen, onReconcile, onToggleLedger, transactions, rates }: {
  acc: Account; balance: number; currency: string; now: Date; ledgerOpen: boolean;
  onOpen: () => void; onReconcile: () => void; onToggleLedger: () => void;
  transactions: Transaction[]; rates: Record<string, number>;
}) {
  const isCard = acc.kind === 'credit_card';
  const isCash = acc.kind === 'cash';
  const days = staleDays(acc, now);
  const figures = isCard ? cardFigures(acc.creditLimit, balance) : null;
  const due = isCard && acc.paymentDueDay ? fmtDay(nextDueDate(acc.paymentDueDay, now)) : null;

  let line: React.ReactNode;
  let phoneLine: React.ReactNode = null;
  if (isCard) {
    phoneLine = figures
      ? `${fmtNet(figures.available, currency)} free of ${fmt(figures.limit, currency)}`
      : 'Add the credit limit to see what’s free';
    if (days !== null) phoneLine = <><span style={{ color: 'var(--warn-text)' }}>not reconciled in {days} days</span> · {phoneLine}</>;
    line = figures
      ? [
          `${fmtNet(figures.available, currency)} free of ${fmt(figures.limit, currency)}`,
          acc.billingCycleDay ? `cycle ${ordinal(acc.billingCycleDay)}` : null,
          due ? `due ${due}` : null,
        ].filter(Boolean).join(' · ')
      : 'Add the credit limit to see what’s free';
    if (days !== null) line = <><span style={{ color: 'var(--warn-text)' }}>not reconciled in {days} days</span> · {line}</>;
  } else if (days !== null) {
    line = <span style={{ color: 'var(--warn-text)' }}>not reconciled in {days} days</span>;
  } else if (isCash) {
    line = 'Notes and coins you hold';
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
            style={{ background: 'var(--well-bg)', boxShadow: 'var(--well-shadow)', border: '1px solid var(--well-border)' }} aria-hidden>{iconOf(acc)}</span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="font-bold text-[15px] text-ink truncate">{acc.name}</span>
              {/* W6 (audit FE-UIS-11): an onboarding estimate (take-home pay as opening cash) is not a
                  counted balance until it is reconciled, which confirms it. */}
              {isEstimate(acc) && <EstimatedTag confidence={acc.confidence!} source={acc.source} className="flex-shrink-0" />}
              {acc.isDefault && (
                <>
                  <span className="text-[12px]" style={{ color: 'var(--warn-text)' }} aria-hidden>★</span>
                  <span className="hidden lg:inline text-[11px] text-ink-dim">Default account</span>
                </>
              )}
            </span>
            {phoneLine !== null && <span className="lg:hidden block text-[12px] text-ink-dim truncate mt-0.5">{phoneLine}</span>}
            <span className={`${phoneLine !== null ? 'hidden lg:block' : 'block'} text-[12px] text-ink-dim truncate mt-0.5`}>{line}</span>
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
          {!isCash && (
            <button type="button" onClick={stale ? onReconcile : onToggleLedger}
              aria-expanded={stale ? undefined : ledgerOpen}
              className="block ml-auto text-[12px] font-medium mt-0.5 hover:opacity-70"
              style={{ color: stale ? 'var(--warn-text)' : 'var(--ff-ink-3, inherit)' }}>
              {stale ? 'Reconcile ›' : ledgerOpen ? 'Hide ledger' : 'Ledger ›'}
            </button>
          )}
        </div>
      </div>
      {figures && (
        <div className="lg:hidden mt-3">
          <div className="trough h-1.5" role="img" aria-label={`${Math.round(figures.utilisation * 100)}% of the credit limit used`}>
            <div className="h-full rounded-full chart-grow"
              style={{ width: `${Math.min(100, figures.utilisation * 100)}%`, background: 'hsl(var(--denim))' }} />
          </div>
          {/* The percentage is not capped — a card over its limit says so; only the bar stops at full. */}
          <div className="text-[12px] text-ink-dim mt-1.5">
            {Math.round(figures.utilisation * 100)}% of limit used{due ? ` · due ${due}` : ''}
          </div>
        </div>
      )}
      {/* Cash is counted, not read off a statement: Reconcile and Ledger sit on its card. */}
      {isCash && (
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <Button variant="ghost" onClick={onReconcile} className="min-h-[44px]">
            <ClipboardCheck size={16} aria-hidden /> Reconcile
          </Button>
          <Button variant="ghost" onClick={onToggleLedger} aria-expanded={ledgerOpen} className="min-h-[44px]">
            <List size={16} aria-hidden /> Ledger
          </Button>
        </div>
      )}
      {ledgerOpen && (
        <>
          <AccountLedger account={acc} txns={transactions} baseCur={currency} rates={rates} />
          {!isCash && (
            <button type="button" onClick={onReconcile}
              className="mt-1 ml-1 min-h-[44px] text-[12px] font-medium text-ink-mid hover:text-ink">Reconcile against a statement ›</button>
          )}
        </>
      )}
    </div>
  );
}

/** Per-account ledger: reverse-chronological, with the running balance. */
function AccountLedger({ account, txns, baseCur, rates }: {
  account: Account; txns: Transaction[]; baseCur: string; rates: Record<string, number>;
}) {
  // W8a (FE-UIC-15): the walk undoes each reconcile adjustment as it passes the day it was applied.
  const rows = useMemo(() => accountLedgerRows(account, txns, baseCur, rates), [account, txns, baseCur, rates]);

  const log = (account.reconciliationLog ?? []).slice(-5).reverse();
  if (!rows.length && !log.length) return <div className="mt-3 pl-1 text-[0.72rem] text-ink-dim">No entries yet.</div>;
  return (
    <div className="mt-3 ml-1 border-l-2 border-line pl-3 space-y-1">
      {/* Reconcile adjustments appear in account history ONLY — never in a spend total. */}
      {log.map((e, i) => (
        <div key={`log-${i}`} className="flex items-center gap-2 text-[0.74rem] text-ink-dim italic">
          <span className="num text-[11px] w-[4.5rem] shrink-0">{e.at.length > 10 ? dateKeyIn(new Date(e.at)) : e.at}</span>
          <span className="flex-1 truncate">
            {e.kind === 'investment' ? 'Value updated' : e.kind === 'merge' ? (e.note ?? 'History moved in') : 'Reconcile adjustment'}
            {' '}({e.delta >= 0 ? '+' : ''}{Math.round(e.delta)})
          </span>
        </div>
      ))}
      {rows.slice(0, 50).map(({ t, impact, runningAfter }) => (
        <div key={t.id} className="flex items-center gap-2 text-[0.78rem]">
          <span className="text-ink-dim num text-[11px] w-[4.5rem] shrink-0">{t.date}</span>
          <span className="flex-1 truncate text-ink-mid">{t.description || getCat(t.category).label}</span>
          <span className="num" style={{ color: impact < 0 ? 'hsl(var(--terra))' : 'hsl(var(--sage))' }}>
            {fmtSigned(impact, baseCur)}
          </span>
          <span className="num text-ink-dim w-20 text-right">{fmtNet(runningAfter, baseCur)}</span>
        </div>
      ))}
    </div>
  );
}
