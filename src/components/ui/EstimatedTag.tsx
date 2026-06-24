// Vyact — honest-data rendering (spec §5.5).
//
// A single shared tag. Any value whose confidence !== 'confirmed' renders it, so
// an estimate always *looks* like an estimate and is never styled as real data.
// "confirming" (real data has begun reconciling) reads slightly warmer than a
// fresh "estimated" value.

import type { Confidence } from '../../lib/onboardingState';

interface Props {
  confidence: Confidence;
  className?: string;
}

const LABEL: Record<Exclude<Confidence, 'confirmed'>, string> = {
  estimated: 'Estimated',
  confirming: 'Confirming',
};

export default function EstimatedTag({ confidence, className = '' }: Props) {
  if (confidence === 'confirmed') return null;
  const tone =
    confidence === 'confirming'
      ? 'bg-honey/15 text-honey border-honey/30'
      : 'bg-bg3 text-ink-mid border-line';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[0.55rem] tracking-[0.1em] uppercase leading-none ${tone} ${className}`}
      title={
        confidence === 'confirming'
          ? 'Real data is tracking against this estimate — tap to confirm.'
          : 'You placed this estimate during setup. It converges to confirmed as real data lands.'
      }
    >
      <span aria-hidden>≈</span>
      {LABEL[confidence]}
    </span>
  );
}
