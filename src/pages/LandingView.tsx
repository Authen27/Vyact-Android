// Vyact — the public landing page's markup (v10.50.0).
//
// The v10.33 landing (Aurora tokens, "Your household deserves to understand its money."),
// restored as the brand page at "/" by owner decision, with the SEO content of the v10.49
// server-rendered page added as sections at the BOTTOM: use cases, features, featured
// lessons and a visible FAQ.
//
// Pure: no store, no browser API, no env. Landing.tsx wraps it with auth state, and
// scripts/prerender-landing.mjs renders it to dist/landing.html at build time so crawlers,
// social scrapers and AI tools get the full page as HTML. Copy lives in content/landingCopy.ts.
//
// Illustrative content is captioned (the Help.tsx honesty convention): nothing shown to an
// anonymous visitor is real user data.
import { Link } from 'react-router-dom';
import {
  Layers, CalendarX2, BarChart3, Lightbulb, Target, TrendingUp, Users, Home, Receipt, Landmark, PiggyBank, Globe2,
  Zap, BellRing, CalendarClock, Split, LineChart, MessageCircle, ShieldCheck, BookOpen, Play,
} from 'lucide-react';
import { Pip } from '../components/layout/Brand';
import {
  HERO, PAINS, PILLARS, PIP, INSIGHTS, USE_CASES, FEATURES, LESSONS, FAQ, SHORTS, YOUTUBE_CHANNEL, DEMO_URL,
  PROMO, promoWatchUrl, promoEmbedUrl,
} from '../content/landingCopy';

type Icon = typeof Layers;

function badgeIcon(Icon: Icon) {
  return (
    <span
      className="inline-flex items-center justify-center w-10 h-10 rounded-lg mb-3 flex-shrink-0"
      style={{ background: 'color-mix(in srgb, hsl(var(--coral)) 14%, transparent)' }}
      aria-hidden
    >
      <Icon size={19} className="text-coral" />
    </span>
  );
}

/** Aurora 4.0 LA1 — the app's raised small card at 18px. */
const CARD = 'tile !rounded-r3';

function PainCard({ icon, title, children }: { icon: Icon; title: string; children: React.ReactNode }) {
  return (
    <div className={`${CARD} p-5`}>
      {badgeIcon(icon)}
      <h3 className="text-[15px] font-semibold text-ink mb-1.5">{title}</h3>
      <p className="text-[0.9rem] leading-6 text-ink-mid">{children}</p>
    </div>
  );
}

function FeatureCard({ icon, title, children }: { icon: Icon; title: string; children: React.ReactNode }) {
  return (
    <div className={`${CARD} p-5 flex gap-3.5 items-start`}>
      {badgeIcon(icon)}
      <div className="pt-0.5">
        <h3 className="text-[15px] font-semibold text-ink mb-1">{title}</h3>
        <p className="text-[0.9rem] leading-6 text-ink-mid">{children}</p>
      </div>
    </div>
  );
}

const PAIN_ICONS: Icon[] = [Layers, CalendarX2, BarChart3];
const PILLAR_ICONS: Icon[] = [Layers, Lightbulb, Target, TrendingUp];
const USE_CASE_ICONS: Icon[] = [Users, Home, Receipt, Landmark, PiggyBank, Globe2];
const FEATURE_ICONS: Icon[] = [Zap, BellRing, CalendarClock, Split, Landmark, LineChart, MessageCircle, ShieldCheck];

export interface LandingViewProps {
  /** Cloud build (auth exists). Local-only builds go straight into the app. */
  cloudMode: boolean;
  signedIn: boolean;
  /** Analytics hook for CTA clicks (placement); a no-op when pre-rendered. */
  onCta?: (placement: string) => void;
  /** v10.108.0 — the promo player is showing (the visitor tapped the poster). Never true when pre-rendered. */
  promoPlaying?: boolean;
  /** Tapping the poster. Without it (pre-rendered) the poster is a plain link to the video on YouTube,
   *  and the boot script in landing.html handles a tap made before the app is up. */
  onPlayPromo?: () => void;
}

/** v10.108.0 — the promo: a poster in a 16:9 box (no layout shift), and the player only after a tap.
 *  The poster is a brand card drawn in CSS (no image, nothing fetched): see PROMO in landingCopy.ts. */
