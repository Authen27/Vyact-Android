import { type ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  message: string;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({ icon = '◇', message, action, className = '' }: Props) {
  return (
    <div className={`text-center py-9 px-5 text-ink-mid ${className}`}>
      <div className="text-[1.8rem] mb-2.5 opacity-60">{icon}</div>
      <p className="font-mono text-[0.66rem] tracking-[0.1em] uppercase text-ink-dim leading-relaxed">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
