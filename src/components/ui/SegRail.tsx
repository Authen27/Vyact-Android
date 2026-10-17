import { useRef, type ReactNode, type KeyboardEvent } from 'react';

// Aurora 4.0 X5 — the ONE segmented switch for views and filters: a sunken track, and the
// active option gets the accent tint and inset. It replaced four look-alikes (the neu rail on
// Transactions, Reports, Debts and the bill calendar, and the flat Insights switch). Forms
// keep `SegmentedControl` (radio semantics) — it shares this look through `.ui-segments`.
// Tabs keep their role and accessible name, so e2e can still select them by role and label.

export interface SegRailOption<Value extends string> {
  value: Value;
  label: ReactNode;
  /** DOM id for the tab — needed when it controls a tabpanel (`controls`). */
  id?: string;
  /** Id of the tabpanel this tab shows. */
  controls?: string;
}

interface Props<Value extends string> {
  /** Accessible name of the tablist (e.g. "Transaction type"). */
  label: string;
  value: Value;
  options: SegRailOption<Value>[];
  onChange: (value: Value) => void;
  /** Stretch the options to fill the row (phones). */
  fill?: boolean;
  className?: string;
}

export default function SegRail<Value extends string>({ label, value, options, onChange, fill, className = '' }: Props<Value>) {
  const ref = useRef<HTMLDivElement>(null);

  // Roving focus: Left/Right step through the options, Home/End jump to the ends.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const at = options.findIndex(o => o.value === value);
    const last = options.length - 1;
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : event.key === 'ArrowRight' ? (at >= last ? 0 : at + 1)
      : (at <= 0 ? last : at - 1);
    onChange(options[next].value);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div ref={ref} role="tablist" aria-label={label} className={`seg-rail ${fill ? 'flex w-full' : ''} ${className}`}>
      {options.map(option => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            id={option.id}
            aria-controls={option.controls}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={onKeyDown}
            className={`seg-option ${fill ? 'flex-1' : ''}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
