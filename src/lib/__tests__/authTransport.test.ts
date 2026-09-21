import { beforeEach, expect, it, vi } from 'vitest';
import { signIn, signOut, createInviteLink, acceptInvitation, onAuthStateChange } from '../auth';
import { queryResult } from './helpers/edgeHarness';

const api = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), auth: {
  signInWithPassword: vi.fn(), signOut: vi.fn(), getUser: vi.fn(), onAuthStateChange: vi.fn(),
} }));
vi.mock('../supabase', () => ({ sb: () => api, APP_URL: 'https://app.example.com' }));
beforeEach(() => vi.clearAllMocks());

it('successful sign-in returns the verified session and sign-out calls the auth authority', async () => {
  const data = { user: { id: 'alice' }, session: { access_token: 'synthetic-session' } };
  api.auth.signInWithPassword.mockResolvedValue({ data, error: null });
  api.auth.signOut.mockResolvedValue({ error: null });
  expect(await signIn('alice@example.com', 'synthetic-password')).toEqual(data);
  expect(api.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'alice@example.com', password: 'synthetic-password' });
  await signOut();
  expect(api.auth.signOut).toHaveBeenCalledOnce();
});

it('creates an attributed shareable invite and accepts the exact opaque token', async () => {
  api.auth.getUser.mockResolvedValue({ data: { user: { id: 'alice' } } });
  const query = queryResult({ id: 'invite', token: 'opaque/with+symbols==' });
  api.from.mockReturnValue(query);
  const invitation = await createInviteLink('household', 'member', 'partner');
  expect(query.insert).toHaveBeenCalledWith({ household_id: 'household', invited_email: '(shareable link)',
    invited_by: 'alice', role: 'member', household_role: 'partner' });
  api.rpc.mockResolvedValue({ data: { household_id: 'household', membership_id: 'membership', role: 'member' }, error: null });
  expect(await acceptInvitation(invitation.token)).toEqual({ household_id: 'household', membership_id: 'membership', role: 'member' });
  expect(api.rpc).toHaveBeenCalledWith('accept_invitation_link', { invite_token: 'opaque/with+symbols==' });
});

it('forwards session changes and releases the subscription', () => {
  const unsubscribe = vi.fn();
  api.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });
  const handler = vi.fn();
  const dispose = onAuthStateChange(handler);
  const callback = api.auth.onAuthStateChange.mock.calls[0][0];
  callback('SIGNED_IN', { user: { id: 'alice' } });
  callback('SIGNED_OUT', null);
  expect(handler.mock.calls).toEqual([[{ user: { id: 'alice' } }], [null]]);
  dispose();
  expect(unsubscribe).toHaveBeenCalledOnce();
});