// Vyact v10.24.0 (Accounts R2) — Reconcile (design frame M4).
//
// One sheet for cash, banks and cards; only the wording changes. A bank is
// checked against its statement BALANCE, a card against its statement
// OUTSTANDING, and cash against the amount counted.
//
// 🔒 A reconcile never writes a transaction. "Post an adjustment" absorbs the
// drift into the account's reconciliation offset with a dated log entry
// (money-model D2, INV-3/INV-3b), so spend and income cannot move. The design
// calls it a "marked adjustment": it is marked in the account's ledger, and it
// is never inside a spend total.
//
// v10.28.0 — rendered as the /accounts/:id/reconcile page (pages/FormPages.tsx).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FormPage from '../ui/FormPage';
import Button from '../ui/Button';
import { useStore } from '../../store';
import { fmt } from '../../lib/format';
import { computeAccountBalance } from '../../lib/accountBalance';
import { lastReconciledAt, parseAmountInput, statementWindow } from '../../lib/accountsView';
import { CURRENCIES } from '../../constants';
import type { Account } from '../../types';

interface Props {
  account: Account | null;
  open?: boolean;
  onClose: () => void;
}

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export default function ReconcileSheet({ account, open = true, onClose }: Props) {
  const transactions     = useStore(s => s.transactions);
  const rates            = useStore(s => s.rates);
  const baseCurrency     = useStore(s => s.profile.baseCurrency);
  const reconcileAccount = useStore(s => s.reconcileAccount);
  const toast            = useStore(s => s.toast);
  const navigate = useNavigate();

  const isCard = account?.kind === 'credit_card';
  const isCash = account?.kind === 'cash';
  const balance = account ? computeAccountBalance(account, transactions, baseCurrency, rates) : 0;
  // What Vyact says, in the statement's own terms.
  const vyactSays = isCard ? round2(Math.max(0, -balance)) : balance;

  const [stated, setStated] = useState('');
  const [choice, setChoice] = useState<'adjust' | 'find'>('adjust');
  const [busy, setBusy] = useState(false);

  // Prefill with Vyact's figure each time the sheet opens, so the customer
  // overtypes only what differs. Deliberately NOT re-run when transactions
  // change while the sheet is open — that would wipe what they typed.
  useEffect(() => {
    if (!open) return;
    setStated(String(vyactSays));
    setChoice('adjust');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.id]);

  if (!account) return null;

  const statedValue = parseAmountInput(stated);
  const drift = statedValue === null ? 0 : round2(statedValue - vyactSays);
  const hasDrift = statedValue !== null && drift !== 0;
  const since = lastReconciledAt(account);
  const sinceDays = since ? Math.floor((Date.now() - new Date(since).getTime()) / DAY_MS) : null;
  const symbol = CURRENCIES[baseCurrency]?.symbol ?? '';
  const statementNoun = isCard ? 'statement outstanding' : 'statement balance';
  const signed = (n: number) => (isCard ? `−${fmt(n, baseCurrency)}` : fmt(n, baseCurrency));

  async function submit() {
    if (!account || statedValue === null) return;
    if (hasDrift && choice === 'find') {
      const query = new URLSearchParams({ accountId: account.id });
      if (isCard && account.billingCycleDay) {
        const window = statementWindow(account.billingCycleDay, new Date());
        query.set('from', window.start);
        query.set('to', window.end);
      }
      // Replace, not close-then-push: going back from those transactions returns
      // to the screen reconcile was opened from, not to this page.
      navigate(`/transactions?${query.toString()}`, { replace: true });
      return;
    }
    setBusy(true);
    try {
      // A card's balance is what it owes, negated.
      const statedBalance = isCard ? -statedValue : statedValue;
      await reconcileAccount(account, hasDrift ? statedBalance : balance);
      toast(hasDrift
        ? `Reconcile adjustment of ${fmt(Math.abs(drift), baseCurrency)} posted — spend totals unchanged`
        : isCash ? 'Cash balance confirmed' : 'Balance confirmed against your statement', 'success');
      onClose();
    } catch (e) {
      toast(`Reconcile failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  const cta = !hasDrift ? 'Confirm'
    : choice === 'adjust' ? `Post ${fmt(Math.abs(drift), baseCurrency)} adjustment`
    : isCard ? "Show this cycle's transactions" : 'Show its transactions';

  const footer = (
    <div className="flex gap-2">
      <Button variant="ghost" onClick={onClose}>Not now</Button>
      <Button full onClick={submit} disabled={busy || statedValue === null}>
        {busy ? 'Saving…' : cta}
      </Button>
    </div>
  );

  return (
    <FormPage open={open} onClose={onClose} title={account.name} footer={footer} helpTopicId="cash-reconcile">
      <p className="text-[0.84rem] text-ink-dim -mt-1 mb-4">{isCash ? 'Reconcile cash on hand' : 'Reconcile against your statement'}</p>

      <label className="block font-mono text-[8.5px] tracking-[0.14em] uppercase text-ink-dim mb-1.5" htmlFor="recon-stated">
        {isCash ? 'Cash counted' : `${statementNoun} says`}
      </label>
      <div className="flex items-center gap-2 min-h-[54px] px-4 rounded-r2 mb-4"
        style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
        <span className="font-mono text-[16px] text-ink-dim" aria-hidden>{symbol}</span>
        <input id="recon-stated" autoFocus inputMode="decimal" value={stated}
          onChange={e => setStated(e.target.value)}
          className="num font-bold text-[22px] bg-transparent border-none outline-none text-ink w-full min-w-0" />
      </div>

      {/* The drift block: both figures side by side, and the gap in words. */}
      <div className="rounded-[16px] px-[17px] py-4 mb-4" style={{
        background: 'var(--canvas)',
        boxShadow: `var(--neu), 0 0 0 1.5px color-mix(in srgb, hsl(var(${hasDrift ? '--honey' : '--sage'})) ${hasDrift ? 45 : 40}%, transparent)`,
      }}>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="font-mono text-[8.5px] tracking-[0.11em] uppercase px-2 py-[3px] rounded-md" style={{
            background: `color-mix(in srgb, hsl(var(${hasDrift ? '--honey' : '--sage'})) 18%, transparent)`,
            color: `hsl(var(${hasDrift ? '--honey' : '--sage'}))`,
          }}>{hasDrift ? 'Drift found' : 'Matches'}</span>
          <span className="text-[0.78rem] text-ink-dim">
            {sinceDays === null ? 'never reconciled' : sinceDays === 0 ? 'last reconciled today' : `last reconciled ${sinceDays} day${sinceDays === 1 ? '' : 's'} ago`}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-r2 p-3" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
            <div className="font-mono text-[8px] tracking-[0.13em] uppercase text-ink-dim mb-1">Vyact says</div>
            <div className="num font-semibold text-[15px] text-ink">{signed(vyactSays)}</div>
          </div>
          <div className="rounded-r2 p-3" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
            <div className="font-mono text-[8px] tracking-[0.13em] uppercase text-ink-dim mb-1">{isCash ? 'Cash counted' : 'Statement says'}</div>
            <div className="num font-semibold text-[15px]" style={{ color: 'var(--accent)' }}>
              {statedValue === null ? '—' : signed(statedValue)}
            </div>
          </div>
        </div>
        <p className="text-[0.8rem] text-ink-mid mt-3 leading-snug">
          {!hasDrift
            ? 'Nothing to correct. Confirming records that you checked it today.'
            : <>A <strong className="num">{fmt(Math.abs(drift), baseCurrency)}</strong> gap — {drift > 0 === isCard ? 'most likely a spend that never got logged.' : 'most likely income or a refund that never got logged.'}</>}
        </p>
      </div>

      {hasDrift && (
        <>
          <div className="font-mono text-[8.5px] tracking-[0.14em] uppercase text-ink-dim mb-2">How should I close it?</div>
          <div className="flex flex-col gap-2.5 mb-4" role="radiogroup" aria-label="How to close the gap">
            <Pick on={choice === 'adjust'} onSelect={() => setChoice('adjust')} title="Post an adjustment">
              A visible reconcile adjustment of {fmt(Math.abs(drift), baseCurrency)}, dated today. It corrects the
              balance but stays out of your spend total, so this month&apos;s figures don&apos;t shift.
            </Pick>
            <Pick on={choice === 'find'} onSelect={() => setChoice('find')} title={isCard ? 'Let me find the missing spend' : 'Let me find what’s missing'}>
              Opens {isCard ? "this cycle's" : "this account's"} transactions so you can add what&apos;s missing.
              Slower, but the {fmt(Math.abs(drift), baseCurrency)} lands in the right category.
            </Pick>
          </div>
        </>
      )}

      <p className="rounded-[13px] px-[13px] py-[11px] text-[0.74rem] leading-relaxed text-ink-mid"
        style={{ background: 'color-mix(in srgb, hsl(var(--denim)) 14%, transparent)' }}>
        {isCash
          ? 'Confirm the cash you counted. Any adjustment is recorded in the cash ledger, not as spending or income.'
          : 'A bank is reconciled against its statement balance; a card against its statement outstanding.'}
      </p>
    </FormPage>
  );
}

/** A radio card (design `.pick`). */
export function Pick({ on, onSelect, title, badge, disabled, children }: {
  on: boolean; onSelect: () => void; title: string; badge?: string; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button type="button" role="radio" aria-checked={on} disabled={disabled} onClick={onSelect}
      className="flex items-start gap-2.5 text-left rounded-[13px] px-4 py-3.5 border-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-55 transition-[box-shadow]"
      style={{
        background: 'var(--canvas)',
        boxShadow: on ? 'var(--neu), 0 0 0 1.5px var(--accent)' : 'var(--neu-sm)',
      }}>
      <span className="w-[17px] h-[17px] rounded-full flex-shrink-0 mt-px flex items-center justify-center"
        style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }} aria-hidden>
        {on && <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-[0.88rem] text-ink">{title}</span>
          {badge && (
            <span className="font-mono text-[8px] tracking-wider px-1.5 py-0.5 rounded-md"
              style={{ background: 'color-mix(in srgb, hsl(var(--sage)) 18%, transparent)', color: 'hsl(var(--sage))' }}>{badge}</span>
          )}
        </span>
        <span className="block text-[0.78rem] text-ink-dim leading-snug mt-0.5">{children}</span>
      </span>
    </button>
  );
}
