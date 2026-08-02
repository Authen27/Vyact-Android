// Vyact — Onboarding & Activation flow (redesigned, revamp/Vyact Aurora · Onboarding.html).
//
// Six-screen spine driven by pip:
//   0 Welcome (currency set once here) → 1 Who + name → 2 What matters →
//   3 Money in (take-home) → 4 Money out (fixed bills, amounts inline) → 5 Reveal.
//
// Unlike the old "estimated reference baseline" that wiped itself, this flow now
// turns the captured numbers into REAL money-model objects the user can see and
// edit from day one (see lib/onboardingWiring.ts):
//   • take-home  → Cash account opening balance (cash-in-hand)
//   • take-home  → recurring paycheck (income, 1st of month, into Cash)
//   • each bill  → recurring expense (2nd of month, from Cash, its category) —
//                  future-dated + approval-gated, never auto-paid until reviewed
//   • the bills  → a budget for the join month, one allocation per category
// None of it POSTS a transaction, so the money invariants are untouched.
//
// The whole feature still sits behind FEATURES.onboarding; when off, this route
// renders nothing and redirects to the dashboard.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, Check, ShieldCheck, Lock } from 'lucide-react';
import { useStore } from '../store';
import { CURRENCIES } from '../constants';
import { fmt } from '../lib/format';
import Button from '../components/ui/Button';
import Chip from '../components/ui/Chip';
import { Pip } from '../components/layout/Brand';
import { isOnboardingEnabled } from '../config/features';
import { SEGMENTS, SEGMENT_ORDER } from '../lib/onboardingTemplates';
import {
  markStarted, markCompleted, setBaseline,
  type Segment, type OnboardingContext, type OnboardingBaseline,
} from '../lib/onboardingState';
import type { TemplateKey } from '../lib/templates';
import { track } from '../lib/analytics';
import { wireOnboardingToMoney } from '../lib/onboardingWiring';

type Step = 0 | 1 | 2 | 3 | 4 | 5;

const SEGMENT_TO_PROFILE: Record<Segment, 'personal' | 'family' | 'business'> = {
  individual: 'personal',
  household: 'family',
  smb: 'business',
};

const SEGMENT_TO_TEMPLATE: Record<Segment, TemplateKey> = {
  individual: 'single',
  household: 'family',
  smb: 'self_employed',
};

// Fixed-bill chip → display emoji (categories live in lib/onboardingWiring).
const CHIP_EMOJI: Record<string, string> = {
  rent: '🏠', mortgage: '🏠', utilities: '⚡', phone: '📱', subscriptions: '▶️',
  transport: '🛵', childcare: '👶', groceries: '🛒', insurance: '🛡️',
  payroll: '👥', software: '💻', contractors: '🧑‍💼', marketing: '📣', taxes: '🧾',
};

