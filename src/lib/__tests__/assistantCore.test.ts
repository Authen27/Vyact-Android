// W4 (v10.45.0) — the server-side model call for Ask Vyact on WhatsApp: the gateway's
// config, cap and metering, minus the test-only relay.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryResult } from './helpers/edgeHarness';

const MODEL = { id: 'm-1', seam: 'assistant', provider: 'openai', model: 'gpt-x', base_url: 'https://api.example.com',
  key_env_var: 'TEST_MODEL_KEY', params: {}, enabled: true, priority: 10 };
const RELAY = { id: 'r-1', seam: 'assistant', provider: 'claude-code-relay', model: 'relay', base_url: null,
  key_env_var: null, params: { allowed_user_ids: ['alice'] }, enabled: true, priority: 1 };

function admin(opts: { rows?: unknown[]; reserveError?: { code?: string; message?: string } } = {}) {
  const usageUpdates: Record<string, unknown>[] = [];
  const api = {
    from: vi.fn((table: string) => {
      if (table === 'ai_model_configs') return queryResult(opts.rows ?? [RELAY, MODEL]);
      const q = queryResult(null);
      q.update.mockImplementation((row: Record<string, unknown>) => { usageUpdates.push(row); return q; });
      return q;
    }),
    rpc: vi.fn(async () => (opts.reserveError ? { data: null, error: opts.reserveError } : { data: 'res-1', error: null })),
  };
  return { api, usageUpdates };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('Deno', { env: { get: (k: string) => (k === 'TEST_MODEL_KEY' ? 'sk-test' : undefined) } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    choices: [{ message: { content: 'Here you go.' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});
afterEach(() => vi.unstubAllGlobals());

const caller = { userId: 'alice', householdId: 'h-1', surface: 'whatsapp' as const, dailyCap: 200 };

describe('assistantCore — the server model call (W4)', () => {
  it('CON-UNIT-W4-005 · uses the production model (never the relay), reserves the cap and meters as whatsapp', async () => {
    const { serverModelCall } = await import('../../../../supabase/functions/_shared/agent/assistantCore');
    const { api, usageUpdates } = admin();
    const text = await serverModelCall(api as never, caller)({ system: 'phrase', user: '{}' });
    expect(text).toBe('Here you go.');
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('https://api.example.com/v1/chat/completions');
    expect(api.rpc).toHaveBeenCalledWith('reserve_ai_usage', { p_user_id: 'alice', p_household_id: 'h-1', p_surface: 'whatsapp', p_cap: 200 });
    expect(usageUpdates[0]).toEqual(expect.objectContaining({ surface: 'whatsapp', prompt_tokens: 12, completion_tokens: 4 }));
    expect(usageUpdates[0]).not.toHaveProperty('user_id');
  });

  it('CON-UNIT-W4-006 · over the cap fails closed before any provider call; no model means unavailable', async () => {
    const { serverModelCall } = await import('../../../../supabase/functions/_shared/agent/assistantCore');
    const over = admin({ reserveError: { code: '42901', message: 'quota_exceeded' } });
    await expect(serverModelCall(over.api as never, caller)({ system: 's', user: 'u' })).rejects.toThrow('quota_exceeded');
    expect(fetch).not.toHaveBeenCalled();
    const none = admin({ rows: [RELAY] });                                   // only the relay: excluded → nothing
    await expect(serverModelCall(none.api as never, caller)({ system: 's', user: 'u' })).rejects.toThrow(/no model is enabled/);
    expect(none.api.rpc).not.toHaveBeenCalled();
  });
});
