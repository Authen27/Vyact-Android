// Aurora accessible dialog primitive (audit 6.1).
//
// HalfSheet and Modal previously hand-rolled their ARIA: `role="dialog"` +
// an Escape listener, but no focus trap, no focus restoration, no background
// inertness, no reliable initial focus, and a 5px close grabber. That is an
// incomplete modal interaction model — a keyboard or screen-reader user could
// tab straight out of an open sheet into the page behind it.
//
// This wraps Radix `Dialog`, which provides the full interaction model out of
// the box (focus trap, initial focus, focus restoration to the trigger, Escape,
// scrim dismissal, and `aria-modal` semantics), styled with the Aurora tokens.
// HalfSheet and Modal both render through this, so there is ONE dialog
// behaviour to test.

import { type ReactNode, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { scrim, sheetUp } from '../../lib/motion';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  ariaLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** 'sheet' = mobile bottom-sheet / desktop dialog; 'modal' = always centered. */
  variant?: 'sheet' | 'modal';
  /** Desktop width. 'md' (default) is the compact form sheet; 'lg' and 'xl'
   *  fit two-column dialogs (v10.24.0 Accounts edit / delete guard). Mobile is
   *  always full width. */
  size?: 'md' | 'lg' | 'xl';
}

// Whole class strings (not interpolated fragments) so Tailwind's scanner sees them.
const SHEET_WIDTH: Record<NonNullable<Props['size']>, string> = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-[840px]',
  xl: 'sm:max-w-[900px]',
};
const MODAL_WIDTH: Record<NonNullable<Props['size']>, string> = {
  md: 'max-w-md',
  lg: 'max-w-[840px]',
  xl: 'max-w-[900px]',
};

export default function AccessibleDialog({
  open, onClose, title, ariaLabel, children, footer, variant = 'sheet', size = 'md', className = '',
}: Props) {
  const isSheet = variant === 'sheet';
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center sm:p-5"
            style={{ background: 'rgba(5,10,12,0.55)', backdropFilter: 'blur(3px)' }}
            variants={scrim} initial="hidden" animate="visible" exit="exit"
          />
        </Dialog.Overlay>
        <Dialog.Content
          onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
          onCloseAutoFocus={event => {
            if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); }
          }}
          aria-describedby={undefined}
          aria-label={ariaLabel}
          asChild={false}
          className={`${className} ${
            isSheet
              ? `fixed z-[201] inset-x-0 bottom-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 w-full ${SHEET_WIDTH[size]} glass-panel rounded-t-r4 sm:rounded-r4 max-h-[92dvh] sm:max-h-[90vh] flex flex-col outline-none`
              : `fixed z-[201] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full ${MODAL_WIDTH[size]} glass-panel rounded-r4 max-h-[90vh] flex flex-col outline-none`
          }`}
        >
          <motion.div variants={sheetUp} initial={false} animate="visible" exit="exit" className="flex flex-col min-h-0 max-h-full">
            {/* Audit 6.1 — the close affordance is a REAL control with a ≥44px
                touch target (the grabber was 5px). Visible on every breakpoint. */}
            <div className={`flex items-center ${title ? 'justify-between' : 'justify-end'} px-5 pt-2 sm:pt-4 pb-2 flex-shrink-0 ${title ? 'sm:border-b sm:border-line' : ''}`}>
              {title && (
                <Dialog.Title className="display-italic text-[1.4rem] leading-none text-ink">
                  {title}
                </Dialog.Title>
              )}
              <Dialog.Close
                aria-label="Close"
                className="min-w-[44px] min-h-[44px] -m-2 flex items-center justify-center text-ink-dim hover:text-ink transition-colors rounded-full"
              >
                <X size={18} />
              </Dialog.Close>
            </div>
            {!title && ariaLabel && (
              // Screen readers still get a name when there's no visible title.
              <Dialog.Title className="sr-only">{ariaLabel}</Dialog.Title>
            )}
            <div className="flex-1 overflow-y-auto px-5 pb-4 sm:py-4 min-h-0">{children}</div>
            {footer && (
              <div className="px-5 pt-2 pb-[max(16px,env(safe-area-inset-bottom))] sm:py-3 border-t border-line flex-shrink-0">
                {footer}
              </div>
            )}
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
