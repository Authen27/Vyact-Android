// Mobile bottom tab bar (Aurora v10.1.1, Batch A board M1/M7).
// Five slots: Track · Plan · [ + ] · Analyze · ✦ Ask. The primary "+" add
// action sits dead-center and Ask is the far-right slot — both are actions,
// not routes. "Home" now lives on the header pip and "Profile" on the header
// avatar (account menu), so they are no longer tabs here. Secondary routes are
// reached via the SubNav pill scroller inside each section.
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeftRight, Wallet, BarChart3, Sparkles, Plus } from 'lucide-react';
import { useStore } from '../../store';
import { sectionForPath } from './navModel';

const SECTION_TABS = [
  { id: 'track',   label: 'Track',   to: '/dashboard', icon: ArrowLeftRight },
  { id: 'plan',    label: 'Plan',    to: '/budgets',   icon: Wallet },
  { id: 'analyze', label: 'Analyze', to: '/reports',   icon: BarChart3 },
] as const;

export default function MobileTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const openAddTxn = useStore(s => s.openAddTxn);
  const openAsk = useStore(s => s.openAsk);
  const section = sectionForPath(location.pathname);

  const tabCls = 'flex flex-col items-center justify-center gap-0.5 min-w-[52px] min-h-[48px] px-1.5 py-1 rounded-r2 border-none bg-transparent cursor-pointer transition-colors';

  return (
    <nav
      aria-label="Primary"
      className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-line"
      style={{
        background: 'var(--glass-strong)',
        backdropFilter: 'var(--blur)',
        WebkitBackdropFilter: 'var(--blur)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div className="flex items-end justify-around px-1 py-1.5">
        {/* Track */}
        <TabButton tab={SECTION_TABS[0]} on={section === 'track'} onClick={() => navigate(SECTION_TABS[0].to)} className={tabCls} />
        {/* Plan */}
        <TabButton tab={SECTION_TABS[1]} on={section === 'plan'} onClick={() => navigate(SECTION_TABS[1].to)} className={tabCls} />

        {/* + Add (dead center, primary — board M1 .add-circle: 54px, lifted,
            coral glow) */}
        <button
          type="button"
          onClick={() => openAddTxn()}
          aria-label="Add transaction"
          className="flex items-center justify-center w-[54px] h-[54px] rounded-full border-none cursor-pointer transition-[filter] active:brightness-90"
          style={{
            background: 'var(--accent)',
            color: 'var(--accent-ink)',
            transform: 'translateY(-16px)',
            boxShadow: '0 8px 22px color-mix(in srgb, var(--accent) 45%, transparent), var(--neu-sm)',
          }}
        >
          <Plus size={26} strokeWidth={2.6} />
        </button>

        {/* Analyze */}
        <TabButton tab={SECTION_TABS[2]} on={section === 'analyze'} onClick={() => navigate(SECTION_TABS[2].to)} className={tabCls} />

        {/* ✦ Ask — coral, matching the desktop Ask chip. */}
        <button type="button" onClick={openAsk} aria-label="Ask Vyact" className={tabCls} style={{ color: 'var(--accent)' }}>
          <Sparkles size={19} strokeWidth={1.9} />
          <span className="font-display text-[10px] font-semibold">Ask</span>
        </button>
      </div>
    </nav>
  );
}

function TabButton({ tab, on, onClick, className }: {
  tab: { label: string; icon: typeof ArrowLeftRight };
  on: boolean;
  onClick: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={on ? 'page' : undefined}
      className={className}
      /* Board §.m-tab.on — the active tab sits on an accent-tinted pill, not
         just a recolored icon. */
      style={on
        ? { color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 14%, transparent)' }
        : { color: 'var(--ff-ink-3)' }}
    >
      <tab.icon size={19} strokeWidth={on ? 2.2 : 1.8} />
      <span className="font-display text-[10px] font-semibold">{tab.label}</span>
    </button>
  );
}
