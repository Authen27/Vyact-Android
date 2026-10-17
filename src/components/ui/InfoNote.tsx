import { useId, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';

// Aurora 4.0 X11 — one line, details on demand. A method note keeps its first line on screen and
// puts the rest behind an (i) toggle (44px target), instead of printing paragraphs of method notes
// before and between charts.
export default function InfoNote({ line, children, label = 'How this is worked out', className = '' }: {
  line: ReactNode;
  children: ReactNode;
  /** Accessible name of the (i) toggle. */
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={`text-xs text-ink-dim ${className}`}>
      <div className="flex items-center gap-1">
        <p className="min-w-0 leading-relaxed">{line}</p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          aria-label={label}
          title={label}
          onClick={() => setOpen(o => !o)}
          className="min-w-[44px] min-h-[44px] -my-3 flex items-center justify-center rounded-full text-ink-dim hover:text-coral transition-colors flex-shrink-0"
        >
          <Info size={15} aria-hidden />
        </button>
      </div>
      {open && <div id={id} className="leading-relaxed text-ink-mid mt-1 space-y-1">{children}</div>}
    </div>
  );
}
