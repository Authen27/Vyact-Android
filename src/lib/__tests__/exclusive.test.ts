import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runExclusive } from '../exclusive';

describe('runExclusive (W6, audit FE-UIC-13)', () => {
  it('W6-UIC13-001 · a second call while the first is in flight is dropped; the slot frees afterwards, even on error', async () => {
    const slot = { current: false };
    let calls = 0;
    let release!: () => void;
    const work = () => { calls++; return new Promise<void>(r => { release = r; }); };
    const first = runExclusive(slot, work);
    const second = runExclusive(slot, work);          // the double tap, same tick
    expect(await second).toBe(false);
    expect(calls).toBe(1);
    release();
    expect(await first).toBe(true);
    expect(slot.current).toBe(false);
    await expect(runExclusive(slot, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(slot.current).toBe(false);                 // a failed save does not lock the button
    expect(await runExclusive(slot, async () => {})).toBe(true);
  });

  it('W6-UIC13-002 · the Recurring sheet saves through the guard and disables its button while saving', () => {
    const src = readFileSync(resolve(__dirname, '../../pages/Recurring.tsx'), 'utf8');
    expect(src).toMatch(/runExclusive\(savingSlot,/);
    expect(src).toMatch(/onClick=\{save\}[\s\S]{0,120}disabled=\{saving\}/);
  });
});
