// Aurora shell (v10) — top app bar + contextual subnav + ⌘K palette on
// desktop/tablet; bottom tab bar below sm. Replaces the v6–v9 left sidebar.
import { useEffect, useState, type ReactNode } from 'react';
import TopBar from './TopBar';
import MobileHeader from './MobileHeader';
import SubNav from './SubNav';
import CommandPalette from './CommandPalette';
import MobileTabBar from './MobileTabBar';
import FloatingTools from './FloatingTools';
import AddFab from './AddFab';
import SyncConflictBanner from './SyncConflictBanner';
import { useShortcuts } from '../../hooks';
import { useStore } from '../../store';

export default function Layout({ children }: { children: ReactNode }) {
  const [palette, setPalette] = useState(false);

  // Add-entity shortcuts stay app-wide (v7.4.4). `useShortcuts` already
  // ignores keystrokes while typing in form fields.
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

  // ⌘K / Ctrl-K — command palette (handoff §6.4).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPalette(p => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative min-h-screen" style={{ background: 'var(--canvas)' }}>
      <TopBar onOpenPalette={() => setPalette(true)} />
      {/* Board M1 — mobile chrome scrolls with the page (no fixed bar). */}
      <MobileHeader />
      <SubNav />

      <main className="relative z-[1]">
        <div className="max-w-[1320px] mx-auto px-4 lg:px-7 py-5 lg:py-7 pb-28 sm:pb-16">
          {/* TD-03 phase B — surfaces optimistic-concurrency conflicts. */}
          <SyncConflictBanner />
          {children}
        </div>
      </main>

      <MobileTabBar />
      <FloatingTools />
      <AddFab />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
