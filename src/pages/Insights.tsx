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

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 bg-bg3 border border-line rounded-lg p-1 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap text-[0.8rem] font-medium transition-colors ${
              tab === id ? 'bg-bg2 text-ink shadow-sm' : 'text-ink-mid hover:text-ink'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'for-you' && <ForYou feed={feed} onOpenReel={i => setReelStart(i)} />}
      {tab === 'learn'   && <EvergreenLearn openId={learnOpenId} onConsumedOpen={() => setLearnOpenId(null)} />}
      {tab === 'plan'    && <Planner />}

      {reelStart !== null && feed.length > 0 && (
        <ForYouReel cards={feed} startIndex={reelStart} onClose={() => setReelStart(null)} onOpenLearn={openLearn} />
      )}
    </div>
  );
}

function ForYou({ feed, onOpenReel }: { feed: FeedCard[]; onOpenReel: (startIndex: number) => void }) {
  if (feed.length === 0) {
    return <EmptyState icon="✨" message="Add a few transactions and your personal insights will appear here." />;
  }
  return (
    <div>
      {/* Launch hero — the reel is the primary, mobile-first experience. */}
      <button
        onClick={() => onOpenReel(0)}
        className="w-full flex items-center justify-between gap-4 rounded-xl border border-coral/30 bg-coral/[0.06] px-5 py-4 mb-4 text-left hover:bg-coral/[0.1] transition-colors"
      >
        <div className="min-w-0">
          <div className="display-italic text-xl text-ink">Your insights are ready</div>
          <div className="text-[0.82rem] text-ink-mid mt-0.5">{feed.length} fresh card{feed.length === 1 ? '' : 's'} · a short, finite read</div>
        </div>
        <span className="flex-shrink-0 inline-flex items-center gap-1.5 btn-primary"><Play size={15} /> Open</span>
      </button>

      {/* Preview list — tap any card to open the reel at that point. */}
      <div className="grid sm:grid-cols-2 gap-2.5">
        {feed.map((c, i) => (
          <button
            key={c.id}
            onClick={() => onOpenReel(i)}
            className="flex items-start gap-3 rounded-lg border border-line bg-bg2 px-4 py-3 text-left hover:bg-bg3 transition-colors"
          >
            <span className="text-xl flex-shrink-0 leading-6" aria-hidden>{c.emoji}</span>
            <div className="min-w-0 flex-1">
              <div className="num text-[0.96rem] font-semibold text-ink">{c.big}</div>
              <div className="text-[0.78rem] text-ink-mid leading-snug mt-0.5">{c.line}</div>
            </div>
            {c.learnId
              ? <BookOpen size={14} className="text-coral shrink-0 mt-1" />
              : <ArrowRight size={14} className="text-coral shrink-0 mt-1" />}
          </button>
        ))}
      </div>
    </div>
  );
}
