// Contextual subnav. Respects the template-based page visibility the old sidebar enforced.
// Aurora 4.0 (NAV1 phones, NAV2 desktop): the section's routes are a plain tab row with an
// underline under the active page — 13.5px on phones, 14px on desktop — in place of the pill
// rail (10.5px on phones, which squeezed "Recurring" and "Accounts"). The section name is
// already in the header, so the mono "PLAN ▸" cap is gone. The row scrolls sideways if a
// section ever gets a fifth route. Links stay <a> elements (e2e selects them by href).
import { NavLink, useLocation } from 'react-router-dom';
import { useStore } from '../../store';
import { SECTIONS, ACCOUNT_ROUTES, sectionForPath, visiblePages } from './navModel';

const tabStyle = ({ isActive }: { isActive: boolean }) => (isActive
  ? { color: 'var(--accent-text)', fontWeight: 600, boxShadow: 'inset 0 -2px 0 var(--accent)' }
  : { color: 'hsl(var(--ink-mid))', fontWeight: 500 });

export default function SubNav() {
  const location = useLocation();
  const template = useStore(s => s.profile.template);
  const sectionId = sectionForPath(location.pathname);
  const section = SECTIONS.find(s => s.id === sectionId);
  // v10.53.0 — a page of its own (Pip) has no sibling routes to switch between.
  const standalone = sectionId === 'standalone';
  const routes = (section ? section.routes : ACCOUNT_ROUTES)
    .filter(r => visiblePages(template).has(r.page));

  if (standalone || routes.length <= 1) return null;
  const label = section ? section.label : 'Account';

  return (
    <>
      {/* ── Phones: underline tab row (NAV1) ── */}
      <nav aria-label={`${label} pages`} className="sm:hidden border-b border-line">
        <div className="max-w-[1320px] mx-auto px-4 flex gap-5 overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
          {routes.map(r => (
            <NavLink
              key={r.to}
              to={r.to}
              className="flex items-center min-h-[44px] pt-2.5 pb-[11px] font-ui text-[13.5px] whitespace-nowrap flex-shrink-0"
              style={tabStyle}
            >
              {r.label}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* ── Desktop: sticky underline tab bar (NAV2) ── */}
      <nav
        aria-label={`${label} pages`}
        className="hidden sm:block sticky top-[64px] z-40 border-b border-line"
        style={{ background: 'var(--canvas)' }}
      >
        <div className="max-w-[1320px] mx-auto px-4 lg:px-7 flex gap-7 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {routes.map(r => (
            <NavLink
              key={r.to}
              to={r.to}
              className="flex items-center min-h-[48px] pt-3.5 pb-[13px] font-ui text-[14px] whitespace-nowrap flex-shrink-0"
              style={tabStyle}
            >
              {r.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}
