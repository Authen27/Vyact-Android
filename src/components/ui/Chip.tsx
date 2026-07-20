// Aurora chip primitives (v10.1) — the neumorphic pills that replace <Select>
// dropdowns across every add/edit form (forms doctrine). `on` = selected
// (neu-inset + accent). Two shapes: a standard horizontal pill and a tall
// emoji category tile.
import type { ReactNode } from 'react';

interface ChipProps {
  on?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  /** Stable hook for e2e (renders data-testid). */
  testId?: string;
}

const base =
  'inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-pill font-display font-semibold ' +
  'text-[12.5px] whitespace-nowrap cursor-pointer transition-[box-shadow,color,transform] ' +
  'duration-150 select-none border-none';

export default function Chip({ on, onClick, children, className = '', ariaLabel, testId }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={ariaLabel}
      data-testid={testId}
      className={`${base} ${className}`}
      style={on
        ? { boxShadow: 'var(--neu-inset)', color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 10%, var(--canvas))' }
        : { boxShadow: 'var(--neu-sm)', color: 'var(--ff-ink-3)', background: 'var(--canvas)' }}
    >
      {children}
    </button>
  );
}

/** Tall emoji category tile (category picker). */
export function CategoryChip({ emoji, label, on, onClick, testId }: { emoji: string; label: string; on?: boolean; onClick?: () => void; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      data-testid={testId}
      className="flex flex-col items-center gap-1 w-[76px] flex-shrink-0 py-2 px-1 rounded-r3 border-none cursor-pointer transition-[box-shadow,color] duration-150 font-medium text-[10.5px]"
      style={on
        ? { boxShadow: 'var(--neu-inset)', color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 10%, var(--canvas))' }
        : { boxShadow: 'var(--neu-sm)', color: 'var(--ff-ink-3)', background: 'var(--canvas)' }}
    >
      <span className="text-[19px] leading-none">{emoji}</span>
      <span className="truncate max-w-full">{label}</span>
    </button>
  );
}

/** A labelled horizontal group of single-select chips. */
export function ChipGroup<T extends string>({ label, value, options, onChange }: {
  label?: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      {label && <div className="mono-label mb-1.5">{label}</div>}
      <div className="flex gap-1.5 flex-wrap">
        {options.map(o => (
          <Chip key={o.value} on={o.value === value} onClick={() => onChange(o.value)}>{o.label}</Chip>
        ))}
      </div>
    </div>
  );
}
