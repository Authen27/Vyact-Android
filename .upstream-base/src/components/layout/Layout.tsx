import { useState, useCallback, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import MobileBar from './MobileBar';
import FloatingTools from './FloatingTools';
import AddFab from './AddFab';
import SyncConflictBanner from './SyncConflictBanner';
import { useShortcuts, useEdgeSwipe } from '../../hooks';
import { useStore } from '../../store';

export default function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  // v7.4.5 — left-edge swipe opens the sidebar on touch devices.
  const openSidebar = useCallback(() => setOpen(true), []);
  useEdgeSwipe(openSidebar);

  // v7.4.4 — promote add-entity shortcuts to app-wide so they work on every
  // page, not just Transactions. `useShortcuts` already ignores keystrokes
  // while typing in form fields.
  const openAddTxn    = useStore(s => s.openAddTxn);
  const openAddBudget = useStore(s => s.openAddBudget);
  const openAddDebt   = useStore(s => s.openAddDebt);
  const openAddAsset  = useStore(s => s.openAddAsset);
  useShortcuts({
    n: () => openAddTxn(), N: () => openAddTxn(),
    b: openAddBudget, B: openAddBudget,
    d: openAddDebt,   D: openAddDebt,
    a: openAddAsset,  A: openAddAsset,
  });

  return (
    <div className="relative">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <MobileBar onMenu={() => setOpen(true)} />
      <main className="lg:ml-60 min-h-screen relative z-[1]">
        <div className="px-4 lg:px-7 py-5 lg:py-7 pb-28 lg:pb-14 max-w-[1400px]">
          {/* TD-03 phase B — surfaces optimistic-concurrency conflicts. */}
          <SyncConflictBanner />
          {children}
        </div>
      </main>
      <FloatingTools />
      <AddFab />
    </div>
  );
}
