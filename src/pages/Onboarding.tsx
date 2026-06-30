// Vyact — Onboarding & Activation flow (vyact-onboarding-engineering-spec.md).
//
// Six-step spine. Steps 0/1/5 are shared; steps 2–4 read content from the
// per-segment map in lib/onboardingTemplates.ts. The whole feature sits behind
// FEATURES.onboarding — when the flag is off this route renders nothing and
// redirects to the dashboard (plug-n-play, spec §1.2).
//
// The flow captures a minimal baseline (a snapshot + a forward-model scaffold —
// never a bank statement) and seeds provenance-tagged `estimated` records that
// converge to confirmed over the 21-day window (spec §5).

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, ShieldCheck, Lock } from 'lucide-react';
import { useStore } from '../store';
import { CURRENCIES } from '../constants';
import { fmt } from '../lib/format';
import Button from '../components/ui/Button';
import EstimatedTag from '../components/ui/EstimatedTag';
import { FEATURES, isOnboardingEnabled } from '../config/features';
import {
  SEGMENTS, SEGMENT_ORDER, PRIMARY_CONCERNS,
} from '../lib/onboardingTemplates';
import {
  markStarted, markSkipped, markCompleted, setBaseline,
  type Segment, type OnboardingContext, type OnboardingBaseline,
} from '../lib/onboardingState';
import type { TemplateKey } from '../lib/templates';
import { track } from '../lib/analytics';

type Step = 0 | 1 | 2 | 3 | 4 | 5;
const TOTAL_STEPS = 5;

const SEGMENT_TO_PROFILE: Record<Segment, 'personal' | 'family' | 'business'> = {
  individual: 'personal',
  household: 'family',
  smb: 'business',
};

// v9.7 — segment now drives the module template (Sidebar reads pagesForTemplate),
// so the dashboard a customer lands on actually matches their type:
// individual → Single (no Members/Splits), household → Family (all), smb →
// Self-Employed (no Splits/Members; Net Worth + Debts focus).
const SEGMENT_TO_TEMPLATE: Record<Segment, TemplateKey> = {
  individual: 'single',
  household: 'family',
  smb: 'self_employed',
};

