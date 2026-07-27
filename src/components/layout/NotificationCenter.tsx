// Aurora notification bell (v10.1) — the neu circle in the top bar. Opens the
// full-screen NotificationSheet (pull-down) rather than an anchored popover.
// Badge = unread count for the ACTIVE household only, capped 9+.
import { useState } from 'react';
import { Bell } from 'lucide-react';
import { useStore } from '../../store';
import NotificationSheet from './NotificationSheet';

export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const notifications = useStore(s => s.notifications);
  const currentHouseholdId = useStore(s => s.currentHouseholdId);

  const unread = notifications.filter(
    n => n.status === 'unread' && (!n.householdId || n.householdId === currentHouseholdId),
  ).length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative w-10 h-10 rounded-full border-none flex items-center justify-center text-ink-mid hover:text-ink transition-colors cursor-pointer"
        style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}
        title="Notifications"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span
            className="absolute top-1.5 right-1.5 bg-coral text-white text-[0.55rem] font-mono font-bold rounded-full min-w-[14px] h-3.5 px-0.5 flex items-center justify-center"
            style={{ boxShadow: '0 0 0 2px var(--canvas)' }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <NotificationSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
