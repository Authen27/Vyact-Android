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

const Chat = React.lazy(() => import('../../pages/Chat'));

type Tool = 'chat' | null;

import ls from '../../lib/localStorageCompat';
const KEY = 'floating_last';

export default function FloatingTools() {
  const [tool, setTool] = useState<Tool>(null);

  // Esc closes the drawer for keyboard users.
  useEffect(() => {
    if (!tool) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTool(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool]);

  function open(t: Tool) {
    setTool(t);
    try { if (t) ls.setString(KEY, t); } catch { /* noop */ }
  }

  return (
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
