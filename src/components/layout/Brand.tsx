// pip + wordmark (Aurora v10). pip keeps his coral face on any theme;
// wordmark is "Vy" in ink + "act" in the accent, per handoff §10.
import { useId } from 'react';
import { Link } from 'react-router-dom';

export function Pip({ size = 28 }: { size?: number }) {
  // Unique per instance — TopBar (desktop) and MobileHeader both mount a
  // <Pip> at once; a shared literal id="pip-grad" is a duplicate-DOM-id bug.
  const gradId = `pip-grad-${useId()}`;
  return (
    <svg viewBox="0 0 36 36" width={size} height={size} aria-hidden>
      <defs>
        <radialGradient id={gradId} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#F4B6A8" />
          <stop offset="100%" stopColor="#E26D5C" />
        </radialGradient>
      </defs>
      <path d="M18 3 C 27 3, 33 9, 33 18 C 33 27, 27 33, 18 33 C 9 33, 3 27, 3 18 C 3 9, 9 3, 18 3 Z" fill={`url(#${gradId})`} stroke="#2A2522" strokeWidth="1.2" />
      <ellipse cx="13" cy="16" rx="1.4" ry="1.8" fill="#2A2522" />
      <ellipse cx="23" cy="16" rx="1.4" ry="1.8" fill="#2A2522" />
      <circle cx="9.5" cy="20" r="1.6" fill="#F4B6A8" opacity="0.8" />
      <circle cx="26.5" cy="20" r="1.6" fill="#F4B6A8" opacity="0.8" />
      <path d="M14 22 Q 18 25, 22 22" stroke="#2A2522" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <path d="M18 3 Q 16 -1, 14 1 Q 17 3, 18 3 Z" fill="#85A88A" stroke="#2A2522" strokeWidth="0.8" />
    </svg>
  );
}

export default function Brand({ size = 26 }: { size?: number }) {
  return (
    <Link
      to="/dashboard"
      aria-label="Vyact — go to dashboard"
      className="flex items-center gap-2 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40"
    >
      <Pip size={size} />
      <span className="font-display font-semibold text-[1.15rem] leading-none text-ink tracking-tight">
        Vy<span style={{ color: 'var(--accent)' }}>act</span>
      </span>
    </Link>
  );
}
