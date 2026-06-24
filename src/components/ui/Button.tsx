import { type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'ghost' | 'danger';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  full?: boolean;
}

export default function Button({ variant = 'primary', full = false, className = '', children, ...rest }: Props) {
  const base = 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-mono uppercase font-medium transition-all duration-150 rounded-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
  const sizes = 'text-[0.66rem] tracking-[0.12em] px-5 py-2.5';
  const variantCls: Record<Variant, string> = {
    primary: 'bg-coral text-white shadow-1 hover:brightness-110 hover:-translate-y-px hover:shadow-2 active:translate-y-0',
    ghost:   'bg-transparent border border-line text-ink-mid hover:border-line2 hover:bg-bg3 hover:text-ink',
    danger:  'bg-transparent border border-line text-ink-mid hover:border-terra hover:bg-coral-tint hover:text-terra',
  };
  return (
    <button className={`${base} ${sizes} ${variantCls[variant]} ${full ? 'w-full' : ''} ${className}`} {...rest}>
      {children}
    </button>
  );
}
