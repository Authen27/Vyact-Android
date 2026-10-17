import { type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { useRegisterPageAction, type PageAction } from '../layout/pageAction';

// Aurora 4.0 — one page header for every app page (PH1 B′, X3, X4).
//  · Desktop: the title (and a sentence-case subtitle) on the left, the page's own add button on
//    the right, centred on the title rather than floating at its top edge.
//  · Phones (< 640px): the title and subtitle are visually hidden — the mobile header already names
//    the page — but stay in the accessibility tree as the page's h1. The add button is not shown
//    here: the page's action becomes the small outlined + in the mobile header (MobileHeader).
//    Controls a page needs on phones (tabs, a date range, Pip's toolbar) go in `aside`, which stays;
//    without one the whole header takes no space on phones.
// It replaced 14 hand-rolled header blocks.
interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  /** The page's own add action ("+ Add Loan"). Registered with the shell for the header +. */
  action?: PageAction & { icon?: boolean };
  /** Controls that stay visible on every width (tabs, filters, a "View only" note). */
  aside?: ReactNode;
  /** No bottom margin (the page spaces its own sections, e.g. the Dashboard stack). */
  flush?: boolean;
}

export default function PageHead({ title, subtitle, action, aside, flush }: Props) {
  // Always registered: the floating + uses it to leave this page's entity out of its menu even where
  // the header + is off (`headerPlus: false` — the tab bar's + already adds a transaction).
  useRegisterPageAction(action);
  const hasAside = aside != null && aside !== false;
  const margin = flush ? '' : 'mb-5 lg:mb-6';
  return (
    <div
      data-testid="page-head"
      className={`flex justify-between items-center gap-4 flex-wrap ${margin} ${hasAside ? 'max-sm:justify-end' : 'max-sm:sr-only'}`}
    >
      <div className={`min-w-0 ${hasAside ? 'max-sm:sr-only' : ''}`}>
        <h1 className="display-italic text-4xl text-ink">{title}</h1>
        {subtitle && <p className="ui-label mt-1.5">{subtitle}</p>}
      </div>
      {(hasAside || action) && (
        <div className="flex items-center gap-2 flex-wrap max-sm:w-full max-sm:justify-end">
          {aside}
          {action && (
            <button type="button" className="btn-primary flex-shrink-0 max-sm:hidden" onClick={action.onClick}>
              {action.icon && <Plus size={16} aria-hidden />}{action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