// Step-2 "what matters" — salaried-person wording; `concern` maps to the
// profile.primaryConcern space (spending / debt / savings).
const CONCERNS: { key: string; concern: 'spending' | 'debt' | 'savings'; emoji: string; label: string }[] = [
  { key: 'see',       concern: 'spending', emoji: '🔍', label: 'See where my money actually goes' },
  { key: 'save',      concern: 'savings',  emoji: '💰', label: 'Save a bit more each month' },
  { key: 'payoff',    concern: 'debt',     emoji: '📉', label: 'Pay off a loan or card' },
  { key: 'overspend', concern: 'spending', emoji: '🛑', label: 'Stop overspending before payday' },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const householdId = useStore(s => s.currentHouseholdId);
  const updateProfile = useStore(s => s.updateProfile);
  const refresh = useStore(s => s.refresh);
  const toast = useStore(s => s.toast);
  const profileName = useStore(s => s.profile.name);

  const [startedAt] = useState(() => Date.now());
  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState<string>(() => (profileName && profileName !== 'Alex Morgan' ? profileName : ''));
  const [segment, setSegment] = useState<Segment | null>(null);
  const [concerns, setConcerns] = useState<string[]>([]);
  const [income, setIncome] = useState<string>('');
  const [incomeSteady, setIncomeSteady] = useState<boolean>(true);
  const [billAmounts, setBillAmounts] = useState<Record<string, string>>({});
  const [currency, setCurrency] = useState<string>(() =>
    navigator.language?.includes('IN') ? 'INR' : navigator.language?.includes('GB') ? 'GBP' : 'USD',
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOnboardingEnabled()) {
      navigate('/dashboard', { replace: true });
      return;
    }
    markStarted(householdId);
    track('onboarding_started', { segment: 'none', flag_enabled: true });
  }, [householdId, navigate]);

  const tpl = segment ? SEGMENTS[segment] : null;
  const incomeAmt = Number(income) || 0;
  const curSym = CURRENCIES[currency]?.symbol ?? '';

  // Bills with a parsed amount (>0) or a name-only inclusion via the amount map key.
  const bills = useMemo(() => {
    if (!tpl) return [] as { key: string; label: string; amount: number }[];
    return tpl.fixedCostChips
      .filter(c => c.key in billAmounts)
      .map(c => ({ key: c.key, label: c.label, amount: Number(billAmounts[c.key]) || 0 }));
  }, [tpl, billAmounts]);

  const fixedTotal = bills.reduce((s, b) => s + b.amount, 0);
  const roomLeft = incomeAmt - fixedTotal;
  const biggestBill = bills.filter(b => b.amount > 0).sort((a, b) => b.amount - a.amount)[0] ?? null;
  const pulseEstimate = incomeAmt > 0
    ? Math.max(30, Math.min(85, Math.round(52 + (roomLeft / incomeAmt) * 40)))
    : null;

  function advance(next: Step) {
    track('onboarding_step_completed', { segment: segment ?? 'none', step_index: step, duration_ms: Date.now() - startedAt });
    setStep(next);
  }

  function toggleBill(key: string) {
    setBillAmounts(m => {
      if (key in m) { const n = { ...m }; delete n[key]; return n; }
      return { ...m, [key]: '' };
    });
  }

  async function complete() {
    if (!segment) return;
    setSubmitting(true);
    try {
      const primaryConcern = concerns.includes('payoff') ? 'debt'
        : concerns.includes('save') ? 'savings' : 'spending';
      const context: OnboardingContext = {
        primaryConcern,
        incomeType: incomeSteady ? 'steady' : 'variable',
      };

      // Reference baseline (StartingBaselineBand) — a complementary UI overlay.
      const baseline: OnboardingBaseline = {
        cash: incomeAmt, debt: 0, monthlyIncome: incomeAmt,
        fixedCosts: bills.map(b => ({ key: b.key, label: b.label })),
        currency, segment, primaryConcern, capturedAt: new Date().toISOString(),
      };
      setBaseline(householdId, baseline);

      // The real money wiring (cash balance + paycheck + bill schedules + budget).
      const st = useStore.getState();
      const primaryMember = st.members[0]?.id;
      await wireOnboardingToMoney({
        monthlyIncome: incomeAmt,
        bills,
        currency,
        memberId: primaryMember,
        fns: {
          ensureDefaultCashAccount: st.ensureDefaultCashAccount,
          getCashAccount: () => useStore.getState().accounts.find(a => a.kind === 'cash'),
          upsertAccount: st.upsertAccount,
          upsertRecurring: st.upsertRecurring,
          saveOnboardingBudget: st.saveOnboardingBudget,
        },
      });

      markCompleted(householdId, segment, context);
      await updateProfile({
        name: name.trim() || profileName,
        household: SEGMENT_TO_PROFILE[segment],
        template: SEGMENT_TO_TEMPLATE[segment],
        primaryConcern,
        baseCurrency: currency,
        onboardedAt: new Date().toISOString(),
      });
      await refresh();

      track('onboarding_completed', { segment, total_ms: Date.now() - startedAt, confirmed_pct: 35 });
      toast(`You're all set${name.trim() ? `, ${name.trim()}` : ''} — welcome to Vyact`, 'success');
      navigate('/dashboard');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[150] bg-bg overflow-y-auto">
      <div className="max-w-xl mx-auto px-6 py-8">

        {/* pip header + coral progress ribbon (steps ≥1). */}
        {step > 0 && (
          <>
            <div className="flex items-center gap-3 mb-4">
              <Pip size={38} />
              <div className="flex-1 min-w-0 rounded-r3 px-4 py-2.5 glass-panel">
                <div className="text-[0.86rem] text-ink leading-snug">{pipLine(step, name)}</div>
              </div>
            </div>
            <div className="flex gap-1.5 mb-7" aria-hidden>
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-1.5 flex-1 rounded-full"
                  style={{ background: i < step ? 'hsl(var(--sage))' : i === step ? 'var(--coral-grad)' : 'var(--sunken)', boxShadow: i > step ? 'var(--neu-inset)' : undefined }} />
              ))}
            </div>
          </>
        )}

        {/* ── Step 0 — Welcome (currency set once here) ─────────────────── */}
        {step === 0 && (
          <div className="flex flex-col items-center text-center pt-6">
            <Pip size={72} />
            <div className="mono-label mt-4 mb-3">Welcome to Vyact</div>
            <h1 className="display-italic text-[2rem] leading-tight text-ink mb-3">
              A clear money picture,<br />in two minutes.
            </h1>
            <p className="text-ink-mid mb-7 max-w-sm leading-relaxed">
              Hi, I'm pip. Tell me a little about your money and I'll set up your dashboard — everything stays editable.
            </p>
            <div className="w-full space-y-3 mb-7 text-left">
              <div className="flex items-start gap-3 rounded-r3 p-3.5" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
                <Lock size={16} className="text-sage mt-0.5 shrink-0" />
                <div className="text-[0.85rem] text-ink-mid"><span className="font-semibold text-ink">No bank login, ever.</span> No statements or card numbers — you type what you know.</div>
              </div>
              <div className="flex items-start gap-3 rounded-r3 p-3.5" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
                <ShieldCheck size={16} className="text-denim mt-0.5 shrink-0" />
                <div className="text-[0.85rem] text-ink-mid"><span className="font-semibold text-ink">Nothing is locked in.</span> Every number here is a starting point you refine later.</div>
              </div>
            </div>
            <div className="w-full flex items-center justify-between mb-3">
              <span className="mono-label">Currency · set once</span>
              <select value={currency} onChange={e => setCurrency(e.target.value)}
                className="ff-select rounded-pill px-3 py-1.5 text-[0.82rem] font-ui cursor-pointer"
                style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
                {Object.entries(CURRENCIES).map(([code, c]) => <option key={code} value={code}>{c.symbol} {code} — {c.name}</option>)}
              </select>
            </div>
            <Button onClick={() => advance(1)} full>Let's go <ArrowRight size={15} /></Button>
            <Link to="/auth/sign-in" className="mono-label mt-4 hover:text-ink">
              Already have an account? <span style={{ color: 'var(--accent)' }}>Sign in</span>
            </Link>
          </div>
        )}

        {/* ── Step 1 — Who + name ──────────────────────────────────────── */}
        {step === 1 && (
          <div>
            <label className="mono-label mb-1.5 block">Your first name</label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Rohan"
              className="w-full rounded-r2 px-4 min-h-[52px] text-ink text-[1.05rem] mb-6 border-none"
              style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }} />
            <label className="mono-label mb-2 block">Who's this picture for?</label>
            <div className="flex flex-col gap-3 mb-7">
              {SEGMENT_ORDER.map(key => {
                const s = SEGMENTS[key];
                const on = segment === key;
                return (
                  <button key={key} onClick={() => setSegment(key)}
                    className="flex items-center gap-3.5 p-4 rounded-r3 text-left transition-shadow relative"
                    style={{ background: 'var(--canvas)', boxShadow: on ? 'var(--neu-sm), 0 0 0 2px var(--accent)' : 'var(--neu-sm)' }}>
                    <span className="text-2xl">{s.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-ink">{key === 'smb' ? 'My side business' : s.label}</div>
                      <div className="text-[0.78rem] text-ink-mid leading-snug">{key === 'smb' ? 'Keep business books separate from personal' : s.blurb}</div>
                    </div>
                    {on && <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] shrink-0" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>✓</span>}
                  </button>
                );
              })}
            </div>
            <FootNav onBack={() => setStep(0)} onNext={() => advance(2)} nextDisabled={!segment || !name.trim()} nextLabel="Continue" />
          </div>
        )}

        {/* ── Step 2 — What matters (multi-select) ─────────────────────── */}
        {step === 2 && (
          <div>
            <label className="mono-label mb-2 block">Pick what matters most · you can pick a few</label>
            <div className="flex flex-col gap-3 mb-7">
              {CONCERNS.map(c => {
                const on = concerns.includes(c.key);
                return (
                  <button key={c.key}
                    onClick={() => setConcerns(cs => on ? cs.filter(k => k !== c.key) : [...cs, c.key])}
                    className="flex items-center gap-3 p-3.5 rounded-r3 text-left transition-shadow"
                    style={{ background: 'var(--canvas)', boxShadow: on ? 'var(--neu-sm), 0 0 0 2px var(--accent)' : 'var(--neu-sm)' }}>
                    <span className="text-xl">{c.emoji}</span>
                    <span className="flex-1 font-semibold text-[0.92rem] text-ink">{c.label}</span>
                    {on && <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] shrink-0" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>✓</span>}
                  </button>
                );
              })}
            </div>
            <FootNav onBack={() => setStep(1)} onNext={() => advance(3)} nextDisabled={concerns.length === 0} nextLabel="Continue" />
          </div>
        )}

        {/* ── Step 3 — Money in (take-home) ────────────────────────────── */}
        {step === 3 && (
          <div>
            <label className="mono-label mb-1.5 block">Monthly take-home pay</label>
            <div className="flex items-baseline gap-2 rounded-r2 px-4 min-h-[64px] mb-2" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
              <span className="num text-ink-dim text-[1.1rem]">{curSym}</span>
              <input autoFocus inputMode="decimal" type="number" min="0" value={income}
                onChange={e => setIncome(e.target.value)} placeholder="0"
                className="flex-1 bg-transparent border-none num font-bold text-[1.7rem] text-ink outline-none min-w-0" />
            </div>
            <div className="text-[0.78rem] text-ink-dim mb-6">What actually lands in your account after tax. This becomes your starting cash and your monthly paycheck.</div>
            <label className="mono-label mb-2 block">Does it arrive on a schedule?</label>
            <div className="flex gap-2 mb-4">
              <Chip on={incomeSteady} onClick={() => setIncomeSteady(true)}>Same day each month</Chip>
              <Chip on={!incomeSteady} onClick={() => setIncomeSteady(false)}>It varies</Chip>
            </div>
            {incomeSteady && (
              <div className="flex items-center gap-2 rounded-r2 p-3 mb-2" style={{ background: 'color-mix(in srgb, hsl(var(--sage)) 12%, transparent)' }}>
                <Check size={14} className="text-sage shrink-0" />
                <span className="text-[0.78rem] text-ink-mid">Steady pay — I'll add a monthly paycheck on the 1st and forecast your month.</span>
              </div>
            )}
            <div className="mt-6"><FootNav onBack={() => setStep(2)} onNext={() => advance(4)} nextDisabled={incomeAmt <= 0} nextLabel="Continue" /></div>
          </div>
        )}

        {/* ── Step 4 — Money out (fixed bills, amounts inline) ─────────── */}
        {step === 4 && tpl && (
          <div>
            <label className="mono-label mb-2 block">Which fixed bills do you have? Tap to add an amount.</label>
            <div className="flex flex-col gap-2.5 mb-4">
              {tpl.fixedCostChips.map(chip => {
                const on = chip.key in billAmounts;
                return (
                  <div key={chip.key}
                    className="flex items-center gap-3 px-3.5 py-2.5 rounded-r2 transition-shadow"
                    style={{ background: 'var(--canvas)', boxShadow: on ? 'var(--neu-sm), 0 0 0 2px var(--accent)' : 'var(--neu-sm)' }}>
                    <button onClick={() => toggleBill(chip.key)} className="flex items-center gap-3 flex-1 min-w-0 text-left border-none bg-transparent cursor-pointer">
                      <span className="w-9 h-9 rounded-[10px] flex items-center justify-center text-[15px] shrink-0" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>{CHIP_EMOJI[chip.key] ?? '💸'}</span>
                      <span className="font-semibold text-[0.86rem] text-ink truncate">{chip.label}</span>
                    </button>
                    {on ? (
                      <div className="flex items-baseline gap-1 rounded-lg px-2.5 py-1.5" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
                        <span className="num text-[0.72rem] text-ink-dim">{curSym}</span>
                        <input autoFocus inputMode="decimal" type="number" min="0" value={billAmounts[chip.key]}
                          onChange={e => setBillAmounts(m => ({ ...m, [chip.key]: e.target.value }))}
                          placeholder="0"
                          className="w-[76px] bg-transparent border-none num font-semibold text-[0.9rem] text-ink outline-none text-right" />
                      </div>
                    ) : (
                      <button onClick={() => toggleBill(chip.key)} className="mono-label border-none bg-transparent cursor-pointer" style={{ color: 'var(--accent)' }}>＋ add</button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between px-4 py-3 rounded-r2 mb-6" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
              <span className="text-[0.82rem] text-ink-mid">Fixed costs so far</span>
              <span className="num font-bold text-[1rem] text-ink">{fmt(fixedTotal, currency)}<span className="text-ink-dim font-medium text-[0.72rem]"> /mo</span></span>
            </div>
            <FootNav onBack={() => setStep(3)} onNext={() => advance(5)} nextDisabled={false} nextLabel="See my picture" />
          </div>
        )}

        {/* ── Step 5 — Reveal ──────────────────────────────────────────── */}
        {step === 5 && (
          <div>
            <div className="mono-label text-sage mb-2">Your starting picture</div>
            <h1 className="display-italic text-[1.7rem] text-ink mb-6">Here's your month{name.trim() ? `, ${name.trim()}` : ''}.</h1>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <RevealStat label="Room left this month" value={fmt(roomLeft, currency)} hint="after fixed bills, before daily spend" tone="hsl(var(--sage))" />
              <RevealStat label="First Pulse" value={pulseEstimate != null ? String(pulseEstimate) : '—'} hint="builds as you log" tone="hsl(var(--honey))" />
            </div>
            {biggestBill && (
              <div className="flex items-center gap-3 rounded-r3 p-4 mb-4" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
                <span className="w-10 h-10 rounded-[11px] flex items-center justify-center text-[17px] shrink-0" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>{CHIP_EMOJI[biggestBill.key] ?? '💸'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[0.86rem] font-semibold text-ink">{biggestBill.label} is your biggest fixed cost</div>
                  <div className="text-[0.76rem] text-ink-mid">{fmt(biggestBill.amount, currency)}{incomeAmt > 0 ? ` — about ${Math.round((biggestBill.amount / incomeAmt) * 100)}% of take-home pay` : ''}</div>
                </div>
              </div>
            )}
            <div className="rounded-r3 p-4 mb-7" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[0.8rem] text-ink-mid">Picture confirmed</span>
                <span className="num font-bold text-ink">35%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
                <div className="h-full rounded-full" style={{ width: '35%', background: 'hsl(var(--sage))' }} />
              </div>
              <div className="text-[0.72rem] text-ink-dim mt-2">Log a week of real spending and this climbs toward 80% — that's when the forecast gets sharp. Your paycheck and bills are waiting in <strong>Recurring</strong> for you to review.</div>
            </div>
            <Button onClick={complete} disabled={submitting} full>
              {submitting ? 'Setting up…' : 'Go to my dashboard'} <ArrowRight size={15} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function pipLine(step: Step, name: string): string {
  const n = name.trim();
  switch (step) {
    case 1: return 'First — what should I call you, and who is this for?';
    case 2: return n ? `Nice to meet you, ${n}. What brought you here?` : 'What brought you here?';
    case 3: return 'How much comes in each month? You know this one exactly.';
    case 4: return 'Which fixed bills do you have? Add an amount for each.';
    case 5: return n ? `Here's your month, ${n}.` : "Here's your month.";
    default: return '';
  }
}

function FootNav({ onBack, onNext, nextDisabled, nextLabel }: {
  onBack: () => void; onNext: () => void; nextDisabled: boolean; nextLabel: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Button variant="ghost" onClick={onBack}>Back</Button>
      <Button onClick={onNext} disabled={nextDisabled} full>{nextLabel} <ArrowRight size={14} /></Button>
    </div>
  );
}

function RevealStat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone: string }) {
  return (
    <div className="rounded-r3 p-4" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
      <div className="mono-label mb-1.5">{label}</div>
      <div className="num font-bold text-[1.5rem]" style={{ color: tone }}>{value}</div>
      {hint && <div className="text-[0.68rem] text-ink-dim mt-1 leading-snug">{hint}</div>}
    </div>
  );
}
