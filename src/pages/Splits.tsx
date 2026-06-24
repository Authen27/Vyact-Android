import { useState } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks';
import { Panel } from '../components/ui/Card';
import { fmt, convert, uid } from '../lib/format';
import Money from '../components/ui/Money';
import { splitsOutstanding } from '../lib/calculations';
import type { Transaction, SplitParticipant, Debt } from '../types';

export default function Splits() {
  const { t } = useTranslation();
  const transactions  = useStore(s => s.transactions);
  const profile       = useStore(s => s.profile);
  const rates         = useStore(s => s.rates);
  const upsertTransaction = useStore(s => s.upsertTransaction);
  const upsertDebt    = useStore(s => s.upsertDebt);
  const toast         = useStore(s => s.toast);

  const c = profile.baseCurrency;
  const { owedToYou, youOwe, owedDetails, youOweDetails } = splitsOutstanding(transactions, c, rates);

  const splitTxns = transactions.filter(tx => tx.split?.isSplit);

  async function markPaid(txnId: string, participantName: string) {
    const txn = transactions.find(tx => tx.id === txnId);
    if (!txn?.split) return;
    const updated: Transaction = {
      ...txn,
      split: {
        ...txn.split,
        participants: txn.split.participants.map((p: SplitParticipant) =>
          p.name === participantName ? { ...p, paid: true, paidOn: new Date().toISOString().split('T')[0] } : p
        ),
      },
    };
    await upsertTransaction(updated);
    toast(`Marked ${participantName} as settled`, 'success');
  }

  async function markAllPaid(txnId: string) {
    const txn = transactions.find(tx => tx.id === txnId);
    if (!txn?.split) return;
    const updated: Transaction = {
      ...txn,
      split: {
        ...txn.split,
        participants: txn.split.participants.map((p: SplitParticipant) => ({ ...p, paid: true, paidOn: new Date().toISOString().split('T')[0] })),
      },
    };
    await upsertTransaction(updated);
    toast('All participants settled', 'success');
  }

  // v7.3 — Convert a "you owe" split obligation into a real Debt row so it
  // appears on the Debts page, gets included in liabilities + Net Worth, and
  // can use the avalanche/snowball payoff engine. The corresponding split
  // participant is left as-is (it stays the source-of-truth IOU); the new
  // Debt links back via `linkedDebtId` on the transaction so we can dedupe
  // later if needed.
  async function convertSplitToDebt(txnId: string, participantName: string) {
    const txn = transactions.find(tx => tx.id === txnId);
    if (!txn?.split) return;
    const part = txn.split.participants.find((p: SplitParticipant) =>
      (p.isYou ? 'You' : p.name) === participantName,
    );
    if (!part) return;

    const counterparty = txn.type === 'income'
      ? (part.isYou ? 'External recipient' : part.name)
      : (part.isYou ? 'External payer' : part.name);
    const debt: Partial<Debt> = {
      id: uid(),
      type: 'personal',
      name: `${txn.description} — ${counterparty}`,
      lender: counterparty,
      counterpartyName: counterparty,
      principal: part.share,
      currentBalance: part.share,
      interestRate: 0,
      minimumPayment: 0,
      currency: txn.currency,
      direction: 'owed_by_me',
    };
    const created = await upsertDebt(debt);
    await upsertTransaction({ ...txn, linkedDebtId: created.id });
    toast(`Tracked ${fmt(convert(part.share, txn.currency, c, rates), c)} as a debt`, 'success');
  }

  function SplitRow({ txn }: { txn: Transaction }) {
    const [expanded, setExpanded] = useState(false);
    const split = txn.split!;
    const isIncome = txn.type === 'income';
    const totalInBase = convert(split.totalAmount, txn.currency, c, rates);
    const yourShareBase = convert(split.yourShare, txn.currency, c, rates);
    const unsettled = split.participants.filter((p: SplitParticipant) => !p.paid && !p.isYou);
    // v7.3 — polarity inverts on income (see splitsOutstanding for the
    // matching aggregator branches).
    let owedHere = 0;
    let youOweHere = 0;
    if (!isIncome) {
      owedHere = split.paidBy === 'me'
        ? unsettled.reduce((s: number, p: SplitParticipant) => s + convert(p.share, txn.currency, c, rates), 0)
        : 0;
      youOweHere = split.paidBy === 'external' && !split.participants.find((p: SplitParticipant) => p.isYou)?.paid
        ? yourShareBase : 0;
    } else {
      owedHere = split.paidBy === 'external' && !split.participants.find((p: SplitParticipant) => p.isYou)?.paid
        ? yourShareBase : 0;
      youOweHere = split.paidBy === 'me'
        ? unsettled.reduce((s: number, p: SplitParticipant) => s + convert(p.share, txn.currency, c, rates), 0)
        : 0;
    }
    const linkedDebtId = txn.linkedDebtId;

    return (
      <div className="bg-bg border border-line rounded-xl overflow-hidden">
        <button className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-bg3 transition-colors"
          onClick={() => setExpanded(e => !e)}>
          <div>
            <div className="font-semibold text-ink">{txn.description}</div>
            <div className="font-mono text-[0.62rem] tracking-wider text-ink-dim">{txn.date} · {split.participants.length} participants</div>
          </div>
          <div className="flex items-center gap-4 min-w-0">
            <div className="text-right min-w-0">
              <Money amount={totalInBase} currency={c} maxChars={11} className="font-semibold text-ink" />
              {owedHere > 0 && <div className="font-mono text-[0.6rem] tracking-wider text-sage">+{fmt(owedHere, c)} owed to you</div>}
              {youOweHere > 0 && <div className="font-mono text-[0.6rem] tracking-wider text-terra">−{fmt(youOweHere, c)} you owe</div>}
              {linkedDebtId && <div className="font-mono text-[0.58rem] tracking-wider text-ink-dim">linked to a debt</div>}
            </div>
            <span className="text-ink-dim text-sm flex-shrink-0">{expanded ? '▴' : '▾'}</span>
          </div>
        </button>

        {expanded && (
          <div className="border-t border-line px-5 py-4 space-y-2">
            <div className="flex justify-between items-center mb-3">
              <div className="font-mono text-[0.6rem] tracking-widest text-ink-dim uppercase">Participants</div>
              {unsettled.length > 0 && (
                <button className="btn-ghost text-xs py-1 px-2.5" onClick={() => markAllPaid(txn.id)}>
                  Settle all
                </button>
              )}
            </div>
            {split.participants.map((p: SplitParticipant) => {
              const shareBase = convert(p.share, txn.currency, c, rates);
              return (
                <div key={p.name} className={`flex items-center justify-between rounded-md px-3 py-2.5 border ${p.paid ? 'bg-sage/5 border-sage/20' : 'bg-bg3 border-line'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-base">{p.isYou ? '👤' : '👥'}</span>
                    <div>
                      <span className="text-[0.84rem] font-semibold text-ink">{p.isYou ? 'You' : p.name}</span>
                      {p.paid && p.paidOn && <div className="font-mono text-[0.58rem] tracking-wider text-sage">Settled {p.paidOn}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 min-w-0">
                    <Money amount={shareBase} currency={c} maxChars={10} className={`font-semibold text-[0.9rem] ${p.paid ? 'text-sage' : 'text-ink'}`} />
                    {!p.paid && !p.isYou && ((!isIncome && split.paidBy === 'me') || (isIncome && split.paidBy === 'me')) && (
                      <button className="btn-secondary text-xs py-1 px-2.5" onClick={() => markPaid(txn.id, p.name)}>
                        Mark paid
                      </button>
                    )}
                    {!p.paid && p.isYou && ((!isIncome && split.paidBy === 'external') || (isIncome && split.paidBy === 'external')) && (
                      <button className="btn-primary text-xs py-1 px-2.5" onClick={() => markPaid(txn.id, p.name)}>
                        Settle
                      </button>
                    )}
                    {/* v7.3 — Convert "you owe" obligations into Debts. Shown
                       on the participant row that represents your unpaid
                       liability: expense + paidBy=external + isYou; or
                       income + paidBy=me + !isYou (you owe each non-you). */}
                    {!p.paid && !linkedDebtId && (
                      (!isIncome && split.paidBy === 'external' && p.isYou) ||
                      (isIncome && split.paidBy === 'me' && !p.isYou)
                    ) && (
                      <button
                        className="btn-ghost text-xs py-1 px-2.5"
                        title="Track this obligation as a Debt"
                        onClick={() => convertSplitToDebt(txn.id, p.isYou ? 'You' : p.name)}
                      >
                        Track as debt
                      </button>
                    )}
                    {p.paid && <span className="text-sage text-base">✓</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-start mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="display-italic text-4xl text-ink mb-1.5">{t('splits')}</h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            Group bills · outstanding IOUs · settlements
          </p>
        </div>
      </div>

      {/* IOU summary */}
      {(owedToYou > 0 || youOwe > 0) && (
        <div className="grid sm:grid-cols-2 gap-3 mb-5">
          <div className="bg-sage/8 border border-sage/20 rounded-xl p-5 min-w-0">
            <div className="font-mono text-[0.6rem] tracking-widest text-ink-dim uppercase mb-1">Owed to You</div>
            <Money amount={owedToYou} currency={c} maxChars={11} className="text-3xl font-semibold text-sage" />
            <div className="font-mono text-[0.62rem] tracking-wider text-ink-dim mt-1">{owedDetails.length} outstanding item{owedDetails.length !== 1 ? 's' : ''}</div>
          </div>
          <div className="bg-terra/8 border border-terra/20 rounded-xl p-5 min-w-0">
            <div className="font-mono text-[0.6rem] tracking-widest text-ink-dim uppercase mb-1">You Owe</div>
            <Money amount={youOwe} currency={c} maxChars={11} className="text-3xl font-semibold text-terra" />
            <div className="font-mono text-[0.62rem] tracking-wider text-ink-dim mt-1">{youOweDetails.length} outstanding item{youOweDetails.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
      )}

      <div className="bg-coral-tint border border-coral/20 rounded-md px-4 py-3 mb-5 text-[0.84rem] text-ink-mid">
        <span className="font-semibold text-ink">Add split transactions</span> from the Transactions page —
        flag any expense (a shared bill) <em>or</em> income (a shared payout) as a split and assign
        participants and shares. Use <span className="font-semibold text-ink">Track as debt</span> on
        a "you owe" row to convert the IOU into a real debt that shows up on the Debts page and Net
        Worth.
      </div>

      {/* Split list */}
      {splitTxns.length === 0 ? (
        <Panel>
          <div className="px-6 py-14 text-center">
            <div className="text-4xl mb-3 opacity-60">🤝</div>
            <p className="text-ink-mid mb-2">No split transactions yet.</p>
            <p className="text-[0.84rem] text-ink-dim">Add a transaction and mark it as a split to track shared expenses.</p>
          </div>
        </Panel>
      ) : (
        <div className="space-y-3">
          <div className="font-mono text-[0.6rem] tracking-widest text-ink-dim uppercase px-1 mb-2">
            {splitTxns.length} split transaction{splitTxns.length !== 1 ? 's' : ''}
          </div>
          {splitTxns.map(txn => <SplitRow key={txn.id} txn={txn} />)}
        </div>
      )}
    </div>
  );
}
