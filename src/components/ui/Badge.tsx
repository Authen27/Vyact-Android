import { type ReactNode } from 'react';

type Tone = 'good' | 'warn' | 'alert' | 'info' | 'neutral' | 'plum' | 'denim';

interface Props {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

const toneClass: Record<Tone, string> = {
  good:    'bg-sage/15 text-olive border-sage/30',
  warn:    'bg-honey/15 text-[#B5774A] border-honey/30',
  alert:   'bg-coral-tint text-terra border-terra/30',
  info:    'bg-denim/10 text-denim border-denim/30',
  neutral: 'bg-bg3 text-ink-dim border-line',
  plum:    'bg-plum/10 text-plum border-plum/30',
  denim:   'bg-denim/10 text-denim border-denim/30',
};

export default function Badge({ tone = 'neutral', children, className = '' }: Props) {
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[0.55rem] tracking-[0.1em] uppercase px-2 py-0.5 rounded-pill border ${toneClass[tone]} ${className}`}>
      {children}
    </span>
  );
}
