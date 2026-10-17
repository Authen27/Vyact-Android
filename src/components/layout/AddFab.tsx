// Vyact v7.4.4 — AddFab. Aurora 4.0 X4 / IN1.
//
// Desktop-only floating + (on phones the tab bar's raised + adds a transaction). It used to add a
// transaction on click, doubling the "+ Add Transaction" button in the page header. Now the page's
// own add button stays in its header (PageHead), and the floating + opens a menu of the OTHER things
// you can add: the current page's own entity is left out (read from the page action). It shows on
// every app page, Insights included (IN1); auth and onboarding have no household to add to.
// It hides on scroll-down while closed, and reappears on scroll-up.

import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, Wallet, CreditCard, Briefcase, Users, X, ArrowLeftRight } from 'lucide-react';
import { useStore } from '../../store';
import { useScrollDirection } from '../../hooks';
import { usePageAction, type AddEntity } from './pageAction';

export default function AddFab() {
  const location = useLocation();
  const openAddTxn    = useStore(s => s.openAddTxn);
  const openAddBudget = useStore(s => s.openAddBudget);
  const openAddDebt   = useStore(s => s.openAddDebt);
  const openAddAsset  = useStore(s => s.openAddAsset);
  const openAddSplit  = useStore(s => s.openAddSplit);
  const pageEntity = usePageAction()?.entity;

  const dir = useScrollDirection();
  const [open, setOpen] = useState(false);

  // Keep it pinned while the menu is open, so the choice does not slide away.
  const hidden = dir === 'down' && !open;

  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e: MouseEvent) => {
      const root = document.getElementById('add-fab-root');
      if (root && !root.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // (After the hooks so they run unconditionally — rules-of-hooks.)
  if (location.pathname.startsWith('/auth/') || location.pathname.startsWith('/onboarding')) return null;

  const pick = (fn: () => void) => { setOpen(false); fn(); };
  const items: { entity: AddEntity; label: string; icon: ReactNode; run: () => void }[] = [
    { entity: 'transaction', label: 'Add transaction', icon: <ArrowLeftRight size={16} />, run: () => openAddTxn() },
    { entity: 'split',       label: 'New split',       icon: <Users size={16} />,          run: () => openAddSplit() },
    { entity: 'budget',      label: 'Add budget',      icon: <Wallet size={16} />,         run: openAddBudget },
    { entity: 'debt',        label: 'Add loan',        icon: <CreditCard size={16} />,     run: openAddDebt },
    { entity: 'asset',       label: 'Add asset',       icon: <Briefcase size={16} />,      run: openAddAsset },
  ];
  const menu = items.filter(item => item.entity !== pageEntity);

  return (
    <div
      id="add-fab-root"
      className="fixed right-4 z-50 hidden sm:flex flex-col items-end gap-2.5 transition-all duration-300"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)' }}
    >
      {open && (
        <div role="menu" aria-label="Add" className="flex flex-col items-end gap-2 mb-1 animate-modalIn">
          {menu.map(item => (
            <button
              key={item.entity}
              type="button"
              role="menuitem"
              onClick={() => pick(item.run)}
              className="tile flex items-center gap-2 !rounded-full min-h-[44px] pl-3.5 pr-4 text-[0.875rem] text-ink hover:-translate-y-0.5 transition-transform"
            >
              <span style={{ color: 'var(--accent-text)' }}>{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        aria-label={open ? 'Close add menu' : 'Add…'}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Add…"
        onClick={() => setOpen(o => !o)}
        className={`w-14 h-14 rounded-full bg-coral text-[color:var(--accent-ink)] shadow-2 flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 ${hidden ? 'translate-y-[120%] opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'}`}
      >
        {open ? <X size={22} /> : <Plus size={22} strokeWidth={2.4} />}
      </button>
    </div>
  );
}
