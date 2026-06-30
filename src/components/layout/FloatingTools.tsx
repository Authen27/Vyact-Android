// Vyact v6.4 — FloatingTools
//
// Ask Vyact lives here as a floating action button that opens a right-side
// drawer, available on every authenticated screen.
//
// v9.5.3 (Insights Hub §6/§8): the Planner FAB was REMOVED — the Planner now
// lives inside the Insights hub as the "Plan" tab. Its Sparkles icon is freed up
// and adopted by Ask Vyact (was MessageCircle). The /planner and /chat routes
// remain for deep links.

import React, { Suspense, useState, useEffect, type ReactNode } from 'react';
import { Sparkles, X } from 'lucide-react';
import { App } from '@capacitor/app';
import { useScrollDirection } from '../../hooks';
import { isNative } from '../../lib/native';

const Chat = React.lazy(() => import('../../pages/Chat'));

type Tool = 'chat' | null;

import ls from '../../lib/localStorageCompat';
const KEY = 'floating_last';

export default function FloatingTools() {
  const [tool, setTool] = useState<Tool>(null);

  // Mirror AddFab: fade out on scroll-down so the FAB stops covering the
  // right-aligned transaction amounts / chart edges; reappear on scroll-up.
  const dir = useScrollDirection();
  const hidden = dir === 'down' && !tool;

  // Close the drawer via Esc (web keyboard) and the Android hardware Back button
  // (native). The Back listener is only registered while the drawer is open, so
  // it doesn't interfere with normal back navigation otherwise.
  useEffect(() => {
    if (!tool) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTool(null); };
    window.addEventListener('keydown', onKey);

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

  return (
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
  );
}

function DrawerLoadingState() {
  return <div className="mono-label">Loading…</div>;
}

interface FabProps {
  label: string;
  tone: 'coral' | 'denim';
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}
function Fab({ label, tone, active, onClick, children }: FabProps) {
  const bg = tone === 'coral' ? 'bg-coral hover:bg-coral/90' : 'bg-denim hover:bg-denim/90';
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`group flex items-center gap-2 ${bg} text-white rounded-full shadow-2 transition-all
                  px-3.5 h-11 hover:pr-4 hover:scale-[1.03] ${active ? 'ring-2 ring-white/50' : ''}`}
    >
      {children}
      <span className="font-mono text-[0.6rem] tracking-[0.14em] uppercase font-semibold hidden sm:inline">
        {label}
      </span>
    </button>
  );
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
