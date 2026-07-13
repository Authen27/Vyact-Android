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
<<<<<<< ANDROID
import { Sparkles, X } from 'lucide-react';
import { App } from '@capacitor/app';
import { useScrollDirection } from '../../hooks';
import { isNative } from '../../lib/native';
||||||| UPSTREAM-BASE
import { Sparkles, X } from 'lucide-react';
=======
import { X } from 'lucide-react';
import { useStore } from '../../store';
>>>>>>> UPSTREAM

const Chat = React.lazy(() => import('../../pages/Chat'));

export default function FloatingTools() {
  const location = useLocation();
  const askOpen = useStore(s => s.askOpen);
  const closeAsk = useStore(s => s.closeAsk);

  // Mirror AddFab: fade out on scroll-down so the FAB stops covering the
  // right-aligned transaction amounts / chart edges; reappear on scroll-up.
  const dir = useScrollDirection();
  const hidden = dir === 'down' && !tool;

  // Close the drawer via Esc (web keyboard) and the Android hardware Back button
  // (native). The Back listener is only registered while the drawer is open, so
  // it doesn't interfere with normal back navigation otherwise.
  useEffect(() => {
    if (!askOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAsk(); };
    window.addEventListener('keydown', onKey);
<<<<<<< ANDROID

    const backHandle = isNative()
      ? App.addListener('backButton', () => setTool(null))
      : null;

    return () => {
      window.removeEventListener('keydown', onKey);
      void backHandle?.then(h => h.remove());
    };
  }, [tool]);

  function open(t: Tool) {
    setTool(t);
    try { if (t) ls.setString(KEY, t); } catch { /* noop */ }
  }
||||||| UPSTREAM-BASE
    return () => window.removeEventListener('keydown', onKey);
  }, [tool]);

  function open(t: Tool) {
    setTool(t);
    try { if (t) ls.setString(KEY, t); } catch { /* noop */ }
  }
=======
    return () => window.removeEventListener('keydown', onKey);
  }, [askOpen, closeAsk]);
>>>>>>> UPSTREAM

  // Never surface on the onboarding / auth full-screen overlays (no household
  // context). Closing defensively keeps a stale open-flag from leaking across
  // a route change into those surfaces.
  const suppressed = location.pathname.startsWith('/onboarding') || location.pathname.startsWith('/auth/');
  if (suppressed || !askOpen) return null;

  return (
<<<<<<< ANDROID
    <>
      {/* Stacked FABs in the bottom-right. Sit a fixed gap ABOVE the primary
          AddFab so the Add-Transaction button stays the most prominent action.
          Must share AddFab's safe-area-inset baseline (AddFab bottom = inset+80,
          height 56) so the two never collide on devices with a nav-bar inset:
          inset + 80 + 56 + 16(gap) = inset + 152. */}
      <div
        className={`fixed right-4 z-40 flex flex-col gap-2.5 transition-all duration-300 ${hidden ? 'opacity-0 translate-y-3 pointer-events-none' : 'opacity-100 translate-y-0'}`}
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 152px)' }}
      >
        <Fab
          label="Ask Vyact"
          tone="denim"
          onClick={() => open('chat')}
          active={tool === 'chat'}
        >
          <Sparkles size={18} />
        </Fab>
      </div>

      {tool && (
        <Drawer onClose={() => setTool(null)} title="Ask Vyact">
          <Suspense fallback={<DrawerLoadingState />}>
            <Chat />
          </Suspense>
        </Drawer>
      )}
    </>
||||||| UPSTREAM-BASE
    <>
      {/* Stacked FABs in the bottom-right. Sit above the primary AddFab
          (v7.4.4) so the Add-Transaction button stays the most prominent
          action; offset above MobileBar (~56px) on small screens. */}
      <div className="fixed right-4 bottom-[160px] lg:bottom-[160px] z-40 flex flex-col gap-2.5">
        <Fab
          label="Ask Vyact"
          tone="denim"
          onClick={() => open('chat')}
          active={tool === 'chat'}
        >
          <Sparkles size={18} />
        </Fab>
      </div>

      {tool && (
        <Drawer onClose={() => setTool(null)} title="Ask Vyact">
          <Suspense fallback={<DrawerLoadingState />}>
            <Chat />
          </Suspense>
        </Drawer>
      )}
    </>
=======
    <Drawer onClose={closeAsk} title="Ask Vyact">
      <Suspense fallback={<DrawerLoadingState />}>
        <Chat />
      </Suspense>
    </Drawer>
>>>>>>> UPSTREAM
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
      <div
        className="bg-bg2 border-l border-line2 h-full w-full sm:w-[min(28rem,100vw)] flex flex-col shadow-3 animate-slideInRight"
        // Inset so the close button clears the Android status bar (was untappable
        // under it on a full-width mobile drawer) and content clears the nav bar.
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h3 className="display-italic text-[1.2rem] leading-none text-ink">{title}</h3>
          <button onClick={onClose} className="text-ink-dim hover:text-ink transition-colors p-2 -mr-1" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
