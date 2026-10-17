import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isChunkLoadError, shouldReloadForChunk } from '../chunkRecovery';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}

describe('error screen and stale chunks (W6, audit FE-UIS-12)', () => {
  it('W6-UIS12-001 · recognises a failed chunk in each browser\'s wording, and nothing else', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://vyact.app/assets/Reports-1a2b.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);           // Safari
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);    // Firefox
    expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'x' })).toBe(true);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'amount')"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it('W6-UIS12-002 · reloads once per minute at most, and never when it cannot remember', () => {
    const store = memory();
    expect(shouldReloadForChunk(store, 1_000_000)).toBe(true);
    expect(shouldReloadForChunk(store, 1_030_000)).toBe(false);     // the reload did not help: show the error
    expect(shouldReloadForChunk(store, 1_061_000)).toBe(true);
    expect(shouldReloadForChunk(null, 1)).toBe(false);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => undefined };
    expect(shouldReloadForChunk(broken, 1)).toBe(false);
  });

  it('W6-UIS12-003 · the boundary records the crash, its fallback uses real classes, a second Try Again reloads; main listens for vite:preloadError', () => {
    const boundary = readFileSync(resolve(__dirname, '../../components/ui/ErrorBoundary.tsx'), 'utf8');
    expect(boundary).toMatch(/unexpected\(error, 'render:ErrorBoundary'\)/);
    expect(boundary).not.toMatch(/bg-bone|text-bone/);
    expect(boundary).toMatch(/if \(this\.resets >= 1\) \{ window\.location\.reload\(\); return; \}/);
    const main = readFileSync(resolve(__dirname, '../../main.tsx'), 'utf8');
    expect(main).toMatch(/addEventListener\('vite:preloadError'/);
  });
});
