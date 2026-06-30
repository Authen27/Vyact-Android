// Vyact — onboarding starting-baseline band (v9.7).
//
// The redesign's payoff: the steps-3–4 inputs (cash, debt, income, fixed costs)
// are rendered as a clearly-ESTIMATED starting picture on the dashboard from minute
// one — so a fresh user never lands on an empty screen — and the band WIPES once
// real activity supersedes it. It's a reference overlay, NOT ledger rows (no fake
// transactions touch the money model). The lead CTA adapts to the stated concern.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, X, ArrowRight } from 'lucide-react';
import { useStore } from '../../store';
import { getBaseline, clearBaseline, type OnboardingBaseline } from '../../lib/onboardingState';
import { fmt } from '../../lib/format';
import EstimatedTag from '../ui/EstimatedTag';

/** Real transactions logged before the reference auto-wipes for good. */
const GRADUATE_AT = 5;

export default function StartingBaselineBand() {
  const householdId = useStore(s => s.currentHouseholdId);
  const txnCount = useStore(s => s.transactions.length);
  const baseCur = useStore(s => s.profile.baseCurrency);
  const [baseline, setBaseline] = useState<OnboardingBaseline | null>(null);

  // Load (and reload when the active household changes).
  useEffect(() => { setBaseline(getBaseline(householdId)); }, [householdId]);

  // Graduation — once real activity has taken over, wipe the reference for good
  // (cross-device, via the onboarding cloud-persister).
  useEffect(() => {
    if (baseline && txnCount >= GRADUATE_AT) {
      clearBaseline(householdId);
      setBaseline(null);
    }
  }, [txnCount, baseline, householdId]);

  if (!baseline) return null;

  function dismiss() { clearBaseline(householdId); setBaseline(null); }

  const ccy = baseline.currency || baseCur;
  const net = baseline.cash - baseline.debt;
  const cta = baseline.primaryConcern === 'debt'
    ? { to: '/debts', label: 'Add your debts' }
    : baseline.primaryConcern === 'runway'
    ? { to: '/transactions', label: 'Log activity' }
    : { to: '/budgets', label: 'Set your budgets' };

  return (
    <div className="mb-3.5 rounded-xl border border-honey/40 bg-honey/[0.06] px-4 py-3.5">
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={15} className="text-honey shrink-0" />
          <span className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-mid">Your starting estimate</span>
          <EstimatedTag confidence="estimated" />
        </div>
        <button onClick={dismiss} aria-label="Clear starting estimate"
          className="text-ink-dim hover:text-ink p-0.5"><X size={15} /></button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Stat label="Net position" value={fmt(net, ccy)} accent={net >= 0 ? 'text-sage' : 'text-terra'} />
        <Stat label="Monthly income" value={fmt(baseline.monthlyIncome, ccy)} />
        <Stat label="Est. debt" value={fmt(baseline.debt, ccy)} accent={baseline.debt > 0 ? 'text-terra' : 'text-ink'} />
        <Stat label="Fixed costs" value={`${baseline.fixedCosts.length} to budget`} />
      </div>

      <div className="flex items-center justify-between gap-3 mt-3">
        <span className="text-[0.72rem] text-ink-dim">A reference from setup — it clears as you log real activity.</span>
        <Link to={cta.to} className="inline-flex items-center gap-1 text-[0.78rem] font-medium text-coral hover:underline shrink-0">
          {cta.label} <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value, accent = 'text-ink' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-bg2 border border-line rounded-md px-2.5 py-2">
      <div className="font-mono text-[0.54rem] tracking-wider uppercase text-ink-dim mb-0.5">{label}</div>
      <div className={`num text-[0.95rem] font-semibold ${accent}`}>{value}</div>
    </div>
  );
}
