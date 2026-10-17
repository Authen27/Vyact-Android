// W1b (v10.63.0, audit 2026-10-04) — the delete-account Edge Function: recent sign-in enforced on
// the server, one purge_account() call, the auth user deleted last, and an owner who must hand
// over first is told so. Mocked Supabase client; not a deployed-function test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureHandler } from './helpers/edgeHarness';

const api = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(),
  auth: { getUser: vi.fn(), admin: { deleteUser: vi.fn() } },
}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.45.0', () => ({ createClient: () => api }));

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (amrSecondsAgo: number | null) => ['h', b64url({ sub: 'u1', role: 'authenticated',
  ...(amrSecondsAgo === null ? {} : { amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) - amrSecondsAgo }] }) }), 's'].join('.');
const post = (handler: (r: Request) => Promise<Response>, jwt: string) =>
  handler(new Request('https://edge.example.com/delete-account', { method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: '{}' }));

let handler: (r: Request) => Promise<Response>;
beforeEach(async () => {
  vi.resetModules();
  api.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  api.auth.admin.deleteUser.mockResolvedValue({ error: null });
  api.rpc.mockResolvedValue({ data: { status: 'purged' }, error: null });
  handler = await captureHandler(() => import('../../../../supabase/functions/delete-account/index'));
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('delete-account (W1b)', () => {
  it('CON-UNIT-W1-016 · refuses without a sign-in in the last 10 minutes, and touches nothing', async () => {
    for (const jwt of [token(null), token(3600)]) {
      const res = await post(handler, jwt);
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('reauth_required');
    }
    expect(api.rpc).not.toHaveBeenCalled();
    expect(api.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('CON-UNIT-W1-017 · an owner whose household others use is told to transfer; the login stays', async () => {
    api.rpc.mockResolvedValue({ data: null, error: { message: 'transfer_required', details: 'h1,h2' } });
    const res = await post(handler, token(30));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(expect.objectContaining({ error: 'transfer_required', households: ['h1', 'h2'] }));
    expect(api.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('CON-UNIT-W1-018 · one purge call, then the auth user — in that order', async () => {
    const res = await post(handler, token(30));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(api.rpc).toHaveBeenCalledTimes(1);
    expect(api.rpc).toHaveBeenCalledWith('purge_account', { p_user_id: 'u1' });
    expect(api.auth.admin.deleteUser).toHaveBeenCalledWith('u1');
    expect(api.rpc.mock.invocationCallOrder[0]).toBeLessThan(api.auth.admin.deleteUser.mock.invocationCallOrder[0]);
    expect(api.from).not.toHaveBeenCalled();                       // no client-side delete chain any more
  });

  it('CON-UNIT-W1-019 · a failed auth delete is reported as retryable (the purge already happened)', async () => {
    api.auth.admin.deleteUser.mockResolvedValue({ error: { message: 'boom' } });
    const res = await post(handler, token(30));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(expect.objectContaining({ error: 'auth_delete_failed', retry: true }));
  });

  it('CON-UNIT-W1-020 · an invalid session is unauthorized before anything else', async () => {
    api.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });
    expect((await post(handler, token(30))).status).toBe(401);
    expect(api.rpc).not.toHaveBeenCalled();
  });
});
