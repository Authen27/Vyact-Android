// Vyact — public landing page at "/" (vyact.app domain cutover, v10.33.0).
//
// Rendered Layout-less, before the `loading` gate, so an anonymous visitor or
// crawler sees it immediately (same reasoning as the legal-route branch in
// App.tsx — see the comment there). Structure and copy mirror the marketing
// site drafted in GoDaddy Airo Builder, rebuilt here with Vyact's own Aurora
// tokens so the visual language matches the app a visitor lands in next —
// the "Meet your Pulse Score" spotlight and the sample Insights feed are both
// captioned as illustrative, the same honesty convention Help.tsx's guide
// screenshots use ("Example household, not your data"): a score or insight
// shown to an anonymous visitor is never real user data.
//
// CTA reads real auth state, the same way AppShell/AuthGate do:
//   cloud mode + signed in  → "Go to Dashboard"
//   cloud mode + signed out → "Sign in" / "Get started"
//   local-only mode         → straight into the app, no auth concept here
import { Link } from 'react-router-dom';
import { Layers, CalendarX2, BarChart3, Lightbulb, Target, TrendingUp } from 'lucide-react';
import { useStore } from '../store';
import { isCloudEnabled } from '../lib/supabase';
import { Pip } from '../components/layout/Brand';

function badgeIcon(Icon: typeof Layers) {
  return (
    <span
      className="inline-flex items-center justify-center w-10 h-10 rounded-lg mb-3"
      style={{ background: 'color-mix(in srgb, hsl(var(--coral)) 14%, transparent)' }}
      aria-hidden
    >
      <Icon size={19} className="text-coral" />
    </span>
  );
}

function PainCard({ icon, title, children }: { icon: typeof Layers; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg3 border border-line rounded-xl p-5">
      {badgeIcon(icon)}
      <h3 className="text-[15px] font-semibold text-ink mb-1.5">{title}</h3>
      <p className="text-[0.9rem] leading-6 text-ink-mid">{children}</p>
    </div>
  );
}

function FeatureCard({ icon, title, children }: { icon: typeof Layers; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg3 border border-line rounded-xl p-5 flex gap-3.5 items-start">
      {badgeIcon(icon)}
      <div className="pt-0.5">
        <h3 className="text-[15px] font-semibold text-ink mb-1">{title}</h3>
        <p className="text-[0.9rem] leading-6 text-ink-mid">{children}</p>
      </div>
    </div>
  );
}

