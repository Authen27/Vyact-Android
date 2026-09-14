import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureHandler, queryResult, userToken } from './helpers/edgeHarness';

const api = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } }));
vi.mock('https://esm.sh/@supabase/supabase-js@2.45.0', () => ({ createClient: () => api }));
const householdId = '20000000-0000-4000-8000-000000000001';
const config = { id: 'config', seam: 'assistant', provider: 'vllm', model: 'test-model',
  base_url: 'https://models.example.com/v1', key_env_var: null, params: null, enabled: true, priority: 1 };
let handler: (request: Request) => Promise<Response>;
let provider: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  api.auth.getUser.mockResolvedValue({ data: { user: { id: 'user' } }, error: null });
  api.rpc.mockResolvedValue({ data: 'reservation', error: null });
  provider = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Computed facts received.' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } }), { status: 200 }));
  vi.stubGlobal('fetch', provider);
  handler = await captureHandler(() => import('../../../../supabase/functions/ask-vyact/index'));
});
afterEach(() => vi.unstubAllGlobals());

function request(body: unknown) {
  return new Request('https://edge.example.com/ask-vyact', { method: 'POST', headers: {
    Authorization: `Bearer ${userToken()}`, Origin: 'https://vyact.app', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('actual Ask Vyact gateway handler', () => {
  it('authenticates, reserves quota, calls provider, finalizes metadata and returns the response', async () => {
    api.from.mockReturnValueOnce(queryResult([config])).mockReturnValueOnce(queryResult({ household_id: householdId }));
    const meter = queryResult(null);
    api.from.mockReturnValueOnce(meter);
    const result = await handler(request({ householdId, messages: [{ role: 'user', content: 'Explain these computed facts.' }] }));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ ok: true, enabled: true, text: 'Computed facts received.',
      usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 } });
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe('https://vyact.app');
    expect(api.auth.getUser).toHaveBeenCalledWith(userToken());
    expect(api.rpc).toHaveBeenCalledWith('reserve_ai_usage', { p_user_id: 'user', p_household_id: householdId, p_surface: 'chat', p_cap: 200 });
    expect(api.rpc.mock.invocationCallOrder[0]).toBeLessThan(provider.mock.invocationCallOrder[0]);
    expect(provider).toHaveBeenCalledOnce();
    expect(meter.eq).toHaveBeenCalledWith('id', 'reservation');
    expect(meter.update).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ok', prompt_tokens: 12, completion_tokens: 4 }));
    expect(JSON.stringify(meter.update.mock.calls)).not.toContain('Explain these computed facts');
  });

  it('probes enabled readiness without reserving quota or calling a provider', async () => {
    api.from.mockReturnValueOnce(queryResult([config]));
    const result = await handler(request({ probe: true }));
    expect(await result.json()).toMatchObject({ ok: true, enabled: true, ready: true });
    expect(api.rpc).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it('stays inert when no model is configured', async () => {
    api.from.mockReturnValueOnce(queryResult([]));
    const result = await handler(request({ messages: [{ role: 'user', content: 'Hello' }] }));
    expect(await result.json()).toMatchObject({ enabled: false, reason: 'no_enabled_model_config' });
    expect(api.from).toHaveBeenCalledExactlyOnceWith('ai_model_configs');
    expect(api.rpc).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it('blocks provider spend when reservation is refused', async () => {
    api.from.mockReturnValueOnce(queryResult([config]));
    api.rpc.mockResolvedValue({ data: null, error: { code: '42901', message: 'quota_exceeded' } });
    const result = await handler(request({ messages: [{ role: 'user', content: 'Hello' }] }));
    expect(result.status).toBe(429);
    expect(provider).not.toHaveBeenCalled();
  });
});