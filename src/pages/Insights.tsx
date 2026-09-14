// Vyact — Insights (v10.29.0: one personal view; docs/INSIGHTS_ASK_REPORTS_UX.md).
//
// Two tabs:
//   • For You — the household's review-and-act view. The former Plan tab (rules
//     from lib/plannerRules.ts) and the For You feed (lib/insightsFeed.ts) are
//     merged by lib/personalInsights.ts into Your next steps / What changed /
//     Keep an eye on / Learn about this, deduplicated by issue and period. The
//     reel is an optional "Review highlights" action, not the way in.
//   • Learn   — the evergreen lesson library (What's New lives inside it).
// /planner and ?tab=plan land on For You.
//
// "Services compute, never fabricate": both engines read existing aggregates
// only — no new financial math, no writes, all on-device. No Pulse, Goals or Tax.
import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Sparkles, GraduationCap, Play, ArrowRight, BookOpen } from 'lucide-react';
import { useStore } from '../store';
import { useTranslation } from '../hooks';
import Button from '../components/ui/Button';
import EstimatedTag from '../components/ui/EstimatedTag';
import EvergreenLearn from '../components/insights/EvergreenLearn';
import ForYouReel from '../components/insights/ForYouReel';
import { buildPersonalInsights, type PersonalInsight } from '../lib/personalInsights';
import { allEvergreenCards, evergreenByTag } from '../lib/evergreen';

type Tab = 'for-you' | 'learn';

const TABS: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: 'for-you', label: 'For You', icon: Sparkles },
  { id: 'learn',   label: 'Learn',   icon: GraduationCap },
];

export default function Insights() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'learn' ? 'learn' : 'for-you';
  const [reelStart, setReelStart] = useState<number | null>(null);
  const [learnOpenId, setLearnOpenId] = useState<string | null>(null);
  const highlightsButton = useRef<HTMLButtonElement>(null);

  const transactions = useStore(s => s.transactions);
  const budgets = useStore(s => s.budgets);
  const accounts = useStore(s => s.accounts);
  const budgetAllocations = useStore(s => s.budgetAllocations);
  const recurring = useStore(s => s.recurringSchedules);
  const loading = useStore(s => s.loading);
  const debts = useStore(s => s.debts);
  const assets = useStore(s => s.assets);
  const profile = useStore(s => s.profile);
  const rates = useStore(s => s.rates);

  const review = useMemo(
    () => buildPersonalInsights({ transactions, budgets, goals: [], accounts, budgetAllocations, recurring, debts, assets, baseCurrency: profile.baseCurrency, rates, householdType: profile.household }),
    [transactions, budgets, accounts, budgetAllocations, recurring, debts, assets, profile.baseCurrency, profile.household, rates],
  );

  function setTab(next: Tab) {
    const updated = new URLSearchParams(params);
    updated.set('tab', next);
    setParams(updated, { replace: true });
  }

  function openLearn(id: string) {
    setReelStart(null);
    setLearnOpenId(id);
    setTab('learn');
  }

  function closeHighlights() {
    setReelStart(null);
    highlightsButton.current?.focus();
  }

  const relatedLessons = [...new Set(review.items.flatMap(item => item.learnId ? [item.learnId] : []))]
    .map(id => allEvergreenCards().find(lesson => lesson.id === id)).filter(lesson => lesson && !/tax/i.test(lesson.category));
  if (!relatedLessons.length && review.hasActivity) {
    const lesson = evergreenByTag(review.items.some(item => item.issue.startsWith('debt')) ? ['debt', 'payoff'] : ['budgeting', 'saving']);
    if (lesson && !/tax/i.test(lesson.category)) relatedLessons.push(lesson);
  }

  return (
    <div className="ui-pilot max-w-4xl mx-auto min-w-0" data-testid="insights-review">
      <div className="mb-group">
        <h1 className="display-italic text-4xl text-ink mb-1.5">{t('insights') || 'Insights'}</h1>
      </div>

      <div role="tablist" aria-label="Insights views" className="flex gap-1 p-1 mb-section rounded-lg max-w-sm" style={{ background: 'var(--sunken)' }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button" role="tab" id={`insights-tab-${id}`} aria-controls={`insights-panel-${id}`}
            onClick={() => setTab(id)}
            aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 'for-you' : event.key === 'End' ? 'learn' : tab === 'learn' ? 'for-you' : 'learn';
              setTab(next);
              document.getElementById(`insights-tab-${next}`)?.focus();
            }}
            className="flex-1 flex items-center justify-center gap-2 h-11 px-3 rounded-md text-sm font-medium"
            style={tab === id
              ? { background: 'var(--canvas)', color: 'hsl(var(--ink))' }
              : { background: 'transparent', color: 'var(--ff-ink-3)' }}
          >
            <Icon size={16} aria-hidden /> {label}
          </button>
        ))}
      </div>

      {tab === 'for-you' && (
        <div role="tabpanel" id="insights-panel-for-you" aria-labelledby="insights-tab-for-you" className="space-y-section">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm text-ink-dim">As of {review.asOf} · Month to date unless stated</p>
            {review.highlights.length > 0 && !loading && <button ref={highlightsButton} type="button" className="btn-ghost inline-flex items-center gap-2 min-h-[44px]" onClick={() => setReelStart(0)}>
              <Play size={16} aria-hidden /> Review highlights
            </button>}
          </div>
          {loading ? <p role="status" className="text-ink-mid">Loading your review…</p> : !review.hasActivity ? (
            <section className="py-8 border-y border-line">
              <h2 className="text-xl font-display font-medium text-ink mb-3">Not enough recorded activity yet</h2>
              <p className="text-sm text-ink-mid mb-4">Record income and expenses to see changes and useful next steps for your household.</p>
              <Link to="/transactions" className="inline-flex items-center gap-2 text-coral min-h-[44px]">Open Transactions <ArrowRight size={16} aria-hidden /></Link>
            </section>
          ) : <>
            <ReviewSection title="Your next steps" items={review.nextSteps} onLearn={openLearn} />
            <ReviewSection title="What changed" items={review.changes} onLearn={openLearn} />
            <ReviewSection title="Keep an eye on" items={review.watch} onLearn={openLearn} />
            <section aria-labelledby="insights-related">
              <h2 id="insights-related" className="font-display text-xl font-medium text-ink mb-4">Learn about this</h2>
              {relatedLessons.map(lesson => lesson && <button key={lesson.id} type="button" onClick={() => openLearn(lesson.id)} className="w-full flex items-center gap-3 text-left text-sm text-ink py-3 border-b border-line min-h-[44px]">
                <BookOpen size={18} className="shrink-0 text-coral" aria-hidden /><span className="flex-1 min-w-0 break-words">{lesson.title}</span><ArrowRight size={16} className="shrink-0" aria-hidden />
              </button>)}
              <Button variant="ghost" className="mt-3" onClick={() => setTab('learn')}>Browse lessons <ArrowRight size={16} aria-hidden /></Button>
            </section>
          </>}
        </div>
      )}
      {tab === 'learn' && <div role="tabpanel" id="insights-panel-learn" aria-labelledby="insights-tab-learn"><EvergreenLearn openId={learnOpenId} onConsumedOpen={() => setLearnOpenId(null)} /></div>}

      {reelStart !== null && review.highlights.length > 0 && (
        <ForYouReel cards={review.highlights} startIndex={reelStart} onClose={closeHighlights} onOpenLearn={openLearn} />
      )}
    </div>
  );
}

