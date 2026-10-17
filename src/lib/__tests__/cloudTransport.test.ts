import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAdapter } from '../supabaseAdapter';
import { resolveConfiguredModelCall, CLIENT_DEADLINE_MS } from '../askVyactModelCall';
import { readWhatsAppLink } from '../whatsappLink';

const transport = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { functions: transport }, sb: () => ({ functions: transport }) }));
beforeEach(() => vi.clearAllMocks());

describe('cloud command transports', () => {
  it.each(['create', 'replace'] as const)('atomic budget %s forwards identity and returns authoritative allocations', async mode => {
    const rpc = vi.fn().mockResolvedValue({ error: null, data: {
      budget: { id: 'server-budget', household_id: 'household', currency: 'USD', monthly_limit: 500, scope: 'month', period_year: 2026, period_month: 9 },
      allocations: [{ id: 'server-allocation', budget_id: 'server-budget', category: 'groceries', amount: 500 }],
    } });
    const adapter = new SupabaseAdapter({ rpc } as unknown as SupabaseClient);
    const result = await adapter.upsertBudgetWithAllocations('household', { id: 'client-budget', scope: 'month', periodYear: 2026, periodMonth: 9,
      currency: 'USD', limit: 500 }, [{ category: 'groceries', amount: 500 }, { category: '', amount: 1 }], mode);
    expect(rpc).toHaveBeenCalledWith('upsert_budget_with_allocations', expect.objectContaining({ h: 'household', p_mode: mode,
      allocs: [{ category: 'groceries', amount: 500 }], b: expect.objectContaining({ period_year: 2026, period_month: 9 }) }));
    if (mode === 'create') expect(rpc.mock.calls[0][1].b).not.toHaveProperty('id');
    else expect(rpc.mock.calls[0][1].b.id).toBe('client-budget');
    expect(result).toMatchObject({ budget: { id: 'server-budget', limit: 500, periodMonth: 9 },
      allocations: [{ id: 'server-allocation', budgetId: 'server-budget', category: 'groceries', amount: 500 }] });
  });

  it('the configured browser model call invokes only the Edge gateway and returns its text', async () => {
    transport.invoke.mockResolvedValue({ data: { ok: true, enabled: true, text: 'Authoritative explanation' }, error: null });
    const call = resolveConfiguredModelCall();
    expect(call).not.toBeNull();
    expect(await call!({ op: 'classify', system: 'Use computed facts', user: 'Summarize', json: true, maxTokens: 100 })).toBe('Authoritative explanation');
    // W1c: the op and the text only — the gateway composes the system prompt itself.
    expect(transport.invoke).toHaveBeenCalledExactlyOnceWith('ask-vyact', { body: { seam: 'assistant', surface: 'chat',
      op: 'classify', input: 'Summarize', maxOutputTokens: 100 }, signal: expect.any(AbortSignal) });
  });

  it('a relay-queued call polls the gateway until the answer arrives (v10.37, test-only)', async () => {
    vi.useFakeTimers();
    try {
      transport.invoke
        .mockResolvedValueOnce({ data: { ok: false, enabled: true, error: 'relay_pending', relayId: 'relay-1' }, error: null })
        .mockResolvedValueOnce({ data: { ok: false, enabled: true, error: 'relay_pending', relayId: 'relay-1' }, error: null })
        .mockResolvedValueOnce({ data: { ok: true, enabled: true, text: 'Relayed explanation' }, error: null });
      const pending = resolveConfiguredModelCall()!({ op: 'phrase', system: 'Use computed facts', user: 'Summarize' });
      await vi.advanceTimersByTimeAsync(6_000);
      expect(await pending).toBe('Relayed explanation');
      expect(transport.invoke).toHaveBeenCalledTimes(3);
      expect(transport.invoke).toHaveBeenLastCalledWith('ask-vyact', { body: { seam: 'assistant', relayPoll: 'relay-1' }, signal: expect.any(AbortSignal) });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a relay call that is never answered becomes an error, not a silent empty answer', async () => {
    vi.useFakeTimers();
    try {
      transport.invoke.mockResolvedValue({ data: { ok: false, enabled: true, error: 'relay_pending', relayId: 'relay-2' }, error: null });
      const pending = resolveConfiguredModelCall()!({ op: 'phrase', system: 's', user: 'u' });
      const outcome = expect(pending).rejects.toThrow('relay did not answer in time');
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 3_000);
      await outcome;
    } finally {
      vi.useRealTimers();
    }
  });

  it('W8a-PIP16-001 · Stop aborts the in-flight gateway call; a stopped turn makes no further calls (FE-PIP-16)', async () => {
    let seen: AbortSignal | undefined;
    transport.invoke.mockImplementation((_n: string, opts: { signal?: AbortSignal }) => new Promise((_res, rej) => {
      seen = opts.signal;
      opts.signal?.addEventListener('abort', () => rej(opts.signal!.reason));
    }));
    const turn = new AbortController();
    const pending = resolveConfiguredModelCall(undefined, turn.signal)!({ op: 'phrase', system: 's', user: 'u' });
    turn.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen?.aborted).toBe(true);
    transport.invoke.mockClear();
    await expect(resolveConfiguredModelCall(undefined, turn.signal)!({ op: 'phrase', system: 's', user: 'u' })).rejects.toMatchObject({ name: 'AbortError' });
    expect(transport.invoke).not.toHaveBeenCalled();
  });

  it('W8a-PIP16-002 · a gateway that never answers is given up on at the client deadline (FE-PIP-16)', async () => {
    vi.useFakeTimers();
    try {
      transport.invoke.mockImplementation((_n: string, opts: { signal?: AbortSignal }) => new Promise((_res, rej) => {
        opts.signal?.addEventListener('abort', () => rej(opts.signal!.reason));
      }));
      const pending = resolveConfiguredModelCall()!({ op: 'phrase', system: 's', user: 'u' });
      const outcome = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(CLIENT_DEADLINE_MS + 10);
      await outcome;
    } finally {
      vi.useRealTimers();
    }
  });

  it('CON-UNIT-W1-032 · the browser never sends a system prompt; it names the household and the rejected figures', async () => {
    transport.invoke.mockResolvedValue({ data: { ok: true, enabled: true, text: 'ok' }, error: null });
    const household = '20000000-0000-4000-8000-000000000001';
    await resolveConfiguredModelCall(household)!({ op: 'phrase', system: 'anything at all', user: '{"facts":{}}', offending: ['42000'] });
    await resolveConfiguredModelCall('local')!({ op: 'classify', system: 'x', user: 'q' });
    const [first, second] = transport.invoke.mock.calls.map(c => c[1].body);
    expect(first).toEqual({ seam: 'assistant', surface: 'chat', op: 'phrase', input: '{"facts":{}}', offending: ['42000'], householdId: household });
    expect(second).toEqual({ seam: 'assistant', surface: 'chat', op: 'classify', input: 'q' });
    expect(JSON.stringify(transport.invoke.mock.calls)).not.toMatch(/anything at all|"system"|"messages"/);
  });

  it('reads link status and unlinks through the authenticated endpoint without profile writes', async () => {
    transport.invoke.mockResolvedValueOnce({ data: { status: 'linked', phone: '111', householdId: 'household' }, error: null })
      .mockResolvedValueOnce({ data: { status: 'unlinked' }, error: null });
    expect(await readWhatsAppLink()).toEqual({ status: 'linked', phone: '111', householdId: 'household' });
    expect(await readWhatsAppLink('unlink')).toEqual({ status: 'unlinked' });
    expect(transport.invoke.mock.calls).toEqual([
      ['whatsapp-verify-otp', { body: { action: 'status' } }], ['whatsapp-verify-otp', { body: { action: 'unlink' } }],
    ]);
  });
});