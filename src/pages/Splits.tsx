import { useState } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks';
import { Panel } from '../components/ui/Card';
import { fmt, convert, uid } from '../lib/format';
import Money from '../components/ui/Money';
import { splitsOutstanding, type SplitOutstanding } from '../lib/calculations';
import type { Transaction, SplitParticipant, Debt } from '../types';

// v10.17 (items 7/8/9) — roll the outstanding split details up per person,
// keyed by email (fallback: display name for local/no-email participants), so
// the hero tiles can expand into "who must pay you / whom you must pay". The
// sums reconcile exactly with the hero numbers because both read the same
// `splitsOutstanding` details.
interface PersonAgg { key: string; name: string; email?: string; amount: number }
function aggregatePeople(
  details: SplitOutstanding['owedDetails'],
  base: string, rates: Parameters<typeof convert>[3],
): PersonAgg[] {
  const map = new Map<string, PersonAgg>();
  for (const { txn, participant } of details) {
    const email = participant.email?.toLowerCase();
    const key = email || participant.name.toLowerCase();
    const amt = convert(participant.share, txn.currency, base, rates);
    const cur = map.get(key);
    if (cur) cur.amount += amt;
    else map.set(key, { key, name: participant.name, email, amount: amt });
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export default function Splits() {
  const { t } = useTranslation();
  const transactions  = useStore(s => s.transactions);
  const profile       = useStore(s => s.profile);
  const rates         = useStore(s => s.rates);
  const upsertTransaction = useStore(s => s.upsertTransaction);
  const removeTransaction = useStore(s => s.removeTransaction);
  const upsertDebt    = useStore(s => s.upsertDebt);
  const toast         = useStore(s => s.toast);
  const openAddSplit  = useStore(s => s.openAddSplit);
  const openEditSplit = useStore(s => s.openEditSplit);
  const deleteSharedSplitForTxn = useStore(s => s.deleteSharedSplitForTxn);
  // v10.14 — email-based cross-household split sharing.
  const cloudEnabled        = useStore(s => s.cloudEnabled);
  const currentHouseholdId  = useStore(s => s.currentHouseholdId);
  const session             = useStore(s => s.session);
  const sharedSplitsOwned   = useStore(s => s.sharedSplitsOwned);
  const sharedSplitsWithMe  = useStore(s => s.sharedSplitsWithMe);
  const settleMySplitShare  = useStore(s => s.settleMySplitShare);
  const markSplitShareRowPaid = useStore(s => s.markSplitShareRowPaid);
  const closeMySplit        = useStore(s => s.closeMySplit);
  const myEmail = session?.user?.email?.toLowerCase();
  const cloudActive = cloudEnabled && currentHouseholdId !== 'local';

  const c = profile.baseCurrency;
  const { owedToYou, youOwe, owedDetails, youOweDetails } = splitsOutstanding(transactions, c, rates);

  // v10.17 (items 7/8/9) — which hero tile's per-person breakdown is expanded.
  const [heroView, setHeroView] = useState<null | 'owed' | 'owe' | 'net'>(null);
  const owedByPerson = aggregatePeople(owedDetails, c, rates);
  const youOweByPerson = aggregatePeople(youOweDetails, c, rates);
  // Net per person = what they owe you − what you owe them (union of both sides).
  const netByPerson = (() => {
    const map = new Map<string, { key: string; name: string; email?: string; net: number }>();
    for (const p of owedByPerson) map.set(p.key, { key: p.key, name: p.name, email: p.email, net: p.amount });
    for (const p of youOweByPerson) {
      const cur = map.get(p.key);
      if (cur) cur.net -= p.amount;
      else map.set(p.key, { key: p.key, name: p.name, email: p.email, net: -p.amount });
    }
    return [...map.values()].filter(p => Math.abs(p.net) > 0.005).sort((a, b) => b.net - a.net);
  })();

  const splitTxns = transactions.filter(tx => tx.split?.isSplit);

  async function deleteSplit(txnId: string) {
    if (!confirm('Delete this split completely? This removes the transaction and any shares sent to other households.')) return;
    try {
      await removeTransaction(txnId);
      if (cloudActive) await deleteSharedSplitForTxn(txnId);
      toast('Split deleted', 'info');
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, 'error');
    }
  }

  // v10.18.1 — the local transaction card is now the single owner surface, so
  // marking a member paid must also settle their CLOUD share (the copy other
  // households see + their notifications), matched by email. Best-effort.
  async function syncCloudSharePaid(txnId: string, email?: string) {
    if (!cloudActive || !email) return;
    const owned = sharedSplitsOwned.find(sp => sp.txnId === txnId);
    const share = owned?.shares.find(sh => sh.email?.toLowerCase() === email.toLowerCase());
    if (share && !share.paid) {
      try { await markSplitShareRowPaid(share.id); } catch { /* best-effort cloud sync */ }
    }
  }

  async function markPaid(txnId: string, participantName: string) {
    const txn = transactions.find(tx => tx.id === txnId);
    if (!txn?.split) return;
    const target = txn.split.participants.find((p: SplitParticipant) => p.name === participantName);
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
    await syncCloudSharePaid(txnId, target?.email);
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
    // Also settle every unpaid cloud share for this split (best-effort).
    if (cloudActive) {
      const owned = sharedSplitsOwned.find(sp => sp.txnId === txnId);
      for (const sh of owned?.shares ?? []) {
        if (!sh.paid) { try { await markSplitShareRowPaid(sh.id); } catch { /* best-effort */ } }
      }
    }
    toast('All participants settled', 'success');
  }

  async function closeSplit(splitId: string) {
    if (!confirm('Close this split? Members are notified and it can no longer be edited.')) return;
    try { await closeMySplit(splitId); toast('Split closed', 'info'); }
    catch (e) { toast(`Close failed: ${(e as Error).message}`, 'error'); }
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

  // v10.17 — one row of the per-person hero breakdown. Shows the resolved
  // username (falls back to the email when no display name) and the email ID
  // beneath it, with the rolled-up amount on the right.
  function PersonBreakdownRow(
    { p, amount, tone, signed }: { p: { name: string; email?: string }; amount: number; tone: 'sage' | 'terra'; signed?: boolean },
  ) {
    const showName = p.name && p.name.toLowerCase() !== (p.email ?? '').toLowerCase() && p.name !== 'You';
    const prefix = signed ? (amount >= 0 ? '＋' : '−') : '';
    return (
      <div className="flex items-center justify-between gap-3 rounded-md px-3 py-2 bg-bg3 border border-line">
        <div className="min-w-0">
          {showName && <div className="text-[0.82rem] font-semibold text-ink truncate">{p.name}</div>}
          <div className={`font-mono text-[0.62rem] tracking-wider truncate ${showName ? 'text-ink-dim' : 'text-ink font-semibold'}`}>
            {p.email || p.name}
          </div>
        </div>
        <span className={`num font-semibold text-[0.9rem] flex-shrink-0 ${tone === 'sage' ? 'text-sage' : 'text-terra'}`}>
          {prefix}{fmt(Math.abs(amount), c)}
        </span>
      </div>
    );
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
    // v10.18.1 — the matching CLOUD shared split (if this owned split was shared
    // out). Drives the folded-in owner controls (Close split) + email display.
    const ownedShared = sharedSplitsOwned.find(sp => sp.txnId === txn.id);

    return (
      <div className="rounded-r3 overflow-hidden" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
        <button className="w-full px-5 py-4 flex items-center justify-between text-left hover:brightness-105 transition-[filter]"
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
              <div className="flex gap-2">
                <button className="btn-ghost text-xs py-1 px-2.5" onClick={() => openEditSplit(txn)}>
                  Edit
                </button>
                {unsettled.length > 0 && (
                  <button className="btn-ghost text-xs py-1 px-2.5" onClick={() => markAllPaid(txn.id)}>
                    Settle all
                  </button>
                )}
                {ownedShared && !ownedShared.closedAt && (
                  <button className="btn-ghost text-xs py-1 px-2.5" onClick={() => closeSplit(ownedShared.id)}>
                    Close split
                  </button>
                )}
                <button className="btn-ghost text-xs py-1 px-2.5 text-terra" onClick={() => deleteSplit(txn.id)}>
                  Delete
                </button>
              </div>
            </div>
            {split.participants.map((p: SplitParticipant) => {
              const shareBase = convert(p.share, txn.currency, c, rates);
              return (
                <div key={p.name} className={`flex items-center justify-between gap-3 rounded-md px-3 py-2.5 border ${p.paid ? 'bg-sage/5 border-sage/20' : 'bg-bg3 border-line'}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-base flex-shrink-0">{p.isYou ? '👤' : '👥'}</span>
                    <div className="min-w-0">
                      <div className="text-[0.84rem] font-semibold text-ink truncate">{p.isYou ? 'You' : p.name}</div>
                      {!p.isYou && p.email && (
                        <div className="font-mono text-[0.62rem] tracking-wider text-ink-dim truncate">{p.email}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 min-w-0 flex-shrink-0">
                    {p.paid && p.paidOn && (
                      <span className="font-mono text-[0.58rem] tracking-wider text-sage whitespace-nowrap">Settled {p.paidOn}</span>
                    )}
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
        <button className="btn-primary text-sm py-2 px-4 flex-shrink-0" onClick={() => openAddSplit()}>
          + Add Split
        </button>
      </div>

      {/* Board M4 — who-owes-who hero: your net position + the two sides.
          v10.17 (items 7/8/9) — every tile is a toggle that expands a per-person
          (email-keyed) breakdown. The breakdown sums reconcile with the tile. */}
      {(owedToYou > 0 || youOwe > 0) && (
        <div className="rounded-r4 p-5 mb-5" style={{ background: 'var(--elevated)', boxShadow: 'var(--neu)' }}>
          <button type="button" onClick={() => setHeroView(v => v === 'net' ? null : 'net')}
            className="w-full text-left" aria-expanded={heroView === 'net'}>
            <div className="mono-label mb-1.5 flex items-center gap-1.5">
              Your net position <span className="text-ink-dim">{heroView === 'net' ? '▴' : '▾'}</span>
            </div>
            <Money amount={owedToYou - youOwe} currency={c} maxChars={12}
              className={`num text-3xl font-semibold ${owedToYou - youOwe >= 0 ? 'text-sage' : 'text-terra'}`} />
          </button>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <button type="button" onClick={() => setHeroView(v => v === 'owed' ? null : 'owed')}
              className="rounded-r3 px-4 py-3 min-w-0 text-left" aria-expanded={heroView === 'owed'}
              style={{ background: 'var(--sunken)', boxShadow: heroView === 'owed' ? 'var(--neu-inset), 0 0 0 1.5px hsl(var(--sage))' : 'var(--neu-inset)' }}>
              <div className="mono-label mb-1 flex items-center gap-1.5">Owed to you <span className="text-ink-dim">{heroView === 'owed' ? '▴' : '▾'}</span></div>
              <Money amount={owedToYou} currency={c} maxChars={11} className="num text-xl font-semibold text-sage" />
              <div className="mono-label mt-0.5">{owedByPerson.length} {owedByPerson.length === 1 ? 'person' : 'people'}</div>
            </button>
            <button type="button" onClick={() => setHeroView(v => v === 'owe' ? null : 'owe')}
              className="rounded-r3 px-4 py-3 min-w-0 text-left" aria-expanded={heroView === 'owe'}
              style={{ background: 'var(--sunken)', boxShadow: heroView === 'owe' ? 'var(--neu-inset), 0 0 0 1.5px hsl(var(--terra))' : 'var(--neu-inset)' }}>
              <div className="mono-label mb-1 flex items-center gap-1.5">You owe <span className="text-ink-dim">{heroView === 'owe' ? '▴' : '▾'}</span></div>
              <Money amount={youOwe} currency={c} maxChars={11} className="num text-xl font-semibold text-terra" />
              <div className="mono-label mt-0.5">{youOweByPerson.length} {youOweByPerson.length === 1 ? 'person' : 'people'}</div>
            </button>
          </div>

          {/* Per-person breakdown for the selected tile. */}
          {heroView && (
            <div className="mt-4 pt-4 border-t border-line space-y-1.5">
              {heroView === 'owed' && (
                owedByPerson.length === 0
                  ? <div className="mono-label">No one owes you right now.</div>
                  : <>
                      <div className="mono-label mb-1">Who must pay you</div>
                      {owedByPerson.map(p => <PersonBreakdownRow key={p.key} p={p} amount={p.amount} tone="sage" />)}
                    </>
              )}
              {heroView === 'owe' && (
                youOweByPerson.length === 0
                  ? <div className="mono-label">You don't owe anyone right now.</div>
                  : <>
                      <div className="mono-label mb-1">Whom you must pay</div>
                      {youOweByPerson.map(p => <PersonBreakdownRow key={p.key} p={p} amount={p.amount} tone="terra" />)}
                    </>
              )}
              {heroView === 'net' && (
                netByPerson.length === 0
                  ? <div className="mono-label">All square — nothing outstanding per person.</div>
                  : <>
                      <div className="mono-label mb-1">Per person · who pays you (＋) or you pay (−)</div>
                      {netByPerson.map(p => (
                        <PersonBreakdownRow key={p.key} p={p} amount={p.net} tone={p.net >= 0 ? 'sage' : 'terra'} signed />
                      ))}
                    </>
              )}
            </div>
          )}
        </div>
      )}

      {/* v10.14 — splits OTHERS shared with you (settle your own share). These
          have no local transaction card, so they live here. v10.18.1 — the
          splits YOU own were removed from this section (they were redundant with
          the transaction card below); their owner controls now live on that card. */}
      {cloudActive && sharedSplitsWithMe.length > 0 && (
        <div className="space-y-3 mb-5">
          <div className="font-mono text-[0.6rem] tracking-widest text-ink-dim uppercase px-1">
            Shared with you
          </div>

          {sharedSplitsWithMe.map(sp => {
            const myShare = sp.shares.find(sh => sh.email === myEmail);
            if (!myShare) return null;
            return (
              <div key={sp.id} className="rounded-r3 px-5 py-4 flex items-center justify-between gap-4"
                style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
                <div>
                  <div className="font-semibold text-ink">{sp.description || 'Shared split'}</div>
                  <div className="font-mono text-[0.62rem] tracking-wider text-ink-dim">
                    {sp.date} · shared with you{sp.closedAt ? ' · closed' : ''}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Money amount={myShare.share} currency={sp.currency} maxChars={10}
                    className={`font-semibold ${myShare.paid ? 'text-sage' : 'text-ink'}`} />
                  {myShare.paid ? (
                    <span className="text-sage text-base">✓</span>
                  ) : sp.closedAt ? (
                    <span className="font-mono text-[0.6rem] tracking-wider text-ink-dim uppercase">Closed</span>
                  ) : (
                    <button className="btn-primary text-xs py-1 px-2.5" onClick={() => settleMySplitShare(myShare.id)}>
                      Settle my share
                    </button>
                  )}
                </div>
              </div>
            );
          })}

        </div>
      )}

      {/* Split list */}
      {splitTxns.length === 0 ? (
        <Panel>
          <div className="px-6 py-14 text-center max-w-md mx-auto">
            <div className="text-4xl mb-3 opacity-60">🤝</div>
            <p className="text-ink-mid mb-2">No splits yet.</p>
            <p className="text-[0.84rem] text-ink-dim leading-relaxed mb-4">
              Tap <span className="text-ink font-semibold">+ Add Split</span> to split a shared bill
              (expense) or a shared payout (income) — enter the total, add people and their shares,
              and only your share counts toward your money. Others' shares are tracked as IOUs here.
            </p>
            <button className="btn-primary text-sm py-2 px-4" onClick={() => openAddSplit()}>+ Add Split</button>
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
