import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight } from 'lucide-react';
import { useStore } from '../store';
import { Panel } from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import { evaluateRecommendations, type Severity, type Domain } from '../lib/plannerRules';

// Board D M5 — severity group headers carry a glyph, a label and a count.
const SEVERITY_GLYPH: Record<Severity, string> = {
  critical: '▲', watch: '⚠', info: 'ⓘ',
};
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical', watch: 'Watch', info: 'Info',
};
const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'text-terra',
  watch:    'text-honey',
  info:     'text-denim',
};
const SEVERITY_SPINE: Record<Severity, string> = {
  critical: 'hsl(var(--terra))', watch: 'hsl(var(--honey))', info: 'hsl(var(--denim))',
};
const DOMAIN_ICON: Record<Domain, string> = {
  income: '💰', expenses: '💸', investments: '📈', debt: '⬇️', tax: '📋',
};
const DOMAIN_LABEL: Record<Domain, string> = {
  income: 'Income', expenses: 'Expenses', investments: 'Investments', debt: 'Debt', tax: 'Tax',
};

interface PlannerProps {
  onNavigate?: () => void;
}

export default function Planner({ onNavigate }: PlannerProps = {}) {
  const navigate = useNavigate();
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
      baseCurrency: profile.baseCurrency, rates,
      householdType: profile.household,   // #8 — advice adapts to household type
    }, 8),
    [txns, budgets, goals, debts, assets, profile.baseCurrency, rates, profile.household]
  );

  // Board D M5 — recommendations group by SEVERITY (Critical · Watch · Info),
  // with the domain riding each card as a pill. (The by-domain grouping is kept
  // available in plannerRules for other callers.)
  const bySeverity = useMemo(() => ({
    critical: recs.filter(r => r.severity === 'critical'),
    watch:    recs.filter(r => r.severity === 'watch'),
    info:     recs.filter(r => r.severity === 'info'),
  }), [recs]);
  const nothingCritical = bySeverity.critical.length === 0;

  return (
    <div>
      <div className="flex justify-between items-start mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="display-italic text-4xl text-ink mb-1.5 flex items-center gap-2.5">
            <Sparkles className="text-coral" /> Planner
          </h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            Rules-based recommendations · No AI · Zero hallucination
          </p>
        </div>
      </div>

      {/* Board D M5 — the honesty banner is compact and denim-tinted: these are
          fixed rules, not a model. */}
      <div className="flex items-start gap-2.5 rounded-r2 px-3 py-2.5 mb-3.5"
        style={{ background: 'color-mix(in srgb, hsl(var(--denim)) 12%, transparent)' }}>
        <span className="text-[13px] leading-5 flex-shrink-0" aria-hidden>🔒</span>
        <p className="text-[11.5px] text-ink-mid leading-[1.4]">
          Recommendations follow fixed rules — <strong className="text-ink">no AI, no guessing.</strong> You decide what
          to act on. They're guidelines from your own data, not financial advice.
        </p>
      </div>

      {recs.length === 0 ? (
        <Panel>
          <EmptyState
            icon="✨"
            message="Nothing to flag — your finances look healthy. Add more data to get more recommendations."
          />
        </Panel>
      ) : (
        <div className="space-y-3.5">
          {(['critical', 'watch', 'info'] as Severity[]).filter(s => bySeverity[s].length > 0).map(sev => (
            <div key={sev}>
              <div className={`mono-label mb-2 px-0.5 ${SEVERITY_COLOR[sev]}`}>
                {SEVERITY_GLYPH[sev]} {SEVERITY_LABEL[sev]} · {bySeverity[sev].length}
              </div>
              <div className="flex flex-col gap-2.5">
                {bySeverity[sev].map(r => (
                  // Board D §.sev — neu severity-spined card; the domain rides as a pill.
                  <div key={r.id} className="relative overflow-hidden rounded-r2 py-3.5 px-4"
                    style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
                    <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full"
                      style={{ background: SEVERITY_SPINE[r.severity] }} aria-hidden />
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[14px] leading-none flex-shrink-0" aria-hidden>{DOMAIN_ICON[r.domain]}</span>
                      <span className="font-bold text-[13.5px] text-ink min-w-0">{r.title}</span>
                      <span className={`ml-auto flex-shrink-0 font-display font-semibold text-[9px] px-2 py-0.5 rounded-pill ${SEVERITY_COLOR[r.severity]}`}
                        style={{ background: `color-mix(in srgb, ${SEVERITY_SPINE[r.severity]} 16%, transparent)` }}>
                        {DOMAIN_LABEL[r.domain]}
                      </span>
                    </div>
                    <div className="text-[12px] text-ink-mid leading-[1.45]">{r.body}</div>
                    {r.action && (
                      <button
                        type="button"
                        onClick={() => { navigate(r.action!.route); onNavigate?.(); }}
                        className="inline-flex items-center gap-1 font-mono text-[0.66rem] tracking-wider uppercase text-coral hover:opacity-70 mt-2.5"
                      >
                        {r.action.label} <ArrowRight size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Board D M5 — when nothing's critical the tone stays warm, not empty. */}
          {nothingCritical && (
            <div className="text-center py-1">
              <span className="mono-label text-ink-dim">Nothing critical right now — you're steady 🌿</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
