// Vyact v7.4.0 — Money
//
// Adaptive currency renderer that prevents very large or long values from
// breaking adjacent layout (KPI tiles, transaction rows, budget cards).
//
// Behaviour:
//   • By default renders the full value via fmt() with tabular-nums.
//   • If `compact` is requested or the rendered length exceeds `maxChars`,
//     falls back to fmtShort() honouring the user's number system
//     (western K/M/B/T or indian K/L/Cr).
//   • Always sets the `title` attribute to the precise value so hover
//     reveals full precision.
//   • v7.4.0: NEVER truncates with an ellipsis. Tight containers must
//     either widen or rely on the compact threshold; values like
//     "10,234,543.00" are not allowed to render as "10,234…".

import { fmt, fmtShort, getNumberSystem } from '../../lib/format';

interface Props {
  amount: number;
  currency?: string;
  /** Force compact (K/M/B or K/L/Cr) rendering regardless of length. */
  compact?: boolean;
  /** Switch to compact when the full string exceeds this many characters. */
  maxChars?: number;
  /** Additional Tailwind classes applied to the wrapping span. */
  className?: string;
  /** Forces a leading sign even for positive numbers (useful for deltas). */
  signed?: boolean;
}

export default function Money({ amount, currency = 'USD', compact, maxChars = 12, className = '', signed }: Props) {
  const n = Number(amount) || 0;
  const full = fmt(n, currency);
  const useShort = compact || full.length > maxChars;
  const sys = getNumberSystem();
  const shown = useShort ? fmtShort(n, currency, sys) : full;
  const sign = signed && n > 0 ? '+' : '';
  const display = (n < 0 ? '−' : sign) + shown.replace(/^-/, '');
  const titleSign = n < 0 ? '−' : sign;
  const title = `${titleSign}${full.replace(/^-/, '')}`;
  return (
    <span
      className={`num inline-block whitespace-nowrap ${className}`}
      title={title}
    >
      {display}
    </span>
  );
}
