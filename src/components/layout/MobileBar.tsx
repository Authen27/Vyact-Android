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
    <header className="lg:hidden sticky top-0 z-30 h-14 bg-bg2 border-b border-line flex items-center justify-between px-4 backdrop-blur">
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
    </header>
  );
}
