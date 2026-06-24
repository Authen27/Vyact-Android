import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, X } from 'lucide-react';
import { useStore } from '../../store';
import type { NotifType } from '../../types';

const TYPE_LABEL: Record<NotifType, string> = {
  upcoming_bill:    'Upcoming bill',
  missed_payment:   'Missed payment',
  budget_threshold: 'Budget',
  goal_milestone:   'Goal milestone',
  weekly_digest:    'Weekly digest',
  custom_reminder:  'Reminder',
};

const TYPE_DOT: Record<NotifType, string> = {
  upcoming_bill:    'bg-honey',
  missed_payment:   'bg-terra',
  budget_threshold: 'bg-coral',
  goal_milestone:   'bg-sage',
  weekly_digest:    'bg-denim',
  custom_reminder:  'bg-plum',
};

export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const notifications = useStore(s => s.notifications);
  const markRead = useStore(s => s.markNotificationRead);
  const dismiss = useStore(s => s.dismissNotification);

  const active = notifications.filter(n => n.status !== 'dismissed');
  const unreadCount = active.filter(n => n.status === 'unread').length;

  // v6.4: Compute popover position so it always stays inside the viewport.
  // Previous implementation used `absolute right-0 w-80` inside the fixed
  // sidebar, which clipped the popover on narrow desktops and made the
  // notification text unreadable.
  useEffect(() => {
    if (!open) return;
    const computePos = () => {
      const btn = btnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 12;
      const desiredWidth = Math.min(320, vw - margin * 2);
      // Right-align with the bell where possible; clamp inside viewport.
      let left = rect.right - desiredWidth;
      if (left < margin) left = margin;
      if (left + desiredWidth > vw - margin) left = vw - margin - desiredWidth;
      const top = Math.min(rect.bottom + 4, vh - margin - 100);
      const maxHeight = Math.max(220, vh - top - margin);
      setPos({ top, left, width: desiredWidth, maxHeight: Math.min(maxHeight, 480) });
    };
    computePos();
    window.addEventListener('resize', computePos);
    window.addEventListener('scroll', computePos, true);
    return () => {
      window.removeEventListener('resize', computePos);
      window.removeEventListener('scroll', computePos, true);
    };
  }, [open]);

  useEffect(() => {
    const onClickAway = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClickAway);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickAway);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-md text-ink-mid hover:text-ink hover:bg-bg3 transition-colors"
        title="Notifications"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 bg-coral text-white text-[0.55rem] font-mono font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={popRef}
          className="fixed z-[100] bg-bg2 border border-line2 rounded-md shadow-2 overflow-y-auto"
          style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
        >
          <div className="px-3 py-2.5 border-b border-line flex justify-between items-center sticky top-0 bg-bg2">
            <span className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-mid font-medium">
              Notifications {unreadCount > 0 && `· ${unreadCount} unread`}
            </span>
          </div>

          {active.length === 0 ? (
            <div className="text-center py-10 text-ink-dim font-mono text-[0.62rem] tracking-wider uppercase">
              All clear · Nothing new
            </div>
          ) : (
            <div className="divide-y divide-line">
              {active.map(n => (
                <div
                  key={n.id}
                  className={`px-3 py-2.5 flex items-start gap-2.5 group ${n.status === 'unread' ? 'bg-coral-tint/40' : ''}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${TYPE_DOT[n.type]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[0.55rem] tracking-[0.1em] uppercase text-ink-dim mb-0.5">
                      {TYPE_LABEL[n.type]}
                    </div>
                    <div className="text-[0.84rem] font-semibold text-ink leading-snug break-words">{n.title}</div>
                    <div className="text-[0.78rem] text-ink-mid leading-snug mt-0.5 break-words">{n.body}</div>
                  </div>
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100">
                    {n.status === 'unread' && (
                      <button onClick={() => markRead(n.id)} className="p-1 hover:text-sage" title="Mark read">
                        <Check size={12} />
                      </button>
                    )}
                    <button onClick={() => dismiss(n.id)} className="p-1 hover:text-terra" title="Dismiss">
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
