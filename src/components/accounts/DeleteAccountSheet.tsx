// Vyact v10.24.0 (Accounts R2) — Delete guard (design frames M5 / M6 / D3).
//
// Permanent delete lives on the customer's own screen, but it always COUNTS
// FIRST — and in cloud mode the database does the counting (account_dependencies),
// so a stale local cache can never talk the guard into deleting an account that
// still has history.
//
//   nothing attached → a short confirm; the destructive button is live and no
//                      typed confirmation is asked for, because nothing is at stake
//   history attached → permanent delete is blocked; ARCHIVE is preselected and
//                      recommended; "move them, then delete" re-tags everything to
//                      another account of the same type in one database transaction
//
// Unsettled splits block the move path: they must be settled or cancelled first.
import { useEffect, useState } from 'react';
import HalfSheet from '../ui/HalfSheet';
import Button from '../ui/Button';
import { Select } from '../ui/Input';
import { Pick } from './ReconcileSheet';
import { useStore } from '../../store';
import { fmt } from '../../lib/format';
import { hasDependencies, moveDestinations } from '../../lib/accountsView';
import type { Account, AccountDependencies } from '../../types';

interface Props {
  account: Account | null;
  open: boolean;
  onClose: () => void;
  /** Called after the account was deleted, archived or moved — the caller closes its own editor. */
  onDone?: () => void;
}

