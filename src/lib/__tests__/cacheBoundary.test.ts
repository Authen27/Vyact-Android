import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HybridAdapter } from '../hybridAdapter';
import { kvGet, kvSet } from '../kvStore';
import { purgeCachedCloudData } from '../cacheInvalidation';
import ls from '../localStorageCompat';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('actual cache consumers across a purge', () => {
  it('CON-UNIT-911 - a delayed delta cannot refill a purged entity cache', async () => {
    const household = crypto.randomUUID();
    await kvSet(`${household}_transactions`, [{ id: 'old' }]);
    const adapter = new HybridAdapter({} as SupabaseClient);
    vi.spyOn(ls, 'readString').mockImplementation(key => key.startsWith('cursor_') ? '2026-09-01T00:00:00Z' : null);
    const delta = { rows: [{ id: 'late', amount: 10 }], tombstones: [], maxUpdatedAt: '2026-09-09T00:00:00Z|late' };
    let finish!: (result: typeof delta) => void;
    vi.spyOn(adapter.cloud, 'listSince').mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const application = vi.spyOn(adapter as unknown as { applyCloudDelta(...args: unknown[]): Promise<void> }, 'applyCloudDelta');
    await adapter.list('transactions', household);
    await purgeCachedCloudData();
    finish(delta);
    await vi.waitFor(() => expect(application).toHaveBeenCalledTimes(1));
    await application.mock.results[0].value;
    expect(await kvGet(`${household}_transactions`)).toBeNull();
  });

  it('CON-UNIT-912 - purge clears the real chat and cursor key shapes', async () => {
    const household = crypto.randomUUID();
    await kvSet(`chat_history_${household}`, [{ content: 'private' }]);
    await kvSet(`cursor_${household}_transactions`, '2026-09-01T00:00:00Z');
    await purgeCachedCloudData();
    expect(await kvGet(`chat_history_${household}`)).toBeNull();
    expect(await kvGet(`cursor_${household}_transactions`)).toBeNull();
  });
});