// Vyact — Insights Hub (v9.5.3).
//
// Insights is no longer a single content page: it's the app's stickiness hub with
// four streams (spec vyact-insights-hub-spec.md):
//   • For You    — the personal-insight feed, shown as a finite full-screen reel
//   • Learn      — the 100+ evergreen card library (bundled, visual+text)
//   • What's New — curated editorial / external updates (the v6.3 content module)
//   • Plan       — the absorbed Planner (was a FloatingTool bubble)
//
// "Services compute, never fabricate": the For You feed reads existing aggregates
// only (lib/insightsFeed.ts) — no new financial math, all on-device.
import { useMemo, useState } from 'react';
import { Sparkles, GraduationCap, Compass, Play, ArrowRight, BookOpen } from 'lucide-react';
import { useStore } from '../store';
import { useTranslation } from '../hooks';
import EmptyState from '../components/ui/EmptyState';
import Planner from './Planner';
import EvergreenLearn from '../components/insights/EvergreenLearn';
import ForYouReel from '../components/insights/ForYouReel';
import { buildInsightFeed, type FeedCard } from '../lib/insightsFeed';
import { evaluateRecommendations, type Severity } from '../lib/plannerRules';
import { filterEvergreen } from '../lib/evergreen';

const RAIL_SPINE: Record<Severity, string> = {
  critical: 'hsl(var(--terra))', watch: 'hsl(var(--honey))', info: 'hsl(var(--denim))',
};

// v9.5.5 — What's New was merged INTO Learn (as a Lessons/Updates segment), so the
// hub is now three tabs.
type Tab = 'for-you' | 'learn' | 'plan';

const TABS: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: 'for-you', label: 'For You', icon: Sparkles },
  { id: 'learn',   label: 'Learn',   icon: GraduationCap },
  { id: 'plan',    label: 'Plan',    icon: Compass },
];

export default function Insights() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('for-you');
  const [reelStart, setReelStart] = useState<number | null>(null);
  const [learnOpenId, setLearnOpenId] = useState<string | null>(null);

  const transactions = useStore(s => s.transactions);
  const budgets = useStore(s => s.budgets);
  const goals = useStore(s => s.goals);
  const debts = useStore(s => s.debts);
  const assets = useStore(s => s.assets);
  const profile = useStore(s => s.profile);
  const rates = useStore(s => s.rates);

  const feed = useMemo(
    () => buildInsightFeed({ transactions, budgets, goals, debts, assets, baseCurrency: profile.baseCurrency, rates }),
    [transactions, budgets, goals, debts, assets, profile.baseCurrency, rates],
  );

  function openLearn(id: string) {
    setReelStart(null);
    setLearnOpenId(id);
    setTab('learn');
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="display-italic text-4xl text-ink mb-1.5">{t('insights') || 'Insights'}</h1>
        <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
          Your money, made legible · learn · plan
        </p>
      </div>

      {/* Board D — .tri: the 3-tab pill (For You / Learn / Plan). */}
      <div className="flex gap-1 p-1 mb-5 rounded-pill overflow-x-auto" style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className="flex-1 flex items-center justify-center gap-1.5 h-[30px] px-3 rounded-pill whitespace-nowrap text-[0.8rem] font-medium border-none cursor-pointer transition-[box-shadow,color]"
            style={tab === id
              ? { background: 'var(--canvas)', boxShadow: 'var(--neu-sm)', color: 'var(--ink)' }
              : { background: 'transparent', color: 'var(--ff-ink-3)' }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* Board D2 — on desktop the hub shows what mobile tabs between: For You
          on the left, a Plan + Learn rail on the right. Selecting Learn or Plan
          still opens that surface full-width. */}
      {tab === 'for-you' && (
        <div className="lg:grid lg:grid-cols-[1.5fr_1fr] lg:gap-5 lg:items-start">
          <div className="min-w-0">
            <ForYou feed={feed} onOpenReel={i => setReelStart(i)} />
          </div>
          <div className="hidden lg:flex lg:flex-col gap-3.5">
            <PlanRail onSeeAll={() => setTab('plan')} />
            <LearnRail onOpen={openLearn} onSeeAll={() => setTab('learn')} />
          </div>
        </div>
      )}
      {tab === 'learn'   && <EvergreenLearn openId={learnOpenId} onConsumedOpen={() => setLearnOpenId(null)} />}
      {tab === 'plan'    && <Planner />}

      {reelStart !== null && feed.length > 0 && (
        <ForYouReel cards={feed} startIndex={reelStart} onClose={() => setReelStart(null)} onOpenLearn={openLearn} />
      )}
    </div>
  );
}

/** Board D2 right rail — a condensed Plan column: the top few rules-based
 *  recommendations as severity-spined rows, with the "no AI" promise kept in
 *  view. Reads the same `evaluateRecommendations` the Plan tab does. */
