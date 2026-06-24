// Custom SVG pulse gauge — the centerpiece of the Dashboard.
// Recharts has gauges via RadialBarChart, but our brand asset is the
// hand-crafted conic-gradient ring. Keeping it custom for fidelity.

import { useEffect, useState } from 'react';
import type { PulseScore } from '../../lib/calculations';
import { pulseStatus } from '../../lib/calculations';

interface Props { score: PulseScore; }

export default function PulseGauge({ score }: Props) {
  const status = pulseStatus(score.total);
  const [animated, setAnimated] = useState(0);
  const target = score.total ?? 0;        // null renders as an empty ring
  const reduce = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (reduce) { setAnimated(target); return; }
    const t = setTimeout(() => setAnimated(target), 80);
    return () => clearTimeout(t);
  }, [target, reduce]);

  const deg = Math.round(animated / 100 * 360);
  const ringStyle: React.CSSProperties = {
    background: `conic-gradient(${status.cssVar} ${deg}deg, hsl(var(--bg3)) ${deg}deg)`,
    transition: reduce ? 'none' : 'background 0.9s ease',
  };

  return (
    <div className="bg-bg2 border border-line rounded-md p-4 shadow-1 relative overflow-hidden text-center">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-coral" />
      <div className="font-mono text-[0.5rem] tracking-[0.2em] uppercase text-terra mb-3.5">
        Family Pulse Score™
      </div>
      <div className="flex justify-center mb-3">
        <div
          className="w-[116px] h-[116px] rounded-full flex items-center justify-center relative"
          style={ringStyle}
        >
          <div className="absolute inset-[11px] rounded-full bg-bg2" />
          <div className="relative z-10 flex flex-col items-center">
            <div
              className="display-italic text-[2.5rem] leading-none"
              style={{ color: status.cssVar }}
            >
              {score.total === null ? '—' : score.total}
            </div>
            <div className="font-mono text-[0.5rem] tracking-[0.14em] uppercase text-ink-dim mt-0.5">
              {status.label}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {([
          ['Budgets', score.components.budget, score.applicable.budget],
          ['Savings', score.components.savings, score.applicable.savings],
          ['Trend',   score.components.trend,  score.applicable.trend],
          ['Debt',    score.components.debt,   score.applicable.debt],
        ] as [string, number, boolean][]).map(([label, val, ok]) => {
          const color = !ok ? 'var(--ink-dim)' : val >= 70 ? 'var(--sage)' : val >= 45 ? 'var(--honey)' : 'var(--terra)';
          return (
            <div key={label} className="flex justify-between items-center">
              <span className="font-mono text-[0.57rem] text-ink-mid tracking-wider">{label}</span>
              <span className="font-mono text-[0.62rem] font-medium" style={{ color: `hsl(${color})` }}>
                {ok ? val : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