function ReviewSection({ title, items, onLearn }: { title: string; items: PersonalInsight[]; onLearn: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <section aria-label={title}>
      <h2 className="font-display text-xl font-medium text-ink mb-4">{title}</h2>
      <div className="space-y-3">
        {items.map(item => <article key={item.id} data-insight-id={item.id} className="rounded-lg border border-line p-4 sm:p-5 min-w-0" style={{ background: 'var(--canvas)' }}>
          <div className="flex items-center gap-2 flex-wrap text-xs text-ink-dim mb-2">
            <span aria-hidden>{item.emoji}</span><span>{item.period}</span>
            {item.severity && <span className={item.severity === 'critical' ? 'text-terra' : 'text-ink-dim'}>{item.severity === 'critical' ? 'Priority' : item.severity === 'watch' ? 'Review' : 'Consider'}</span>}
            {item.estimated && <EstimatedTag confidence="estimated" title="Projection or unconfirmed inputs. Review the calculation basis." />}
          </div>
          <h3 className="text-base font-medium text-ink mb-2 [overflow-wrap:anywhere]">{item.title}</h3>
          <p className="text-sm text-ink-mid leading-relaxed">{item.body}</p>
          {item.evidence.map(text => <p key={text} className="text-sm text-ink-mid leading-relaxed mt-3">{text}</p>)}
          <details className="mt-3 text-xs text-ink-dim">
            <summary className="cursor-pointer min-h-[44px] flex items-center">Calculation basis</summary>
            <ul className="list-disc pl-4 space-y-2 leading-relaxed">{item.basis.map(basis => <li key={basis}>{basis}</li>)}</ul>
          </details>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {item.action && <Link to={item.action.route} className="inline-flex items-center gap-2 text-sm text-coral min-h-[44px]">{item.action.label}<ArrowRight size={16} aria-hidden /></Link>}
            {item.learnId && <button type="button" onClick={() => onLearn(item.learnId!)} className="inline-flex items-center gap-2 text-sm text-coral min-h-[44px]"><BookOpen size={16} aria-hidden /> Related lesson</button>}
          </div>
        </article>)}
      </div>
    </section>
  );
}
