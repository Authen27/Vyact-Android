import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';

// Aurora 4.0 EM1 — empty states that explain. An icon tile, a short heading, one sentence on what
// will appear here, one primary action, and a Pip hint where it helps. Same component on every list
// page. It replaced a faint ◇, a mono caps line ("NO TRANSACTIONS YET") and a ghost button.
//  · `compact` is the in-panel form (Dashboard panels, sub-lists): no tile, the action as a link.
export interface EmptyAction {
  label: string;
  onClick?: () => void;
  to?: string;
}

interface Props {
  icon?: ReactNode;
  /** Short heading, e.g. "No entries yet". */
  title?: string;
  /** One sentence on what will appear here. */
  message: string;
  /** The one thing to do next — a button (or a link with `to`), or a custom node. */
  action?: EmptyAction | ReactNode;
  /** A quiet line under the action, e.g. or tell Pip: "spent 450 on auto". */
  hint?: ReactNode;
  compact?: boolean;
  className?: string;
}

const isAction = (a: unknown): a is EmptyAction =>
  !!a && typeof a === 'object' && 'label' in (a as Record<string, unknown>) && typeof (a as EmptyAction).label === 'string';

export default function EmptyState({ icon = '✦', title, message, action, hint, compact, className = '' }: Props) {
  const actionNode = isAction(action)
    ? action.to
      ? <Link to={action.to} className={compact ? 'empty-link' : 'btn-primary'}>{action.label}</Link>
      : <button type="button" onClick={action.onClick} className={compact ? 'empty-link' : 'btn-primary'}>{action.label}</button>
    : action;

  if (compact) {
    return (
      <div data-testid="empty-state" className={`text-center px-4 py-6 ${className}`}>
        {title && <div className="font-display font-medium text-[15px] text-ink mb-1">{title}</div>}
        <p className="text-[13.5px] text-ink-mid leading-relaxed">{message}</p>
        {actionNode && <div className="mt-1">{actionNode}</div>}
        {hint && <p className="text-[12.5px] text-ink-dim mt-1">{hint}</p>}
      </div>
    );
  }

  return (
    <div data-testid="empty-state" className={`flex flex-col items-center text-center gap-2.5 px-5 py-10 ${className}`}>
      <span aria-hidden className="well w-[52px] h-[52px] !rounded-r3 flex items-center justify-center text-[22px] text-ink-mid">{icon}</span>
      {title && <div className="font-display font-medium text-[18px] text-ink">{title}</div>}
      <p className="text-[13.5px] text-ink-mid leading-relaxed max-w-[300px]">{message}</p>
      {actionNode && <div className="mt-1">{actionNode}</div>}
      {hint && <p className="text-[12.5px] text-ink-dim">{hint}</p>}
    </div>
  );
}