export default function Landing() {
  const session = useStore(s => s.session);
  const cloudMode = isCloudEnabled();
  const signedIn = cloudMode && !!session;

  const primaryTo = !cloudMode ? '/dashboard' : signedIn ? '/dashboard' : '/auth/sign-up';
  const primaryLabel = !cloudMode ? 'Open Vyact' : signedIn ? 'Go to Dashboard' : "Open Vyact — it's free →";

  return (
    <div className="min-h-[100dvh]" style={{ background: 'var(--canvas)' }}>
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pip size={30} />
            <div>
              <div className="display-italic text-lg text-ink leading-none">Vyact</div>
              <div className="font-mono text-[0.55rem] tracking-[0.14em] uppercase text-coral">Family Finance OS</div>
            </div>
          </div>
          {cloudMode && signedIn ? (
            <Link to="/dashboard" className="btn-primary px-5 py-2.5 text-[0.9rem] font-semibold rounded-full">
              Open app
            </Link>
          ) : cloudMode ? (
            <div className="flex items-center gap-4">
              <Link to="/auth/sign-in" className="text-[0.85rem] font-medium text-ink-mid hover:text-ink">Sign in</Link>
              <Link to="/auth/sign-up" className="btn-primary px-5 py-2.5 text-[0.9rem] font-semibold rounded-full">
                Open app
              </Link>
            </div>
          ) : (
            <Link to="/dashboard" className="btn-primary px-5 py-2.5 text-[0.9rem] font-semibold rounded-full">
              Open app
            </Link>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5">
        {/* Hero */}
        <section className="pt-16 pb-16 md:pt-20 md:pb-20 max-w-2xl">
          <h1 className="display-italic text-4xl md:text-5xl text-ink mb-5 leading-[1.1]">
            Your household deserves to understand its money.
          </h1>
          <p className="text-[1.05rem] leading-7 text-ink-mid mb-8">
            Vyact tracks your spending, shows your net worth, and gives every Indian household the
            financial clarity usually reserved for people with a personal finance advisor.
          </p>
          <Link to={primaryTo} className="btn-primary inline-block px-6 py-3.5 text-[0.95rem] font-semibold rounded-full">
            {primaryLabel}
          </Link>
          <p className="text-[0.8rem] text-ink-dim mt-3">No credit card. No bank connection required. Works on any device.</p>
        </section>

        {/* Sound familiar? */}
        <section className="pb-16">
          <h2 className="display-italic text-2xl text-ink mb-6 text-center">Sound familiar?</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <PainCard icon={Layers} title="Money is tracked in too many places.">
              Salary in one account. Expenses on UPI. Investments somewhere else. Debt in your head.
              No single picture of what&apos;s actually happening.
            </PainCard>
            <PainCard icon={CalendarX2} title="The month ends and you&apos;re not sure where it went.">
              You earned well. You didn&apos;t splurge. And yet — the balance doesn&apos;t reflect it.
              The leak is somewhere; you just can&apos;t see it.
            </PainCard>
            <PainCard icon={BarChart3} title="Knowing your net worth shouldn&apos;t require a spreadsheet.">
              Assets, liabilities, investments, debt — the real number that tells you whether you&apos;re
              ahead or behind should be one tap away, not a Sunday afternoon calculation.
            </PainCard>
          </div>
        </section>

        {/* One app */}
        <section className="pb-16">
          <h2 className="display-italic text-2xl md:text-3xl text-ink mb-6 text-center">
            One app. Everything your household needs.
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FeatureCard icon={Layers} title="Track">
              Log every transaction — expense, income, investment, transfer — against the account it
              moved. Know your real balance, always.
            </FeatureCard>
            <FeatureCard icon={Lightbulb} title="Understand">
              A personalised Insights feed shows what your spending patterns actually mean. A weekly
              Pulse Score reflects your financial health across five dimensions.
            </FeatureCard>
            <FeatureCard icon={Target} title="Plan">
              Set monthly and annual budgets by category. Schedule recurring payments. See what&apos;s
              committed before the month starts.
            </FeatureCard>
            <FeatureCard icon={TrendingUp} title="Build">
              Watch your net worth grow as you pay down debt and add to investments. One number,
              updated in real time, that tells you whether you&apos;re building wealth.
            </FeatureCard>
          </div>
        </section>

        {/* Pulse Score spotlight — illustrative only; a real score only exists once a household has recorded activity */}
        <section className="pb-16">
          <div
            className="rounded-2xl p-8 md:p-10 flex flex-col md:flex-row items-center gap-6 md:gap-10 overflow-hidden relative"
            style={{ background: 'hsl(var(--coral))' }}
          >
            <span
              aria-hidden
              className="absolute -right-2 -bottom-4 font-display font-bold text-[7rem] md:text-[9rem] leading-none select-none"
              style={{ color: 'color-mix(in srgb, white 18%, transparent)' }}
            >
              78
            </span>
            <div className="relative max-w-lg">
              <h2 className="display-italic text-2xl md:text-3xl text-white mb-3">Meet your Pulse Score.</h2>
              <p className="text-[0.95rem] leading-6" style={{ color: 'color-mix(in srgb, white 88%, transparent)' }}>
                Every week, Vyact calculates a single score for your household&apos;s financial health —
                combining spending patterns, savings rate, debt load, and budget adherence. It&apos;s not
                a grade. It&apos;s a conversation starter.
              </p>
              <p className="font-mono text-[0.6rem] tracking-[0.1em] uppercase mt-4" style={{ color: 'color-mix(in srgb, white 65%, transparent)' }}>
                Illustrative score shown — yours is calculated from your own household once you start recording.
              </p>
            </div>
          </div>
        </section>

        {/* Insights showcase */}
        <section className="pb-16 grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          <div>
            <h2 className="display-italic text-2xl md:text-3xl text-ink mb-4">
              Your money, explained back to you.
            </h2>
            <p className="text-[0.95rem] leading-6 text-ink-mid">
              Vyact&apos;s Insights feed generates personalised observations from your own financial
              data — not generic tips, not sponsored content. When your dining spend runs 34% above
              your usual, Vyact notices. When you&apos;ve stayed under budget for three months
              running, Vyact says so. The kind of feedback a good financial advisor would give you,
              built from your actual numbers.
            </p>
          </div>
          <div className="space-y-3">
            <div className="bg-bg3 border border-line rounded-lg px-4 py-3 text-[0.85rem] text-ink">
              Your dining spend is 40% higher than last month.
            </div>
            <div className="bg-bg3 border border-line rounded-lg px-4 py-3 text-[0.85rem] text-ink">
              You&apos;re on track for your savings goal this month.
            </div>
            <div className="bg-bg3 border border-line rounded-lg px-4 py-3 text-[0.85rem] text-ink">
              Subscriptions cost ₹3,200 more than you budgeted.
            </div>
            <p className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-ink-dim">
              Example household, not your data.
            </p>
          </div>
        </section>

        {/* Final CTA */}
        <section className="pb-16 text-center">
          <Link to={primaryTo} className="btn-primary inline-block px-6 py-3.5 text-[0.95rem] font-semibold rounded-full">
            {!cloudMode || signedIn ? primaryLabel : "Open Vyact — it's free"}
          </Link>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="max-w-5xl mx-auto px-5 py-8 flex flex-wrap justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Pip size={22} />
              <div>
                <div className="display-italic text-base text-ink leading-none">Vyact</div>
                <div className="font-mono text-[0.5rem] tracking-[0.14em] uppercase text-coral">Family Finance OS</div>
              </div>
            </div>
            <p className="text-[0.8rem] text-ink-dim">Your family&apos;s financial operating system.</p>
          </div>
          <div className="text-right">
            <Link to={primaryTo} className="text-[0.85rem] font-medium text-coral hover:underline">Open Vyact →</Link>
            <p className="text-[0.8rem] text-ink-dim mt-1">Built for Indian households. Privacy-first, no bank connection required.</p>
            <div className="flex gap-4 justify-end mt-3 text-[0.75rem] text-ink-dim">
              <Link to="/privacy" className="hover:text-ink">Privacy</Link>
              <Link to="/terms" className="hover:text-ink">Terms</Link>
              <Link to="/cookies" className="hover:text-ink">Cookies</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
