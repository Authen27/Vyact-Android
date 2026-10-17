import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isAssetValueStale, valueDateLabel } from '../assetStaleness';

// 16 Oct 2026 (owner): the Net Worth page raised "Some bank or card balances haven't been updated in
// over 30 days" on EVERY visit. It named the wrong things and repeated itself, so it is gone; the
// row's own chip carries the notice and now says how old the value is.
const NOW = new Date('2026-10-16T12:00:00Z').getTime();

describe('Net Worth stale-value chip (v10.106.2)', () => {
  it('ASSET-STALE-001: flags a cash-like or short-term value older than 30 days, or never dated', () => {
    expect(isAssetValueStale({ type: 'investment', lastUpdated: '2026-06-14' }, NOW)).toBe(true);
    expect(isAssetValueStale({ type: 'savings', lastUpdated: '2026-09-01' }, NOW)).toBe(true);
    expect(isAssetValueStale({ type: 'cash', lastUpdated: undefined }, NOW)).toBe(true);
    expect(isAssetValueStale({ type: 'investment', lastUpdated: '2026-10-05' }, NOW)).toBe(false);
    expect(isAssetValueStale({ type: 'savings', lastUpdated: '2026-09-17' }, NOW)).toBe(false);
  });

  it('ASSET-STALE-002: never flags long-term holdings, however old', () => {
    for (const type of ['real_estate', 'vehicle', 'retirement', 'business', 'collectible']) {
      expect(isAssetValueStale({ type, lastUpdated: '2025-01-01' }, NOW)).toBe(false);
      expect(isAssetValueStale({ type, lastUpdated: undefined }, NOW)).toBe(false);
    }
  });

  it('ASSET-STALE-003: the chip label is the stored local day, with the year only when it differs', () => {
    const now = new Date(NOW);
    expect(valueDateLabel('2026-06-14', now)).toBe('14 Jun');
    expect(valueDateLabel('2026-01-01', now)).toBe('1 Jan');
    expect(valueDateLabel('2025-12-31', now)).toBe('31 Dec 2025');
    expect(valueDateLabel('2026-06-14T23:30:00Z', now)).toBe('14 Jun');   // never shifted by a time zone
    expect(valueDateLabel('not a date', now)).toBeNull();
    expect(valueDateLabel('2026-13-01', now)).toBeNull();
  });

  it('ASSET-STALE-004: the page no longer raises a stale toast; the chip shows the value date', () => {
    const page = readFileSync(resolve(__dirname, '../../pages/NetWorth.tsx'), 'utf8').replace(/\r\n/g, '\n');
    expect(page).not.toMatch(/haven.t been updated in over 30 days/);
    expect(page).not.toMatch(/bank or card balances/);
    expect(page).not.toMatch(/useEffect/);
    expect(page).toMatch(/isAssetValueStale\(row\.asset\)/);
    expect(page).toMatch(/\$\{since\} · Update/);
  });
});
