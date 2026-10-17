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
import { fmt, fmtNet } from '../../lib/format';
import { computeAccountBalance } from '../../lib/accountBalance';
import { lastReconciledAt, parseAmountInput, statedForReconcile, statementWindow } from '../../lib/accountsView';
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

  // W7a (FE-UIC-14): normalised before the drift is computed, so the sheet shows what the engine posts.
  const statedValue = statedForReconcile(parseAmountInput(stated), account.kind);
  const drift = statedValue === null ? 0 : round2(statedValue - vyactSays);
  const hasDrift = statedValue !== null && drift !== 0;
  const since = lastReconciledAt(account);
  const sinceDays = since ? Math.floor((Date.now() - new Date(since).getTime()) / DAY_MS) : null;
  const symbol = CURRENCIES[baseCurrency]?.symbol ?? '';
  const statementNoun = isCard ? 'statement outstanding' : 'statement balance';
  // W4d (FE-UIC-04): a card is stated as what it owes (shown negative; a card in credit, positive);
  // a bank keeps its own sign, so an overdraft reads as one.
  const signed = (n: number) => fmtNet(isCard ? -n : n, baseCurrency);

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
      const posted = await reconcileAccount(account, hasDrift ? statedBalance : balance);
      // The toast reports the delta the engine actually wrote (W7a, FE-UIC-14), not the sheet's estimate.
      toast(posted !== 0
        ? `Reconcile adjustment of ${fmt(Math.abs(posted), baseCurrency)} posted — spend totals unchanged`
        : isCash ? 'Cash balance confirmed' : 'Balance confirmed against your statement', 'success');
      onClose();
    } catch (e) {
      toast(`Reconcile failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  const cta = !hasDrift ? 'Mark reconciled'
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
    <FormPage open={open} onClose={onClose} title={account.name} footer={footer} helpTopicId="cash-reconcile" className="ui-pilot">
      <p className="text-[0.84rem] text-ink-dim -mt-1 mb-4">
        {isCash ? 'Reconcile cash on hand' : 'Reconcile against your statement'} ·{' '}
        {sinceDays === null ? 'never reconciled' : sinceDays === 0 ? 'last reconciled today' : `last reconciled ${sinceDays} day${sinceDays === 1 ? '' : 's'} ago`}
      </p>

      {/* Aurora 4.0 RC1 — one card: "In Vyact" and "On your statement" side by side (the statement side
          is the field you type in), the gap underneath. Was three blocks: a balance card, the field, a gap row. */}
      <div className="card-raised px-4 py-4 mb-4" data-testid="reconcile-compare" style={{
        boxShadow: `var(--neu), 0 0 0 1.5px color-mix(in srgb, hsl(var(${hasDrift ? '--honey' : '--sage'})) ${hasDrift ? 45 : 40}%, transparent)`,
      }}>
        <div className="grid grid-cols-2 gap-3 items-start">
          <div className="min-w-0">
            <div className="ui-label mb-1.5">In Vyact</div>
            <div className="num font-semibold text-[20px] text-ink min-h-[44px] flex items-center">{signed(vyactSays)}</div>
          </div>
          <div className="min-w-0">
            <label className="block ui-label mb-1.5" htmlFor="recon-stated">
              {isCash ? 'Cash counted' : 'On your statement'}
            </label>
            <div className="well flex items-center gap-1.5 min-h-[44px] px-3">
              <span className="text-[15px] text-ink-dim" aria-hidden>{symbol}</span>
              <input id="recon-stated" autoFocus inputMode="decimal" value={stated}
                aria-describedby="recon-gap"
                onChange={e => setStated(e.target.value)}
                className="num font-bold text-[20px] bg-transparent border-none outline-none text-ink w-full min-w-0" />
            </div>
            {!isCash && <div className="text-[11.5px] text-ink-dim mt-1">the {statementNoun}</div>}
          </div>
        </div>
        {/* RC2 — a state for when they match: say so, and what confirming does. */}
        <div id="recon-gap" className="mt-3 pt-3 border-t border-line text-[13px] leading-snug" aria-live="polite">
          {!hasDrift ? (
            <>
              <div className="font-semibold" style={{ color: 'var(--good-text)' }}>✓ Balances match</div>
              <div className="text-ink-mid mt-0.5">Nothing to correct. Marking it reconciled records that you checked it today.</div>
            </>
          ) : (
            <span className="text-ink-mid">
              A <strong className="num" style={{ color: 'var(--warn-text)' }}>{fmt(Math.abs(drift), baseCurrency)}</strong> gap — {drift > 0 === isCard ? 'most likely a spend that never got logged.' : 'most likely income or a refund that never got logged.'}
            </span>
          )}
        </div>
      </div>

      {hasDrift && (
        <>
          <div className="ui-label mb-2">How should I close it?</div>
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

      <p className="rounded-r2 px-[13px] py-[11px] text-[12px] leading-relaxed text-ink-mid"
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
      className="flex items-start gap-2.5 text-left rounded-r2 px-4 py-3.5 border-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-55 transition-[box-shadow]"
      style={{
        background: 'var(--canvas)',
        boxShadow: on ? 'var(--neu), 0 0 0 1.5px var(--accent)' : 'var(--neu-sm)',
      }}>
      <span className="w-[17px] h-[17px] rounded-full flex-shrink-0 mt-px flex items-center justify-center"
        style={{ background: 'var(--well-bg)', boxShadow: 'var(--well-shadow)', border: '1px solid var(--well-border)' }} aria-hidden>
        {on && <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-[0.88rem] text-ink">{title}</span>
          {badge && (
            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-md"
              style={{ background: 'color-mix(in srgb, hsl(var(--sage)) 18%, transparent)', color: 'var(--good-text)' }}>{badge}</span>
          )}
        </span>
        <span className="block text-[0.78rem] text-ink-dim leading-snug mt-0.5">{children}</span>
      </span>
    </button>
  );
}