function PlanRail({ onSeeAll }: { onSeeAll: () => void }) {
  const txns    = useStore(s => s.transactions);
  const budgets = useStore(s => s.budgets);
  const goals   = useStore(s => s.goals);
  const debts   = useStore(s => s.debts);
  const assets  = useStore(s => s.assets);
  const profile = useStore(s => s.profile);
  const rates   = useStore(s => s.rates);

  const recs = useMemo(() =>
    evaluateRecommendations({
      transactions: txns, budgets, goals, debts, assets,
      baseCurrency: profile.baseCurrency, rates, householdType: profile.household,
    }, 3),
    [txns, budgets, goals, debts, assets, profile.baseCurrency, rates, profile.household]);

  if (recs.length === 0) return null;
  return (
    <div className="rounded-r3 p-4" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="mono-label">Plan · recommendations</span>
        <span className="ml-auto mono-label text-ink-dim">🔒 rules, no AI</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {recs.map(r => (
          <div key={r.id} className="relative overflow-hidden rounded-r2 py-3 px-3.5"
            style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
            <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full"
              style={{ background: RAIL_SPINE[r.severity] }} aria-hidden />
            <div className="font-bold text-[12.5px] text-ink mb-0.5">{r.title}</div>
            <div className="text-[11.5px] text-ink-mid leading-[1.4]">{r.body}</div>
          </div>
        ))}
      </div>
      <button type="button" onClick={onSeeAll}
        className="mt-3 font-mono text-[0.62rem] tracking-wider uppercase text-coral hover:opacity-70">
        All recommendations →
      </button>
    </div>
  );
}

/** Board D2 right rail — a Learn tile grid of evergreen lessons. */
function LearnRail({ onOpen, onSeeAll }: { onOpen: (id: string) => void; onSeeAll: () => void }) {
  const tiles = useMemo(() => filterEvergreen('', 'all').slice(0, 4), []);
  if (tiles.length === 0) return null;
  return (
    <div className="rounded-r3 p-4" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}>
      <div className="mono-label mb-3">Learn · evergreen</div>
      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map(c => (
          <button key={c.id} type="button" onClick={() => onOpen(c.id)}
            className="text-left p-3 rounded-r2 border-none cursor-pointer"
            style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' }}>
            <div className="font-mono text-[0.55rem] tracking-wider uppercase text-ink-dim mb-1">{c.category}</div>
            <div className="text-[11.5px] font-semibold text-ink leading-snug">{c.title}</div>
          </button>
        ))}
      </div>
      <button type="button" onClick={onSeeAll}
        className="mt-3 font-mono text-[0.62rem] tracking-wider uppercase text-coral hover:opacity-70">
        Browse all lessons →
      </button>
    </div>
  );
}

function ForYou({ feed, onOpenReel }: { feed: FeedCard[]; onOpenReel: (startIndex: number) => void }) {
  if (feed.length === 0) {
    return <EmptyState icon="✨" message="Add a few transactions and your personal insights will appear here." />;
  }
  return (
    <div>
      {/* Board D M3 — the launch hero is GLASS over the ambient aurora, and it
          says out loud that the numbers are computed on-device. */}
      <div className="relative overflow-hidden rounded-r4 px-5 py-[18px] mb-3.5"
        style={{ background: 'var(--glass-strong)', backdropFilter: 'var(--blur)', WebkitBackdropFilter: 'var(--blur)', border: '1px solid var(--glass-line)', boxShadow: 'var(--cast-2)' }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'var(--ambient)', opacity: 0.9 }} aria-hidden />
        <div className="relative sm:flex sm:items-center sm:gap-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[20px] leading-none" aria-hidden>✦</span>
              <span className="mono-label" style={{ color: 'var(--accent)' }}>Your insights are ready</span>
            </div>
            <div className="font-display font-bold text-[22px] leading-tight tracking-tight text-ink mb-1">
              {feed.length} fresh card{feed.length === 1 ? '' : 's'} this week
            </div>
            <div className="text-[12.5px] text-ink-mid leading-snug mb-3.5 sm:mb-0">
              A 60-second story on where your money moved — computed on your device, never guessed.
            </div>
          </div>
          <button onClick={() => onOpenReel(0)}
            className="btn-primary h-[44px] flex items-center gap-1.5 flex-shrink-0 w-full sm:w-auto justify-center">
            <Play size={15} /> Play the reel
          </button>
        </div>
      </div>

      <div className="mono-label mb-2.5 px-0.5">Or browse them</div>

      {/* Board D M3/D2 §.icard — a severity SPINE down the left edge, then the
          emoji, the number that matters (tinted by tone), and one line. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
        {feed.map((c, i) => {
          const spine = c.tone === 'positive' ? 'hsl(var(--sage))'
                      : c.tone === 'constructive' ? 'hsl(var(--honey))'
                      : 'var(--accent)';
          const bigCls = c.tone === 'positive' ? 'text-sage'
                       : c.tone === 'constructive' ? 'text-honey'
                       : 'text-ink';
          return (
            <button
              key={c.id}
              onClick={() => onOpenReel(i)}
              className="relative overflow-hidden rounded-r3 px-4 py-[15px] text-left border-none cursor-pointer transition-[box-shadow,transform] hover:-translate-y-0.5"
              style={{ background: 'var(--canvas)', boxShadow: 'var(--neu)' }}
            >
              <span className="absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded-full" style={{ background: spine }} aria-hidden />
              <div className="flex items-start justify-between gap-2">
                <span className="text-[22px] leading-none" aria-hidden>{c.emoji}</span>
                {c.learnId
                  ? <BookOpen size={13} className="text-coral shrink-0 mt-1" />
                  : <ArrowRight size={13} className="text-coral shrink-0 mt-1" />}
              </div>
              <div className={`num font-bold text-[26px] leading-none tracking-tight mt-1.5 mb-0.5 ${bigCls}`}>{c.big}</div>
              <div className="text-[11.5px] text-ink-mid leading-[1.4]">{c.line}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
