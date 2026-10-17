// W4c (v10.72.0; owner decision D18; audit INT-TXN-01, FE-UIC-01, FE-PIP-03) — editing a split no
// longer erases it: split rows and Pip's split captures open the Split form, an edit is a patch over
// the opened row, and a participant who had paid keeps the day they paid.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editPatch, isSplitRow } from '../txnEdit';
import { paidOnFor } from '../splitParticipants';
import type { Transaction } from '../../types';

const nav = vi.hoisted(() => ({ appNavigate: vi.fn() }));
vi.mock('../appNavigation', () => ({ appNavigate: nav.appNavigate }));
vi.mock('../supabase', () => ({ isCloudEnabled: () => false, supabase: null }));

const { useStore } = await import('../../store');
const { LocalStorageAdapter } = await import('../dataAdapter');

const split: NonNullable<Transaction['split']> = {
  isSplit: true, totalAmount: 1200, yourShare: 600, paidBy: 'me',
  participants: [
    { name: 'You', isYou: true, share: 600, paid: true, paidOn: null },
    { name: 'Ravi', share: 600, paid: true, paidOn: '2026-09-02', email: 'ravi@example.com' },
  ],
};
const row = (p: Partial<Transaction> = {}): Transaction => ({
  id: 't-1', type: 'expense', amount: 1200, currency: 'INR', date: '2026-09-01', description: 'Dinner',
  category: 'food_dining', accountId: 'bank', paymentMethod: 'bank', note: 'birthday', split,
  recurringScheduleId: 's-1', debtId: undefined, confidence: 'estimated', source: 'onboarding',
  updated_at: '2026-09-01T10:00:00Z', ...p,
} as Transaction);

describe('W4c · editing keeps what the form does not show', () => {
  it('W4-D18-001 · an edit is a patch: the split, schedule link, note, provenance and version ride through; the picked account wins', () => {
    const built = { id: 't-1', type: 'expense', amount: 1500, currency: 'INR', date: '2026-09-01', description: 'Dinner out',
      category: 'food_dining', paymentMethod: 'card', excluded: undefined } as Transaction;
    const saved = editPatch(row({ excluded: true }), built);
    expect(saved).toMatchObject({ amount: 1500, description: 'Dinner out', paymentMethod: 'card', split, recurringScheduleId: 's-1',
      note: 'birthday', confidence: 'estimated', source: 'onboarding', updated_at: '2026-09-01T10:00:00Z' });
    expect(saved.accountId).toBeUndefined();          // re-derived from the picked account by the store
    expect(saved.excluded).toBeUndefined();           // a field the form owns and cleared stays cleared
    expect(editPatch(null, built)).toBe(built);       // a new entry is exactly what the form built
    // An investment names its account itself, and that wins over the cleared stored one.
    expect(editPatch(row({ type: 'investment', accountId: 'old' }), { ...built, type: 'investment', accountId: 'new' } as Transaction).accountId).toBe('new');
    expect(isSplitRow(row())).toBe(true);
    expect(isSplitRow(row({ split: undefined }))).toBe(false);
  });

  it('W4-D18-002 · a split row and a split capture open the Split form; anything else the plain one', () => {
    const s = useStore.getState();
    s.openEditTxn(row());
    s.openEditTxn(row({ id: 't-2', split: undefined }));
    const seed = { type: 'expense', amount: 1200, category: 'food_dining', split } as Partial<Transaction>;
    s.openAddTxn(seed);
    s.openAddTxn({ type: 'expense', amount: 90 });
    s.openAddTxn();
    expect(nav.appNavigate.mock.calls).toEqual([
      ['/splits/t-1/edit'],
      ['/transactions/t-2/edit'],
      ['/splits/new', { state: { seed } }],
      ['/transactions/new', { state: { seed: { type: 'expense', amount: 90 } } }],
      ['/transactions/new', undefined],
    ]);
  });

  it('W4-D18-003 · someone who had paid keeps the day they paid; only a new payment is dated today', () => {
    const before = split.participants;
    expect(paidOnFor(before, { email: 'ravi@example.com', name: 'Ravi K' }, true, '2026-10-07')).toBe('2026-09-02');
    expect(paidOnFor(before, { email: 'meera@example.com', name: 'Meera' }, true, '2026-10-07')).toBe('2026-10-07');
    expect(paidOnFor(before, { email: 'ravi@example.com', name: 'Ravi' }, false, '2026-10-07')).toBeNull();
    expect(paidOnFor(before, { name: 'Ravi' }, true, '2026-10-07')).toBe('2026-09-02');            // local: matched by name
    expect(paidOnFor(undefined, { name: 'Ravi' }, true, '2026-10-07')).toBe('2026-10-07');
  });
});

describe('W4c · through the store', () => {
  beforeEach(() => {
    useStore.setState({ ...useStore.getInitialState(), adapter: new LocalStorageAdapter(), currentHouseholdId: crypto.randomUUID(),
      cloudEnabled: false, transactions: [], refreshNotifications: vi.fn().mockResolvedValue(undefined),
      accounts: [
        { id: 'bank', kind: 'bank', name: 'Bank', currency: 'INR', openingBalance: 0 },
        { id: 'card', kind: 'credit_card', name: 'Card', currency: 'INR', openingBalance: 0 },
      ] as never });
  });
  afterEach(() => vi.clearAllMocks());

  it('W4-D18-004 · saving an edit keeps the split on the stored row and moves it to the newly picked account', async () => {
    const first = await useStore.getState().upsertTransaction({ ...row(), updated_at: undefined });
    const edited = await useStore.getState().upsertTransaction(editPatch(first, {
      id: first.id, type: 'expense', amount: 1200, currency: 'INR', date: '2026-09-01', description: 'Dinner',
      category: 'food_dining', paymentMethod: 'card',
    } as Transaction));
    expect(edited).toMatchObject({ accountId: 'card', split, recurringScheduleId: 's-1', note: 'birthday' });
    const [stored] = await new LocalStorageAdapter().list<Transaction>('transactions', useStore.getState().currentHouseholdId);
    expect(stored).toMatchObject({ accountId: 'card', split });
  });
});
