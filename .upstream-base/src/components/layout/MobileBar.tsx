import { Menu, Sun, Moon, Monitor } from 'lucide-react';
import { useStore } from '../../store';
import type { Theme } from '../../types';
import NotificationCenter from './NotificationCenter';

interface Props { onMenu: () => void; }

export default function MobileBar({ onMenu }: Props) {
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);

  const cycle = () => {
    const next: Theme = theme === 'warm' ? 'dark' : theme === 'dark' ? 'system' : 'warm';
    setTheme(next);
  };

  const Icon = theme === 'dark' ? Moon : theme === 'system' ? Monitor : Sun;

  return (
    // paddingTop keeps the bar clear of the Android status bar (safe-area inset);
    // 0px fallback means no change on web / devices without an inset.
    <header
      className="lg:hidden sticky top-0 z-30 bg-bg2 border-b border-line backdrop-blur"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="h-14 flex items-center justify-between px-4">
        <button
          onClick={onMenu}
          aria-label="Open navigation menu"
          className="btn-icon btn-sm"
        >
          <Menu size={18} strokeWidth={1.5} />
        </button>
        <div className="text-2xl text-ink leading-none"
             style={{ fontFamily: 'var(--ff-serif)', fontWeight: 300, letterSpacing: '-0.015em' }}>
          Vyact
        </div>
        <div className="flex items-center gap-1.5">
          <NotificationCenter />
          <button
            onClick={cycle}
            aria-label="Toggle theme"
            className="btn-icon btn-sm"
          >
            <Icon size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </header>
  );
}
