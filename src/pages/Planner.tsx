import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useStore } from '../store';
import { Panel, Card } from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import { evaluateRecommendations, recsByDomain, type Severity, type Domain } from '../lib/plannerRules';

const SEVERITY_ICON: Record<Severity, typeof AlertTriangle> = {
  critical: AlertTriangle,
  watch: AlertCircle,
  info: Info,
};
const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'text-terra border-terra/40 bg-coral-tint',
  watch:    'text-honey border-honey/40 bg-honey/5',
  info:     'text-denim border-denim/40 bg-denim/5',
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

  const grouped = recsByDomain(recs);
  const critical = recs.filter(r => r.severity === 'critical').length;
  const watch    = recs.filter(r => r.severity === 'watch').length;
  const info     = recs.filter(r => r.severity === 'info').length;

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

      <div className="grid grid-cols-3 gap-2 mb-3.5">
        <Card label="Critical" accent="terra" value={<span className="text-terra">{critical}</span>} sub="Address now" />
        <Card label="Watch"    accent="honey" value={<span className="text-honey">{watch}</span>}    sub="Trending in wrong direction" />
        <Card label="Info"     accent="denim" value={<span className="text-denim">{info}</span>}     sub="Optimisations" />
      </div>

      <div className="bg-bg2 border border-line rounded-md p-4 mb-3.5">
        <div className="flex items-start gap-2.5">
          <Sparkles size={16} className="text-coral mt-0.5 flex-shrink-0" />
          <p className="text-[0.84rem] text-ink-mid leading-relaxed">
            <strong className="text-ink">These are guidelines based on your data, not financial advice.</strong> Every recommendation
            traces to a specific rule and a specific data point — no hallucination. Consult a qualified financial adviser
            for major decisions.
          </p>
        </div>
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
          {(Object.keys(grouped) as Domain[]).filter(d => grouped[d].length > 0).map(domain => (
            <Panel
              key={domain}
              title={`${DOMAIN_ICON[domain]} ${DOMAIN_LABEL[domain]}`}
              sub={`${grouped[domain].length} recommendation${grouped[domain].length === 1 ? '' : 's'}`}
            >
              {grouped[domain].map(r => {
                const Icon = SEVERITY_ICON[r.severity];
                return (
                  <div key={r.id} className={`px-4 py-3.5 border-b border-line last:border-b-0 border-l-4 ${SEVERITY_COLOR[r.severity]}`}>
                    <div className="flex items-start gap-3">
                      <Icon size={16} className="mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-ink mb-1">{r.title}</div>
                        <div className="text-[0.84rem] text-ink-mid leading-relaxed">{r.body}</div>
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
                    </div>
                  </div>
                );
              })}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
