import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { useStore } from '../../store';
import { kvGet, kvSet } from '../kvStore';
import { claimDue, enqueueOp, IdbDriver, pendingCount, setDriverForTests } from '../sync/outbox';
import { purgeCachedCloudData } from '../cacheInvalidation';

vi.mock('../supabase', () => ({ isCloudEnabled: () => false, supabase: null }));

const session = (id: string) => ({ user: { id, email: `${id}@example.com` } } as Session);
let driver: IdbDriver;
beforeEach(async () => {
  driver = new IdbDriver();
  await driver.transaction(rows => rows.clear());
  setDriverForTests(driver);
  useStore.setState({ ...useStore.getInitialState(), cloudEnabled: true });
});
afterEach(async () => { await driver.close(); setDriverForTests(null); vi.restoreAllMocks(); });

it('signs out Alice then hydrates Bob only after Alice cache is cleared, preserving Alice outbox', async () => {
  await kvSet('alice-house_transactions', [{ id: 'alice-txn' }]);
  await enqueueOp({ ts: 1, op: 'upsert', householdId: 'alice-house', entity: 'transactions', payload: { id: crypto.randomUUID() } }, 'alice');
  useStore.setState({ session: session('alice'), currentHouseholdId: 'alice-house',
    transactions: [{ id: 'alice-txn' }] as never, budgetAllocations: [{ id: 'alice-allocation' }] as never,
    recurringSchedules: [{ id: 'alice-schedule' }] as never, notifications: [{ id: 'alice-notification' }] as never,
    sharedSplitsOwned: [{ id: 'alice-split' }] as never, sharedSplitsWithMe: [{ id: 'alice-share' }] as never });
  useStore.getState().setSession(null);
  for (const key of ['transactions', 'budgetAllocations', 'recurringSchedules', 'notifications', 'sharedSplitsOwned', 'sharedSplitsWithMe'] as const) {
    expect(useStore.getState()[key], key).toEqual([]);
  }
  await vi.waitFor(async () => expect(await kvGet('alice-house_transactions')).toBeNull());
  let cacheAtHydration: unknown = 'not-hydrated';
  const init = vi.fn(async () => {
    cacheAtHydration = await kvGet('alice-house_transactions');
    useStore.setState({ currentHouseholdId: 'bob-house', transactions: [{ id: 'bob-txn' }] as never });
  });
  useStore.setState({ init });
  useStore.getState().setSession(session('bob'));
  await vi.waitFor(() => expect(useStore.getState().currentHouseholdId).toBe('bob-house'));
  expect(cacheAtHydration).toBeNull();
  expect(init).toHaveBeenCalledOnce();
  expect(useStore.getState().transactions).toEqual([{ id: 'bob-txn' }]);
  expect(await pendingCount()).toBe(1);
  expect(await claimDue('bob-worker', Date.now(), 'bob')).toEqual([]);
  expect(await claimDue('alice-worker', Date.now(), 'alice')).toHaveLength(1);
});

it('hydrates a successful fresh session once without reinitializing on token refresh', async () => {
  await purgeCachedCloudData();
  const init = vi.fn().mockResolvedValue(undefined);
  useStore.setState({ session: null, init });
  useStore.getState().setSession(session('alice'));
  await vi.waitFor(() => expect(init).toHaveBeenCalledOnce());
  useStore.getState().setSession({ ...session('alice'), access_token: 'refreshed-test-token' });
  expect(init).toHaveBeenCalledOnce();
  expect(useStore.getState().sessionLoaded).toBe(true);
});