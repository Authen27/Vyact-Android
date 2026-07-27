// Board C · Budgets hero — cumulative-spend-vs-limit pace chart.
// A filled coral area traces cumulative spend day-by-day; a dashed line marks
// the limit; the today dot sits at the current cumulative; a dotted run-rate
// projection continues to month-end so you can see where you'll land. All the
// money comes in pre-computed (base currency) from `cumulativeSpendSeries` in
// the pure calc layer — this component only does SVG geometry.
import { fmtShort } from '../../lib/format';

interface Props {
  /** Cumulative spend at the end of each elapsed day (day 1 … today). */
  series: { date: string; cumulative: number }[];
  limit: number;
  daysInMonth: number;
  currency: string;
}

const W = 320, H = 84, PAD_X = 8, TOP_Y = 14, BASE_Y = 76;

export default function BudgetPaceChart({ series, limit, daysInMonth, currency }: Props) {
  const dayNum = series.length;                       // elapsed days incl. today
  const lastCum = dayNum ? series[dayNum - 1].cumulative : 0;
  // Linear run-rate projection to month-end.
  const projectedEnd = dayNum ? (lastCum / dayNum) * daysInMonth : 0;
  const scaleMax = Math.max(limit, lastCum, projectedEnd) || 1;

  const spanX = daysInMonth > 1 ? daysInMonth - 1 : 1;
  const xFor = (i: number) => PAD_X + (i / spanX) * (W - 2 * PAD_X);
  const yFor = (v: number) => BASE_Y - (v / scaleMax) * (BASE_Y - TOP_Y);

  const limitY = yFor(limit);
  const pts = series.map((p, i) => [xFor(i), yFor(p.cumulative)] as const);
  const todayX = pts.length ? pts[pts.length - 1][0] : PAD_X;
  const todayY = pts.length ? pts[pts.length - 1][1] : BASE_Y;

  const linePath = pts.length
    ? 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')
    : '';
  const fillPath = pts.length
    ? `${linePath} L${todayX.toFixed(1)} ${BASE_Y} L${pts[0][0].toFixed(1)} ${BASE_Y} Z`
    : '';
  const projX = xFor(daysInMonth - 1);
  const projY = yFor(projectedEnd);

  const under = limit - projectedEnd;               // >0 = lands under budget

  return (
    <div className="relative -mx-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-16" preserveAspectRatio="none" role="img"
        aria-label={`Cumulative spend ${fmtShort(lastCum, currency)} of ${fmtShort(limit, currency)}; projected to land ${fmtShort(Math.abs(under), currency)} ${under >= 0 ? 'under' : 'over'} budget`}>
        <defs>
          <linearGradient id="budget-pace-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--coral))" stopOpacity="0.22" />
            <stop offset="100%" stopColor="hsl(var(--coral))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* dashed limit line */}
        <line x1={PAD_X} y1={limitY} x2={W - PAD_X} y2={limitY}
          stroke="hsl(var(--terra))" strokeWidth="1" strokeDasharray="4 4" opacity="0.55" />
        {fillPath && <path d={fillPath} fill="url(#budget-pace-fill)" />}
        {linePath && <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        {/* dotted run-rate projection to month-end */}
        {dayNum > 0 && dayNum < daysInMonth && (
          <path d={`M${todayX.toFixed(1)} ${todayY.toFixed(1)} L${projX.toFixed(1)} ${projY.toFixed(1)}`}
            fill="none" stroke="hsl(var(--ink-dim))" strokeWidth="1.5" strokeDasharray="2 5" strokeLinecap="round" />
        )}
        {dayNum > 0 && (
          <circle cx={todayX} cy={todayY} r="4" fill="var(--accent)" stroke="var(--canvas)" strokeWidth="2" />
        )}
      </svg>
      <span className="absolute top-0 right-0.5 font-mono text-[7.5px] tracking-wide uppercase text-terra">
        limit {fmtShort(limit, currency)}
      </span>
    </div>
  );
}
