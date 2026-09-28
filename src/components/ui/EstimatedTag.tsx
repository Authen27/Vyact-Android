// Vyact — honest-data rendering (spec §5.5).
//
// A single shared tag. Any value whose confidence !== 'confirmed' renders it, so
// an estimate always *looks* like an estimate and is never styled as real data.
// "confirming" (real data has begun reconciling) reads slightly warmer than a
// fresh "estimated" value.
//
// P4.5 — the tag is SOURCE-AWARE. An onboarding estimate is a number the user
// placed themselves; an 'agent' row is a number Vyact read out of a message.
// Telling the user the first story about the second one would be dishonest, so
// the copy (and the ≈ glyph, which means "approximately") switches on `source`.
// Any other/absent source keeps the original onboarding wording byte-for-byte.

import type { Confidence, ProvenanceSource } from '../../lib/onboardingState';

interface Props {
  confidence: Confidence;
  /** Defaults to the onboarding/legacy voice when absent. */
  source?: ProvenanceSource;
  className?: string;
  title?: string;
}

const LABEL: Record<Exclude<Confidence, 'confirmed'>, string> = {
  estimated: 'Estimated',
  confirming: 'Confirming',
};

/** Agent rows are read, not guessed — "Estimated" would misdescribe them. */
const AGENT_LABEL: Record<Exclude<Confidence, 'confirmed'>, string> = {
  estimated: 'Unconfirmed',
  confirming: 'Confirming',
};

const AGENT_TITLE = 'Vyact read this from a message. Check the details.';

/** Pure copy resolver — exported so the wording is unit-testable without a DOM. */
export function estimatedTagCopy(
  confidence: Confidence,
  source?: ProvenanceSource,
): { label: string; title: string; glyph: string | null } | null {
  if (confidence === 'confirmed') return null;
  if (source === 'agent') {
    return { label: AGENT_LABEL[confidence], title: AGENT_TITLE, glyph: null };
  }
  return {
    label: LABEL[confidence],
    title:
      confidence === 'confirming'
        ? 'Real data is tracking against this estimate — tap to confirm.'
        : 'You placed this estimate during setup. It converges to confirmed as real data lands.',
    glyph: '≈',
  };
}

export default function EstimatedTag({ confidence, source, className = '', title }: Props) {
  const copy = estimatedTagCopy(confidence, source);
  if (!copy) return null;
  // Literal class strings only — an interpolated `text-${tone}` never survives
  // the Tailwind purge. Colour comes from Tailwind tokens, which already wrap
  // the HSL triplets in hsl(); no raw var(--triplet) here.
  const tone =
    source === 'agent'
      ? 'bg-bg3 text-ink-dim border-line'
      : confidence === 'confirming'
        ? 'bg-honey/15 text-honey border-honey/30'
        : 'bg-bg3 text-ink-mid border-line';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[0.55rem] tracking-[0.1em] uppercase leading-none ${tone} ${className}`}
      title={title ?? copy.title}
    >
      {copy.glyph && <span aria-hidden>{copy.glyph}</span>}
      {copy.label}
    </span>
  );
}
