import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HybridAdapter } from '../hybridAdapter';
import { ack, claimDue, enqueueOp, IdbDriver, pendingCount, setDriverForTests } from '../sync/outbox';

let driver: IdbDriver;
beforeEach(async () => {
  driver = new IdbDriver();
  await driver.transaction(rows => rows.clear());
  setDriverForTests(driver);
});
afterEach(async () => { await driver.close(); setDriverForTests(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('outbox IndexedDB transaction contract', () => {
  it('CON-UNIT-917 - HybridAdapter drains a write enqueued during a delayed cloud request', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const householdId = crypto.randomUUID();
    const entityId = crypto.randomUUID();
    const adapter = new HybridAdapter({} as SupabaseClient);
    vi.spyOn(adapter.cloud, 'currentUserId').mockResolvedValue('alice');
    let resolveFirst!: (row: { id: string; updated_at: string }) => void;
    const upsert = vi.spyOn(adapter.cloud, 'upsert')
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValue({ id: entityId, updated_at: 'server-second' });
    await enqueueOp({ ts: 1, op: 'upsert', entity: 'accounts', householdId, payload: { id: entityId } }, 'alice');
    const flushing = adapter.flushQueue();
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    await enqueueOp({ ts: 2, op: 'upsert', entity: 'accounts', householdId,
      payload: { id: entityId, name: 'Second edit' }, expectedUpdatedAt: 'local-clock' }, 'alice');
    resolveFirst({ id: entityId, updated_at: 'server-first' });
    await flushing;
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[1][3]).toBe('server-first');
    expect(await pendingCount()).toBe(0);
    expect(await adapter.cache.list('accounts', householdId)).toContainEqual({ id: entityId, updated_at: 'server-second' });
  });
  it('CON-UNIT-913 - competing claims own a row only once', async () => {
    await enqueueOp({ op: 'upsert', ts: 1, householdId: 'household', entity: 'transactions', payload: { id: crypto.randomUUID() } }, 'alice');
    const [first, second] = await Promise.all([claimDue('first', 1000, 'alice'), claimDue('second', 1000, 'alice')]);
    expect(first.length + second.length).toBe(1);
    const claimed = first[0] ?? second[0];
    await ack(claimed.opId, 'wrong-worker');
    expect(await pendingCount()).toBe(1);
    await ack(claimed.opId, claimed.claimedBy);
    expect(await pendingCount()).toBe(0);
  });
  it('CON-UNIT-914 - aborted storage work never reports a successful durable write', async () => {
    await expect(driver.transaction(rows => {
      rows.set('bad', { opId: 'bad', seq: 1, ts: 1, op: 'upsert', householdId: 'household',
        status: 'pending', ownerUid: 'alice', payload: () => 'not-cloneable' });
    })).rejects.toThrow();
    expect(await pendingCount()).toBe(0);
  });
  it('CON-UNIT-915 - unknown owners are quarantined and writes survive closing the database', async () => {
    await enqueueOp({ ts: 1, op: 'updateProfile', householdId: 'household', payload: { name: 'Alice' } }, null);
    expect(await claimDue('worker', 1000, 'bob')).toEqual([]);
    await driver.close();
    expect(await pendingCount()).toBe(1);
  });
  it('CON-UNIT-916 - a later entity write cannot overtake an older backoff operation', async () => {
    await enqueueOp({ ts: 1, op: 'upsert', entity: 'accounts', householdId: 'household', nextRetryAt: 2000 }, 'alice');
    await enqueueOp({ ts: 2, op: 'upsert', entity: 'accounts', householdId: 'household' }, 'alice');
    expect(await claimDue('worker', 1000, 'alice')).toEqual([]);
  });
});