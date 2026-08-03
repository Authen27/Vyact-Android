// Contextual subnav (Aurora v10 · Batch A fidelity pass).
// Board M1: on phones the section's routes render as a "Track ▸" segmented
// bar — an inset pill container whose ACTIVE segment is a raised accent-
// tinted chip — scrolling with the page under the mobile header.
// Board D1: on desktop it stays a sticky bar under the top bar — section cap
// + 32px neu chips, active = inset + accent tint.
// Respects the template-based page visibility the old sidebar enforced.
import { NavLink, useLocation } from 'react-router-dom';
import { useStore } from '../../store';
import { SECTIONS, ACCOUNT_ROUTES, sectionForPath, visiblePages } from './navModel';

export default function SubNav() {
  const location = useLocation();
  const template = useStore(s => s.profile.template);
  const sectionId = sectionForPath(location.pathname);
  const section = SECTIONS.find(s => s.id === sectionId);
  const routes = (section ? section.routes : ACCOUNT_ROUTES)
    .filter(r => visiblePages(template).has(r.page));

  if (routes.length <= 1) return null;
  const label = section ? section.label : 'Account';

  return (
    <>
      {/* ── Mobile: "Track ▸" segmented bar (board M1) ── */}
      <div className="sm:hidden max-w-[1320px] mx-auto px-4 pb-3 flex items-center gap-2">
        <span className="font-mono text-[8.5px] tracking-[0.15em] uppercase flex-shrink-0" style={{ color: 'var(--accent)' }}>
          {label} ▸
        </span>
        <div
          className="flex-1 flex gap-1 p-1 rounded-pill min-w-0 overflow-x-auto [&::-webkit-scrollbar]:hidden"
          style={{ background: 'var(--sunken)', boxShadow: 'var(--neu-inset)', scrollbarWidth: 'none' }}
        >
          {routes.map(r => (
            <NavLink
              key={r.to}
              to={r.to}
              className="flex-1 flex items-center justify-center h-[26px] px-2 rounded-pill font-display font-semibold text-[10.5px] whitespace-nowrap"
              style={({ isActive }) => (isActive
                ? { color: 'var(--accent)', boxShadow: 'var(--neu-inset)', background: 'color-mix(in srgb, var(--accent) 10%, var(--canvas))' }
                : { color: 'var(--ff-ink-3)' })}
            >
              {r.label}
            </NavLink>
          ))}
        </div>
      </div>

      {/* ── Desktop: sticky chip bar (board D1) ── */}
      <div
        className="hidden sm:block sticky top-[64px] z-40 border-b border-line"
        style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}
      >
        <div className="max-w-[1320px] mx-auto px-4 lg:px-7 py-2.5 flex gap-2 items-center overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          <span className="font-mono text-[9px] tracking-[0.15em] uppercase text-ink-dim mr-1 flex-shrink-0">{label}</span>
          {routes.map(r => (
            <NavLink
              key={r.to}
              to={r.to}
              className="flex items-center h-8 px-3.5 rounded-pill font-display font-semibold text-[12.5px] whitespace-nowrap flex-shrink-0"
              style={({ isActive }) => (isActive
                ? { color: 'var(--accent)', boxShadow: 'var(--neu-inset)', background: 'color-mix(in srgb, var(--accent) 10%, var(--canvas))' }
                : { color: 'var(--ff-ink-3)', background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' })}
            >
              {r.label}
            </NavLink>
          ))}
        </div>
      </div>
    </>
  );
}
