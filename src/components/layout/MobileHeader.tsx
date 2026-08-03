// Aurora mobile header (Batch A fidelity pass · board M1 §m-header).
// The board has NO fixed top bar on phones — this header scrolls with the
// page. One row: pip → home · page identity (greeting on Home, section cap +
// page title elsewhere) · household-type chip → HouseholdSheet · bell →
// NotificationSheet · avatar → account menu. Desktop keeps TopBar; this
// renders below `sm` only.
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStore } from '../../store';
import { Pip } from './Brand';
import AccountMenu from './AccountMenu';
import NotificationCenter from './NotificationCenter';
import HouseholdSheet from './HouseholdSheet';
import { SECTIONS, ACCOUNT_ROUTES, sectionForPath } from './navModel';
import { PROFILE_TYPES } from '../../constants';
import type { ProfileTypeKey } from '../../types';

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
}

export default function MobileHeader() {
  const location = useLocation();
  const [hhOpen, setHhOpen] = useState(false);
  const profile = useStore(s => s.profile);
  const households = useStore(s => s.households);
  const currentHouseholdId = useStore(s => s.currentHouseholdId);
  const active = households.find(h => h.id === currentHouseholdId);
  const typeLabel = PROFILE_TYPES[(active?.type ?? 'family') as ProfileTypeKey]?.label ?? 'Family';

  const isHome = location.pathname === '/dashboard' || location.pathname === '/';
  const sectionId = sectionForPath(location.pathname);
  const section = SECTIONS.find(s => s.id === sectionId);
  const route = (section ? section.routes : ACCOUNT_ROUTES).find(r => location.pathname.startsWith(r.to));
  const firstName = (profile.name || '').trim().split(/\s+/)[0];

  return (
    <div className="sm:hidden max-w-[1320px] mx-auto px-4 pt-2.5 pb-3.5 flex items-center gap-2">
      <Link to="/dashboard" aria-label="Home" className="flex-shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40">
        <Pip size={30} />
      </Link>

      {/* Page identity — greeting on Home (board M1), section·title elsewhere. */}
      <div className="flex-1 min-w-0">
        {isHome ? (
          <>
            <div className="text-[11.5px] leading-tight text-ink-dim">{greeting()}</div>
            <div className="font-display font-bold text-[18px] leading-tight tracking-tight text-ink truncate">
              {profile.name?.trim() || 'Welcome'}
            </div>
          </>
        ) : (
          <>
            <div className="font-mono text-[8.5px] tracking-[0.15em] uppercase text-ink-dim leading-tight">
              {section ? section.label : 'Account'}
            </div>
            <div className="font-display font-bold text-[18px] leading-tight tracking-tight text-ink truncate">
              {route?.label ?? 'Vyact'}
            </div>
          </>
        )}
      </div>

      {/* Household-type chip → the same pull-down sheet as the desktop chip. */}
      <button
        type="button"
        onClick={() => setHhOpen(true)}
        aria-label={`Switch household — ${active?.name ?? 'Household'}`}
        className="flex-shrink-0 flex items-center gap-1.5 h-[38px] px-3 rounded-pill border-none cursor-pointer"
        style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-dim" aria-hidden>
          <path d="M4 11l8-7 8 7M6 10v9h12v-9" />
        </svg>
        <span className="font-mono text-[9px] tracking-[0.15em] uppercase text-ink-dim">{typeLabel}</span>
      </button>

      <NotificationCenter />
      <AccountMenu trigger="avatar" />

      <HouseholdSheet open={hhOpen} onClose={() => setHhOpen(false)} />
    </div>
  );
}
