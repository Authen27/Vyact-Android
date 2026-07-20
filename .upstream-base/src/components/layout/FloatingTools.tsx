// Vyact — Ask Vyact drawer host (v10.1.1)
//
// Ask Vyact is a right-side drawer. Per the Batch A board the LAUNCHER moved
// into the shell chrome — the desktop header "✦ Ask" chip and the mobile
// tab-bar "✦ Ask" slot (both call `openAsk`) — so this component no longer
// renders a floating action button. It only HOSTS the drawer, driven by the
// store `askOpen` flag, and is mounted once in Layout.
//
// The /planner and /chat routes remain for deep links.

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
        <Chat />
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
function Drawer({ title, onClose, children }: DrawerProps) {
  return (
    <div
      className="fixed inset-0 z-[150] flex justify-end"
      style={{ background: 'hsl(var(--shadow) / 0.45)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-bg2 border-l border-line2 h-full w-full sm:w-[min(28rem,100vw)] flex flex-col shadow-3 animate-slideInRight">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h3 className="display-italic text-[1.2rem] leading-none text-ink">{title}</h3>
          <button onClick={onClose} className="text-ink-dim hover:text-ink transition-colors p-1" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
