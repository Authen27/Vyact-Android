import { useState } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks';
import { Panel } from '../components/ui/Card';
import { fmt, convert, uid, today, formatDate } from '../lib/format';
import { ChevronDown } from 'lucide-react';
import OverflowMenu from '../components/ui/OverflowMenu';
import Money from '../components/ui/Money';
import { splitsOutstanding, type SplitOutstanding } from '../lib/calculations';
import type { Transaction, SplitParticipant, Debt } from '../types';
import { splitCounts } from '../lib/splitParticipants';
import { shareIntentForTxn } from '../lib/sharedSplits';
import PageHead from '../components/ui/PageHead';
import EmptyState from '../components/ui/EmptyState';
import { askSheet, confirmSheet } from '../lib/confirmSheet';
import { closeSplitRequest, deleteSplitRequest } from '../lib/confirmCopy';

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
  const updateSharedSplitForTxn = useStore(s => s.updateSharedSplitForTxn);
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
  const counts = splitCounts(transactions);
  // v10.59.0 (owner, item 6) — created vs open vs settled, a quiet line under the two sides.
  const countsLine = counts.created > 0 && (
    <div className="text-[12px] text-ink-dim mt-3" data-testid="split-counts">
      {counts.created} split{counts.created === 1 ? '' : 's'} created · {counts.open} open · {counts.settled} settled
    </div>
  );

  // The other people on a split, by name (for the sheets).
  const othersOn = (txn: Transaction) => (txn.split?.participants ?? [])
    .filter((p: SplitParticipant) => !p.isYou).map((p: SplitParticipant) => p.name || p.email || '').filter(Boolean);

  // Aurora 4.0 CF4 — says who is affected; a shared split offers Close as the softer option.
  async function deleteSplit(txnId: string) {
    const txn = transactions.find(t => t.id === txnId);
    const shared = sharedSplitsOwned.find(sp => sp.txnId === txnId && !sp.closedAt);
    const answer = await askSheet(deleteSplitRequest({
      name: txn?.description ?? '', amount: txn ? fmt(txn.amount, txn.currency) : 'whole',
      others: txn ? othersOn(txn) : [], canClose: !!shared,
    }));
    if (!answer.ok) return;
    if (answer.choice === 'close' && shared) {
      // closeMySplit says 'Split closed' itself (and if its email didn't go out).
      try { await closeMySplit(shared.id); }
      catch (e) { toast(`Close failed: ${(e as Error).message}`, 'error'); }
      return;
    }
    try {
      await removeTransaction(txnId);
      if (cloudActive) await deleteSharedSplitForTxn(txnId);
      toast('Split deleted', 'info');
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, 'error');
    }
  }

  // v10.18.1 — the local transaction card is the single owner surface, so marking a member paid also
  // settles their CLOUD share (the copy other households see, and their notifications).
  // v10.121.0 (T5b; owner, 19 Oct 2026: "queue it") — through the split's queued share step, behind the
  // transaction, retried until it lands. It used to call the cloud from here and swallow a failure, so
  // offline the other household kept seeing the money as owed.
  async function queueCloudSharesPaid(txn: Transaction) {
    if (!cloudActive) return;
    const intent = shareIntentForTxn(txn);
    if (intent?.participants.length) await updateSharedSplitForTxn(intent);
  }

  async function markPaid(txnId: string, participantName: string) {
    const txn = transactions.find(tx => tx.id === txnId);
    if (!txn?.split) return;
    const updated: Transaction = {
      ...txn,
      split: {
        ...txn.split,
        participants: txn.split.participants.map((p: SplitParticipant) =>
          p.name === participantName ? { ...p, paid: true, paidOn: today() } : p
        ),
      },
    };
    await upsertTransaction(updated);
    await queueCloudSharesPaid(updated);
    toast(`Marked ${participantName} as settled`, 'success');
  }

  async function markAllPaid(txnId: string) {
    const txn = transactions.find(tx => tx.id === txnId);
    if (!txn?.split) return;
    const updated: Transaction = {
      ...txn,
      split: {
        ...txn.split,
        participants: txn.split.participants.map((p: SplitParticipant) => ({ ...p, paid: true, paidOn: today() })),
      },
    };
    await upsertTransaction(updated);
    await queueCloudSharesPaid(updated);
    toast('All participants settled', 'success');
  }

  // Aurora 4.0 CF5 — closing is permanent and notifies people, so it keeps a confirmation.
  async function closeSplit(splitId: string) {
    const shared = sharedSplitsOwned.find(sp => sp.id === splitId);
    const txn = shared ? transactions.find(t => t.id === shared.txnId) : undefined;
    if (!(await confirmSheet(closeSplitRequest({ name: txn?.description ?? '', others: txn ? othersOn(txn) : [] })))) return;
    try { await closeMySplit(splitId); }
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
      currency: profile.baseCurrency,   // W3b: one currency per household
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
      <div className="flex items-center justify-between gap-3 well px-3 py-2">
        <div className="min-w-0">
          {showName && <div className="text-[0.82rem] font-semibold text-ink truncate">{p.name}</div>}
          <div className={`text-[12px] truncate ${showName ? 'text-ink-dim' : 'text-ink font-semibold'}`}>
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
        <button className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:brightness-105 transition-[filter]"
          onClick={() => setExpanded(e => !e)} aria-expanded={expanded}>
          <div className="min-w-0">
            <div className="font-semibold text-ink truncate">{txn.description}</div>
            <div className="text-[12px] text-ink-dim">{formatDate(txn.date, profile.dateFormat)} · {split.participants.length} {split.participants.length === 1 ? 'person' : 'people'}</div>
            {owedHere > 0 && <div className="text-[12px] text-sage">+{fmt(owedHere, c)} owed to you</div>}
            {youOweHere > 0 && <div className="text-[12px] text-terra">−{fmt(youOweHere, c)} you owe</div>}
            {linkedDebtId && <div className="text-[12px] text-ink-dim">linked to a debt</div>}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <Money amount={totalInBase} currency={c} maxChars={11} className="font-semibold text-ink" />
            <ChevronDown size={15} aria-hidden className={`text-ink-dim transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </div>
        </button>

        {expanded && (
          <div className="border-t border-line px-5 py-4 space-y-2">
            <div className="flex justify-between items-center gap-2 mb-3">
              <div className="ui-label">Participants</div>
              <div className="flex items-center gap-2">
                {unsettled.length > 0 && (
                  <button className="btn-primary" onClick={() => markAllPaid(txn.id)}>
                    Settle all
                  </button>
                )}
                <OverflowMenu ariaLabel={`More actions for ${txn.description || 'this split'}`} items={[
                  { label: 'Edit', onSelect: () => openEditSplit(txn) },
                  ...(ownedShared && !ownedShared.closedAt ? [{ label: 'Close split', onSelect: () => closeSplit(ownedShared.id) }] : []),
                  { label: 'Delete', danger: true, onSelect: () => deleteSplit(txn.id) },
                ]} />
              </div>
            </div>
            {split.participants.map((p: SplitParticipant) => {
              const shareBase = convert(p.share, txn.currency, c, rates);
              return (
                <div key={p.name} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${p.paid ? 'rounded-r2 border bg-sage/5 border-sage/20' : 'well'}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-base flex-shrink-0">{p.isYou ? '👤' : '👥'}</span>
                    <div className="min-w-0">
                      <div className="text-[0.84rem] font-semibold text-ink truncate">{p.isYou ? 'You' : p.name}</div>
                      {!p.isYou && p.email && (
                        <div className="text-[12px] text-ink-dim truncate">{p.email}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 min-w-0 flex-shrink-0">
                    {p.paid && p.paidOn && (
                      <span className="text-[12px] text-sage whitespace-nowrap">Settled {formatDate(p.paidOn, profile.dateFormat)}</span>
                    )}
                    <Money amount={shareBase} currency={c} maxChars={10} className={`font-semibold text-[0.9rem] ${p.paid ? 'text-sage' : 'text-ink'}`} />
                    {!p.paid && !p.isYou && ((!isIncome && split.paidBy === 'me') || (isIncome && split.paidBy === 'me')) && (
                      <button className="btn-ghost" onClick={() => markPaid(txn.id, p.name)}>
                        Mark paid
                      </button>
                    )}
                    {!p.paid && p.isYou && ((!isIncome && split.paidBy === 'external') || (isIncome && split.paidBy === 'external')) && (
                      <button className="btn-primary" onClick={() => markPaid(txn.id, p.name)}>
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
                        className="btn-ghost"
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
    <div className="ui-pilot">
      <PageHead title={t('splits')} action={{ label: '+ Add Split', entity: 'split', onClick: () => openAddSplit() }} />

      {/* Board M4 — who-owes-who hero: your net position + the two sides.
          v10.17 (items 7/8/9) — every tile is a toggle that expands a per-person
          (email-keyed) breakdown. The breakdown sums reconcile with the tile. */}
      {(owedToYou > 0 || youOwe > 0) && (
        <div className="card-raised p-5 mb-5 overflow-hidden" data-testid="splits-hero">
          <span aria-hidden className="absolute left-0 top-[14px] bottom-[14px] w-[3px] rounded" style={{ background: 'hsl(var(--sage))' }} />
          <div className="mono-label mb-1.5">Your net position</div>
          <Money amount={owedToYou - youOwe} currency={c} maxChars={12}
            className={`num text-3xl font-semibold ${owedToYou - youOwe >= 0 ? 'text-sage' : 'text-terra'}`} />
          <div className="grid grid-cols-2 gap-3 mt-4">
            <button type="button" onClick={() => setHeroView(v => v === 'owed' ? null : 'owed')}
              className="rounded-r3 px-4 py-3 min-w-0 text-left" aria-expanded={heroView === 'owed'}
              style={{ background: 'var(--sunken)', boxShadow: heroView === 'owed' ? 'var(--neu-inset), 0 0 0 1.5px hsl(var(--sage))' : 'var(--neu-inset)' }}>
              <div className="mono-label mb-1">Owed to you</div>
              <Money amount={owedToYou} currency={c} maxChars={11} className="num text-xl font-semibold text-sage" />
              <div className="mono-label mt-0.5">{owedByPerson.length} {owedByPerson.length === 1 ? 'person' : 'people'}</div>
            </button>
            <button type="button" onClick={() => setHeroView(v => v === 'owe' ? null : 'owe')}
              className="rounded-r3 px-4 py-3 min-w-0 text-left" aria-expanded={heroView === 'owe'}
              style={{ background: 'var(--sunken)', boxShadow: heroView === 'owe' ? 'var(--neu-inset), 0 0 0 1.5px hsl(var(--terra))' : 'var(--neu-inset)' }}>
              <div className="mono-label mb-1">You owe</div>
              <Money amount={youOwe} currency={c} maxChars={11} className="num text-xl font-semibold text-terra" />
              <div className="mono-label mt-0.5">{youOweByPerson.length} {youOweByPerson.length === 1 ? 'person' : 'people'}</div>
            </button>
          </div>
          <button type="button" onClick={() => setHeroView(v => v === 'net' ? null : 'net')} aria-expanded={heroView === 'net'}
            className="empty-link mt-1 -ml-1">
            {heroView === 'net' ? 'Hide who owes what' : 'See who owes what →'}
          </button>
          {countsLine}

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

      {!(owedToYou > 0 || youOwe > 0) && countsLine && <div className="mb-4 -mt-2">{countsLine}</div>}

      {/* v10.14 — splits OTHERS shared with you (settle your own share). These
          have no local transaction card, so they live here. v10.18.1 — the
          splits YOU own were removed from this section (they were redundant with
          the transaction card below); their owner controls now live on that card. */}
      {cloudActive && sharedSplitsWithMe.length > 0 && (
        <div className="space-y-3 mb-5">
          <div className="ui-label px-1">Shared with you</div>

          {sharedSplitsWithMe.map(sp => {
            const myShare = sp.shares.find(sh => sh.email === myEmail);
            if (!myShare) return null;
            return (
              <div key={sp.id} className="rounded-r3 px-5 py-4 flex items-center justify-between gap-4"
                style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
                <div>
                  <div className="font-semibold text-ink">{sp.description || 'Shared split'}</div>
                  <div className="text-[12px] text-ink-dim">
                    {formatDate(sp.date, profile.dateFormat)} · shared with you{sp.closedAt ? ' · closed' : ''}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Money amount={myShare.share} currency={sp.currency} maxChars={10}
                    className={`font-semibold ${myShare.paid ? 'text-sage' : 'text-ink'}`} />
                  {myShare.paid ? (
                    <span className="text-sage text-base">✓</span>
                  ) : sp.closedAt ? (
                    <span className="text-[12px] text-ink-dim">Closed</span>
                  ) : (
                    <button className="btn-primary text-xs py-1 px-2.5" onClick={() => settleMySplitShare(myShare.id).catch(e => toast(`Settle failed: ${(e as Error).message}`, 'error'))}>
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
          <EmptyState icon="🤝" title="No splits yet"
            message="Split a shared bill or payout: only your share counts toward your money, and the others' shares are tracked here as IOUs."
            action={{ label: '+ Add a split', onClick: () => openAddSplit() }} />
        </Panel>
      ) : (
        <div className="space-y-3">
          <div className="ui-label px-1 mb-2">
            {splitTxns.length} split transaction{splitTxns.length !== 1 ? 's' : ''}
          </div>
          {splitTxns.map(txn => <SplitRow key={txn.id} txn={txn} />)}
        </div>
      )}
    </div>
  );
}
