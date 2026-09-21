import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAdapter } from '../supabaseAdapter';
import { resolveConfiguredModelCall } from '../askVyactModelCall';
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
    expect(await call!({ system: 'Use computed facts', user: 'Summarize', json: true, maxTokens: 100 })).toBe('Authoritative explanation');
    expect(transport.invoke).toHaveBeenCalledExactlyOnceWith('ask-vyact', { body: { seam: 'assistant', surface: 'chat',
      messages: [{ role: 'system', content: 'Use computed facts' }, { role: 'user', content: 'Summarize' }], responseFormat: 'json', maxOutputTokens: 100 } });
  });

  it('a relay-queued call polls the gateway until the answer arrives (v10.37, test-only)', async () => {
    vi.useFakeTimers();
    try {
      transport.invoke
        .mockResolvedValueOnce({ data: { ok: false, enabled: true, error: 'relay_pending', relayId: 'relay-1' }, error: null })
        .mockResolvedValueOnce({ data: { ok: false, enabled: true, error: 'relay_pending', relayId: 'relay-1' }, error: null })
        .mockResolvedValueOnce({ data: { ok: true, enabled: true, text: 'Relayed explanation' }, error: null });
      const pending = resolveConfiguredModelCall()!({ system: 'Use computed facts', user: 'Summarize' });
      await vi.advanceTimersByTimeAsync(6_000);
      expect(await pending).toBe('Relayed explanation');
      expect(transport.invoke).toHaveBeenCalledTimes(3);
      expect(transport.invoke).toHaveBeenLastCalledWith('ask-vyact', { body: { seam: 'assistant', relayPoll: 'relay-1' } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a relay call that is never answered becomes an error, not a silent empty answer', async () => {
    vi.useFakeTimers();
    try {
      transport.invoke.mockResolvedValue({ data: { ok: false, enabled: true, error: 'relay_pending', relayId: 'relay-2' }, error: null });
      const pending = resolveConfiguredModelCall()!({ system: 's', user: 'u' });
      const outcome = expect(pending).rejects.toThrow('relay did not answer in time');
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 3_000);
      await outcome;
    } finally {
      vi.useRealTimers();
    }
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