// Vyact — Insights (v10.29.0: one personal view; docs/INSIGHTS_ASK_REPORTS_UX.md).
//
// Two tabs:
//   • For You — the household's review-and-act view. The former Plan tab (rules
//     from lib/plannerRules.ts) and the For You feed (lib/insightsFeed.ts) are
//     merged by lib/personalInsights.ts into Your next steps / What changed /
//     Keep an eye on / Learn about this, deduplicated by issue and period. The
//     reel is an optional "Review highlights" action, not the way in.
//   • Learn   — the evergreen lesson library: search, filters, lessons. (v10.52.0:
//               the Lessons / Updates segment and the Updates feed were removed.)
// /planner and ?tab=plan land on For You.
//
// "Services compute, never fabricate": both engines read existing aggregates
// only — no new financial math, no writes, all on-device. No Pulse, Goals or Tax.
import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Sparkles, GraduationCap, Play, ArrowRight, BookOpen } from 'lucide-react';
import { useStore } from '../store';
import { useTranslation } from '../hooks';
import { Panel } from '../components/ui/Card';
import EstimatedTag from '../components/ui/EstimatedTag';
import EvergreenLearn from '../components/insights/EvergreenLearn';
import ForYouReel from '../components/insights/ForYouReel';
import { buildPersonalInsights, type PersonalInsight } from '../lib/personalInsights';
import { allEvergreenCards, evergreenByTag } from '../lib/evergreen';
import SegRail from '../components/ui/SegRail';
import PageHead from '../components/ui/PageHead';
import OverflowMenu from '../components/ui/OverflowMenu';

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

  // Aurora 4.0 LN1 — up to two lessons tied to this household's review, each with its reason.
  const suggested = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; reason: string }[] = [];
    for (const item of review.items) {
      if (!item.learnId || seen.has(item.learnId)) continue;
      const lesson = allEvergreenCards().find(l => l.id === item.learnId);
      if (!lesson || /tax/i.test(lesson.category)) continue;
      seen.add(item.learnId);
      out.push({ id: item.learnId, reason: `Because of “${item.title}”` });
      if (out.length === 2) break;
    }
    // Nothing in the review names a lesson: the same fallback "Learn about this" uses, with its reason.
    if (out.length < 2 && review.hasActivity) {
      const debt = review.items.some(item => item.issue.startsWith('debt'));
      const lesson = evergreenByTag(debt ? ['debt', 'payoff'] : ['budgeting', 'saving']);
      if (lesson && !seen.has(lesson.id) && !/tax/i.test(lesson.category)) {
        out.push({ id: lesson.id, reason: debt ? 'Because your review includes a loan' : 'A good next step for your monthly plan' });
      }
    }
    return out;
  }, [review.items, review.hasActivity]);

  // v10.52.0 — same page frame as Net Worth and Reports: full content width (the
  // shell caps it at 1320px), title + mono subtitle on the left, controls on the
  // right, content in Panels on a 2-column grid from lg. It used to be a single
  // max-w-4xl column of large cards, visibly narrower than its Analyze peers.
  const hasReview = !loading && review.hasActivity;
  return (
    <div className="ui-pilot min-w-0" data-testid="insights-review">
      {/* Same subtitle on both tabs, so the header keeps one height and the toolbar slot below
          it never moves between tabs. The tabs stay on phones (aside). */}
      <PageHead
        title={t('insights') || 'Insights'}
        subtitle="Your review · money lessons"
        aside={(
          // Aurora 4.0 X5 — the shared SegRail (it had no inset and no accent of its own).
          <SegRail<Tab>
            label="Insights views"
            value={tab}
            onChange={setTab}
            fill
            className="sm:w-auto"
            options={TABS.map(({ id, label, icon: Icon }) => ({
              value: id,
              id: `insights-tab-${id}`,
              controls: `insights-panel-${id}`,
              label: <><Icon size={14} aria-hidden /> {label}</>,
            }))}
          />
        )}
      />

      {tab === 'for-you' && (
        <div role="tabpanel" id="insights-panel-for-you" aria-labelledby="insights-tab-for-you" className="space-y-3.5 min-w-0">
          {/* v10.52.0 (owner) — the toolbar slot under the header, the same place
              Learn shows its search and filters: a quick play button for the
              highlights reel. */}
          <div data-testid="insights-toolbar" className="flex items-center justify-between gap-3 flex-wrap min-h-[44px]">
            {review.highlights.length > 0 && !loading ? (
              <button ref={highlightsButton} type="button" onClick={() => setReelStart(0)} aria-label="Play highlights"
                className="inline-flex items-center gap-2.5 min-h-[44px] pl-1.5 pr-4 rounded-pill border border-line text-sm font-medium text-ink hover:border-coral">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
                  <Play size={14} aria-hidden className="ml-0.5" fill="currentColor" />
                </span>
                Play highlights
                <span className="text-xs font-normal text-ink-dim">{review.highlights.length}</span>
              </button>
            ) : <span />}
            <p className="text-xs text-ink-dim">As of {review.asOf} · month to date unless stated</p>
          </div>
          {loading ? <Panel><p role="status" className="px-4 py-5 text-sm text-ink-mid">Loading your review…</p></Panel> : !review.hasActivity ? (
            <Panel>
              <section className="px-4 py-5">
                <h2 className="text-lg font-display font-medium text-ink mb-1.5">Not enough recorded activity yet</h2>
                <p className="text-sm text-ink-mid mb-2">Record income and expenses to see changes and useful next steps for your household.</p>
                <Link to="/transactions" className="inline-flex items-center gap-2 text-sm text-coral min-h-[44px]">Open Transactions <ArrowRight size={15} aria-hidden /></Link>
              </section>
            </Panel>
          ) : null}
          {hasReview && <>
            <ReviewPanel title="Your next steps" items={review.nextSteps} onLearn={openLearn} columns />
            {/* Side by side only when both have items; a lone panel takes the full width. */}
            <div className={`grid grid-cols-1 ${review.changes.length && review.watch.length ? 'lg:grid-cols-2' : ''} gap-3.5 items-start min-w-0`}>
              <ReviewPanel title="What changed" items={review.changes} onLearn={openLearn} columns={!review.watch.length} />
              <ReviewPanel title="Keep an eye on" items={review.watch} onLearn={openLearn} columns={!review.changes.length} />
            </div>
            <section aria-labelledby="insights-related" className="panel overflow-hidden min-w-0">
              <div className="flex justify-between items-center px-4 py-3 border-b border-line gap-3 flex-wrap">
                <h2 id="insights-related" className="ui-label text-ink">Learn about this</h2>
                <button type="button" onClick={() => setTab('learn')} className="inline-flex items-center gap-1.5 text-[12.5px] text-coral min-h-[44px]">Browse lessons <ArrowRight size={13} aria-hidden /></button>
              </div>
              {relatedLessons.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2">
                  {relatedLessons.map(lesson => lesson && <button key={lesson.id} type="button" onClick={() => openLearn(lesson.id)} className="flex items-center gap-2.5 text-left text-sm text-ink px-4 py-2.5 border-b border-line min-h-[44px] hover:bg-bg3">
                    <BookOpen size={15} className="shrink-0 text-coral" aria-hidden /><span className="flex-1 min-w-0 break-words">{lesson.title}</span><ArrowRight size={14} className="shrink-0 text-ink-dim" aria-hidden />
                  </button>)}
                </div>
              )}
            </section>
          </>}
        </div>
      )}
      {tab === 'learn' && <div role="tabpanel" id="insights-panel-learn" aria-labelledby="insights-tab-learn"><EvergreenLearn openId={learnOpenId} onConsumedOpen={() => setLearnOpenId(null)} suggested={suggested} initialQuery={params.get('q') ?? undefined} /></div>}

      {reelStart !== null && review.highlights.length > 0 && (
        <ForYouReel cards={review.highlights} startIndex={reelStart} onClose={closeHighlights} onOpenLearn={openLearn} />
      )}
    </div>
  );
}

