// W4d (v10.73.0; audit FE-UIS-04, INT-TXN-13, FE-UIC-04) — a bill card acts only on its own
// occurrence while it is the one due, a card handled elsewhere is cleared, and a figure that can go
// below zero keeps its minus.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationOccurrence, resolvedBillCards } from '../notifications';
import { fmtNet, fmtShortNet, fmt } from '../format';
import type { Notification, RecurringSchedule } from '../../types';

vi.mock('../supabase', () => ({ isCloudEnabled: () => false, supabase: null }));
const { useStore } = await import('../../store');
const { LocalStorageAdapter } = await import('../dataAdapter');
const { setLocalJson } = await import('../../store/localJson');

/** Node has no localStorage; the local notification list lives there. */
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

const card = (p: Partial<Notification> = {}): Notification => ({
  id: 'n-1', type: 'recurring_due_confirm', priority: 'P1', status: 'unread', createdAt: '2026-10-01T03:00:00Z',
  title: 'Rent', dedupeKey: 'recurring_due_confirm:s-1:2026-10-01', scheduleId: 's-1', dueAt: '2026-10-01', ...p,
} as Notification);
const sched = (p: Partial<RecurringSchedule> = {}): RecurringSchedule => ({
  id: 's-1', frequency: 'monthly', dayOfMonth: 1, startDate: '2026-01-01', nextDueDate: '2026-10-01', autoConfirm: false, active: true,
  transactionTemplate: { type: 'expense', amount: 25000, currency: 'INR', description: 'Rent', category: 'rent_mortgage', accountId: 'bank' },
  ...p,
} as RecurringSchedule);

describe('W4d · bill cards', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T06:00:00Z'));
    g.localStorage = new MemStorage();
    useStore.setState({ ...useStore.getInitialState(), adapter: new LocalStorageAdapter(), currentHouseholdId: crypto.randomUUID(),
      cloudEnabled: false, transactions: [], recurringSchedules: [],
      accounts: [{ id: 'bank', kind: 'bank', name: 'Bank', currency: 'INR', openingBalance: 0 }] as never });
  });
  afterEach(() => { vi.useRealTimers(); delete g.localStorage; });

  it('W4-BELL-001 · Approve and Skip act only on the card’s occurrence while it is the one due', async () => {
    // Already approved elsewhere: the schedule has moved on to 1 Nov.
    const s = await useStore.getState().upsertRecurring(sched({ nextDueDate: '2026-11-01', lastGenerated: '2026-10-01' }));
    expect(await useStore.getState().skipRecurring(s.id, '2026-10-01')).toBe(false);
    expect(await useStore.getState().approveRecurring(s.id, '2026-10-01')).toBe(false);
    let state = useStore.getState();
    expect(state.recurringSchedules[0].nextDueDate).toBe('2026-11-01');   // November is NOT skipped
    expect(state.transactions).toEqual([]);                              // nothing claimed as posted

    // The due one: Approve posts it; Skip on the next due one moves only that one.
    await useStore.getState().upsertRecurring({ ...useStore.getState().recurringSchedules[0], nextDueDate: '2026-10-01' });
    expect(await useStore.getState().approveRecurring(s.id, '2026-10-01')).toBe(true);
    state = useStore.getState();
    expect(state.transactions).toHaveLength(1);
    expect(state.recurringSchedules[0].nextDueDate).toBe('2026-11-01');
    expect(await useStore.getState().skipRecurring(s.id, '2026-11-01')).toBe(true);
    expect(useStore.getState().recurringSchedules[0].nextDueDate).toBe('2026-12-01');
  });

  it('W4-BELL-002 · a cloud card’s timestamp is read as its date, and cards handled elsewhere are cleared on refresh', async () => {
    expect(notificationOccurrence(card({ dueAt: '2026-10-01T00:00:00+00:00' }))).toBe('2026-10-01');
    expect(notificationOccurrence(card({ dueAt: undefined }))).toBeUndefined();

    const cards = [
      card({ id: 'moved' }),                                                        // schedule now at 1 Nov
      card({ id: 'current', scheduleId: 's-2' }),                                   // still due
      card({ id: 'paused', scheduleId: 's-3' }),                                    // schedule paused
      card({ id: 'unknown', scheduleId: 's-9' }),                                   // not loaded here: left alone
      card({ id: 'read', status: 'read' }),
    ];
    const schedules = [sched({ nextDueDate: '2026-11-01' }), sched({ id: 's-2' }), sched({ id: 's-3', active: false })];
    expect(resolvedBillCards(cards, schedules).sort()).toEqual(['moved', 'paused']);

    // Through the store (local household): the stale card is marked read, the current one stays.
    const hid = useStore.getState().currentHouseholdId;
    setLocalJson(`notifications_${hid}`, [card({ id: 'moved', householdId: hid }), card({ id: 'current', scheduleId: 's-2', householdId: hid })]);
    useStore.setState({ recurringSchedules: schedules });
    await useStore.getState().refreshNotifications();
    const byId = Object.fromEntries(useStore.getState().notifications.map(n => [n.id, n.status]));
    expect(byId).toMatchObject({ moved: 'read', current: 'unread' });
  });
});

describe('W4d · signs', () => {
  it('W4-SIGN-001 · a figure that can cross zero keeps its minus; a positive one gets no plus', () => {
    expect(fmtNet(-5000, 'INR')).toBe(`−${fmt(5000, 'INR')}`);
    expect(fmtNet(5000, 'INR')).toBe(fmt(5000, 'INR'));
    expect(fmtNet(0, 'INR')).toBe(fmt(0, 'INR'));
    expect(fmtShortNet(-20000, 'INR', 'indian')).toBe('−₹20K');
    expect(fmtShortNet(20000, 'INR', 'indian')).toBe('₹20K');
    // The old path printed the magnitude only.
    expect(fmt(-5000, 'INR')).toBe(fmt(5000, 'INR'));
  });
});
