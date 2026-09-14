// Vyact — Ask Vyact drawer host (v10.1.1)
//
// Ask Vyact is a right-side drawer. Per the Batch A board the LAUNCHER moved
// into the shell chrome — the desktop header "✦ Ask" chip and the mobile
// tab-bar "✦ Ask" slot (both call `openAsk`) — so this component no longer
// renders a floating action button. It only HOSTS the drawer, driven by the
// store `askOpen` flag, and is mounted once in Layout.
//
// The /chat route remains for deep links; /planner redirects to Insights' For You
// view, which absorbed the Planner in v10.29.0.

import React, { Suspense, useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { useStore } from '../../store';

const Chat = React.lazy(() => import('../../pages/Chat'));

export default function FloatingTools() {
  const location = useLocation();
  const askOpen = useStore(s => s.askOpen);
  const closeAsk = useStore(s => s.closeAsk);

  // Esc closes the drawer for keyboard users.
  useEffect(() => {
    if (!askOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAsk(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [askOpen, closeAsk]);

  // Never surface on the onboarding / auth full-screen overlays (no household
  // context). Closing defensively keeps a stale open-flag from leaking across
  // a route change into those surfaces.
  const suppressed = location.pathname.startsWith('/onboarding') || location.pathname.startsWith('/auth/');
  if (suppressed || !askOpen) return null;

  return (
    <Drawer onClose={closeAsk} title="Ask Vyact">
      <Suspense fallback={<DrawerLoadingState />}>
        <Chat embedded />
      </Suspense>
    </Drawer>
  );
}

function DrawerLoadingState() {
  return <div className="mono-label">Loading…</div>;
}

interface DrawerProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}
/** Board D3 — a right GLASS drawer over the dimmed app, so you keep your
 *  context while you ask. Header carries the ✦ tile, the name and the honesty
 *  line. Esc and click-outside still close it (wired above); v10.35.0 dropped
 *  the footer line stating that, giving the composer the reclaimed space.
 *
 *  v10.20 — that line used to read "On-device · private". Removing
 *  `RulesBackend` made it false: a question now leaves the device for the
 *  ask-vyact Edge Function and on to a model provider. This drawer wraps
 *  `<Chat embedded />` and nothing else, so the subtitle speaks for Ask Vyact
 *  specifically — it says what is still guaranteed (the figures are computed,
 *  not generated) rather than a claim about egress that no longer holds. */
function Drawer({ title, onClose, children }: DrawerProps) {
  return (
    <div
      className="fixed inset-0 z-[150] flex justify-end"
      style={{ background: 'hsl(var(--shadow) / 0.45)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="h-full w-full flex flex-col animate-slideInRight"
        style={{
          background: 'var(--glass-strong)',
          backdropFilter: 'var(--blur)',
          WebkitBackdropFilter: 'var(--blur)',
          borderLeft: '1px solid var(--glass-line)',
          boxShadow: 'var(--cast-3)',
        }}
      >
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-line">
          <span
            className="w-[34px] h-[34px] rounded-r2 flex items-center justify-center text-[17px] flex-shrink-0"
            style={{ background: 'color-mix(in srgb, hsl(var(--denim)) 16%, transparent)', color: 'hsl(var(--denim))' }}
            aria-hidden
          >✦</span>
          <div className="flex-1 min-w-0">
            <div className="font-display font-normal text-[16px] leading-tight text-ink truncate">{title}</div>
            {/* v10.20.1 — was "Your numbers, computed — never guessed", which
                overstated the invented-figure guard. See Chat.tsx. */}
            <div className="mono-label text-ink-dim">Vyact does the maths, not guesswork</div>
          </div>
          <button onClick={onClose} className="text-ink-dim hover:text-ink transition-colors p-1 flex-shrink-0" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
