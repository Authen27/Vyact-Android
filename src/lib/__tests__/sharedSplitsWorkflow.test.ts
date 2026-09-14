import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSharedSplit, fetchOwnedSharedSplits, fetchSharedWithMe, settleSharedSplitShare,
  closeSharedSplit, updateSharedSplit, updateShareAmount, resolveParticipantNames } from '../sharedSplits';

const transport = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), getUser: vi.fn() }));
vi.mock('../supabase', () => ({ sb: () => ({ ...transport, auth: { getUser: transport.getUser } }) }));

function response(data: unknown) {
  const query = { insert: vi.fn(), select: vi.fn(), single: vi.fn(), eq: vi.fn(), neq: vi.fn(),
    order: vi.fn(), in: vi.fn(), update: vi.fn(), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) };
  for (const method of [query.insert, query.select, query.single, query.eq, query.neq, query.order, query.in, query.update]) method.mockReturnValue(query);
  transport.from.mockReturnValueOnce(query);
  return query;
}

const split = { id: 'split', owner_user_id: 'owner', owner_household_id: 'household', txn_id: 'transaction',
  description: 'Dinner', currency: 'USD', total_amount: 90, txn_type: 'expense', date: '2026-09-09',
  closed_at: null, created_at: '2026-09-09T12:00:00Z', updated_at: '2026-09-09T12:00:00Z' };
const share = { id: 'share', split_id: 'split', email: 'friend@example.com', share: 45, paid: false, paid_at: null, settled_user_id: null };

beforeEach(() => { vi.clearAllMocks(); transport.getUser.mockResolvedValue({ data: { user: { id: 'owner' } } }); });
afterEach(() => vi.useRealTimers());

describe('shared split cloud service contracts', () => {
  it('creates an authenticated transaction-backed split and normalizes participant email', async () => {
    const parent = response(split);
    const children = response([share]);
    const created = await createSharedSplit({ ownerHouseholdId: 'household', txnId: 'transaction', description: 'Dinner',
      currency: 'USD', totalAmount: 90, txnType: 'expense', date: '2026-09-09', participants: [{ email: ' Friend@Example.COM ', share: 45 }] });
    expect(parent.insert).toHaveBeenCalledWith(expect.objectContaining({ owner_user_id: 'owner', txn_id: 'transaction', total_amount: 90 }));
    expect(children.insert).toHaveBeenCalledWith([{ split_id: 'split', email: 'friend@example.com', share: 45 }]);
    expect(created).toMatchObject({ id: 'split', txnId: 'transaction', totalAmount: 90, shares: [{ id: 'share', share: 45, paid: false }] });
  });

  it('edits unpaid shares, settles through the participant RPC, closes and reloads on both sides', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z'));
    const parentEdit = response(null);
    await updateSharedSplit('split', { totalAmount: 100 });
    expect(parentEdit.update).toHaveBeenCalledWith({ total_amount: 100 });
    const shareEdit = response(null);
    await updateShareAmount('share', 50);
    expect(shareEdit.update).toHaveBeenCalledWith({ share: 50 });
    expect(shareEdit.eq.mock.calls).toEqual([['id', 'share'], ['paid', false]]);
    transport.rpc.mockResolvedValue({ error: null });
    await settleSharedSplitShare('share');
    expect(transport.rpc).toHaveBeenCalledWith('settle_share', { p_share_id: 'share' });
    const close = response(null);
    await closeSharedSplit('split');
    expect(close.update).toHaveBeenCalledWith({ closed_at: '2026-09-09T12:00:00.000Z' });
    expect(close.eq).toHaveBeenCalledWith('id', 'split');
    const ownerQuery = response([{ ...split, total_amount: 100, closed_at: '2026-09-09T12:00:00Z' }]);
    response([{ ...share, share: 50, paid: true, settled_user_id: 'participant' }]);
    const owned = await fetchOwnedSharedSplits();
    expect(ownerQuery.eq).toHaveBeenCalledWith('owner_user_id', 'owner');
    transport.getUser.mockResolvedValue({ data: { user: { id: 'participant' } } });
    const participantQuery = response([{ ...split, total_amount: 100, closed_at: '2026-09-09T12:00:00Z' }]);
    response([{ ...share, share: 50, paid: true, settled_user_id: 'participant' }]);
    const received = await fetchSharedWithMe();
    expect(participantQuery.neq).toHaveBeenCalledWith('owner_user_id', 'participant');
    expect(received).toEqual(owned);
    expect(received[0]).toMatchObject({ totalAmount: 100, closedAt: '2026-09-09T12:00:00Z', shares: [{ share: 50, paid: true }] });
  });

  it('resolves distinct normalized participant identities and omits unnamed users', async () => {
    transport.rpc.mockResolvedValue({ data: [{ email: 'Friend@Example.com', display_name: 'Friend' }, { email: 'missing@example.com', display_name: null }], error: null });
    expect(await resolveParticipantNames([' Friend@example.com ', 'friend@example.com', ''])).toEqual({ 'friend@example.com': 'Friend' });
    expect(transport.rpc).toHaveBeenCalledWith('resolve_participant_names', { p_emails: ['friend@example.com'] });
  });
});