export default function Onboarding() {
  const navigate = useNavigate();
  const householdId = useStore(s => s.currentHouseholdId);
  const updateProfile = useStore(s => s.updateProfile);
  const refresh = useStore(s => s.refresh);
  const toast = useStore(s => s.toast);

  const [startedAt] = useState(() => Date.now());
  const [step, setStep] = useState<Step>(0);
  const [segment, setSegment] = useState<Segment | null>(null);
  const [ctx, setCtx] = useState<Partial<OnboardingContext>>({});
  const [concern, setConcern] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Record<string, string>>({});
  const [income, setIncome] = useState<string>('');
  const [fixedCosts, setFixedCosts] = useState<string[]>([]);
  const [currency, setCurrency] = useState<string>(() =>
    navigator.language?.includes('IN') ? 'INR' : navigator.language?.includes('GB') ? 'GBP' : 'USD',
  );
  const [submitting, setSubmitting] = useState(false);

  // Flag-off / already-handled: render nothing, fall back to the dashboard.
  useEffect(() => {
    if (!isOnboardingEnabled()) {
      navigate('/dashboard', { replace: true });
      return;
    }
    markStarted(householdId);
    track('onboarding_started', {
      segment: 'none',
      flag_enabled: true,
    });
  }, [householdId, navigate]);

  const tpl = segment ? SEGMENTS[segment] : null;
  const canSkip = step >= FEATURES.onboarding.skipAllowedFromStep;

  function advance(next: Step) {
    track('onboarding_step_completed', {
      segment: segment ?? 'none',
      step_index: step,
      duration_ms: Date.now() - startedAt,
    });
    setStep(next);
  }

  function skip() {
    markSkipped(householdId, step);
    track('onboarding_skipped', { segment: segment ?? 'none', step_index: step });
    // Default to the most permissive segment so no modules are hidden (spec §4.1).
    void finalizeSkip();
  }

  async function finalizeSkip() {
    await updateProfile({
      household: SEGMENT_TO_PROFILE[segment ?? 'household'],
      baseCurrency: currency,
      onboardedAt: new Date().toISOString(),
    });
    await refresh();
    navigate('/dashboard');
  }

  async function complete() {
    if (!segment) return;
    setSubmitting(true);
    const context: OnboardingContext = {
      primaryConcern: concern ?? PRIMARY_CONCERNS[0].key,
      ...ctx,
    };

    // v9.7 — onboarding does NOT seed ledger rows (fake transactions would corrupt
    // the money model). The steps-3–4 inputs are kept as an estimated REFERENCE
    // baseline on `households.onboarding`; the dashboard renders it from minute one
    // (StartingBaselineBand) and it WIPES as real activity supersedes it.
    const baseline: OnboardingBaseline = {
      cash: cashAmt,
      debt: Number(snapshot.debt) || 0,
      monthlyIncome: incomeAmt,
      fixedCosts: fixedCosts
        .map(k => SEGMENTS[segment].fixedCostChips.find(c => c.key === k))
        .filter((c): c is { key: string; label: string } => !!c),
      currency,
      segment,
      primaryConcern: context.primaryConcern,
      capturedAt: new Date().toISOString(),
    };
    setBaseline(householdId, baseline);
    const baselineCount = (baseline.cash || baseline.debt || baseline.monthlyIncome ? 1 : 0)
      + baseline.fixedCosts.length;

    markCompleted(householdId, segment, context);
    await updateProfile({
      household: SEGMENT_TO_PROFILE[segment],
      template: SEGMENT_TO_TEMPLATE[segment],   // v9.7 — segment now drives module visibility
      // 'savings' (the removed "Save for a goal" concern) is no longer selectable;
      // 'runway' falls through to 'spending'. Goals are not a module.
      primaryConcern: (['spending', 'debt'].includes(context.primaryConcern)
        ? context.primaryConcern : 'spending') as 'spending' | 'debt' | 'savings',
      baseCurrency: currency,
      onboardedAt: new Date().toISOString(),
    });
    await refresh();

    track('onboarding_completed', {
      segment,
      total_ms: Date.now() - startedAt,
      baseline_count: baselineCount,
      confirmed_pct: 40,
    });
    toast("You're all set — welcome to Vyact", 'success');
    navigate('/dashboard');
    setSubmitting(false);
  }

  // Step 2 context completeness: every question must be answered to advance.
  const contextComplete = useMemo(() => {
    if (!tpl) return false;
    return tpl.context.every(q => ctx[q.field] != null);
  }, [tpl, ctx]);

  const cashAmt = Number(snapshot.cash) || 0;
  const incomeAmt = Number(income) || 0;

  return (
    <div className="fixed inset-0 z-[150] bg-bg overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="display-italic text-3xl text-coral mb-1">Vyact</div>
        <div className="font-mono text-[0.6rem] tracking-[0.18em] uppercase text-ink-dim mb-6">
          {step === 0 ? 'Welcome' : `Step ${step} of ${TOTAL_STEPS}`} · under 2 minutes
        </div>

        {/* Progress */}
        <div className="bg-bg3 h-1 rounded-full overflow-hidden mb-8">
          <div className="h-full bg-coral transition-[width] duration-500"
               style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
        </div>

        {/* ── Step 0 — Welcome + Trust ─────────────────────────────────────── */}
        {step === 0 && (
          <div>
            <h1 className="display-italic text-3xl text-ink mb-3">A clear money picture in two minutes.</h1>
            <p className="text-ink-mid mb-7">
              We'll set up a starting baseline together. Everything you enter is an estimate
              you can change — it converges to confirmed reality over your first three weeks.
            </p>
            <div className="space-y-3 mb-8">
              <div className="flex items-start gap-3 bg-bg2 border border-line rounded-md p-3">
                <Lock size={16} className="text-denim mt-0.5 shrink-0" />
                <div className="text-[0.85rem] text-ink">
                  <span className="font-semibold">No bank connection.</span>{' '}
                  <span className="text-ink-mid">No statements, account numbers, or card details — ever, in this flow.</span>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-bg2 border border-line rounded-md p-3">
                <ShieldCheck size={16} className="text-sage mt-0.5 shrink-0" />
                <div className="text-[0.85rem] text-ink">
                  <span className="font-semibold">Honest by design.</span>{' '}
                  <span className="text-ink-mid">Estimates always look like estimates until you confirm them.</span>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => advance(1)}>Let's go <ArrowRight size={14} /></Button>
            </div>
          </div>
        )}

        {/* ── Step 1 — Segment Select (mandatory) ──────────────────────────── */}
        {step === 1 && (
          <div>
            <h1 className="display-italic text-3xl text-ink mb-2">Who's this for?</h1>
            <p className="text-ink-mid mb-7">This shapes everything that follows. You can change it later.</p>
            <div className="grid sm:grid-cols-3 gap-3 mb-7">
              {SEGMENT_ORDER.map(key => {
                const s = SEGMENTS[key];
                return (
                  <button key={key} onClick={() => setSegment(key)}
                    className={`text-left p-4 rounded-md border-2 transition-all ${segment === key ? 'border-coral bg-coral-tint' : 'border-line hover:border-line2 bg-bg2'}`}>
                    <div className="text-2xl mb-2">{s.icon}</div>
                    <div className="font-semibold text-ink mb-0.5">{s.label}</div>
                    <div className="text-[0.78rem] text-ink-mid leading-snug">{s.blurb}</div>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>
              <Button onClick={() => advance(2)} disabled={!segment}>Next <ArrowRight size={14} /></Button>
            </div>
          </div>
        )}

        {/* ── Step 2 — Context (per-segment) ───────────────────────────────── */}
        {step === 2 && tpl && (
          <div>
            <h1 className="display-italic text-3xl text-ink mb-2">A little context</h1>
            <p className="text-ink-mid mb-7">Two taps to tune your dashboard.</p>

            {tpl.context.map(q => (
              <div key={q.field} className="mb-6">
                <div className="font-semibold text-ink mb-2">{q.prompt}</div>
                <div className="flex flex-wrap gap-2">
                  {q.options.map(opt => {
                    const raw = ctx[q.field];
                    const selected = String(raw) === opt.key;
                    return (
                      <button key={opt.key}
                        onClick={() => setCtx(c => ({
                          ...c,
                          [q.field]: q.field === 'adultCount' ? Number(opt.key) : opt.key,
                        }))}
                        className={`px-3.5 py-2 rounded-full border-2 text-[0.85rem] transition-all ${selected ? 'border-coral bg-coral-tint text-ink' : 'border-line hover:border-line2 bg-bg2 text-ink-mid'}`}>
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="mb-6">
              <div className="font-semibold text-ink mb-2">What matters most right now?</div>
              <div className="flex flex-wrap gap-2">
                {PRIMARY_CONCERNS.map(opt => (
                  <button key={opt.key} onClick={() => setConcern(opt.key)}
                    className={`px-3.5 py-2 rounded-full border-2 text-[0.85rem] transition-all ${concern === opt.key ? 'border-coral bg-coral-tint text-ink' : 'border-line hover:border-line2 bg-bg2 text-ink-mid'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-between items-center">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <div className="flex items-center gap-3">
                {canSkip && <SkipLink onClick={skip} />}
                <Button onClick={() => advance(3)} disabled={!contextComplete || !concern}>
                  Next <ArrowRight size={14} />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3 — The Snapshot (per-segment, ≤2 inputs) ───────────────── */}
        {step === 3 && tpl && (
          <div>
            <h1 className="display-italic text-3xl text-ink mb-2">Where things stand today</h1>
            <p className="text-ink-mid mb-7">Rough numbers are perfect — they're estimates you'll refine.</p>
            <div className="space-y-4 mb-7">
              {tpl.snapshot.map(field => (
                <div key={field.key}>
                  <label className="flex items-center gap-2 font-mono text-[0.6rem] tracking-[0.12em] uppercase text-ink-mid mb-1.5">
                    {field.label} <EstimatedTag confidence="estimated" />
                  </label>
                  <input
                    inputMode="decimal" type="number" min="0"
                    value={snapshot[field.key] ?? ''}
                    onChange={e => setSnapshot(s => ({ ...s, [field.key]: e.target.value }))}
                    placeholder="0"
                    className="w-full bg-bg3 border border-line rounded-md px-3 py-2.5 font-ui num" />
                  <div className="text-[0.72rem] text-ink-dim mt-1">{field.hint}</div>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center">
              <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
              <div className="flex items-center gap-3">
                {canSkip && <SkipLink onClick={skip} />}
                <Button onClick={() => advance(4)}>Next <ArrowRight size={14} /></Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 4 — The Forward Model ───────────────────────────────────── */}
        {step === 4 && tpl && (
          <div>
            <h1 className="display-italic text-3xl text-ink mb-2">Your monthly shape</h1>
            <p className="text-ink-mid mb-7">Roughly what comes in, and which fixed costs go out.</p>

            <div className="mb-6">
              <label className="flex items-center gap-2 font-mono text-[0.6rem] tracking-[0.12em] uppercase text-ink-mid mb-1.5">
                Monthly income <EstimatedTag confidence="estimated" />
              </label>
              <input
                inputMode="decimal" type="number" min="0" value={income}
                onChange={e => setIncome(e.target.value)} placeholder="0"
                className="w-full bg-bg3 border border-line rounded-md px-3 py-2.5 font-ui num" />
            </div>

            <div className="mb-7">
              <div className="font-semibold text-ink mb-2">Fixed costs you have</div>
              <div className="flex flex-wrap gap-2">
                {tpl.fixedCostChips.map(chip => {
                  const on = fixedCosts.includes(chip.key);
                  return (
                    <button key={chip.key}
                      onClick={() => setFixedCosts(f => on ? f.filter(k => k !== chip.key) : [...f, chip.key])}
                      className={`px-3.5 py-2 rounded-full border-2 text-[0.85rem] transition-all ${on ? 'border-coral bg-coral-tint text-ink' : 'border-line hover:border-line2 bg-bg2 text-ink-mid'}`}>
                      {on && <Check size={12} className="inline mr-1 text-coral" />}{chip.label}
                    </button>
                  );
                })}
              </div>
              <div className="text-[0.72rem] text-ink-dim mt-2">
                We'll create estimated budgets for these — set the amounts as real spending lands.
              </div>
            </div>

            <div className="flex justify-between items-center">
              <Button variant="ghost" onClick={() => setStep(3)}>Back</Button>
              <div className="flex items-center gap-3">
                {canSkip && <SkipLink onClick={skip} />}
                <Button onClick={() => advance(5)}>See my picture <ArrowRight size={14} /></Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 5 — The Reveal (shared) ─────────────────────────────────── */}
        {step === 5 && tpl && (
          <div>
            <div className="font-mono text-[0.6rem] tracking-[0.18em] uppercase text-sage mb-2">Your starting picture</div>
            <h1 className="display-italic text-3xl text-ink mb-6">{tpl.revealLine}</h1>

            <div className="grid sm:grid-cols-2 gap-3 mb-5">
              <RevealStat label="Current position" value={fmt(cashAmt - (Number(snapshot.debt) || 0), currency)} />
              <RevealStat label="Monthly net (est.)" value={fmt(incomeAmt, currency)} estimated />
              <RevealStat label="First Pulse Score" value="—" hint="Builds as you log activity" />
              <RevealStat label="21-day outlook" value="On track" hint="Confirm estimates to sharpen it" />
            </div>

            {/* % confirmed indicator — starts low, by design (spec §4.3 / §5.4). */}
            <div className="bg-bg2 border border-line rounded-md p-4 mb-5">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-mid">Picture confirmed</span>
                <span className="num text-ink font-semibold">40%</span>
              </div>
              <div className="bg-bg3 h-1.5 rounded-full overflow-hidden">
                <div className="h-full bg-sage" style={{ width: '40%' }} />
              </div>
              <div className="text-[0.72rem] text-ink-dim mt-2">
                Your estimates fill in as real activity lands — aim for 80% confirmed in 21 days.
              </div>
            </div>

            <div className="bg-coral-tint border border-coral/30 rounded-md p-4 mb-7">
              <div className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-terra mb-1">Suggested next step</div>
              <div className="text-[0.9rem] text-ink">
                {segment === 'household'
                  ? 'Invite your partner so the household picture stays in sync.'
                  : segment === 'smb'
                  ? 'Log this week\'s expenses to firm up your runway.'
                  : 'Log a few transactions to confirm your spending estimates.'}
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={complete} disabled={submitting}>
                {submitting ? 'Setting up…' : 'Go to my dashboard'} <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        )}

        {/* Currency selector is always available, footer-level. */}
        {step >= 1 && step <= 4 && (
          <div className="mt-10 flex items-center gap-2 justify-center">
            <span className="font-mono text-[0.6rem] tracking-[0.12em] uppercase text-ink-dim">Currency</span>
            <select value={currency} onChange={e => setCurrency(e.target.value)}
              className="ff-select bg-bg3 border border-line rounded-md px-2 py-1 text-[0.8rem] font-ui cursor-pointer">
              {Object.entries(CURRENCIES).map(([code, c]) =>
                <option key={code} value={code}>{c.symbol} {code}</option>)}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

function SkipLink({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-ink-dim hover:text-ink">
      Skip for now
    </button>
  );
}

function RevealStat({ label, value, hint, estimated }: {
  label: string; value: string; hint?: string; estimated?: boolean;
}) {
  return (
    <div className="bg-bg2 border border-line rounded-md p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono text-[0.58rem] tracking-[0.12em] uppercase text-ink-mid">{label}</span>
        {estimated && <EstimatedTag confidence="estimated" />}
      </div>
      <div className="num text-xl text-ink font-semibold">{value}</div>
      {hint && <div className="text-[0.7rem] text-ink-dim mt-1">{hint}</div>}
    </div>
  );
}
