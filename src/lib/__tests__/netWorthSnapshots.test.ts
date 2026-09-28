import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NetWorthProjection } from '../netWorth';
import {
  hasPositionData, mergeSnapshot, netWorthHistory, shouldRecordSnapshot, snapshotFromProjection,
  type NetWorthSnapshot,
} from '../netWorthSnapshots';
import { LocalStorageAdapter } from '../dataAdapter';
import { SupabaseAdapter } from '../supabaseAdapter';

const projection = (patch: Partial<NetWorthProjection> = {}): NetWorthProjection => ({
  baseCurrency: 'INR', assetRows: [{ id: 'bank' } as NetWorthProjection['assetRows'][number]], liabilityRows: [],
  totalAssets: 1500.004, totalLiabilities: 400.126, netWorth: 1099.88, liquidAssets: 700.5, ...patch,
});
const snap = (month: string, patch: Partial<NetWorthSnapshot> = {}): NetWorthSnapshot => ({
  month, totalAssets: 100, totalLiabilities: 40, netWorth: 60, liquidAssets: 50, currency: 'INR', recordedAt: `${month}-02T09:00:00Z`, ...patch,
});

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-11T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('Recorded Net Worth snapshots (v10.30.0)', () => {
  it('records the canonical projection rounded to cents, with net worth derived from the two sides', () => {
    expect(snapshotFromProjection(projection(), '2026-09', '2026-09-11T12:00:00.000Z')).toEqual({
      month: '2026-09', totalAssets: 1500, totalLiabilities: 400.13, netWorth: 1099.87, liquidAssets: 700.5,
      currency: 'INR', recordedAt: '2026-09-11T12:00:00.000Z',
    });
  });

  it('records only a loaded, non-empty position for a month not yet recorded', () => {
    expect(hasPositionData(projection({ assetRows: [], liabilityRows: [] }))).toBe(false);
    expect(shouldRecordSnapshot({ loading: true, hasPosition: true, snapshots: [] })).toBe(false);
    expect(shouldRecordSnapshot({ loading: false, hasPosition: false, snapshots: [] })).toBe(false);
    expect(shouldRecordSnapshot({ loading: false, hasPosition: true, snapshots: [snap('2026-09')] })).toBe(false);
    expect(shouldRecordSnapshot({ loading: false, hasPosition: true, snapshots: [snap('2026-08')] })).toBe(true);
  });

  it('keeps the first snapshot for a month and orders months ascending', () => {
    const merged = mergeSnapshot([snap('2026-09', { netWorth: 1 }), snap('2026-07')], snap('2026-09', { netWorth: 999 }));
    expect(merged.map(row => [row.month, row.netWorth])).toEqual([['2026-07', 60], ['2026-09', 1]]);
    expect(mergeSnapshot([snap('2026-09')], snap('2026-08')).map(row => row.month)).toEqual(['2026-08', '2026-09']);
  });

  it('draws history only from two or more recorded months in the household currency', () => {
    expect(netWorthHistory([snap('2026-09')], 'INR')).toMatchObject({ ready: false, otherCurrency: 0 });
    const history = netWorthHistory([snap('2026-09'), snap('2026-07', { currency: 'USD' }), snap('2026-08')], 'INR');
    expect(history.ready).toBe(true);
    expect(history.otherCurrency).toBe(1);
    expect(history.points.map(point => point.label)).toEqual(['Aug 2026', 'Sep 2026']);
  });

  it('local-only adapter: first write for a month wins and survives a later write', async () => {
    const adapter = new LocalStorageAdapter();
    const household = `nw-${Math.random().toString(36).slice(2)}`;
    expect(await adapter.recordNetWorthSnapshot(household, snap('2026-09', { netWorth: 60 }))).toMatchObject({ netWorth: 60 });
    expect(await adapter.recordNetWorthSnapshot(household, snap('2026-09', { netWorth: 999 }))).toMatchObject({ netWorth: 60 });
    await adapter.recordNetWorthSnapshot(household, snap('2026-08'));
    expect((await adapter.listNetWorthSnapshots(household)).map(row => [row.month, row.netWorth])).toEqual([['2026-08', 60], ['2026-09', 60]]);
  });

  it('cloud adapter: sends the two sides for the first of the month, never net worth, and maps the stored row', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { month: '2026-09-01', total_assets: '1500.00', total_liabilities: '400.13',
      net_worth: '1099.87', liquid_assets: '700.50', currency: 'INR', recorded_at: '2026-09-01T08:00:00Z' }, error: null });
    const adapter = new SupabaseAdapter({ rpc } as unknown as SupabaseClient);
    const stored = await adapter.recordNetWorthSnapshot('h1', snapshotFromProjection(projection(), '2026-09'));
    expect(rpc).toHaveBeenCalledWith('record_net_worth_snapshot', { p_household: 'h1', p_month: '2026-09-01',
      p_total_assets: 1500, p_total_liabilities: 400.13, p_liquid_assets: 700.5, p_currency: 'INR' });
    expect(stored).toEqual({ month: '2026-09', totalAssets: 1500, totalLiabilities: 400.13, netWorth: 1099.87,
      liquidAssets: 700.5, currency: 'INR', recordedAt: '2026-09-01T08:00:00Z' });
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await adapter.recordNetWorthSnapshot('h1', snap('2026-09'))).toBeNull();
  });

  it('cloud adapter: lists the household rows by month and surfaces a read error', async () => {
    const order = vi.fn().mockResolvedValue({ data: [{ month: '2026-08-01', total_assets: 10, total_liabilities: 4, net_worth: 6,
      liquid_assets: 5, currency: 'INR', recorded_at: '2026-08-03T00:00:00Z' }], error: null });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const adapter = new SupabaseAdapter({ from } as unknown as SupabaseClient);
    expect(await adapter.listNetWorthSnapshots('h1')).toEqual([{ month: '2026-08', totalAssets: 10, totalLiabilities: 4, netWorth: 6,
      liquidAssets: 5, currency: 'INR', recordedAt: '2026-08-03T00:00:00Z' }]);
    expect(from).toHaveBeenCalledWith('net_worth_snapshots');
    expect(eq).toHaveBeenCalledWith('household_id', 'h1');
    order.mockResolvedValueOnce({ data: null, error: { code: 'PGRST205', message: 'missing table' } });
    await expect(adapter.listNetWorthSnapshots('h1')).rejects.toMatchObject({ code: 'PGRST205' });
  });
});