function PromoVideo({ playing, onPlay }: { playing: boolean; onPlay?: () => void }) {
  return (
    <div className="relative rounded-r4 overflow-hidden border border-line" style={{ aspectRatio: '16 / 9', background: 'var(--sunken)' }}>
      {playing ? (
        <iframe
          src={promoEmbedUrl(PROMO.id)} title={PROMO.name}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
          className="absolute inset-0 w-full h-full border-0 bg-black"
        />
      ) : (
        <a
          href={promoWatchUrl(PROMO.id)} target="_blank" rel="noopener" data-promo={PROMO.id}
          onClick={onPlay ? e => { e.preventDefault(); onPlay(); } : undefined}
          className="group absolute inset-0 block" aria-label={`Play the video: ${PROMO.name}`}
        >
          <span aria-hidden className="absolute inset-0 transition-opacity opacity-80 group-hover:opacity-100"
            style={{ background: 'radial-gradient(90% 120% at 80% 0%, color-mix(in srgb, hsl(var(--coral)) 30%, transparent), transparent 65%)' }} />
          <span aria-hidden className="absolute left-4 top-4 sm:left-6 sm:top-6 flex items-center gap-2">
            <Pip size={30} />
            <span>
              <span className="block display-italic text-lg text-ink leading-none">Vyact</span>
              <span className="block text-[11px] font-medium text-coral">Family budget app</span>
            </span>
          </span>
          <span aria-hidden className="absolute inset-0 flex items-center justify-center">
            <span className="promo-play inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-full shadow-lg transition-transform group-hover:scale-105"
              style={{ background: 'hsl(var(--coral))', color: 'var(--accent-ink)' }}>
              <Play size={28} fill="currentColor" className="ml-1" />
            </span>
          </span>
          <span aria-hidden className="absolute left-4 bottom-4 sm:left-6 sm:bottom-5 text-[0.95rem] sm:text-[1.05rem] font-semibold text-ink">
            {PROMO.name}
          </span>
          <span aria-hidden className="absolute right-4 bottom-4 sm:right-6 sm:bottom-5 rounded-full px-2.5 py-1 text-[12px] font-semibold text-ink"
            style={{ background: 'color-mix(in srgb, var(--canvas) 70%, transparent)' }}>0:15</span>
        </a>
      )}
    </div>
  );
}

