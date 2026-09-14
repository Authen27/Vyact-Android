// P4.5 — the honest-data tag must not tell an agent-created row the onboarding
// story ("you placed this estimate during setup"). No DOM here: the vitest env
// is 'node', so we assert the pure copy resolver instead of rendering.

import { describe, it, expect } from 'vitest';
import { estimatedTagCopy } from '../EstimatedTag';

describe('estimatedTagCopy', () => {
  it('renders nothing for confirmed values, whatever the source', () => {
    expect(estimatedTagCopy('confirmed')).toBeNull();
    expect(estimatedTagCopy('confirmed', 'agent')).toBeNull();
    expect(estimatedTagCopy('confirmed', 'onboarding')).toBeNull();
  });

  it('keeps the original onboarding copy when no source is given', () => {
    expect(estimatedTagCopy('estimated')).toEqual({
      label: 'Estimated',
      title:
        'You placed this estimate during setup. It converges to confirmed as real data lands.',
      glyph: '≈',
    });
    expect(estimatedTagCopy('confirming')).toEqual({
      label: 'Confirming',
      title: 'Real data is tracking against this estimate — tap to confirm.',
      glyph: '≈',
    });
  });

  it('keeps the onboarding copy for onboarding/user/bank sources', () => {
    for (const source of ['onboarding', 'user', 'bank'] as const) {
      expect(estimatedTagCopy('estimated', source)).toEqual(estimatedTagCopy('estimated'));
    }
  });

  it('tells an agent row the truth: Vyact read it from a message', () => {
    const copy = estimatedTagCopy('estimated', 'agent');
    expect(copy).not.toBeNull();
    expect(copy!.title).toBe('Vyact read this from a message. Check the details.');
    // Never the setup story, and never "approximately" — the figure was read,
    // not guessed.
    expect(copy!.title).not.toMatch(/during setup/);
    expect(copy!.glyph).toBeNull();
    expect(copy!.label).toBe('Unconfirmed');
  });

  it('uses the agent voice for confirming agent rows too', () => {
    expect(estimatedTagCopy('confirming', 'agent')).toEqual({
      label: 'Confirming',
      title: 'Vyact read this from a message. Check the details.',
      glyph: null,
    });
  });
});
