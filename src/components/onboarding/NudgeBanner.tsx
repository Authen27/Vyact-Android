// Vyact — Progressive-capture nudge surface (spec §6).
//
// Renders at most one gentle, dismissible nudge. Self-hides when the feature flag
// is off, the household isn't completed, the session rate-limit is hit, or there
// is nothing to surface. Mounted once at app root.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Sparkles } from 'lucide-react';
import { useStore } from '../../store';
import {
  getActiveNudge, dismissNudge, markNudgeShownThisSession,
  markBankConnectOffered, type Nudge,
} from '../../lib/onboardingNudges';
import {
  getOnboarding, unconfirmedEstimateCount, confirmedPctFromEntities,
} from '../../lib/onboardingState';
import type { WithProvenance } from '../../types';
import { track } from '../../lib/analytics';

export default function NudgeBanner() {
  const navigate = useNavigate();
  const householdId = useStore(s => s.currentHouseholdId);
  const transactions = useStore(s => s.transactions);
  const budgets = useStore(s => s.budgets);
  const goals = useStore(s => s.goals);
  const debts = useStore(s => s.debts);
  const assets = useStore(s => s.assets);

  // Real logs only — onboarding-seeded rows are estimates, not "activity".
  const logCount = useMemo(
    () => transactions.filter(t => t.source !== 'onboarding').length,
    [transactions],
  );

  // Provenance now lives on the entity rows (cloud-synced), so the nudge stats
  // are derived from the store, not a local overlay. Materiality weight = the
  // record's headline amount so a mortgage estimate outweighs a £9 subscription.
  const { unconfirmedEstimates, confirmedPct } = useMemo(() => {
    const records: WithProvenance[] = [...budgets, ...goals, ...debts, ...assets, ...transactions];
    const materiality = (r: WithProvenance): number => {
      const m = r as Partial<{ limit: number; target: number; currentBalance: number; value: number; amount: number }>;
      return Math.abs(m.limit ?? m.target ?? m.currentBalance ?? m.value ?? m.amount ?? 1) || 1;
    };
    return {
      unconfirmedEstimates: unconfirmedEstimateCount(records),
      confirmedPct: confirmedPctFromEntities(records, materiality),
    };
  }, [budgets, goals, debts, assets, transactions]);

  const [nudge, setNudge] = useState<Nudge | null>(null);

  useEffect(() => {
    const active = getActiveNudge({ householdId, logCount, unconfirmedEstimates, confirmedPct });
    setNudge(active);
    if (active) {
      markNudgeShownThisSession();
      if (active.kind === 'bank_connect') markBankConnectOffered(householdId);
      const rec = getOnboarding(householdId);
      const days = rec.completedAt
        ? Math.floor((Date.now() - new Date(rec.completedAt).getTime()) / 86_400_000)
        : undefined;
      track('onboarding_nudge_shown', { nudge_kind: active.kind, days_since: days, log_count: logCount });
      if (active.kind === 'bank_connect') {
        track('bank_connect_offered', { days_since: days, log_count: logCount });
      }
    }
    // Recompute when the household, its real-log count, or estimate stats change.
  }, [householdId, logCount, unconfirmedEstimates, confirmedPct]);

  if (!nudge) return null;

  function close() {
    if (!nudge) return;
    dismissNudge(nudge.id);
    track('onboarding_nudge_dismissed', { nudge_kind: nudge.kind });
    setNudge(null);
  }

  function act() {
    if (!nudge) return;
    track('onboarding_nudge_dismissed', { nudge_kind: nudge.kind, via_nudge: true });
    const href = nudge.href;
    dismissNudge(nudge.id);
    setNudge(null);
    navigate(href);
  }

  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 sm:w-[22rem] z-[120]">
      <div className="bg-bg2 border border-coral/30 rounded-lg shadow-lg p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 h-7 w-7 rounded-full bg-coral-tint text-coral flex items-center justify-center shrink-0">
            <Sparkles size={15} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-ink text-[0.9rem] mb-0.5">{nudge.title}</div>
            <p className="text-[0.8rem] text-ink-mid leading-snug mb-3">{nudge.body}</p>
            <div className="flex items-center gap-3">
              <button onClick={act}
                className="text-[0.78rem] font-semibold text-coral hover:underline">
                {nudge.cta}
              </button>
              <button onClick={close}
                className="text-[0.78rem] text-ink-dim hover:text-ink">
                Not now
              </button>
            </div>
          </div>
          <button onClick={close} aria-label="Dismiss"
            className="text-ink-dim hover:text-ink shrink-0">
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