export default function LandingView({ cloudMode, signedIn, onCta, promoPlaying = false, onPlayPromo }: LandingViewProps) {
  const toApp = !cloudMode || signedIn;
  const primary = (ref: string) => (toApp ? '/dashboard' : `/auth/sign-up?ref=${ref}`);
  const primaryLabel = !cloudMode ? 'Open Vyact' : signedIn ? 'Go to Dashboard' : "Open Vyact — it's free →";
  const cta = (placement: string) => () => onCta?.(placement);

  return (
    <div className="min-h-[100dvh]" style={{ background: 'var(--canvas)' }}>
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2" aria-label="Vyact home">
            <Pip size={30} />
            <div>
              <div className="display-italic text-lg text-ink leading-none">Vyact</div>
              <div className="text-[11px] font-medium text-coral">Family budget app</div>
            </div>
          </Link>
          <nav className="flex items-center gap-3 sm:gap-4" aria-label="Main">
            <a href="/learn" className="hidden sm:inline text-[0.85rem] font-medium text-ink-mid hover:text-ink">Learn</a>
            {cloudMode && !signedIn && (
              <Link to="/auth/sign-in" className="text-[0.85rem] font-medium text-ink-mid hover:text-ink">Sign in</Link>
            )}
            <Link to={primary('landing_nav')} onClick={cta('nav')} data-cta="nav" className="btn-primary px-5 py-2.5 text-[0.9rem] font-semibold rounded-full">
              Open app
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5">
        {/* Hero */}
        <section className="pt-16 pb-16 md:pt-20 md:pb-20 max-w-2xl">
          <p className="text-[0.8rem] font-semibold text-coral mb-3">{HERO.kicker}</p>
          <h1 className="display-italic text-4xl md:text-5xl text-ink mb-5 leading-[1.1]">{HERO.title}</h1>
          <p className="text-[1.05rem] leading-7 text-ink-mid mb-8">{HERO.lede}</p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <Link to={primary('landing_hero')} onClick={cta('hero')} data-cta="hero" className="btn-primary inline-block px-6 py-3.5 text-[0.95rem] font-semibold rounded-full">
              {primaryLabel}
            </Link>
            {/* v10.57.0 (B20) — a look inside before signing up. Production only: a local build is the app already. */}
            {cloudMode && !signedIn && (
              <a href={DEMO_URL} onClick={cta('demo')} data-cta="demo" className="py-2 text-[0.95rem] font-semibold text-coral hover:underline">
                Try the demo, no sign-up
              </a>
            )}
          </div>
          <p className="text-[0.8rem] text-ink-dim mt-3">{HERO.fine}</p>
        </section>

        {/* v10.108.0 — the 15-second promo. Below the fold on phones, so the H1 stays the page's largest paint. */}
        <section className="pb-16 max-w-3xl mx-auto" aria-labelledby="promo" data-testid="landing-promo">
          <h2 id="promo" className="display-italic text-2xl md:text-3xl text-ink mb-2 text-center">{PROMO.heading}</h2>
          <p className="text-[0.95rem] leading-6 text-ink-mid mb-5 text-center">{PROMO.caption}</p>
          <PromoVideo playing={promoPlaying} onPlay={onPlayPromo} />
        </section>

        {/* Sound familiar? */}
        <section className="pb-16">
          <h2 className="display-italic text-2xl text-ink mb-6 text-center">Sound familiar?</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {PAINS.map(([title, body], i) => <PainCard key={title} icon={PAIN_ICONS[i]} title={title}>{body}</PainCard>)}
          </div>
        </section>

        {/* One app */}
        <section className="pb-16">
          <h2 className="display-italic text-2xl md:text-3xl text-ink mb-6 text-center">
            One app. Everything your household needs.
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {PILLARS.map(([title, body], i) => <FeatureCard key={title} icon={PILLAR_ICONS[i]} title={title}>{body}</FeatureCard>)}
          </div>
        </section>

        {/* Pip spotlight (the v10.33 coral band) — example questions are illustrative */}
        <section className="pb-16">
          <div
            className="rounded-2xl p-8 md:p-10 flex flex-col md:flex-row items-center gap-6 md:gap-10 overflow-hidden relative"
            style={{ background: 'hsl(var(--coral))' }}
          >
            <span
              aria-hidden
              className="absolute -right-2 -bottom-4 font-display font-bold text-[7rem] md:text-[9rem] leading-none select-none"
              style={{ color: 'color-mix(in srgb, var(--accent-ink) 12%, transparent)' }}
            >
              ?
            </span>
            <div className="relative max-w-lg" style={{ color: 'var(--accent-ink)' }} data-testid="landing-pip-band">
              <h2 className="display-italic text-2xl md:text-3xl mb-3" style={{ color: 'var(--accent-ink)' }}>{PIP.title}</h2>
              <p className="text-[0.95rem] leading-6">{PIP.body}</p>
              <p className="text-[12px] font-medium mt-4" style={{ color: 'color-mix(in srgb, var(--accent-ink) 78%, transparent)' }}>
                {PIP.caption}
              </p>
            </div>
            <ul className="relative space-y-2 w-full md:w-auto md:min-w-[16rem]">
              {PIP.examples.map(q => (
                <li key={q} className="rounded-r2 px-4 py-2.5 text-[0.85rem] font-medium"
                  style={{ background: 'color-mix(in srgb, white 30%, transparent)', color: 'var(--accent-ink)' }}>“{q}”</li>
              ))}
            </ul>
          </div>
        </section>

        {/* Insights showcase */}
        <section className="pb-16 grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          <div>
            <h2 className="display-italic text-2xl md:text-3xl text-ink mb-4">{INSIGHTS.title}</h2>
            <p className="text-[0.95rem] leading-6 text-ink-mid">{INSIGHTS.body}</p>
          </div>
          <div className="space-y-3">
            {INSIGHTS.examples.map(t => (
              <div key={t} className={`${CARD} px-4 py-3 text-[0.85rem] text-ink`}>{t}</div>
            ))}
            <p className="text-[12px] text-ink-dim">{INSIGHTS.caption}</p>
          </div>
        </section>

        {/* Who it's for */}
        <section className="pb-16" aria-labelledby="who">
          <h2 id="who" className="display-italic text-2xl md:text-3xl text-ink mb-6 text-center">
            Made for the way households actually run.
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {USE_CASES.map(([title, body], i) => <PainCard key={title} icon={USE_CASE_ICONS[i]} title={title}>{body}</PainCard>)}
          </div>
          {/* Plain <a>: /for/* are server-rendered pages, not app routes. */}
          <p className="text-center text-[0.9rem] text-ink-mid mt-5">
            <a href="/for/couples" className="font-semibold text-coral hover:underline">Budgeting as a couple →</a>
            <span className="mx-3 text-ink-dim">·</span>
            <a href="/for/families" className="font-semibold text-coral hover:underline">Budgeting as a family →</a>
            <span className="mx-3 text-ink-dim">·</span>
            <a href="/for/splitwise-users" className="font-semibold text-coral hover:underline">Coming from Splitwise →</a>
            <span className="mx-3 text-ink-dim">·</span>
            <a href="/for/money-owed" className="font-semibold text-coral hover:underline">Tracking money owed →</a>
          </p>
        </section>

        {/* Everything it does */}
        <section className="pb-16" aria-labelledby="features">
          <h2 id="features" className="display-italic text-2xl md:text-3xl text-ink mb-6 text-center">
            Everything in one place.
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FEATURES.map(([title, body], i) => <FeatureCard key={title} icon={FEATURE_ICONS[i]} title={title}>{body}</FeatureCard>)}
          </div>
        </section>

        {/* Learn — plain <a>: /learn is a server-rendered page, not an app route */}
        <section className="pb-16" aria-labelledby="learn">
          <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
            <div>
              <h2 id="learn" className="display-italic text-2xl md:text-3xl text-ink mb-2">Learn money in 60 seconds.</h2>
              <p className="text-[0.95rem] leading-6 text-ink-mid">Short, plain-English lessons and one-minute videos. Free, no sign-up to read.</p>
            </div>
            <a href="/learn" className="text-[0.9rem] font-semibold text-coral hover:underline">Browse the library →</a>
          </div>
          {/* v10.57.0 (B18) — three one-minute Shorts. Plain links + lazy thumbnails: no player loads. */}
          <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-px-5 -mx-5 px-5 pb-1 mb-4 sm:scroll-px-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:mx-0 sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden"
            style={{ scrollbarWidth: 'none' }} data-testid="landing-shorts">
            {SHORTS.map(s => (
              <div key={s.id} className="w-[150px] flex-shrink-0 snap-start sm:w-auto min-w-0">
                <a href={`https://www.youtube.com/shorts/${s.id}`} target="_blank" rel="noopener" data-cta={`short_${s.slug.slice(3, 6)}`} onClick={cta(`short_${s.slug.slice(3, 6)}`)}
                  className="relative block rounded-xl overflow-hidden border border-line bg-black" style={{ aspectRatio: '9 / 16' }}
                  aria-label={`Watch on YouTube: ${s.title}`}>
                  <img src={`https://i.ytimg.com/vi/${s.id}/hqdefault.jpg`} alt="" loading="lazy" width={480} height={360}
                    className="absolute inset-0 w-full h-full object-cover opacity-85" />
                  <span className="absolute inset-x-0 bottom-0 p-2.5 text-[0.8rem] sm:text-[0.85rem] font-semibold text-white leading-snug"
                    style={{ background: 'linear-gradient(transparent, rgba(0,0,0,.8))' }}>▶ {s.title}</span>
                </a>
                <a href={`/learn/${s.slug}`} className="block mt-1.5 text-[0.8rem] font-medium text-coral hover:underline min-h-[44px] sm:min-h-0">Read the lesson →</a>
              </div>
            ))}
          </div>
          <p className="text-[0.85rem] text-ink-mid mb-6">
            New one-minute lessons on <a href={YOUTUBE_CHANNEL} target="_blank" rel="noopener" className="font-semibold text-coral hover:underline">YouTube · @askvyact</a>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {LESSONS.map(l => (
              <a key={l.slug} href={`/learn/${l.slug}`} className={`${CARD} p-4`}>
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-coral mb-1.5">
                  <BookOpen size={12} aria-hidden /> {l.topic}
                </div>
                <div className="text-[0.92rem] font-semibold text-ink leading-snug">{l.title}</div>
              </a>
            ))}
          </div>
        </section>

        {/* FAQ — mirrored exactly by the FAQPage JSON-LD in dist/landing.html */}
        <section className="pb-16 max-w-3xl mx-auto" aria-labelledby="faq">
          <h2 id="faq" className="display-italic text-2xl md:text-3xl text-ink mb-6 text-center">Questions, answered.</h2>
          <div className="space-y-2.5">
            {FAQ.map(([q, a]) => (
              <details key={q} className={`${CARD} px-5 py-4 group`}>
                <summary className="text-[0.95rem] font-semibold text-ink cursor-pointer">{q}</summary>
                <p className="text-[0.9rem] leading-6 text-ink-mid mt-2">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="pb-16 text-center">
          <h2 className="display-italic text-2xl md:text-3xl text-ink mb-5">Set up your household in two minutes.</h2>
          <Link to={primary('landing_footer')} onClick={cta('footer')} data-cta="footer" className="btn-primary inline-block px-6 py-3.5 text-[0.95rem] font-semibold rounded-full">
            {toApp ? primaryLabel : "Open Vyact — it's free"}
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
                <div className="text-[11px] font-medium text-coral">Family budget app</div>
              </div>
            </div>
            <p className="text-[0.8rem] text-ink-dim">Your household’s money, understood together.</p>
          </div>
          <div className="text-right">
            <Link to={primary('landing_footer_link')} onClick={cta('footer_link')} data-cta="footer_link" className="text-[0.85rem] font-medium text-coral hover:underline">Open Vyact →</Link>
            <p className="text-[0.8rem] text-ink-dim mt-1">Budgets, bills, splits and net worth — shared with the people you share money with.</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2 justify-end mt-3 text-[0.75rem] text-ink-dim">
              <a href="/about" className="hover:text-ink">About</a>
              <a href="/learn" className="hover:text-ink">Learn</a>
              <a href="/private" className="hover:text-ink">Private by design</a>
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
