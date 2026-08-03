// Aurora top app bar (v10, handoff §6.1) — replaces the left sidebar.
// Sticky glass bar: 3px rail gradient, pip wordmark, sliding section pill
// (Track · Plan · Analyze), Jump-to ⌘K search button, notifications, account.
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, ChevronDown, Sparkles } from 'lucide-react';
import Brand from './Brand';
import AccountMenu from './AccountMenu';
import NotificationCenter from './NotificationCenter';
import HouseholdSheet from './HouseholdSheet';
import { useStore } from '../../store';
import { SECTIONS, sectionForPath } from './navModel';
import { PROFILE_TYPES } from '../../constants';
import type { ProfileTypeKey } from '../../types';

const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

export function SectionTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const section = sectionForPath(location.pathname);
  const idx = Math.max(0, SECTIONS.findIndex(s => s.id === section));
  const known = SECTIONS.some(s => s.id === section);

  return (
    <div
      className="relative inline-flex p-1 rounded-pill"
      style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-inset)' }}
      role="tablist" aria-label="Sections"
    >
      {known && (
        <span
          aria-hidden
          className="absolute top-1 bottom-1 rounded-pill transition-[left] duration-[260ms] ease-spring"
          style={{
            left: `calc(4px + ${idx} * ((100% - 8px) / ${SECTIONS.length}))`,
            width: `calc((100% - 8px) / ${SECTIONS.length})`,
            background: 'var(--canvas)',
            boxShadow: 'var(--neu-sm)',
          }}
        />
      )}
      {SECTIONS.map(s => {
        const on = s.id === section;
        return (
          <button
            key={s.id}
            role="tab" aria-selected={on}
            onClick={() => navigate(s.routes[0].to)}
            className="relative z-[1] border-none bg-transparent px-4 sm:px-5 py-2 font-display font-semibold text-[13.5px] whitespace-nowrap cursor-pointer transition-colors"
            style={{ color: on ? 'var(--accent)' : 'var(--ff-ink-3)' }}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

export default function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const [hhOpen, setHhOpen] = useState(false);
  const households = useStore(s => s.households);
  const currentHouseholdId = useStore(s => s.currentHouseholdId);
  const openAsk = useStore(s => s.openAsk);
  const activeHousehold = households.find(h => h.id === currentHouseholdId);
  const activeName = activeHousehold?.name || 'Household';
  const typeLabel = PROFILE_TYPES[(activeHousehold?.type ?? 'family') as ProfileTypeKey]?.label ?? 'Family';

  return (
    /* Board M1 — phones have no fixed top bar; MobileHeader (in Layout) owns
       the mobile chrome, so this whole bar is ≥sm only. */
    <header
      className="hidden sm:block sticky top-0 z-50 border-b border-line"
      style={{ background: 'var(--glass)', backdropFilter: 'var(--blur)', WebkitBackdropFilter: 'var(--blur)' }}
    >
      <div aria-hidden className="h-[3px] opacity-85" style={{ background: 'var(--rail)' }} />
      <div className="max-w-[1320px] mx-auto px-4 lg:px-7 py-2.5 flex items-center gap-3 lg:gap-4 flex-wrap">
        <Brand />

        {/* Section tabs — center on wide screens, own row on tablet, hidden
            on phones (the bottom tab bar owns section switching there). */}
        <div className="hidden sm:flex order-3 basis-full justify-center lg:order-none lg:basis-auto lg:flex-none lg:mx-auto">
          <SectionTabs />
        </div>

        <div className="flex items-center gap-2.5 ml-auto">
          <button
            onClick={onOpenPalette}
            aria-label="Search — open command palette"
            className="flex items-center gap-2 h-10 px-3.5 rounded-pill border-none cursor-pointer text-ink-dim"
            style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-inset)' }}
          >
            <Search size={15} />
            <span className="hidden md:inline text-[13px]">Jump to…</span>
            <span className="hidden md:inline mono-label px-1.5 py-0.5 rounded-md" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>
              {IS_MAC ? '⌘K' : 'Ctrl K'}
            </span>
          </button>
          {/* ✦ Ask chip (handoff §6.1 / Batch A board D1) — opens the Ask Vyact
              drawer. Desktop only; on phones Ask is the far-right tab-bar slot.
              Coral (--accent) — matches the household/account avatar identity
              color rather than a semantic status color. */}
          <button
            onClick={openAsk}
            aria-label="Ask Vyact"
            className="hidden sm:flex items-center gap-1.5 h-10 px-3.5 rounded-pill border-none cursor-pointer"
            style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)', color: 'var(--accent)' }}
          >
            <Sparkles size={15} />
            <span className="font-display font-semibold text-[13px]">Ask</span>
          </button>
          <NotificationCenter />
          {/* Household chip — switches the DATA context (distinct from the
              avatar/account menu). Board D1: house icon + household TYPE, not
              the name (the avatar identifies the person; the sheet shows the
              full household identity on open). */}
          <button
            onClick={() => setHhOpen(true)}
            aria-label={`Switch household — ${activeName}`}
            className="flex items-center gap-1.5 h-10 px-3 rounded-pill border-none cursor-pointer text-ink-mid"
            style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-dim" aria-hidden>
              <path d="M4 11l8-7 8 7M6 10v9h12v-9" />
            </svg>
            <span className="font-mono text-[9px] tracking-[0.15em] uppercase text-ink-dim">{typeLabel}</span>
            <ChevronDown size={12} className="flex-shrink-0 text-ink-dim" />
          </button>
          <AccountMenu />
        </div>
      </div>
      <HouseholdSheet open={hhOpen} onClose={() => setHhOpen(false)} />
    </header>
  );
}
