// v10.107.1 — the gateway's pre-model work in one database round trip (17 Oct 2026).
//
// prepare_ai_call() runs as the caller (their JWT; auth.uid() in SQL) alongside getUser() and the config
// read, and answers membership AND the quota reservation together, so nothing waits after those three.
// The order in which the gateway ANSWERS is unchanged, and a reservation the request does not use is
// deleted. Without the function (or the anon key) the gateway takes the v10.106.3 path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureHandler, queryResult, userToken } from './helpers/edgeHarness';

const admin = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } }));
const caller = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } }));
const created = vi.hoisted(() => [] as { key: string; options: unknown }[]);
vi.mock('https://esm.sh/@supabase/supabase-js@2.45.0', () => ({
  createClient: (_url: string, key: string, options: unknown) => {
    created.push({ key, options });
    return key === 'test-anon-key' ? caller : admin;
  },
}));

const householdId = '20000000-0000-4000-8000-000000000001';
const reservation = '30000000-0000-4000-8000-0000000000aa';
const config = { id: 'config', seam: 'assistant', provider: 'vllm', model: 'test-model',
  base_url: 'https://models.example.com/v1', key_env_var: null, params: null, enabled: true, priority: 1 };
const ask = { householdId, op: 'classify', input: 'How much on food?' };
let handler: (request: Request) => Promise<Response>;
let provider: ReturnType<typeof vi.fn>;

const prepared = (data: Record<string, unknown>) => ({ data, error: null });

async function load(env: Record<string, string> = { SUPABASE_ANON_KEY: 'test-anon-key' }) {
  handler = await captureHandler(() => import('../../../../supabase/functions/ask-vyact/index'), env);
}

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); admin.from.mockReset(); caller.rpc.mockReset(); created.length = 0;
  admin.auth.getUser.mockResolvedValue({ data: { user: { id: 'user' } }, error: null });
  admin.rpc.mockResolvedValue({ data: 'fallback-reservation', error: null });
  caller.rpc.mockResolvedValue(prepared({ member: true, reservation_id: reservation, quota: 'ok' }));
  provider = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"id":"interpret.lookup"}' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } }), { status: 200 }));
  vi.stubGlobal('fetch', provider);
  await load();
});
afterEach(() => vi.unstubAllGlobals());

