import { type ReactNode } from 'react';

interface CardProps {
  label?: string;
  value?: ReactNode;
  sub?: ReactNode;
  accent?: 'coral'|'sage'|'terra'|'honey'|'denim'|'plum';
  children?: ReactNode;
  className?: string;
}

const accentBar: Record<NonNullable<CardProps['accent']>, string> = {
  coral: 'after:bg-coral',
  sage:  'after:bg-sage',
  terra: 'after:bg-terra',
  honey: 'after:bg-honey',
  denim: 'after:bg-denim',
  plum:  'after:bg-plum',
};

export function Card({ label, value, sub, accent, children, className = '' }: CardProps) {
  return (
    <div className={`relative overflow-hidden bg-bg2 border border-line rounded-md p-4 sm:p-5 shadow-1 transition-all hover:border-line2 hover:-translate-y-0.5 hover:shadow-2 min-w-0 ${accent ? `after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 ${accentBar[accent]}` : ''} ${className}`}>
      {label && <div className="mono-label mb-2.5">{label}</div>}
      {value !== undefined && <div className="num font-semibold text-[1.4rem] sm:text-[1.7rem] lg:text-[1.95rem] leading-none text-ink mb-1.5 min-w-0">{value}</div>}
      {sub && <div className="font-mono text-[0.58rem] text-ink-dim tracking-wider truncate">{sub}</div>}
      {children}
    </div>
  );
}

interface PanelProps {
  title?: string;
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, sub, action, children, className = '' }: PanelProps) {
  return (
    <div className={`panel overflow-hidden ${className}`}>
      {(title || action) && (
        <div className="flex justify-between items-center px-4 py-3 border-b border-line gap-3 flex-wrap">
          {title && <h2 className="font-mono text-[0.62rem] font-medium tracking-[0.16em] uppercase text-ink">{title}</h2>}
          {sub && <span className="font-mono text-[0.6rem] text-ink-dim tracking-wider">{sub}</span>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
