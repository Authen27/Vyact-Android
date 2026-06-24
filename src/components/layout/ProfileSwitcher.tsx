import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Plus, Settings as SettingsIcon, Check, Cloud, CloudOff } from 'lucide-react';
import { useStore } from '../../store';
import { PROFILE_TYPES } from '../../constants';
import { popover } from '../../lib/motion';
import SyncStatusBadge from './SyncStatusBadge';

export default function ProfileSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const households = useStore(s => s.households);
  const currentId  = useStore(s => s.currentHouseholdId);
  const switchHousehold = useStore(s => s.switchHousehold);
  const cloudEnabled = useStore(s => s.cloudEnabled);
  const session = useStore(s => s.session);
  const active = households.find(h => h.id === currentId);
  const meta = PROFILE_TYPES[active?.type || 'family'];

  useEffect(() => {
    const onClickAway = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2 bg-coral-tint border-b border-line hover:bg-coral/15 transition-colors"
      >
        <span className="text-base">{meta.icon}</span>
        <span className="flex-1 text-left font-mono text-[0.66rem] font-medium tracking-[0.08em] uppercase text-ink truncate">
          {active?.name || 'My Household'}
        </span>
        <ChevronDown size={12} className="text-ink-mid" />
      </button>

      <AnimatePresence>
      {open && (
        <motion.div
          variants={popover} initial="hidden" animate="visible" exit="exit"
          style={{ transformOrigin: 'top' }}
          className="absolute top-full inset-x-0 z-50 bg-bg2 border border-line2 rounded-b-md shadow-2 max-h-96 overflow-y-auto py-1">
          {households.map(h => {
            const m = PROFILE_TYPES[h.type];
            const isActive = h.id === currentId;
            return (
              <div
                key={h.id}
                onClick={() => { switchHousehold(h.id); setOpen(false); }}
                className={`flex items-center gap-2.5 px-3.5 py-2 cursor-pointer hover:bg-bg3 ${isActive ? 'bg-coral-tint' : ''}`}
              >
                <span className="text-base">{m.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[0.84rem] font-semibold text-ink truncate">{h.name}</div>
                  <div className="font-mono text-[0.56rem] tracking-wider text-ink-dim mt-px">
                    {m.label} · {h.baseCurrency}
                  </div>
                </div>
                {isActive && <Check size={14} className="text-coral" />}
              </div>
            );
          })}
          <div className="h-px bg-line my-1" />
          <div onClick={() => { setOpen(false); navigate('/households'); }}
            className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer hover:bg-bg3 text-coral font-mono text-[0.65rem] tracking-wider uppercase">
            <Plus size={14} /> {cloudEnabled ? 'Create or join household' : 'Create new profile'}
          </div>
          <div onClick={() => { setOpen(false); navigate('/households'); }}
            className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer hover:bg-bg3 text-coral font-mono text-[0.65rem] tracking-wider uppercase">
            <SettingsIcon size={14} /> Manage households
          </div>
          {/* Cloud-sync row — the live sync status badge sits beside the cloud icon
              here (v9.5.10), where it's reachable on BOTH desktop and mobile, instead
              of crammed into the desktop-only sidebar header. */}
          <div className="px-3.5 py-2 border-t border-line mt-1 flex items-center gap-2 font-mono text-[0.6rem] tracking-wider uppercase">
            {cloudEnabled
              ? <>
                  <Cloud size={11} className="text-sage shrink-0" />
                  <span className="text-sage flex-1 min-w-0 truncate">Cloud sync · {session?.user?.email}</span>
                  <span className="flex-shrink-0"><SyncStatusBadge /></span>
                </>
              : <><CloudOff size={11} className="text-ink-dim" /><span className="text-ink-dim">Local-only mode</span></>
            }
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