/** A review group as a Panel of compact rows (v10.52.0). `columns` lays the rows
 *  out two-up from lg; used for "Your next steps", which spans the page. */
function ReviewPanel({ title, items, onLearn, columns = false }: { title: string; items: PersonalInsight[]; onLearn: (id: string) => void; columns?: boolean }) {
  if (!items.length) return null;
  return (
    <section aria-label={title} className="panel overflow-hidden min-w-0">
      <div className="flex justify-between items-center px-4 py-3 border-b border-line gap-3">
        <h2 className="ui-label text-ink">{title}</h2>
        <span className="num text-[12px] text-ink-dim">{items.length}</span>
      </div>
      <div className={columns ? 'grid grid-cols-1 lg:grid-cols-2' : ''}>
        {items.map(item => <InsightRow key={item.id} item={item} onLearn={onLearn} />)}
      </div>
    </section>
  );
}

function InsightRow({ item, onLearn }: { item: PersonalInsight; onLearn: (id: string) => void }) {
  // Aurora 4.0 INS2 — one primary link: the action, or the lesson when there is none. The lesson (when
  // the action took the slot) and the calculation basis move into ⋯; the basis opens under the row.
  const [showBasis, setShowBasis] = useState(false);
  const lessonIsPrimary = !item.action && !!item.learnId;
  const more = [
    ...(item.learnId && !lessonIsPrimary ? [{ label: 'Related lesson', icon: <BookOpen size={14} aria-hidden />, onSelect: () => onLearn(item.learnId!) }] : []),
    ...(item.basis.length ? [{ label: showBasis ? 'Hide calculation basis' : 'Calculation basis', onSelect: () => setShowBasis(v => !v) }] : []),
  ];
  return (
    <article data-insight-id={item.id} className="px-4 py-3 border-b border-line min-w-0">
      <div className="flex items-start gap-2.5 min-w-0">
        <span aria-hidden className="text-base leading-6 shrink-0">{item.emoji}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-ink leading-snug [overflow-wrap:anywhere]">{item.title}</h3>
          <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-[12px] text-ink-dim mt-0.5">
            <span>{item.period}</span>
            {item.severity && <span className={item.severity === 'critical' ? 'text-terra font-medium' : 'text-ink-dim'}>· {item.severity === 'critical' ? 'Priority' : item.severity === 'watch' ? 'Review' : 'Consider'}</span>}
            {item.estimated && <EstimatedTag confidence="estimated" title="Projection or unconfirmed inputs. Review the calculation basis." />}
          </div>
          <p className="text-[0.82rem] text-ink-mid leading-relaxed mt-1.5">{item.body}</p>
          {item.evidence.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[0.78rem] text-ink-mid leading-relaxed">
              {item.evidence.map(text => <li key={text}>{text}</li>)}
            </ul>
          )}
          <div className="flex items-center justify-between gap-3 mt-1">
            {item.action
              ? <Link to={item.action.route} className="inline-flex items-center gap-1.5 text-[0.8rem] font-medium text-coral min-h-[44px]">{item.action.label}<ArrowRight size={14} aria-hidden /></Link>
              : lessonIsPrimary
                ? <button type="button" onClick={() => onLearn(item.learnId!)} className="inline-flex items-center gap-1.5 text-[0.8rem] font-medium text-coral min-h-[44px]"><BookOpen size={14} aria-hidden /> Read the lesson</button>
                : <span />}
            {more.length > 0 && <OverflowMenu ariaLabel={`More for ${item.title}`} items={more} />}
          </div>
          {showBasis && (
            <div className="well px-3 py-2 mt-1 text-[12px] text-ink-mid" data-testid="insight-basis">
              <div className="ui-label mb-1">Calculation basis</div>
              <ul className="list-disc pl-4 space-y-1 leading-relaxed">{item.basis.map(basis => <li key={basis}>{basis}</li>)}</ul>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