const shortDate = (iso: string | null) => iso
  ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  : '';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function DeleteAccountSheet({ account, open, onClose, onDone }: Props) {
  const accounts                 = useStore(s => s.accounts);
  const baseCurrency             = useStore(s => s.profile.baseCurrency);
  const accountDependencies      = useStore(s => s.accountDependencies);
  const deleteAccountPermanently = useStore(s => s.deleteAccountPermanently);
  const moveAccountAndDelete     = useStore(s => s.moveAccountAndDelete);
  const upsertAccount            = useStore(s => s.upsertAccount);
  const toast                    = useStore(s => s.toast);

  const [deps, setDeps]       = useState<AccountDependencies | null>(null);
  const [loadError, setError] = useState<string | null>(null);
  const [choice, setChoice]   = useState<'archive' | 'move'>('archive');
  const [destination, setDestination] = useState('');
  const [busy, setBusy]       = useState(false);

  useEffect(() => {
    if (!open || !account) return;
    let cancelled = false;
    setDeps(null);
    setError(null);
    setChoice('archive');
    setDestination('');
    accountDependencies(account.id)
      .then(d => { if (!cancelled) setDeps(d); })
      .catch(e => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [open, account, accountDependencies]);

  if (!account) return null;

  const attached = deps ? hasDependencies(deps) : false;
  const destinations = moveDestinations(account, accounts);
  const splitsBlockMove = !!deps && deps.openSplits.length > 0;
  const loanBlocksMove = !!deps && deps.loanEvents > 0;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      onClose();
      onDone?.();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const deletePermanently = () => run(async () => {
    await deleteAccountPermanently(account.id);
    toast(`${account.name} deleted`, 'info');
  });
  const archive = () => run(async () => {
    await upsertAccount({ id: account.id, isArchived: true });
    toast(`${account.name} archived — its history stays intact`, 'success');
  });
  const move = () => run(async () => {
    const target = accounts.find(a => a.id === destination);
    const result = await moveAccountAndDelete(account.id, destination);
    toast(`Moved ${plural(result.transactions, 'transaction')} to ${target?.name ?? 'the other account'} and deleted ${account.name}`, 'success');
  });

  let footer: React.ReactNode;
  if (!deps) {
    footer = <div className="flex gap-2"><Button variant="ghost" full onClick={onClose}>Cancel</Button></div>;
  } else if (!attached) {
    footer = (
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" full onClick={deletePermanently} disabled={busy}>
          {busy ? 'Deleting…' : 'Delete permanently'}
        </Button>
      </div>
    );
  } else {
    footer = (
      <div className="flex gap-2 items-center">
        <button type="button" disabled aria-disabled="true"
          className="h-[46px] px-4 rounded-r2 font-semibold text-[0.86rem] cursor-not-allowed"
          style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)', color: 'var(--ff-ink-4, hsl(var(--ink) / 0.4))' }}
          title="Permanent delete unlocks once nothing is tagged to this account">
          Delete · blocked
        </button>
        {choice === 'archive' ? (
          <Button full onClick={archive} disabled={busy}>{busy ? 'Archiving…' : 'Archive account'}</Button>
        ) : (
          <Button full onClick={move} disabled={busy || !destination || splitsBlockMove || loanBlocksMove}>
            {busy ? 'Moving…' : 'Move, then delete'}
          </Button>
        )}
      </div>
    );
  }

  const tx = deps?.transactions;
  const named = tx ? tx.groups.slice(0, 2) : [];
  const othersCount = tx ? tx.count - named.reduce((s, g) => s + g.count, 0) : 0;
  const othersTotal = tx ? Math.round((tx.total - named.reduce((s, g) => s + g.total, 0)) * 100) / 100 : 0;

  return (
    <HalfSheet open={open} onClose={onClose} title={account.name} footer={footer} size={attached ? 'xl' : 'md'}>
      <p className="text-[0.84rem] text-ink-dim -mt-1 mb-4">Delete permanently</p>

      {!deps && !loadError && (
        <p className="text-[0.84rem] text-ink-dim py-6 text-center" role="status">Checking what refers to this account…</p>
      )}
      {loadError && (
        <p className="text-[0.84rem] py-4" role="alert" style={{ color: 'hsl(var(--terra))' }}>
          Couldn&apos;t check this account&apos;s history: {loadError}. Nothing was deleted.
        </p>
      )}

      {deps && !attached && (
        <>
          <div className="rounded-[16px] px-[17px] py-4 mb-4" style={{
            background: 'var(--canvas)',
            boxShadow: 'var(--neu), 0 0 0 1.5px color-mix(in srgb, hsl(var(--sage)) 40%, transparent)',
          }}>
            <span className="inline-block font-mono text-[8.5px] tracking-[0.11em] uppercase px-2 py-[3px] rounded-md mb-2.5" style={{
              background: 'color-mix(in srgb, hsl(var(--sage)) 18%, transparent)', color: 'hsl(var(--sage))',
            }}>Nothing attached</span>
            <p className="text-[0.84rem] text-ink-mid leading-snug">
              No transactions, no recurring rules, no open splits. Nothing else in Vyact refers to this
              {account.kind === 'credit_card' ? ' card' : ' account'}, so deleting it changes no number anywhere.
            </p>
          </div>
          <Advice>This is what permanent delete is for — an account added by mistake and never used. It goes for good; there&apos;s no undo.</Advice>
        </>
      )}

      {deps && attached && tx && (
        <div className="grid gap-5 sm:grid-cols-2 sm:gap-[26px]">
          <div className="sm:col-span-2 rounded-[16px] px-[17px] py-4" style={{
            background: 'color-mix(in srgb, hsl(var(--terra)) 9%, var(--canvas))',
            boxShadow: 'inset 0 0 0 1.5px color-mix(in srgb, hsl(var(--terra)) 40%, transparent)',
          }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 h-5 rounded-md flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0"
                style={{ background: 'hsl(var(--terra))' }} aria-hidden>!</span>
              <span className="font-bold text-[0.92rem] text-ink">This account has history</span>
            </div>
            <p className="text-[0.82rem] text-ink-mid leading-relaxed">
              {tx.count > 0 && (
                <>
                  <strong className="num">{plural(tx.count, 'transaction')}</strong> {tx.count === 1 ? 'is' : 'are'} tagged
                  to it, worth <strong className="num">{fmt(tx.total, baseCurrency)}</strong>
                  {tx.firstDate && <>, from <strong>{shortDate(tx.firstDate)}</strong> to <strong>{shortDate(tx.lastDate)}</strong></>}.{' '}
                </>
              )}
              {deps.recurring.length > 0 && <>{plural(deps.recurring.length, 'recurring rule')} {deps.recurring.length === 1 ? 'points' : 'point'} at it. </>}
              {deps.openSplits.length > 0 && (
                <span style={{ color: 'hsl(var(--honey))' }}>{plural(deps.openSplits.length, 'split')} on it {deps.openSplits.length === 1 ? 'is' : 'are'} not settled.</span>
              )}
            </p>
          </div>

          <div>
            <div className="font-mono text-[8.5px] tracking-[0.14em] uppercase text-ink-dim mb-2">What&apos;s attached</div>
            <div className="rounded-[13px] px-4 py-2" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
              {named.map(g => (
                <Row key={g.label} label={`${g.label} · ${plural(g.count, 'entry', 'entries')}`} value={fmt(g.total, baseCurrency)} />
              ))}
              {othersCount > 0 && <Row label={`${othersCount} other${othersCount === 1 ? '' : 's'}`} value={fmt(othersTotal, baseCurrency)} />}
              {deps.recurring.length > 0 && (
                <Row label={`🔁 Recurring: ${deps.recurring.map(r => r.label).join(', ')}`} value={plural(deps.recurring.length, 'rule')} />
              )}
              {deps.openSplits.length > 0 && <Row warn label="⇄ Split · not settled" value={plural(deps.openSplits.length, 'split')} />}
            </div>
            {splitsBlockMove && (
              <p className="text-[0.76rem] text-ink-dim mt-2 leading-snug">
                The unsettled split is the one thing that can&apos;t be moved automatically — settle or cancel it first.
              </p>
            )}
          </div>

          <div>
            <div className="font-mono text-[8.5px] tracking-[0.14em] uppercase text-ink-dim mb-2">What should happen to them?</div>
            <div className="flex flex-col gap-2.5 mb-3" role="radiogroup" aria-label="What should happen to this account's history">
              <Pick on={choice === 'archive'} onSelect={() => setChoice('archive')} title="Archive instead" badge="recommended">
                All {plural(tx.count, 'transaction')} stay where they are, history intact. The account leaves your list and
                stops appearing in Add Transaction.
              </Pick>
              <Pick on={choice === 'move'} onSelect={() => setChoice('move')} title="Move them, then delete"
                disabled={splitsBlockMove || loanBlocksMove || destinations.length === 0}>
                {destinations.length === 0
                  ? `There is no other ${account.kind === 'credit_card' ? 'card' : 'bank account'} to move them to.`
                  : 'Re-tag everything to another account, then remove this one. Your totals stay the same, but the history will read as though the money always moved through the other account.'}
              </Pick>
            </div>
            {choice === 'move' && destinations.length > 0 && (
              <Select aria-label="Move history to" value={destination} onChange={e => setDestination(e.target.value)}
                className="mb-3">
                <option value="">Choose destination…</option>
                {destinations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            )}
            <Advice>Archive whenever real activity is attached. Keep permanent delete for accounts you created by mistake and never used.</Advice>
          </div>
        </div>
      )}
    </HalfSheet>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 py-2 text-[0.8rem] border-b border-line last:border-b-0"
      style={warn ? { color: 'hsl(var(--honey))' } : undefined}>
      <span className="flex-1 min-w-0 truncate text-ink-mid" style={warn ? { color: 'inherit' } : undefined}>{label}</span>
      <span className="num font-semibold text-ink flex-shrink-0" style={warn ? { color: 'inherit' } : undefined}>{value}</span>
    </div>
  );
}

function Advice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[13px] px-[13px] py-[11px] text-[0.74rem] leading-relaxed text-ink-mid"
      style={{ background: 'color-mix(in srgb, hsl(var(--denim)) 14%, transparent)' }}>
      {children}
    </p>
  );
}
