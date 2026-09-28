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

  describe('Claude Code relay (v10.37, test-only)', () => {
    const relayId = '30000000-0000-4000-8000-000000000001';
    const relayConfig = { id: 'relay', seam: 'assistant', provider: 'claude-code-relay', model: 'claude-opus-5 (Claude Code)',
      base_url: 'https://claude-code.relay', key_env_var: null, params: { allowed_user_ids: ['user'] }, enabled: true, priority: 200 };
    const messages = [{ role: 'system', content: 'You classify a personal-finance question' }, { role: 'user', content: 'How am I doing?' }];

    it('queues an allowlisted user\'s call instead of calling a provider and answers 202', async () => {
      api.from.mockReturnValueOnce(queryResult([relayConfig, config]));
      const queue = queryResult({ id: relayId });
      api.from.mockReturnValueOnce(queue);
      const result = await handler(request({ messages }));
      expect(result.status).toBe(202);
      expect(await result.json()).toMatchObject({ ok: false, enabled: true, error: 'relay_pending', relayId });
      expect(api.from).toHaveBeenLastCalledWith('ask_vyact_relay');
      expect(queue.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user', reservation_id: 'reservation',
        call_kind: 'classify', messages }));
      expect(api.rpc).toHaveBeenCalledWith('reserve_ai_usage', expect.objectContaining({ p_user_id: 'user' }));
      expect(provider).not.toHaveBeenCalled();
    });

    it('a user who is not allowlisted resolves the next config and never touches the relay', async () => {
      api.auth.getUser.mockResolvedValue({ data: { user: { id: 'other' } }, error: null });
      api.from.mockReturnValueOnce(queryResult([relayConfig, config])).mockReturnValueOnce(queryResult(null));
      const result = await handler(new Request('https://edge.example.com/ask-vyact', { method: 'POST', headers: {
        Authorization: `Bearer ${userToken('other')}`, Origin: 'https://vyact.app', 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }) }));
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({ ok: true, text: 'Computed facts received.' });
      expect(provider).toHaveBeenCalledOnce();
      expect(api.from).not.toHaveBeenCalledWith('ask_vyact_relay');
    });

    it('a poll returns the relay answer and finalises the reservation as ok', async () => {
      const row = queryResult({ id: relayId, status: 'answered', created_at: '2026-09-15T10:00:00Z',
        answered_at: '2026-09-15T10:00:09Z', response: 'You spent less than usual.', reservation_id: 'reservation' });
      const meter = queryResult(null);
      api.from.mockReturnValueOnce(row).mockReturnValueOnce(meter);
      const result = await handler(request({ relayPoll: relayId }));
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({ ok: true, text: 'You spent less than usual.', provider: 'claude-code-relay', latencyMs: 9000 });
      expect(row.eq).toHaveBeenCalledWith('user_id', 'user');
      expect(meter.update).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ok', provider: 'claude-code-relay', latency_ms: 9000 }));
      expect(api.rpc).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
    });

    it('a poll for a row the caller does not own is not found', async () => {
      api.from.mockReturnValueOnce(queryResult(null));
      const result = await handler(request({ relayPoll: relayId }));
      expect(result.status).toBe(404);
    });

    it('a poll still pending is 202; past the TTL it expires as a 504 timeout', async () => {
      api.from.mockReturnValueOnce(queryResult({ id: relayId, status: 'pending', created_at: new Date().toISOString(), reservation_id: null }));
      expect((await handler(request({ relayPoll: relayId }))).status).toBe(202);
      const stale = queryResult(null);
      api.from.mockReturnValueOnce(queryResult({ id: relayId, status: 'pending', created_at: '2020-01-01T00:00:00Z', reservation_id: 'reservation' }))
        .mockReturnValueOnce(stale).mockReturnValueOnce(queryResult(null));
      const expired = await handler(request({ relayPoll: relayId }));
      expect(expired.status).toBe(504);
      expect(stale.update).toHaveBeenCalledWith({ status: 'expired' });
    });
  });

  it('blocks provider spend when reservation is refused', async () => {
    api.from.mockReturnValueOnce(queryResult([config]));
    api.rpc.mockResolvedValue({ data: null, error: { code: '42901', message: 'quota_exceeded' } });
    const result = await handler(request({ messages: [{ role: 'user', content: 'Hello' }] }));
    expect(result.status).toBe(429);
    expect(provider).not.toHaveBeenCalled();
  });
});