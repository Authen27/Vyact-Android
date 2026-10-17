import type { ReactNode } from 'react';

// Aurora 4.0 R2 — the one 34px category tile: a raised tile tinted with the category's colour. Lists
// (transactions, the Dashboard's recent rows, recurring schedules) share it instead of each drawing
// their own (Recurring had a flat 36px square).
export default function CategoryTile({ icon, color, size = 34, className = '' }: {
  icon: ReactNode;
  /** The category's colour (any CSS colour); defaults to the info teal. */
  color?: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`rounded-r2 flex items-center justify-center flex-shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.47),
        background: `color-mix(in srgb, ${color || 'hsl(var(--denim))'} 15%, transparent)`,
        boxShadow: 'var(--neu-sm)',
      }}
    >
      {icon}
    </span>
  );
}