function request(body: unknown) {
  return new Request('https://edge.example.com/ask-vyact', { method: 'POST', headers: {
    Authorization: `Bearer ${userToken()}`, Origin: 'https://vyact.app', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
const tables = () => admin.from.mock.calls.map(([t]) => t);

describe('gateway pre-work in one round trip (v10.107.1)', () => {
  it('PIP-GW-001 · user check, config read and prepare_ai_call start together; the reservation it made is the one finalised', async () => {
    let verify!: (value: unknown) => void;
    admin.auth.getUser.mockReturnValue(new Promise(resolve => { verify = resolve; }));
    const meter = queryResult(null);
    admin.from.mockReturnValueOnce(queryResult([config])).mockReturnValueOnce(meter);
    const pending = handler(request(ask));
    await vi.waitFor(() => expect(caller.rpc).toHaveBeenCalledOnce());
    expect(tables()).toEqual(['ai_model_configs']);                 // no separate membership read
    expect(provider).not.toHaveBeenCalled();
    verify({ data: { user: { id: 'user' } }, error: null });
    const result = await pending;
    expect(result.status).toBe(200);
    expect(caller.rpc).toHaveBeenCalledWith('prepare_ai_call', { p_household_id: householdId, p_seam: 'assistant',
      p_surface: 'chat', p_cap: 200, p_reserve: true });
    // It runs as the caller: the anon key with the user's own token, never the service key.
    const asCaller = created.find(c => c.key === 'test-anon-key');
    expect(JSON.stringify(asCaller?.options)).toContain(`Bearer ${userToken()}`);
    expect(admin.rpc).not.toHaveBeenCalled();                           // no sequential reserve_ai_usage
    expect(provider).toHaveBeenCalledOnce();
    expect(meter.update).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ok' }));
    expect(meter.eq).toHaveBeenCalledWith('id', reservation);
  });

  it('PIP-GW-002 · over the daily cap is answered 429 and the model is never called', async () => {
    caller.rpc.mockResolvedValue(prepared({ member: true, reservation_id: null, quota: 'exceeded' }));
    admin.from.mockReturnValueOnce(queryResult([config]));
    const result = await handler(request(ask));
    expect(result.status).toBe(429);
    expect(await result.json()).toMatchObject({ error: 'quota_exceeded' });
    expect(provider).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it('PIP-GW-003 · a household the caller is not in is refused 403, before any reservation or model', async () => {
    caller.rpc.mockResolvedValue(prepared({ member: false, reservation_id: null, quota: 'skipped' }));
    admin.from.mockReturnValueOnce(queryResult([config]));
    const result = await handler(request(ask));
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ error: 'forbidden' });
    expect(provider).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it('PIP-GW-004 · a session getUser() rejects is refused 401 and its reservation is deleted', async () => {
    admin.auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error('session not found') });
    const release = queryResult(null);
    admin.from.mockReturnValueOnce(queryResult([config])).mockReturnValueOnce(release);
    const result = await handler(request(ask));
    expect(result.status).toBe(401);
    await vi.waitFor(() => expect(release.delete).toHaveBeenCalled());
    expect(release.eq).toHaveBeenCalledWith('id', reservation);
    expect(release.eq).toHaveBeenCalledWith('outcome', 'reserved');
    expect(provider).not.toHaveBeenCalled();
  });

  it('PIP-GW-005 · OFF stays inert: no model applies, so any reservation is deleted and nothing is called', async () => {
    const release = queryResult(null);
    admin.from.mockReturnValueOnce(queryResult([])).mockReturnValueOnce(release);
    const result = await handler(request(ask));
    expect(await result.json()).toMatchObject({ enabled: false, reason: 'no_enabled_model_config' });
    await vi.waitFor(() => expect(release.delete).toHaveBeenCalled());
    expect(release.eq).toHaveBeenCalledWith('id', reservation);
    expect(provider).not.toHaveBeenCalled();
  });

  it('PIP-GW-006 · without prepare_ai_call (a database not migrated yet) it falls back to the membership read and reserve_ai_usage()', async () => {
    caller.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    const meter = queryResult(null);
    admin.from.mockReturnValueOnce(queryResult([config])).mockReturnValueOnce(queryResult({ household_id: householdId }))
      .mockReturnValueOnce(meter);
    const result = await handler(request(ask));
    expect(result.status).toBe(200);
    expect(tables()).toContain('memberships');
    expect(admin.rpc).toHaveBeenCalledWith('reserve_ai_usage', { p_user_id: 'user', p_household_id: householdId, p_surface: 'chat', p_cap: 200 });
    expect(meter.eq).toHaveBeenCalledWith('id', 'fallback-reservation');
  });

  it('PIP-GW-007 · a request that cannot be sent asks for no reservation, and probes and relay polls never prepare', async () => {
    admin.from.mockReturnValueOnce(queryResult([config]));
    const bad = await handler(request({ householdId, op: 'write-a-poem', input: 'x' }));
    expect(bad.status).toBe(400);
    expect(caller.rpc).toHaveBeenCalledWith('prepare_ai_call', expect.objectContaining({ p_reserve: false }));
    expect(provider).not.toHaveBeenCalled();

    caller.rpc.mockClear();
    admin.from.mockReturnValueOnce(queryResult([config]));
    const probe = await handler(request({ probe: true }));
    expect(await probe.json()).toMatchObject({ ok: true, enabled: true, ready: true });
    expect(caller.rpc).not.toHaveBeenCalled();
  });

  it('PIP-GW-008 · without the anon key the gateway keeps the v10.106.3 path', async () => {
    vi.resetModules();
    await load({});
    const meter = queryResult(null);
    admin.from.mockReturnValueOnce(queryResult([config])).mockReturnValueOnce(queryResult({ household_id: householdId }))
      .mockReturnValueOnce(meter);
    const result = await handler(request(ask));
    expect(result.status).toBe(200);
    expect(caller.rpc).not.toHaveBeenCalled();
    expect(tables().slice(0, 2)).toEqual(['ai_model_configs', 'memberships']);
    expect(admin.rpc).toHaveBeenCalledWith('reserve_ai_usage', expect.objectContaining({ p_user_id: 'user' }));
  });
});
