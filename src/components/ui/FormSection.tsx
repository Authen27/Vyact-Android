import { useId, type ReactNode } from 'react';

// Aurora 4.0 FL1 / RE3 — a long form in short headed groups ("The loan · Repayment · Paying it",
// "What · When · How"), so the fields read as a few questions instead of one long column.
export default function FormSection({ title, note, children, className = '' }: {
  title: string;
  /** One optional line under the heading. */
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`mt-5 first:mt-1 ${className}`}>
      <h2 id={id} className="text-[14px] font-semibold text-ink">{title}</h2>
      {note && <p className="text-[12px] text-ink-dim leading-snug mt-0.5">{note}</p>}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}
