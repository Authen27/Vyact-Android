import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onStorageEvent, emitStorageEvent, isQuotaError } from '../storageEvents';

// CON-UNIT-057 / 058 / 059 — TD-14 storage refactor.
//
// vitest runs in `node` env (no DOM), so we install a minimal
// localStorage polyfill on globalThis for the duration of the test
// file. IndexedDB stays undefined — kvStore's localStorage / memory
// fallback paths are what the unit pins guarantee.

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  get length() { return this.m.size; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
}

const g = globalThis as unknown as { localStorage?: MemStorage };

beforeEach(async () => {
  g.localStorage = new MemStorage();
  const { _resetKvForTests } = await import('../kvStore');
  _resetKvForTests();
});

afterEach(() => {
  delete g.localStorage;
});

describe('TD-14 kvStore (CON-UNIT-057)', () => {
  it('round-trips JSON via the localStorage fallback when IDB is unavailable', async () => {
    const { kvSet, kvGet, kvRemove } = await import('../kvStore');
    await kvSet('demo', { hello: 'world', n: 7 });
    expect(await kvGet<{ hello: string; n: number }>('demo')).toEqual({ hello: 'world', n: 7 });
    await kvRemove('demo');
    expect(await kvGet('demo')).toBeNull();
  });
});

describe('TD-14 quota surfacing (CON-UNIT-058)', () => {
  it('emits a quota-exceeded event when localStorage.setItem throws', async () => {
    const ls = (await import('../localStorageCompat')).default;
    const events: unknown[] = [];
    const unsub = onStorageEvent(e => { events.push(e); });

    const stub = vi.spyOn(g.localStorage!, 'setItem').mockImplementation(() => {
      const err = new Error('mock quota');
      (err as { name?: string }).name = 'QuotaExceededError';
      throw err;
    });
    try {
      ls.setString('big', 'x'.repeat(10));
    } finally {
      stub.mockRestore();
      unsub();
    }

    expect(events).toHaveLength(1);
    expect((events[0] as { kind: string }).kind).toBe('quota-exceeded');
  });

  it('isQuotaError detects all common quota error shapes', () => {
    expect(isQuotaError(Object.assign(new Error('x'), { name: 'QuotaExceededError' }))).toBe(true);
    expect(isQuotaError(Object.assign(new Error('x'), { name: 'NS_ERROR_DOM_QUOTA_REACHED' }))).toBe(true);
    expect(isQuotaError(Object.assign(new Error('x'), { code: 22 }))).toBe(true);
    expect(isQuotaError(new Error('disk quota reached'))).toBe(true);
    expect(isQuotaError(new Error('something else'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });

  it('emitStorageEvent never throws when a listener throws', () => {
    const unsub = onStorageEvent(() => { throw new Error('listener bug'); });
    expect(() => emitStorageEvent({ kind: 'quota-exceeded', key: 'k', error: null })).not.toThrow();
    unsub();
  });
});

describe('TD-14 legacy key migration (CON-UNIT-059)', () => {
  it('kvGet falls back to a legacy ff_ key when no vt_ value exists', async () => {
    g.localStorage!.setItem('ff_legacy_demo', JSON.stringify({ from: 'ff' }));
    const { kvGet } = await import('../kvStore');
    expect(await kvGet<{ from: string }>('legacy_demo')).toEqual({ from: 'ff' });
  });

  it('prefers a vt_ value over a stale ff_ value', async () => {
    g.localStorage!.setItem('vt_dup', JSON.stringify({ src: 'vt' }));
    g.localStorage!.setItem('ff_dup', JSON.stringify({ src: 'ff' }));
    const { kvGet } = await import('../kvStore');
    expect(await kvGet<{ src: string }>('dup')).toEqual({ src: 'vt' });
  });
});
