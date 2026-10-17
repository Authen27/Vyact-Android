import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

// Aurora 4.0 S2 / DB2 — the ⋯ More menu for a card's rarer actions, so each card keeps one primary
// action (and its common secondary) in view instead of a row of buttons that wraps on phones. A
// `menu` of `menuitem` buttons; Escape and a tap outside close it, and focus returns to the trigger.
//
// The menu is drawn in a portal at a fixed position next to its trigger, flipping above it when there
// is no room below. Inside a card with `overflow-hidden` (the Debts loan card), an absolutely placed
// menu was clipped by the card and could not be reached (reported 16 Oct 2026).
export interface OverflowItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}

const ITEM_H = 44;
const PAD = 12;      // the menu's padding + border
const GAP = 6;       // between trigger and menu
const EDGE = 8;      // from the viewport edge

export default function OverflowMenu({ items, label = 'More', ariaLabel, align = 'right' }: {
  items: OverflowItem[];
  label?: string;
  /** Accessible name of the trigger when the visible label is not enough ("More actions for Car loan"). */
  ariaLabel?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const shown = items.filter(Boolean);

  // Place the menu against the trigger: below it, or above it when the viewport has no room below
  // (the bottom tab bar and the floating + sit there on phones).
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const height = shown.length * ITEM_H + PAD;
    const below = window.innerHeight - r.bottom;
    const flip = below < height + GAP + 96 && r.top > height + GAP;
    const top = flip ? r.top - GAP - height : r.bottom + GAP;
    setPos(align === 'right'
      ? { top, right: Math.max(EDGE, window.innerWidth - r.right) }
      : { top, left: Math.max(EDGE, r.left) });
  }, [open, align, shown.length]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    // A fixed menu would drift from its trigger on scroll or resize; close it instead.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  // Focus the first item when the menu opens, so it is usable from the keyboard.
  useEffect(() => {
    if (open && pos) menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [open, pos]);

  if (!shown.length) return null;

  return (
    <div className="relative inline-flex">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        onClick={() => { setPos(null); setOpen(o => !o); }}
        className="btn-ghost !min-h-[40px] !px-3 inline-flex items-center gap-1.5"
      >
        <MoreHorizontal size={15} aria-hidden /> {label}
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div ref={menu} id={id} role="menu" aria-label={ariaLabel ?? label} data-testid="overflow-menu"
          className="glass-panel fixed z-[300] min-w-[190px] max-w-[calc(100vw-16px)] rounded-r2 p-1.5 flex flex-col"
          style={{ top: pos.top, left: pos.left, right: pos.right }}
          onKeyDown={e => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const all = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
            const at = all.indexOf(document.activeElement as HTMLButtonElement);
            all[(at + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus({ preventScroll: true });
          }}>
          {shown.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onSelect(); }}
              className="flex items-center gap-2.5 min-h-[44px] px-3 rounded-r2 text-left text-[14px] hover:bg-bg3 focus:bg-bg3 outline-none disabled:opacity-40 disabled:cursor-not-allowed"
              style={item.danger ? { color: 'var(--crit-text)' } : { color: 'hsl(var(--ink))' }}
            >
              {item.icon && <span aria-hidden className="flex-shrink-0">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
