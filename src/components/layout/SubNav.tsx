// Contextual subnav (Aurora v10, handoff §6.2) — a horizontal pill row of
// the routes inside the active section, sticky under the top bar. Doubles
// as the mobile in-tab route switcher (handoff §7) — same component, both
// breakpoints. Respects the template-based page visibility the old sidebar
// enforced.
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

  return (
    <div
      className="sticky top-[62px] sm:top-[64px] z-40 border-b border-line"
      style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}
    >
      <div className="max-w-[1320px] mx-auto px-4 lg:px-7 py-2.5 flex gap-2 items-center overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <span className="mono-label mr-1 flex-shrink-0 hidden sm:inline">{section ? section.label : 'Account'}</span>
        {routes.map(r => (
          <NavLink
            key={r.to}
            to={r.to}
            className="neu-pill px-3.5 py-2 text-[13px] flex-shrink-0"
            style={({ isActive }) => (isActive
              ? { boxShadow: 'var(--neu-inset)', color: 'var(--accent)', fontWeight: 600 }
              : undefined)}
          >
            <r.icon size={15} /> {r.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
