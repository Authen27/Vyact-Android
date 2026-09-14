// Vyact v10.28.0 — the focused, full-screen form page.
//
// The entity forms (transaction, split, debt, budget, account, asset, and
// reconcile) render through this instead of HalfSheet. It takes the same props,
// so a form body did not have to change to move from a modal to a page:
//   · no Layout chrome — no top bar, sub-nav, tab bar or FAB (App.tsx renders
//     form routes outside <Layout>, as it does onboarding);
//   · a header with one Close control (≥44px) and the title as the page's h1;
//   · the form, in a centred column;
//   · the footer as a Save bar pinned to the bottom of the viewport.
//
// The page is a `main` landmark named by its title, so a screen reader lands on
// "Add Budget, main" and tests find it with getByRole('main', { name }).
// Escape still closes it, as the modal did, unless something layered over the
// form (the delete-account sheet, a popover) is open and owns that key.
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import HelpInfoButton from '../help/HelpInfoButton';

interface Props {
  /** Kept for drop-in parity with HalfSheet; a routed page is always open. */
  open?: boolean;
  onClose: () => void;
  title?: string;
  /** Accessible name when no visible title is rendered. */
  ariaLabel?: string;
  children: ReactNode;
  /** The action row, pinned to the bottom of the viewport. */
  footer?: ReactNode;
  /** Column width: 'md' for single-column forms, 'lg'/'xl' for two-column ones. */
  size?: 'md' | 'lg' | 'xl';
  className?: string;
  /** HELP_TOPICS id shown behind an info icon in the header — the same FAQ
   *  entry Help & Guide renders, so "how do I create a ___" never drifts
   *  between the two surfaces. */
  helpTopicId?: string;
}

// Whole class strings so Tailwind's scanner sees them.
const COLUMN: Record<NonNullable<Props['size']>, string> = {
  md: 'max-w-xl',
  lg: 'max-w-[840px]',
  xl: 'max-w-[900px]',
};

export default function FormPage({
  open = true, onClose, title, ariaLabel, children, footer, size = 'md', className = '', helpTopicId,
}: Props) {
  const titleId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  // Initial focus. A form that autofocuses its first field (amount, name) keeps
  // it; otherwise focus lands on the heading so the new page is announced.
  useEffect(() => {
    const root = rootRef.current;
    if (root && !root.contains(document.activeElement)) (headingRef.current ?? root).focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      // Window capture runs before a Radix sheet's own document-level Escape
      // handler, so an open sheet is still in the DOM here and keeps the key.
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="dialog"], [role="alertdialog"]')) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [aria-modal="true"]')) return;
      closeRef.current();
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  if (!open) return null;

  const column = `mx-auto w-full ${COLUMN[size]} px-5`;
  return (
    <main
      ref={rootRef}
      tabIndex={-1}
      aria-labelledby={title || ariaLabel ? titleId : undefined}
      data-form-page=""
      className={`${className} relative min-h-[100dvh] flex flex-col outline-none`}
      style={{ background: 'var(--canvas)' }}
    >
      <header className="sticky top-0 z-20 border-b border-line" style={{ background: 'var(--canvas)' }}>
        <div className={`${column} flex items-center gap-2 min-h-[60px] pt-[env(safe-area-inset-top)]`}>
          <button
            type="button"
            onClick={() => closeRef.current()}
            aria-label="Close"
            className="min-w-[44px] min-h-[44px] -ml-3 flex items-center justify-center text-ink-dim hover:text-ink transition-colors rounded-full"
          >
            <X size={20} />
          </button>
          <h1
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            className={title ? 'display-italic text-[1.4rem] leading-none text-ink outline-none min-w-0 truncate' : 'sr-only'}
          >
            {title ?? ariaLabel}
          </h1>
          {helpTopicId && <div className="ml-auto -mr-2"><HelpInfoButton topicId={helpTopicId} /></div>}
        </div>
      </header>

      <div className="flex-1">
        <div className={`${column} py-5`}>{children}</div>
      </div>

      {footer && (
        <div className="sticky bottom-0 z-20 border-t border-line" style={{ background: 'var(--canvas)' }}>
          <div className={`${column} pt-3 pb-[max(16px,env(safe-area-inset-bottom))]`}>{footer}</div>
        </div>
      )}
    </main>
  );
}
