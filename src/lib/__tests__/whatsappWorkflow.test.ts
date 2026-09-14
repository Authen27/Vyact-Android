import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureHandler, queryResult } from './helpers/edgeHarness';

const api = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } }));
vi.mock('https://esm.sh/@supabase/supabase-js@2.45.0', () => ({ createClient: () => api }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}'))); });
afterEach(() => vi.unstubAllGlobals());

describe('actual WhatsApp Edge handlers', () => {
  it('reads and unlinks only the authenticated identity, consuming pending relink codes', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-verify-otp/index'));
    api.auth.getUser.mockResolvedValue({ data: { user: { id: 'alice' } }, error: null });
    const status = queryResult({ phone_number: '111', household_id: 'alice-house' });
    const otpDelete = queryResult(null);
    const identityDelete = queryResult(null);
    api.from.mockReturnValueOnce(status).mockReturnValueOnce(otpDelete).mockReturnValueOnce(identityDelete).mockReturnValueOnce(queryResult(null));
    const request = (action: string) => new Request('https://edge.example.com/verify', { method: 'POST',
      headers: { Authorization: 'Bearer test-user' }, body: JSON.stringify({ action, profile_id: 'someone-else' }) });
    expect(await (await handler(request('status'))).json()).toEqual({ status: 'linked', phone: '111', householdId: 'alice-house' });
    expect(await (await handler(request('unlink'))).json()).toEqual({ status: 'unlinked' });
    expect(await (await handler(request('status'))).json()).toEqual({ status: 'unlinked' });
    for (const query of [status, otpDelete, identityDelete]) expect(query.eq).toHaveBeenCalledWith('profile_id', 'alice');
    expect(otpDelete.delete).toHaveBeenCalledOnce();
    expect(identityDelete.delete).toHaveBeenCalledOnce();
  });

  it('verifies a valid OTP, persists the server-owned identity and consumes the OTP', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-verify-otp/index'));
    api.auth.getUser.mockResolvedValue({ data: { user: { id: 'alice' } }, error: null });
    const otp = queryResult({ id: 'otp', household_id: 'alice-house', phone_number: '111', attempts: 0,
      otp_hash: createHash('sha256').update('123456:111:test-pepper').digest('hex') });
    const identity = queryResult(null);
    const cleanup = queryResult(null);
    api.from.mockReturnValueOnce(otp).mockReturnValueOnce(identity).mockReturnValueOnce(cleanup);
    const result = await handler(new Request('https://edge.example.com/verify', { method: 'POST',
      headers: { Authorization: 'Bearer test-user' }, body: JSON.stringify({ code: '123456' }) }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: 'linked', phone: '111', householdId: 'alice-house' });
    expect(identity.upsert).toHaveBeenCalledWith(expect.objectContaining({ profile_id: 'alice', phone_number: '111', household_id: 'alice-house' }), { onConflict: 'profile_id' });
    expect(cleanup.delete).toHaveBeenCalledOnce();
    expect(cleanup.eq).toHaveBeenCalledWith('profile_id', 'alice');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts the configured Meta handshake without database or message traffic', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    const result = await handler(new Request('https://edge.example.com/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge'));
    expect(result.status).toBe(200);
    expect(await result.text()).toBe('challenge');
    expect(api.from).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('processes every signed batch message using its own sender and confirms authoritative results', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    const inboxQueries: ReturnType<typeof queryResult>[] = [];
    api.from.mockImplementation((table: string) => {
      if (table === 'accounts') return queryResult([{ name: 'Bank', kind: 'bank', currency: 'USD' }]);
      // v10.26.0 (R4) — investment assets are offered to the parser as aliases.
      if (table === 'assets') return queryResult([{ name: 'Nifty fund' }]);
      if (table === 'whatsapp_identities') {
        const query = queryResult(null);
        query.maybeSingle.mockImplementation(async () => {
          const phone = query.eq.mock.calls.find(([column]) => column === 'phone_number')?.[1];
          return { data: { profile_id: phone === '111' ? 'alice' : 'bob', household_id: phone === '111' ? 'alice-house' : 'bob-house' }, error: null };
        });
        return query;
      }
      if (table === 'whatsapp_inbound_messages') {
        const query = queryResult([{ wa_message_id: 'claimed' }]);
        inboxQueries.push(query);
        return query;
      }
      throw new Error(`Unexpected table ${table}`);
    });
    api.rpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => ({ error: null, data: {
      status: 'success', amount: args.p_amount, currency: 'USD', type: 'expense', category_id: 'groceries', account_name: 'Bank' } }));
    const body = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: '111' }, { wa_id: '222' }], messages: [
      { id: 'message-a', from: '111', text: { body: '50 groceries bank' } },
      { id: 'message-b', from: '222', text: { body: '75 groceries bank' } },
    ] } }] }] });
    const signature = createHmac('sha256', 'test-app-secret').update(body).digest('hex');
    const result = await handler(new Request('https://edge.example.com/webhook', { method: 'POST',
      headers: { 'x-hub-signature-256': `sha256=${signature}` }, body }));
    expect(await result.json()).toEqual({ status: 'ok', recorded: 2 });
    expect(api.rpc.mock.calls).toEqual([
      ['whatsapp_log_transaction', expect.objectContaining({ p_profile_id: 'alice', p_household_id: 'alice-house', p_amount: 50, p_wa_message_id: 'message-a' })],
      ['whatsapp_log_transaction', expect.objectContaining({ p_profile_id: 'bob', p_household_id: 'bob-house', p_amount: 75, p_wa_message_id: 'message-b' })],
    ]);
    const sends = vi.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(String(options?.body)));
    expect(sends).toEqual([
      expect.objectContaining({ to: '111', text: { body: expect.stringContaining('50 USD') } }),
      expect.objectContaining({ to: '222', text: { body: expect.stringContaining('75 USD') } }),
    ]);
    expect(inboxQueries.flatMap(query => query.upsert.mock.calls)).toHaveLength(2);
    expect(inboxQueries.flatMap(query => query.update.mock.calls).filter(([patch]) => patch.status === 'done')).toHaveLength(2);
  });
});