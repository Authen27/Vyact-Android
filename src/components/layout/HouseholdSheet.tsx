// Aurora household-switch pull-down (board A M3/D3 · fidelity pass).
// Same top-sheet gesture as notifications — tapping the household chip draws a
// glass sheet of household cards; the active one glows coral and carries the
// MEMBER AVATAR STACK + your role. Create + manage one tap away.
//
// Honesty note: the store only holds the ACTIVE household's member roster, so
// only the active card shows the stack; other households show their initials
// avatar rather than a fabricated roster.
import { useNavigate } from 'react-router-dom';
import { Plus, ChevronRight } from 'lucide-react';
import { useStore } from '../../store';
import PullDownSheet from '../ui/PullDownSheet';
import { PROFILE_TYPES, deterministicColor } from '../../constants';
import { roleLabel } from '../../lib/permissions';

const initials = (name: string) =>
  name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'H';

export default function HouseholdSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const households = useStore(s => s.households);
  const currentHouseholdId = useStore(s => s.currentHouseholdId);
  const switchHousehold = useStore(s => s.switchHousehold);
  const members = useStore(s => s.members);
  const myRole = useStore(s => s.myRole);
  const cloudEnabled = useStore(s => s.cloudEnabled);

  // In local-only mode there are no memberships — the single user owns the data.
  const role = myRole ? roleLabel(myRole) : (!cloudEnabled ? 'Owner' : null);

  async function pick(id: string) {
    if (id !== currentHouseholdId) await switchHousehold(id);
    onClose();
  }

  return (
    <PullDownSheet
      open={open}
      onClose={onClose}
      ariaLabel="Your households"
      header={
        <div className="pt-6 pb-3.5">
          <h2 className="font-display text-2xl font-bold text-ink leading-none tracking-tight">Your households</h2>
          <div className="mono-label mt-1.5">Each keeps its own data &amp; roles</div>
        </div>
      }
      footer={
        <button
          className="w-full text-left mono-label py-1.5"
          style={{ color: 'var(--accent)' }}
          onClick={() => { onClose(); navigate('/households'); }}
        >
          Manage members &amp; invites →
        </button>
      }
    >
      <div className="flex flex-col gap-3 py-1">
        {households.map(h => {
          const on = h.id === currentHouseholdId;
          const meta = PROFILE_TYPES[h.type];
          const stack = on ? members.slice(0, 3) : [];
          const sub = [meta?.label || h.type, h.baseCurrency,
            on && role ? `You're the ${role.toLowerCase()}` : null].filter(Boolean).join(' · ');
          return (
            <button
              key={h.id}
              onClick={() => pick(h.id)}
              className="flex items-center gap-3.5 px-4 py-3.5 rounded-r3 text-left transition-transform hover:-translate-y-0.5"
              style={{
                background: 'var(--canvas)',
                boxShadow: on
                  ? 'var(--neu), 0 0 0 2px var(--accent), 0 0 24px color-mix(in srgb, var(--accent) 30%, transparent)'
                  : 'var(--neu)',
              }}
            >
              {/* Board M3 §.avstack — overlapping member avatars on the active
                  card; other households fall back to their initials avatar. */}
              {stack.length > 0 ? (
                <span className="flex flex-shrink-0" aria-hidden>
                  {stack.map((m, i) => (
                    <span
                      key={m.id}
                      className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-white font-display font-bold text-[11px]"
                      style={{
                        background: i === 0 ? 'var(--coral-grad)' : deterministicColor(m.name || m.id),
                        marginLeft: i === 0 ? 0 : -8,
                        boxShadow: '0 0 0 2px var(--canvas)',
                        color: i === 0 ? 'var(--accent-ink)' : '#fff',
                      }}
                    >
                      {initials(m.name || '?')}
                    </span>
                  ))}
                </span>
              ) : (
                <span
                  className="w-[30px] h-[30px] rounded-full flex items-center justify-center font-display font-bold text-[11px] flex-shrink-0"
                  style={{ background: 'var(--coral-grad)', color: 'var(--accent-ink)' }}
                  aria-hidden
                >
                  {initials(h.name)}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-[16px] text-ink truncate">{h.name}</div>
                <div className="mono-label mt-0.5 text-[9px]">{sub}</div>
              </div>
              {on
                ? <span className="mono-label px-2 py-0.5 rounded-pill flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)' }}>Active</span>
                : <ChevronRight size={16} className="text-ink-dim flex-shrink-0" />}
            </button>
          );
        })}

        <button
          onClick={() => { onClose(); navigate('/households'); }}
          className="flex items-center justify-center gap-2 py-3.5 rounded-r3 font-display font-semibold text-[14px] text-ink-dim"
          style={{ border: '1.5px dashed hsl(var(--line2))' }}
        >
          <Plus size={16} /> New household
        </button>
      </div>
    </PullDownSheet>
  );
}
