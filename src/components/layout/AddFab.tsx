// Vyact v7.4.4 — AddFab
//
// Always-visible primary entry point for adding a transaction. Sits in the
// bottom-right corner above the MobileBar / safe-area, hides on scroll-down
// to stop blocking content, and reappears on scroll-up.
//
// Long-press (touch) or right-click (desktop) opens a speed-dial with the
// other CRUD entries (Goal / Budget / Debt / Asset). Plain tap = Add
// Transaction so the most-common action is one tap away.

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, Wallet, CreditCard, Briefcase, X } from 'lucide-react';
import { useStore } from '../../store';
import { useScrollDirection } from '../../hooks';

export default function AddFab() {
  const location = useLocation();
  const openAddTxn    = useStore(s => s.openAddTxn);
  const openAddBudget = useStore(s => s.openAddBudget);
  const openAddDebt   = useStore(s => s.openAddDebt);
  const openAddAsset  = useStore(s => s.openAddAsset);

  const dir = useScrollDirection();
  const [dialOpen, setDialOpen] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  // Hide on scroll-down only when the dial is closed; once the user opens the
  // dial, keep it pinned so they can choose without it sliding out.
  const hidden = dir === 'down' && !dialOpen;

  useEffect(() => {
    if (!dialOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDialOpen(false); };
    const onClick = (e: MouseEvent) => {
      const root = document.getElementById('add-fab-root');
      if (root && !root.contains(e.target as Node)) setDialOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [dialOpen]);

  // Hide on auth routes — no household, no modal target. (After the hooks so they
  // run unconditionally — rules-of-hooks; the effect is a no-op while closed.)
  if (location.pathname.startsWith('/auth/') || location.pathname.startsWith('/onboarding')) return null;

  function startLongPress() {
    longPressFired.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      setDialOpen(true);
    }, 500);
  }
  function cancelLongPress() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }
  function handleClick() {
    if (longPressFired.current) { longPressFired.current = false; return; }
    if (dialOpen) { setDialOpen(false); return; }
    openAddTxn();
  }
  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setDialOpen(d => !d);
  }

  function pick(fn: () => void) {
    setDialOpen(false);
    fn();
  }

  const dialItems = [
    { label: 'Add budget', icon: <Wallet size={16} />,     onClick: () => pick(openAddBudget) },
    { label: 'Add debt',   icon: <CreditCard size={16} />, onClick: () => pick(openAddDebt) },
    { label: 'Add asset',  icon: <Briefcase size={16} />,  onClick: () => pick(openAddAsset) },
  ];

  return (
    <div
      id="add-fab-root"
      className="fixed right-4 z-50 flex flex-col items-end gap-2.5 transition-all duration-300"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
      }}
    >
      {/* Speed-dial items render above the FAB. */}
      {dialOpen && (
        <div className="flex flex-col items-end gap-2 mb-1 animate-modalIn">
          {dialItems.map(item => (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              className="flex items-center gap-2 bg-bg2 border border-line shadow-2 rounded-full pl-3 pr-3.5 py-2 text-[0.82rem] text-ink hover:border-line2 hover:-translate-y-0.5 transition-all"
            >
              <span className="text-coral">{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        aria-label={dialOpen ? 'Close add menu' : 'Add transaction (long-press for more)'}
        title="Add transaction · long-press for more"
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onTouchStart={startLongPress}
        onTouchEnd={cancelLongPress}
        onTouchCancel={cancelLongPress}
        onMouseDown={startLongPress}
        onMouseUp={cancelLongPress}
        onMouseLeave={cancelLongPress}
        className={`w-14 h-14 rounded-full bg-coral text-white shadow-2 flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 ${hidden ? 'translate-y-[120%] opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'}`}
      >
        {dialOpen ? <X size={22} /> : <Plus size={22} strokeWidth={2.4} />}
      </button>
    </div>
  );
}
