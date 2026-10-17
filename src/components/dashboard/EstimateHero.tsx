// Aurora 4.0 FR2 — the estimate from setup, as the Dashboard's first hero.
//
// After onboarding the Dashboard shows "Room left this month" with an `estimated` tag: the pay and
// fixed bills given in setup, less what has been logged this month that is not one of those bills (a
// posted bill is already inside "fixed bills"). Real cash flow replaces it as entries come in: it goes
// for good after GRADUATE_AT logged entries, or when the person dismisses it. It is a reference from
// setup, never ledger rows, and never mixed into the Cash Flow figure.
// (It replaced v9.7's StartingBaselineBand, a separate band above the heroes.)
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../../store';
import { getBaseline, clearBaseline, type OnboardingBaseline } from '../../lib/onboardingState';
import { fmt, fmtNet, nowMonthKey } from '../../lib/format';
import { roomLeftEstimate } from '../../lib/setupChecklist';
import EstimatedTag from '../ui/EstimatedTag';

/** Real transactions logged before the estimate gives way to real cash flow. */
export const GRADUATE_AT = 5;

/** The setup baseline while it still stands (graduates or is dismissed). */
export function useStartingBaseline(): [OnboardingBaseline | null, () => void] {
  const householdId = useStore(s => s.currentHouseholdId);
  const txnCount = useStore(s => s.transactions.length);
  const [baseline, setBaseline] = useState<OnboardingBaseline | null>(null);

  useEffect(() => { setBaseline(getBaseline(householdId)); }, [householdId]);

  // Graduation — once real activity has taken over, wipe the reference for good (cross-device, via
  // the onboarding cloud-persister).
  useEffect(() => {
    if (baseline && txnCount >= GRADUATE_AT) {
      clearBaseline(householdId);
      setBaseline(null);
    }
  }, [txnCount, baseline, householdId]);

  return [baseline, () => { clearBaseline(householdId); setBaseline(null); }];
}

export default function EstimateHero({ baseline, onDismiss }: { baseline: OnboardingBaseline; onDismiss: () => void }) {
  const transactions = useStore(s => s.transactions);
  const baseCur = useStore(s => s.profile.baseCurrency);
  const ccy = baseline.currency || baseCur;
  const mk = nowMonthKey();

  // This month's logged spending that is not one of the setup bills (those post with a schedule id).
  const loggedNotBills = useMemo(() => transactions
    .filter(t => t.type === 'expense' && !t.excluded && t.date.startsWith(mk) && !t.recurringScheduleId)
    .reduce((s, t) => s + Math.abs(t.amount), 0), [transactions, mk]);

  const bills = baseline.billsLater ? 0 : baseline.fixedTotal ?? 0;
  const room = roomLeftEstimate(baseline.monthlyIncome, bills, loggedNotBills);
  const line = baseline.billsLater
    ? 'Your pay, from setup. Add your fixed bills in Recurring to see what is really left.'
    : loggedNotBills > 0
      ? `Pay and fixed bills, less ${fmt(loggedNotBills, ccy)} logged so far. Real spending replaces the estimate as you log it.`
      : 'Your pay less fixed bills, from setup. Real spending replaces this as you log it.';

  return (
    <div data-testid="estimate-hero" className="card-raised relative px-5 py-[18px] overflow-hidden h-full">
      <span aria-hidden className="absolute left-0 top-[14px] bottom-[14px] w-[3px] rounded" style={{ background: 'hsl(var(--sage))' }} />
      <div className="flex items-center gap-2 mb-1.5">
        <span className="ui-label">{baseline.billsLater ? 'Monthly pay' : 'Room left this month'}</span>
        <EstimatedTag confidence="estimated" />
        <button type="button" onClick={onDismiss} aria-label="Hide the estimate from setup" title="Hide"
          className="ml-auto min-w-[44px] min-h-[44px] -my-3 -mr-3 flex items-center justify-center text-ink-dim hover:text-ink rounded-full">
          <X size={15} aria-hidden />
        </button>
      </div>
      <div className="num font-semibold text-[30px] leading-tight" style={{ color: room >= 0 ? 'var(--good-text)' : 'var(--crit-text)' }}>
        {fmtNet(room, ccy)}
      </div>
      <p className="text-[13px] text-ink-mid mt-1.5">{line}</p>
    </div>
  );
}
