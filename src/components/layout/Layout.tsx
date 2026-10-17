// Aurora shell (v10) — top app bar + contextual subnav + ⌘K palette on
// desktop/tablet; bottom tab bar below sm. Replaces the v6–v9 left sidebar.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import TopBar from './TopBar';
import MobileHeader from './MobileHeader';
import SubNav from './SubNav';
import CommandPalette from './CommandPalette';
import MobileTabBar from './MobileTabBar';
import FloatingTools from './FloatingTools';
import AddFab from './AddFab';
import SyncConflictBanner from './SyncConflictBanner';
import NativeNavBridge from './NativeNavBridge'; // ANDROID-OVERLAY
import WidgetSync from './WidgetSync';           // ANDROID-OVERLAY
import OfflineStrip from './OfflineStrip';
import { PageActionContext, type PageAction } from './pageAction';

export default function Layout({ children }: { children: ReactNode }) {
  const [palette, setPalette] = useState(false);
  // Aurora 4.0 PH1 — the current page's own add action (set by <PageHead>), read by the header +
  // on phones and by the floating + on desktop.
  const [pageAction, setPageAction] = useState<PageAction | null>(null);
  const pageActionCtx = useMemo(() => ({ action: pageAction, setAction: setPageAction }), [pageAction]);

  // v10.91.0 (audit FE-UIS-10, WCAG 2.1.4; owner decision 13 Oct 2026) — no single-key add shortcuts.
  // n / b / d / a opened a form from any page, so a speech or keyboard user could open one by
  // accident. The add buttons, the floating + and ⌘K's Quick actions remain.

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
    <PageActionContext.Provider value={pageActionCtx}>
    <div className="relative min-h-screen" style={{ background: 'var(--canvas)' }}>
      <NativeNavBridge />
      <WidgetSync />
      <TopBar onOpenPalette={() => setPalette(true)} />
      {/* Board M1 — mobile chrome scrolls with the page (no fixed bar). */}
      <MobileHeader />
      <SubNav />

      <main className="relative z-[1]">
        <div className="max-w-[1320px] mx-auto px-4 lg:px-7 py-5 lg:py-7 pb-28 sm:pb-16">
          {/* TD-03 phase B — surfaces optimistic-concurrency conflicts. */}
          <SyncConflictBanner />
          {/* Aurora 4.0 OF1 — offline, and how many changes wait on this device. */}
          <OfflineStrip />
          {children}
        </div>
      </main>

      <MobileTabBar />
      <FloatingTools />
      <AddFab />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
    </PageActionContext.Provider>
  );
}
