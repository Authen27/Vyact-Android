import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureHandler, queryResult } from './helpers/edgeHarness';

const api = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } }));
vi.mock('https://esm.sh/@supabase/supabase-js@2.45.0', () => ({ createClient: () => api }));
// W4 — the webhook's answer path, stubbed at the module seams (the engine itself is
// tested in serverEngine.test.ts, the model call in assistantCore.test.ts).
const engine = vi.hoisted(() => ({ loadHouseholdRows: vi.fn(), answerOnServer: vi.fn(), serverModelCall: vi.fn() }));
vi.mock('../../../../supabase/functions/_shared/agent/householdLoader.ts', () => ({ loadHouseholdRows: engine.loadHouseholdRows }));
vi.mock('../../../../supabase/functions/_shared/agent/assistantCore.ts', () => ({ serverModelCall: engine.serverModelCall }));
vi.mock('../../../../supabase/functions/_shared/agent/engine.ts', async () => {
  // W6 — the UPDATE list and the reconcile plan are the real engine functions.
  const { renderForWhatsApp, balancesToCheck, reconcileOnServer } = await import('../serverEngine');
  return { contextFromRows: () => ({}), answerOnServer: engine.answerOnServer, renderForWhatsApp, balancesToCheck, reconcileOnServer };
});
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

  it('verifies a valid OTP, persists the server-owned identity, consumes the OTP and asks notify for the welcome', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-verify-otp/index'));
    api.auth.getUser.mockResolvedValue({ data: { user: { id: 'alice' } }, error: null });
    const otp = queryResult({ id: 'otp', household_id: 'alice-house', phone_number: '111', attempts: 0,
      otp_hash: createHash('sha256').update('123456:111:test-pepper').digest('hex') });
    const identity = queryResult(null);
    const cleanup = queryResult(null);
    api.from.mockReturnValueOnce(otp).mockReturnValueOnce(identity).mockReturnValueOnce(cleanup)
      .mockReturnValueOnce(queryResult({ display_name: 'Alice Rao' })).mockReturnValueOnce(queryResult({ name: 'Rao Household' }));
    const result = await handler(new Request('https://edge.example.com/verify', { method: 'POST',
      headers: { Authorization: 'Bearer test-user' }, body: JSON.stringify({ code: '123456' }) }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: 'linked', phone: '111', householdId: 'alice-house' });
    expect(identity.upsert).toHaveBeenCalledWith(expect.objectContaining({ profile_id: 'alice', phone_number: '111', household_id: 'alice-house' }), { onConflict: 'profile_id' });
    expect(cleanup.delete).toHaveBeenCalledOnce();
    expect(cleanup.eq).toHaveBeenCalledWith('profile_id', 'alice');
    // v10.41.0 — the welcome goes through whatsapp-notify as the service, never straight to Meta.
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toMatch(/\/functions\/v1\/whatsapp-notify$/);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-service-key');
    expect(JSON.parse(String(init?.body))).toEqual({ event: 'whatsapp_welcome', householdId: 'alice-house', toProfileId: 'alice',
      params: ['Alice', 'Rao Household'], dedupeKey: 'link:alice-house:111' });
  });

  it('CON-UNIT-WA-R-006 · a welcome that cannot be sent never fails the link', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-verify-otp/index'));
    api.auth.getUser.mockResolvedValue({ data: { user: { id: 'alice' } }, error: null });
    api.from.mockReturnValueOnce(queryResult({ id: 'otp', household_id: 'alice-house', phone_number: '111', attempts: 0,
      otp_hash: createHash('sha256').update('123456:111:test-pepper').digest('hex') })).mockReturnValue(queryResult(null));
    vi.mocked(fetch).mockRejectedValue(new Error('network down'));
    const result = await handler(new Request('https://edge.example.com/verify', { method: 'POST',
      headers: { Authorization: 'Bearer test-user' }, body: JSON.stringify({ code: '123456' }) }));
    expect(await result.json()).toEqual({ status: 'linked', phone: '111', householdId: 'alice-house' });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).params).toEqual(['friend', 'your household']);
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
      if (table === 'whatsapp_pending_turns') return queryResult(null);   // W3: no open question
      if (table === 'transactions') return queryResult([]);             // W3: no same-amount twin
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
      expect.objectContaining({ to: '111', text: { body: expect.stringContaining('$50') } }),
      expect.objectContaining({ to: '222', text: { body: expect.stringContaining('$75') } }),
    ]);
    expect(inboxQueries.flatMap(query => query.upsert.mock.calls)).toHaveLength(2);
    expect(inboxQueries.flatMap(query => query.update.mock.calls).filter(([patch]) => patch.status === 'done')).toHaveLength(2);
  });
});

// ── v10.40.0 (W0) — failures are recorded, replayed and bounded ──────────────────
const sign = (body: string) => `sha256=${createHmac('sha256', 'test-app-secret').update(body).digest('hex')}`;
const inbound = (text: string) => JSON.stringify({ entry: [{ changes: [{ value: {
  messages: [{ id: 'm-1', from: '111', timestamp: String(Date.UTC(2026, 8, 24, 6, 0) / 1000), text: { body: text } }] } }] }] });

/** Route every table to a fresh query; the inbox claim reports `attempts`. */
function webhookTables(attempts = 0, linked = true, prefs: Record<string, unknown> | null = null) {
  const inbox: ReturnType<typeof queryResult>[] = [];
  const prefWrites: Record<string, unknown>[] = [];
  api.from.mockImplementation((table: string) => {
    if (table === 'accounts') return queryResult([{ name: 'Bank', kind: 'bank', currency: 'INR' }]);
    if (table === 'whatsapp_pending_turns') return queryResult(null);   // W3: no open question
    if (table === 'transactions') return queryResult([]);             // W3: no same-amount twin
    if (table === 'assets') return queryResult([]);
    if (table === 'whatsapp_identities') return queryResult(linked ? { profile_id: 'alice', household_id: 'alice-house' } : null);
    if (table === 'profiles') return queryResult({ display_name: 'Rohan Mehta' });
    if (table === 'whatsapp_preferences') {
      const q = queryResult(prefs);
      q.upsert.mockImplementation((row: Record<string, unknown>) => { prefWrites.push(row); return q; });
      return q;
    }
    if (table === 'whatsapp_inbound_messages') {
      const q = queryResult([{ wa_message_id: 'm-1', attempts }]);
      inbox.push(q);
      return q;
    }
    throw new Error(`Unexpected table ${table}`);
  });
  const patches = () => inbox.flatMap(q => q.update.mock.calls.map(([patch]) => patch as Record<string, unknown>));
  return { patches, prefWrites };
}
const sentTexts = () => vi.mocked(fetch).mock.calls.map(([, o]) => JSON.parse(String(o?.body))?.text?.body as string);

describe('webhook failure handling (W0)', () => {
  it('CON-UNIT-WA-W0-001 · a ledger error marks the row FAILED (not done), attempt 1, and says it is queued', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    const { patches } = webhookTables(0);
    api.rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
    const body = inbound('450 lunch');
    await handler(new Request('https://edge.example.com/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sign(body) }, body }));
    const failed = patches().filter(p => p.status === 'failed');
    expect(failed[0]).toEqual(expect.objectContaining({ status: 'failed', attempts: 1, last_error: 'rpc: connection reset' }));
    expect(patches().some(p => p.status === 'done')).toBe(false);
    expect(sentTexts()[0]).toContain('queued');
  });

  it('CON-UNIT-WA-W0-002 · the attempt counter climbs from the row, and the last retry asks the user to resend', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    const { patches } = webhookTables(2);
    api.rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    const body = inbound('450 lunch');
    await handler(new Request('https://edge.example.com/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sign(body) }, body }));
    expect(patches().find(p => p.status === 'failed')).toEqual(expect.objectContaining({ attempts: 3 }));
    expect(sentTexts()[0]).toContain('send it again');
  });

  it('CON-UNIT-WA-W0-003 · a stated date reaches p_date and is never read as the amount', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    webhookTables(0);
    api.rpc.mockResolvedValue({ error: null, data: { status: 'success', amount: 450, currency: 'INR', type: 'expense', category_id: 'food_dining', account_name: 'Bank' } });
    const body = inbound('yesterday 450 lunch');
    await handler(new Request('https://edge.example.com/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sign(body) }, body }));
    expect(api.rpc).toHaveBeenCalledWith('whatsapp_log_transaction', expect.objectContaining({ p_amount: 450, p_date: '2026-09-23' }));
    expect(sentTexts()[0]).toContain('on 2026-09-23');
  });

  it('CON-UNIT-WA-W0-004 · a button reply is recorded as done without a reply', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    const { patches } = webhookTables(0);
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: 'm-1', from: '111', type: 'button', button: { text: 'Mark as paid' } }] } }] }] });
    await handler(new Request('https://edge.example.com/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sign(body) }, body }));
    expect(patches().find(p => p.status === 'done')).toEqual(expect.objectContaining({ last_error: 'ignored_button' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('CON-UNIT-WA-W0-005 · the sweep needs the service key, then replays failed rows through the ledger', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    const denied = await handler(new Request('https://edge.example.com/webhook?mode=sweep', { method: 'POST', headers: { Authorization: 'Bearer nope' } }));
    expect(denied.status).toBe(403);
    api.from.mockImplementation((table: string) => {
      if (table === 'accounts') return queryResult([{ name: 'Bank', kind: 'bank', currency: 'INR' }]);
      if (table === 'assets') return queryResult([]);
      if (table === 'whatsapp_pending_turns') return queryResult(null);   // W3: no open question
      if (table === 'transactions') return queryResult([]);             // W3: no same-amount twin
      if (table === 'whatsapp_identities') return queryResult({ profile_id: 'alice', household_id: 'alice-house' });
      return queryResult([{ wa_message_id: 'm-9', attempts: 1, payload: { id: 'm-9', from: '111', text: { body: '80 coffee' } } }]);
    });
    api.rpc.mockResolvedValue({ error: null, data: { status: 'duplicate' } });
    const res = await handler(new Request('https://edge.example.com/webhook?mode=sweep', { method: 'POST', headers: { Authorization: 'Bearer test-service-key' } }));
    expect((await res.json()).replayed).toBeGreaterThan(0);
    expect(api.rpc).toHaveBeenCalledWith('whatsapp_log_transaction', expect.objectContaining({ p_wa_message_id: 'm-9', p_amount: 80 }));
    expect(fetch).not.toHaveBeenCalled();   // a replay that already landed stays silent
  });
});

describe('whatsapp-notify guards (W0)', () => {
  const ENABLED = { WHATSAPP_OUTBOUND_ENABLED: 'true', WHATSAPP_APPROVED_TEMPLATES: 'bill_due_reminder,split_settled,reengagement_nudge' };
  const call = (handler: (r: Request) => Promise<Response>, token: string, body: Record<string, unknown>) =>
    handler(new Request('https://edge.example.com/notify', { method: 'POST', headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ householdId: 'h', toProfileId: 'p2', ...body }) }));
  function tables(opts: { role?: string; claimError?: unknown; sentToday?: number; prefs?: Record<string, unknown> } = {}) {
    const inbox: ReturnType<typeof queryResult>[] = [];
    api.from.mockImplementation((table: string) => {
      if (table === 'memberships') return queryResult({ role: opts.role ?? 'member' });
      if (table === 'whatsapp_identities') return queryResult({ phone_number: '222', household_id: 'h' });
      if (table === 'whatsapp_preferences') return queryResult(opts.prefs ?? null);
      if (table === 'whatsapp_inbound_messages') {
        // Call order: [0] the 24h count, [1] the dedupe claim, then status updates.
        const q = queryResult(null, inbox.length === 1 ? (opts.claimError ?? null) : null, opts.sentToday ?? 0);
        inbox.push(q);
        return q;
      }
      throw new Error(`Unexpected table ${table}`);
    });
    return inbox;
  }

  it('CON-UNIT-WA-W0-006 · a server job authenticates with the service key and sends', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-notify/index'), ENABLED);
    tables();
    const res = await call(handler, 'test-service-key', { event: 'split_settled', params: ['Priya', 'BESCOM\nbill', 'Dinner'] });
    expect(await res.json()).toEqual({ status: 'sent', template: 'split_settled' });
    expect(api.auth.getUser).not.toHaveBeenCalled();
    const sent = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    const component = (type: string) => sent.template.components.find((c: { type: string }) => c.type === type);
    expect(component('body').parameters[1].text).toBe('BESCOM bill');   // newline cleaned
    // W1 — an image template carries its header image on the send.
    expect(component('header').parameters[0].image.link).toMatch(/\/whatsapp\/08-split-settled\.jpg$/);
  });

  // v10.47.1 — the runtime's SUPABASE_SERVICE_ROLE_KEY need not equal the legacy
  // service_role JWT the dashboard shows (a correct key got 401 on 26 Sep).
  const jwt = (claims: Record<string, unknown>) => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.signature`;
  };
  function withProbe(ok: boolean) {
    const base = api.from.getMockImplementation()!;
    api.from.mockImplementation((table: string) => table === 'whatsapp_pending_turns'
      ? queryResult(null, ok ? null : { code: '42501', message: 'permission denied' }, ok ? 0 : null)
      : base(table));
  }

  it('CON-UNIT-WA-W0-011 · a service-role key that is not byte-equal to the runtime\'s is accepted once PostgREST verifies it', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-notify/index'), ENABLED);
    tables();
    withProbe(true);
    const res = await call(handler, jwt({ role: 'service_role', ref: 'dmxq' }), { event: 'split_settled', params: ['Priya', '₹600', 'Dinner'] });
    expect(await res.json()).toEqual({ status: 'sent', template: 'split_settled' });
    expect(api.from).toHaveBeenCalledWith('whatsapp_pending_turns');
    expect(api.auth.getUser).not.toHaveBeenCalled();
  });

  it('CON-UNIT-WA-W0-012 · a forged service-role claim is refused: the claim alone is never trusted', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-notify/index'), ENABLED);
    api.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } });
    tables();
    withProbe(false);
    const res = await call(handler, jwt({ role: 'service_role' }), { event: 'split_settled', params: ['Priya', '₹600', 'Dinner'] });
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('CON-UNIT-WA-W0-007 · a viewer cannot message other members', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-notify/index'), ENABLED);
    api.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    tables({ role: 'viewer' });
    const res = await call(handler, 'user-jwt', { event: 'bill_due', params: ['Rohan', '₹3,200', 'Tuesday', 'BESCOM'] });
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('CON-UNIT-WA-W0-008 · marketing is refused until the recipient has opted in', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-notify/index'), ENABLED);
    tables();
    expect(await (await call(handler, 'test-service-key', { event: 'reengagement', params: ['Rohan', '6,850', 'four'] })).json())
      .toEqual(expect.objectContaining({ status: 'skipped', reason: 'marketing_consent_required' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('CON-UNIT-WA-W0-009 · a second send of the same event is refused as a duplicate', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-notify/index'), ENABLED);
    tables({ claimError: { code: '23505' } });
    expect(await (await call(handler, 'test-service-key', { event: 'split_settled', dedupeKey: 'split:s-1', params: ['Priya', '₹600', 'Dinner'] })).json())
      .toEqual(expect.objectContaining({ status: 'skipped', reason: 'duplicate' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('CON-UNIT-WA-W0-010 · the daily cap and the outbound switch both stop a send', async () => {
    let handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-notify/index'), ENABLED);
    tables({ sentToday: 6 });
    expect((await (await call(handler, 'test-service-key', { event: 'split_settled', params: ['Priya', '₹600', 'Dinner'] })).json()).reason).toBe('daily_cap');
    vi.resetModules();
    handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-notify/index'));
    tables();
    expect((await (await call(handler, 'test-service-key', { event: 'split_settled', params: ['Priya', '₹600', 'Dinner'] })).json()).reason).toBe('outbound_disabled');
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ── v10.41.0 — the receptionist: a greeting opens the action menu ───────────────
describe('WhatsApp receptionist', () => {
  const post = async (handler: (r: Request) => Promise<Response>, body: string) =>
    handler(new Request('https://edge.example.com/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sign(body) }, body }));
  const sentBodies = () => vi.mocked(fetch).mock.calls.map(([, o]) => JSON.parse(String(o?.body)));

  it('CON-UNIT-WA-R-001 · "Hi" from a linked number gets the action list by first name, and logs nothing', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    webhookTables(0);
    await post(handler, inbound('Hi'));
    const [msg] = sentBodies();
    expect(msg.type).toBe('interactive');
    expect(msg.interactive.type).toBe('list');
    expect(msg.interactive.body.text).toMatch(/^Hi, Rohan\. What would you like to do\?/);
    expect(msg.interactive.action.button).toBe('Choose an action');
    expect(msg.interactive.action.sections.map((s: { title: string }) => s.title)).toEqual(['Record', 'Check', 'Help and settings']);
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it('CON-UNIT-WA-R-002 · a tapped row gets its reply; with answers off a Check row offers answers here — no link, no figures', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    webhookTables(0);
    const tap = (id: string) => JSON.stringify({ entry: [{ changes: [{ value: { messages: [
      { id: 'm-1', from: '111', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title: 'x' } } }] } }] }] });
    await post(handler, tap('menu:log_spend'));
    expect(sentTexts()[0]).toContain('450 lunch hdfc');
    vi.mocked(fetch).mockClear();
    await post(handler, tap('menu:budgets'));
    expect(sentTexts()[0]).toMatch(/^I can answer that here\./);
    expect(sentTexts()[0]).not.toMatch(/https?:\/\//);                       // the WhatsApp answer rule
    expect(sentTexts()[0]).not.toMatch(/₹\d/);
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it('CON-UNIT-WA-R-003 · an unlinked number gets who we are on a greeting, a one-line reminder otherwise', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    webhookTables(0, false);
    await post(handler, inbound('hello'));
    expect(sentTexts()[0]).toContain("isn't linked to an account yet");
    vi.mocked(fetch).mockClear();
    await post(handler, inbound('450 lunch'));
    expect(sentTexts()[0]).toBe("I can't record that until this number is linked. Settings › WhatsApp in the app.");
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it('CON-UNIT-WA-R-007 · the welcome template’s buttons open the menu or answer as its rows; other templates’ taps wait for W2', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    const { patches } = webhookTables(0);
    const tap = (button: Record<string, string>) => JSON.stringify({ entry: [{ changes: [{ value: { messages: [
      { id: 'm-1', from: '111', type: 'button', button } ] } }] }] });
    await post(handler, tap({ payload: 'whatsapp_welcome:0:link:alice-house:111', text: 'Menu' }));
    const [menu] = sentBodies();
    expect(menu.interactive.type).toBe('list');
    expect(menu.interactive.body.text).toBe("Here's everything I can do in this chat.");
    vi.mocked(fetch).mockClear();
    await post(handler, tap({ payload: 'whatsapp_welcome:1:link:alice-house:111', text: 'Log a spend' }));
    expect(sentTexts()[0]).toContain('450 lunch hdfc');
    vi.mocked(fetch).mockClear();
    await post(handler, tap({ payload: 'What can I send?', text: 'What can I send?' }));   // a test send from WhatsApp Manager
    expect(sentTexts()[0]).toContain('Send MENU any time');
    vi.mocked(fetch).mockClear();
    await post(handler, tap({ payload: 'someone_elses:1:x', text: 'Flag it' }));   // a payload we never issued
    expect(fetch).not.toHaveBeenCalled();
    expect(patches().at(-1)).toEqual(expect.objectContaining({ status: 'done', last_error: 'ignored_button' }));
    expect(api.rpc).not.toHaveBeenCalled();
  });
});

// ── v10.43.0 (W2b) — "paid Rent" approves the reminded bill, atomically ─────────
describe('WhatsApp "paid X" (W2b)', () => {
  const SID = '44444444-4444-4444-8444-444444444444';
  const schedule = { id: SID, household_id: 'alice-house', frequency: 'monthly', start_date: '2026-01-25', next_due_date: '2026-09-24',
    last_generated: null, day_of_month: 24, weekday: null, auto_confirm: false, active: true, owner_member_id: null,
    txn_template: { type: 'expense', amount: 25000, currency: 'INR', description: 'Rent', category: 'rent_mortgage', accountId: '22222222-2222-4222-8222-222222222222' } };
  function tables(reminders: unknown[]) {
    api.from.mockImplementation((table: string) => {
      if (table === 'whatsapp_identities') return queryResult({ profile_id: 'alice', household_id: 'alice-house' });
      if (table === 'whatsapp_pending_turns') return queryResult(null);   // W3: no open question
      if (table === 'transactions') return queryResult([]);             // W3: no same-amount twin
      if (table === 'recurring_schedules') return queryResult(schedule);
      if (table === 'accounts') return queryResult([{ name: 'Bank', kind: 'bank', currency: 'INR' }]);
      if (table === 'assets') return queryResult([]);
      if (table === 'whatsapp_inbound_messages') {
        const q = queryResult([{ wa_message_id: 'm-1', attempts: 0 }]);
        q.like.mockReturnValue(queryResult(reminders));   // the sent-reminder lookup
        return q;
      }
      throw new Error(`Unexpected table ${table}`);
    });
  }
  const post = async (handler: (r: Request) => Promise<Response>, body: string) =>
    handler(new Request('https://edge.example.com/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sign(body) }, body }));
  const reminder = { wa_message_id: `out:bill_due_reminder:alice:bill:${SID}:2026-09-24`, payload: { params: ['Rent', '₹25,000', '24 Sep', 'Rent'] } };

  it('CON-UNIT-WA-B-003 · "paid rent" after a reminder approves THAT occurrence with the app’s row and next date', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    tables([reminder]);
    api.rpc.mockResolvedValue({ error: null, data: { status: 'success', already_posted: false, next_due_date: '2026-10-24' } });
    await post(handler, inbound('paid rent'));
    const { recurringInstanceId } = await import('../../../../supabase/functions/_shared/recurring');
    expect(api.rpc).toHaveBeenCalledTimes(1);
    expect(api.rpc).toHaveBeenCalledWith('whatsapp_approve_recurring', expect.objectContaining({
      p_profile_id: 'alice', p_household_id: 'alice-house', p_schedule_id: SID, p_occurrence: '2026-09-24',
      p_today: '2026-09-24', p_next_due: '2026-10-24', p_wa_message_id: 'm-1',
      p_row: expect.objectContaining({ id: recurringInstanceId(SID, '2026-09-24'), amount: 25000, date: '2026-09-24', recurring_schedule_id: SID }),
    }));
    expect(sentTexts()[0]).toBe('Logged: Rent, ₹25,000, for 24 Sep, as scheduled. The next one is due 24 Oct.');
  });

  it('CON-UNIT-WA-B-004 · a different amount is not logged; with no reminder "paid X" is an ordinary entry', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    tables([reminder]);
    await post(handler, inbound('paid rent 24000'));
    expect(api.rpc).not.toHaveBeenCalled();
    expect(sentTexts()[0]).toMatch(/^Rent is scheduled at ₹25,000, so I haven't logged 24000\./);
    vi.mocked(fetch).mockClear();
    tables([]);
    api.rpc.mockResolvedValue({ error: null, data: { status: 'success', amount: 450, currency: 'INR', type: 'expense', category_id: 'food_dining', account_name: 'Bank' } });
    await post(handler, inbound('paid 450 lunch'));
    expect(api.rpc).toHaveBeenCalledWith('whatsapp_log_transaction', expect.objectContaining({ p_amount: 450 }));
    expect(api.rpc).not.toHaveBeenCalledWith('whatsapp_approve_recurring', expect.anything());
  });

  it('CON-UNIT-W5-013 · "Already paid" on an overdue reminder approves THAT occurrence through the same atomic path', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    tables([]);                                                              // no name lookup is needed
    api.rpc.mockResolvedValue({ error: null, data: { status: 'success', already_posted: false, next_due_date: '2026-10-24' } });
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: 'm-1', from: '111', type: 'button',
      timestamp: String(Date.UTC(2026, 8, 27, 6, 0) / 1000),
      button: { payload: `bill_overdue_reminder:0:bill:${SID}:2026-09-24`, text: 'Already paid' } }] } }] }] });
    await post(handler, body);
    expect(api.rpc).toHaveBeenCalledWith('whatsapp_approve_recurring', expect.objectContaining({
      p_schedule_id: SID, p_occurrence: '2026-09-24', p_today: '2026-09-27', p_next_due: '2026-10-24',
    }));
    expect(sentTexts()[0]).toBe('Logged: Rent, ₹25,000, for 24 Sep, as scheduled. The next one is due 24 Oct.');
  });

  it('CON-UNIT-WA-B-005 · already approved in the app, or not approvable from chat, is said plainly', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    tables([reminder]);
    api.rpc.mockResolvedValueOnce({ error: null, data: { status: 'already_done' } });
    await post(handler, inbound('paid Rent'));
    expect(sentTexts()[0]).toBe("Rent for 24 Sep was already approved in the app, so I've left it.");
    vi.mocked(fetch).mockClear();
    api.rpc.mockResolvedValueOnce({ error: null, data: { status: 'error', reason: 'approve_in_app' } });
    await post(handler, inbound('paid Rent'));
    expect(sentTexts()[0]).toMatch(/^Rent has to be approved in the app/);
  });
});

// ── v10.42.0 (W2) — consent, STOP, statuses and template button taps ────────────
describe('WhatsApp preferences and taps (W2)', () => {
  const post = async (handler: (r: Request) => Promise<Response>, body: string) =>
    handler(new Request('https://edge.example.com/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sign(body) }, body }));
  const tap = (payload: string, extra: Record<string, unknown> = {}) => JSON.stringify({ entry: [{ changes: [{ value: { messages: [
    { id: 'm-1', from: '111', type: 'button', button: { payload, text: 'x' }, ...extra }] } }] }] });

  it('CON-UNIT-WA-P-001 · STOP BUDGETS mutes budgets, says what still comes, and logs nothing', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    const { prefWrites } = webhookTables(0);
    await post(handler, inbound('STOP BUDGETS'));
    expect(prefWrites[0]).toEqual(expect.objectContaining({ profile_id: 'alice', muted_topics: ['budgets'] }));
    expect(sentTexts()[0]).toMatch(/^Done\. No more budget alerts\./);
    expect(sentTexts()[0]).toContain('Bill reminders and large-spend alerts still come');
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it('CON-UNIT-WA-P-002 · bare STOP withdraws marketing and insights and mutes every mutable topic, never bills', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    const { prefWrites } = webhookTables(0, true, { marketing_opt_in: true, insights_opt_in: false, muted_topics: [], large_txn_threshold: 10000 });
    await post(handler, inbound('stop'));
    const w = prefWrites[0];
    expect(w).toEqual(expect.objectContaining({ marketing_opt_in: false, insights_opt_in: false, marketing_opt_in_at: null, marketing_source: null }));
    expect(w.muted_topics).toContain('weekly');
    expect(w.muted_topics).not.toContain('bills');
    expect(w.muted_topics).not.toContain('large_spend');
  });

  it('CON-UNIT-WA-P-003 · a "Stop these" tap mutes that template’s topic; "Flag it" advises the bank and writes nothing', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    const { prefWrites } = webhookTables(0);
    await post(handler, tap('payday_headroom:1:2026-09-25'));
    expect(prefWrites[0]).toEqual(expect.objectContaining({ muted_topics: ['payday'] }));
    expect(sentTexts()[0]).toMatch(/^Done\. No more payday messages\./);
    vi.mocked(fetch).mockClear();
    await post(handler, tap('large_transaction_alert:1:txn:t-1'));
    expect(sentTexts()[0]).toContain("I can't block a card");
    expect(prefWrites).toHaveLength(1);
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it('CON-UNIT-WA-P-004 · a tap on a message more than a week old is not acted on', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    const { prefWrites } = webhookTables(0);
    const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
    api.from.mockImplementation(((orig) => (table: string) => {
      if (table === 'whatsapp_inbound_messages') {
        const q = queryResult([{ wa_message_id: 'm-1', attempts: 0 }]);
        q.maybeSingle.mockReturnValue(queryResult({ created_at: old }));
        return q;
      }
      return orig(table);
    })(api.from.getMockImplementation()!));
    await post(handler, tap('payday_headroom:1:2026-09-01', { context: { id: 'wamid.OLD' } }));
    expect(sentTexts()[0]).toMatch(/^That message is from a while ago/);
    expect(prefWrites).toHaveLength(0);
  });

  it('CON-UNIT-WA-P-005 · delivery statuses move forward only, and Meta’s marketing stop withdraws consent', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    const updates: Record<string, unknown>[] = [];
    const prefWrites: Record<string, unknown>[] = [];
    let current = 'delivered';
    api.from.mockImplementation((table: string) => {
      if (table === 'whatsapp_identities') return queryResult({ profile_id: 'alice', household_id: 'alice-house' });
      if (table === 'whatsapp_preferences') {
        const q = queryResult(null);
        q.upsert.mockImplementation((row: Record<string, unknown>) => { prefWrites.push(row); return q; });
        return q;
      }
      const q = queryResult({ wa_message_id: 'out:x', delivery_status: current });
      q.update.mockImplementation((row: Record<string, unknown>) => { updates.push(row); return q; });
      return q;
    });
    const body = (statuses: unknown[], extra: Record<string, unknown> = {}) =>
      JSON.stringify({ entry: [{ changes: [{ value: { statuses, ...extra } }] }] });
    await post(handler, body([{ id: 'wamid.1', status: 'read' }]));
    expect(updates[0]).toEqual(expect.objectContaining({ delivery_status: 'read' }));
    current = 'read';
    await post(handler, body([{ id: 'wamid.1', status: 'delivered' }]));   // late, out of order
    expect(updates).toHaveLength(1);
    await post(handler, body([], { user_preferences: [{ wa_id: '111', category: 'marketing_messages', value: 'stop' }] }));
    expect(prefWrites[0]).toEqual(expect.objectContaining({ profile_id: 'alice', marketing_opt_in: false, marketing_source: 'meta_opt_out' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('CON-UNIT-WA-P-006 · "Messages I send you" reads the person’s own preferences', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    webhookTables(0, true, { marketing_opt_in: false, insights_opt_in: false, muted_topics: ['budgets'], large_txn_threshold: 10000 });
    await post(handler, JSON.stringify({ entry: [{ changes: [{ value: { messages: [
      { id: 'm-1', from: '111', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'menu:messages', title: 'x' } } }] } }] }] }));
    const text = sentTexts()[0];
    expect(text).toContain('Bill reminders and large-spend alerts (always)');
    expect(text).toMatch(/Off:\n• Budget alerts/);
    expect(text).toContain('Tips and weekly summaries');
  });

  it('CON-UNIT-WA-P-007 · notify refuses a muted topic and marketing without opt-in, and records Meta’s id on a send', async () => {
    const ENABLED = { WHATSAPP_OUTBOUND_ENABLED: 'true', WHATSAPP_APPROVED_TEMPLATES: 'budget_threshold_alert,weekly_summary' };
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-notify/index'), ENABLED);
    const call = (body: Record<string, unknown>) => handler(new Request('https://edge.example.com/notify', { method: 'POST',
      headers: { Authorization: 'Bearer test-service-key' }, body: JSON.stringify({ householdId: 'h', toProfileId: 'p2', ...body }) }));
    let prefs: Record<string, unknown> = { marketing_opt_in: false, insights_opt_in: false, muted_topics: ['budgets'], large_txn_threshold: 10000 };
    const updates: Record<string, unknown>[] = [];
    api.from.mockImplementation((table: string) => {
      if (table === 'whatsapp_identities') return queryResult({ phone_number: '222', household_id: 'h' });
      if (table === 'whatsapp_preferences') return queryResult(prefs);
      const q = queryResult(null, null, 0);
      q.update.mockImplementation((row: Record<string, unknown>) => { updates.push(row); return q; });
      return q;
    });
    const budget = { event: 'budget_threshold_alert', params: ['Dining', '81', '9', '1,540'] };
    expect((await (await call(budget)).json()).reason).toBe('muted');
    expect((await (await call({ event: 'weekly_summary', params: ['₹1', '2', 'Dining'] })).json()).reason).toBe('marketing_consent_required');
    prefs = { ...prefs, muted_topics: [] };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: 'wamid.SENT' }] })));
    expect(await (await call(budget)).json()).toEqual({ status: 'sent', template: 'budget_threshold_alert' });
    expect(updates.at(-1)).toEqual(expect.objectContaining({ status: 'sent', provider_message_id: 'wamid.SENT', delivery_status: 'accepted' }));
  });
});

// ── v10.44.0 (W3) — the capture conversation ─────────────────────────────────────
describe('WhatsApp capture conversation (W3)', () => {
  const post = async (handler: (r: Request) => Promise<Response>, text: string, id = 'm-1') => {
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [
      { id, from: '111', timestamp: String(Date.UTC(2026, 8, 24, 6, 0) / 1000), text: { body: text } }] } }] }] });
    return handler(new Request('https://edge.example.com/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sign(body) }, body }));
  };
  /** A stateful pending-turn table, and a switchable "twin" for the duplicate check. */
  function convTables(opts: { twin?: boolean; lastType?: string } = {}) {
    let open: Record<string, unknown> | null = null;
    api.from.mockImplementation((table: string) => {
      if (table === 'accounts') return queryResult([{ name: 'HDFC', kind: 'bank', currency: 'INR' }]);
      if (table === 'assets') return queryResult([]);
      if (table === 'whatsapp_identities') return queryResult({ profile_id: 'alice', household_id: 'alice-house' });
      if (table === 'profiles') return queryResult({ display_name: 'Rohan' });
      if (table === 'transactions') return queryResult(opts.twin ? [{ created_at: new Date(Date.now() - 20 * 60_000).toISOString() }] : []);
      if (table === 'whatsapp_pending_turns') {
        const q = queryResult(open);
        q.insert.mockImplementation((row: Record<string, unknown>) => { open = { id: 'p-1', ...row }; return q; });
        q.update.mockImplementation(() => { open = null; return q; });
        return q;
      }
      if (table === 'whatsapp_inbound_messages') {
        const q = queryResult([{ wa_message_id: 'm-1', attempts: 0 }]);
        q.maybeSingle.mockReturnValue(queryResult({ payload: { parsed: { type: opts.lastType ?? 'expense' } } }));
        return q;
      }
      throw new Error(`Unexpected table ${table}`);
    });
    api.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => ({ error: null, data:
      name === 'whatsapp_log_transaction'
        ? { status: 'success', amount: args.p_amount, currency: 'INR', type: 'expense', category_id: args.p_category_id, account_name: 'HDFC' }
        : name === 'whatsapp_undo_last' ? { status: 'undone', amount: 450, currency: 'INR', category_id: 'groceries' }
        : { status: 'corrected', amount: 450, currency: 'INR' } }));
    return { open: () => open };
  }
  const logCalls = () => api.rpc.mock.calls.filter(([n]) => n === 'whatsapp_log_transaction');

  it('CON-UNIT-WA-C-001 · a missing amount is asked for, and the next bare number completes the SAME entry', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    const state = convTables();
    await post(handler, 'groceries hdfc');
    expect(sentTexts()[0]).toBe('How much was it? Reply with just the amount, like 450.');
    expect(state.open()).toEqual(expect.objectContaining({ kind: 'missing_amount' }));
    expect(logCalls()).toHaveLength(0);                                     // nothing written without an answer
    vi.mocked(fetch).mockClear();
    await post(handler, '450', 'm-2');
    expect(logCalls()).toHaveLength(1);
    expect(logCalls()[0][1]).toEqual(expect.objectContaining({ p_amount: 450, p_category_id: 'groceries', p_wa_message_id: 'm-2' }));
    expect(sentTexts()[0]).toMatch(/^✅ Logged ₹450 · Groceries from HDFC\. Reply UNDO within 15 minutes to remove it\.$/);
  });

  it('CON-UNIT-WA-C-002 · a same-amount twin within two hours asks first; 1 logs it, 2 logs nothing', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    convTables({ twin: true });
    await post(handler, '450 groceries hdfc');
    expect(sentTexts()[0]).toBe('You logged ₹450 · Groceries 20 minutes ago. Log this one too?\n\nReply 1 to log it, 2 to skip.');
    expect(logCalls()).toHaveLength(0);
    await post(handler, '1', 'm-2');
    expect(logCalls()).toHaveLength(1);
    vi.mocked(fetch).mockClear();
    api.rpc.mockClear();
    await post(handler, '450 groceries hdfc', 'm-3');
    await post(handler, 'no', 'm-4');
    expect(sentTexts().at(-1)).toBe('Skipped. Nothing was logged.');
    expect(logCalls()).toHaveLength(0);
  });

  it('CON-UNIT-WA-C-003 · an answer to an expired question is refused, never logged as ₹1', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    const state = convTables({ twin: true });
    await post(handler, '450 groceries hdfc');
    (state.open() as Record<string, unknown>).expires_at = new Date(Date.now() - 60_000).toISOString();
    vi.mocked(fetch).mockClear();
    await post(handler, '1', 'm-2');
    expect(sentTexts()[0]).toMatch(/^That question has expired/);
    expect(logCalls()).toHaveLength(0);
  });

  it('CON-UNIT-WA-C-004 · UNDO and a correction go to their RPCs; a category of the wrong type is refused', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    convTables();
    await post(handler, 'undo');
    expect(api.rpc).toHaveBeenCalledWith('whatsapp_undo_last', { p_profile_id: 'alice', p_household_id: 'alice-house', p_wa_message_id: 'm-1' });
    expect(sentTexts()[0]).toBe('Undone. ₹450 · Groceries is removed from Vyact.');
    vi.mocked(fetch).mockClear();
    await post(handler, 'no, that was fuel', 'm-2');
    expect(api.rpc).toHaveBeenCalledWith('whatsapp_correct_last', expect.objectContaining({ p_category: 'travel' }));
    expect(sentTexts()[0]).toBe('Changed. ₹450 is now under Travel.');
    vi.mocked(fetch).mockClear();
    api.rpc.mockClear();
    await post(handler, 'actually salary', 'm-3');                              // an income category for a spend
    expect(api.rpc).not.toHaveBeenCalledWith('whatsapp_correct_last', expect.anything());
    expect(sentTexts()[0]).toMatch(/isn't a category for a spend/);
  });
});
// ── v10.45.0 (W4) — Ask Vyact on WhatsApp, with consent ──────────────────────────
describe('WhatsApp answers (W4)', () => {
  const post = async (handler: (r: Request) => Promise<Response>, body: string) =>
    handler(new Request('https://edge.example.com/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sign(body) }, body }));
  const say = (text: string, id = 'm-1') => JSON.stringify({ entry: [{ changes: [{ value: { messages: [
    { id, from: '111', timestamp: String(Date.UTC(2026, 8, 24, 6, 0) / 1000), text: { body: text } }] } }] }] });
  function answerTables(readsEnabled: boolean) {
    let open: Record<string, unknown> | null = null;
    api.from.mockImplementation((table: string) => {
      if (table === 'accounts') return queryResult([{ name: 'HDFC', kind: 'bank', currency: 'INR' }]);
      if (table === 'assets') return queryResult([]);
      if (table === 'whatsapp_identities') return queryResult({ profile_id: 'alice', household_id: 'alice-house' });
      if (table === 'whatsapp_preferences') return queryResult({ reads_enabled: readsEnabled, marketing_opt_in: false, insights_opt_in: false, muted_topics: [], large_txn_threshold: 10000 });
      if (table === 'transactions') return queryResult([]);
      if (table === 'whatsapp_pending_turns') {
        const q = queryResult(open);
        q.insert.mockImplementation((row: Record<string, unknown>) => { open = { id: 'p-1', expires_at: new Date(Date.now() + 60_000).toISOString(), ...row }; return q; });
        q.update.mockImplementation(() => { open = null; return q; });
        return q;
      }
      if (table === 'whatsapp_inbound_messages') return queryResult([{ wa_message_id: 'm-1', attempts: 0 }]);
      throw new Error(`Unexpected table ${table}`);
    });
    engine.loadHouseholdRows.mockResolvedValue({});
    engine.serverModelCall.mockReturnValue(async () => 'unused');
    engine.answerOnServer.mockResolvedValue({ reply: '**You spent ₹2,000** this month.', intentId: 'interpret.lookup',
      chips: [{ label: 'By category', prompt: 'Where did it go?' }], allowedFigures: ['2,000'] });
  }

  it('CON-UNIT-W4-007 · with answers OFF, a question is offered answers here (no link) and reads nothing', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    answerTables(false);
    await post(handler, say('how much did I spend this month?'));
    expect(sentTexts()[0]).toBe("I can answer that here. Your figures would show in this chat and on your phone's lock screen.\n\nReply ANSWERS ON to allow it. You can turn it off any time with ANSWERS OFF.");
    expect(engine.loadHouseholdRows).not.toHaveBeenCalled();
    expect(engine.answerOnServer).not.toHaveBeenCalled();
  });

  it('CON-UNIT-W5-010 · ANSWERS ON records consent as given in WhatsApp, then answers the question that prompted it', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    answerTables(false);
    const prefWrites: Record<string, unknown>[] = [];
    const base = api.from.getMockImplementation()!;
    api.from.mockImplementation((table: string) => {
      const q = base(table);
      if (table === 'whatsapp_preferences') q.upsert.mockImplementation((row: Record<string, unknown>) => { prefWrites.push(row); return q; });
      return q;
    });
    await post(handler, say('how much did I spend this month?'));
    vi.mocked(fetch).mockClear();
    await post(handler, say('answers on', 'm-2'));
    expect(prefWrites[0]).toEqual(expect.objectContaining({ reads_enabled: true, reads_source: 'whatsapp_keyword' }));
    expect(sentTexts()[0]).toMatch(/^Done\. I'll answer your questions here\./);
    expect(engine.answerOnServer).toHaveBeenCalledWith('how much did I spend this month?', expect.anything(), expect.any(Function), []);
    expect(sentTexts()[1]).toBe('You spent ₹2,000 this month.\n\n1. By category\n\nReply with a number, or ask anything.');
  });

  it('CON-UNIT-W5-011 · LOG answers with the one-line format and writes nothing', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    answerTables(false);
    await post(handler, say('LOG'));
    expect(sentTexts()[0]).toMatch(/^Send it in one line:\n450 lunch hdfc/);
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it('CON-UNIT-W4-008 · with answers ON, Ask Vyact answers from this household; "1" asks the follow-up with the stated figures', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    answerTables(true);
    await post(handler, say('how much did I spend this month?'));
    expect(engine.loadHouseholdRows).toHaveBeenCalledWith(expect.anything(), 'alice', 'alice-house');
    expect(engine.serverModelCall).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'alice', householdId: 'alice-house', surface: 'whatsapp' }));
    expect(engine.answerOnServer).toHaveBeenCalledWith('how much did I spend this month?', expect.anything(), expect.any(Function), []);
    expect(sentTexts()[0]).toBe('You spent ₹2,000 this month.\n\n1. By category\n\nReply with a number, or ask anything.');
    vi.mocked(fetch).mockClear();
    await post(handler, say('1', 'm-2'));
    expect(engine.answerOnServer).toHaveBeenLastCalledWith('Where did it go?', expect.anything(), expect.any(Function), ['2,000']);
    expect(api.rpc).not.toHaveBeenCalled();                                     // a question writes nothing
  });

  it('CON-UNIT-W4-009 · the menu’s Check rows ask Ask Vyact when answers are on; a failed read says so plainly', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    answerTables(true);
    await post(handler, JSON.stringify({ entry: [{ changes: [{ value: { messages: [
      { id: 'm-1', from: '111', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'menu:budgets', title: 'x' } } }] } }] }] }));
    expect(engine.answerOnServer).toHaveBeenCalledWith('How are my budgets doing this month?', expect.anything(), expect.any(Function), []);
    vi.mocked(fetch).mockClear();
    engine.loadHouseholdRows.mockRejectedValueOnce(new Error('timeout'));
    await post(handler, say('what is my net worth?', 'm-3'));
    expect(sentTexts()[0]).toBe("I couldn't reach your figures just now, so I haven't answered. Please ask again in a minute.");
  });
});

// ── v10.47.0 (W6) — "Name them here" and "Reply UPDATE" ─────────────────────────
describe('WhatsApp follow-up conversations (W6)', () => {
  const post = async (handler: (r: Request) => Promise<Response>, message: Record<string, unknown>) => {
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [
      { from: '111', timestamp: String(Date.UTC(2026, 8, 26, 6, 0) / 1000), ...message }] } }] }] });
    return handler(new Request('https://edge.example.com/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sign(body) }, body }));
  };
  const say = (text: string, id = 'm-1') => ({ id, text: { body: text } });
  const BANK = '22222222-2222-4222-8222-222222222222';
  const CARD = '33333333-3333-4333-8333-333333333333';
  const acct = (id: string, p: Record<string, unknown>) => ({ id, household_id: 'alice-house', kind: 'bank', name: 'x', currency: 'INR',
    opening_balance: 0, is_default: false, is_archived: false, reconciliation_offset: 0, reconciliation_log: [], payment_modes: [],
    asset_id: null, debt_id: null, last_reconciled_at: '2026-08-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: null, ...p });
  const householdRows = () => ({
    transactions: [], budgets: [], budgetAllocations: [], goals: [], debts: [], assets: [], recurring: [],
    accounts: [acct(BANK, { name: 'HDFC Savings', opening_balance: 48200, last_reconciled_at: '2026-08-23T06:00:00Z' }),
      acct(CARD, { kind: 'credit_card', name: 'Axis card', opening_balance: -12900, credit_limit: 100000, last_reconciled_at: '2026-07-01T00:00:00Z' })],
    memberCount: 1, rates: [], profile: { display_name: 'Rohan' },
    household: { type: 'family', base_currency: 'INR', language: 'en', payoff_strategy: 'avalanche', extra_payment: 0 }, email: '',
  });
  function followTables(role = 'member') {
    let open: Record<string, unknown> | null = null;
    api.from.mockImplementation((table: string) => {
      if (table === 'whatsapp_identities') return queryResult({ profile_id: 'alice', household_id: 'alice-house' });
      if (table === 'memberships') return queryResult({ role });
      if (table === 'profiles') return queryResult({ display_name: 'Rohan' });
      if (table === 'whatsapp_preferences') return queryResult({ reads_enabled: false, marketing_opt_in: true, insights_opt_in: false, muted_topics: [], large_txn_threshold: 10000 });
      if (table === 'whatsapp_pending_turns') {
        const q = queryResult(open);
        q.insert.mockImplementation((row: Record<string, unknown>) => { open = { id: 'p-1', expires_at: new Date(Date.now() + 60_000).toISOString(), ...row }; return q; });
        q.update.mockImplementation(() => { open = null; return q; });
        return q;
      }
      if (table === 'whatsapp_inbound_messages') return queryResult([{ wa_message_id: 'm-1', attempts: 0 }]);
      throw new Error(`Unexpected table ${table}`);
    });
    api.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => ({ error: null, data:
      name === 'whatsapp_unnamed_expenses' ? [
        { id: 'e-1', amount: 2400, currency: 'INR', date: '2026-09-12', account_name: 'HDFC' },
        { id: 'e-2', amount: 1850, currency: 'INR', date: '2026-09-18', account_name: 'Cash in Hand' }]
      : name === 'whatsapp_name_entries' ? { status: 'done', results: (args.p_items as { id: string; category: string }[]).map((i) => ({ ...i, status: 'named' })) }
      : name === 'whatsapp_reconcile_account' ? { status: 'reconciled' } : null }));
    engine.loadHouseholdRows.mockResolvedValue(householdRows());
    return { open: () => open };
  }

  it('CON-UNIT-W6-009 · NAME THEM lists this month’s unnamed entries; "1 groceries, 2 salary" names 1 only and keeps 2 open', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    const state = followTables();
    await post(handler, say('name them'));
    expect(api.rpc).toHaveBeenCalledWith('whatsapp_unnamed_expenses', { p_profile_id: 'alice', p_household_id: 'alice-house', p_from: '2026-09-01', p_limit: 5 });
    expect(sentTexts()[0]).toMatch(/^Two entries this month have no category\. Biggest first:\n1\. ₹2,400 · 12 Sep · HDFC\n2\. ₹1,850 · 18 Sep · Cash in Hand/);
    expect(state.open()).toEqual(expect.objectContaining({ kind: 'name_entries' }));
    vi.mocked(fetch).mockClear();
    await post(handler, say('1 groceries, 2 salary', 'm-2'));
    expect(api.rpc).toHaveBeenCalledWith('whatsapp_name_entries', { p_profile_id: 'alice', p_household_id: 'alice-house',
      p_wa_message_id: 'm-2', p_items: [{ id: 'e-1', category: 'groceries' }] });
    expect(sentTexts()[0]).toBe('Done. 1 is now Groceries. "salary" is an income category, and 2 is an expense. One left, ₹1,850 · 18 Sep · Cash in Hand: reply 2 and a category, or DONE.');
    expect((state.open() as { payload: { entries: { n: number }[] } }).payload.entries.map((e) => e.n)).toEqual([2]);
  });

  it('CON-UNIT-W6-010 · UPDATE walks the stale balances oldest first: a card is asked what it OWES; SAME books nothing; a summary ends it', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    followTables();
    await post(handler, say('UPDATE'));
    expect(sentTexts()[0]).toMatch(/^Two balances, one at a time\. Oldest first\.\n\n1 of 2 · Axis card\nVyact has ₹12,900 owed, last checked \d+ days ago\. What does the card say you owe now\?\n\nReply with the amount, SAME if it matches, or SKIP\.$/);
    vi.mocked(fetch).mockClear();
    await post(handler, say('12450', 'm-2'));
    const [, cardArgs] = api.rpc.mock.calls.find(([n]) => n === 'whatsapp_reconcile_account')!;
    expect(cardArgs).toEqual(expect.objectContaining({ p_account_id: CARD, p_wa_message_id: 'm-2', p_expected_offset: 0, p_offset: 450, p_bridge: null }));
    expect(cardArgs.p_log).toEqual([expect.objectContaining({ delta: 450, kind: 'credit_card', stated_value: 12450 })]);
    expect(sentTexts()[0]).toMatch(/^Axis card now shows ₹12,450 owed\.\n\n2 of 2 · HDFC Savings\nVyact has ₹48,200/);
    vi.mocked(fetch).mockClear();
    api.rpc.mockClear();
    await post(handler, say('same', 'm-3'));
    expect(api.rpc).toHaveBeenCalledWith('whatsapp_reconcile_account', expect.objectContaining({ p_account_id: BANK, p_offset: 0, p_log: [] }));
    expect(sentTexts()[0]).toBe('HDFC Savings matches. Marked as checked today.\n\nTwo checked. Your net worth rose by ₹450 from the corrections.');
    expect(api.rpc).not.toHaveBeenCalledWith('whatsapp_log_transaction', expect.anything());   // never a transaction
  });

  it('CON-UNIT-W6-011 · a viewer is told before any list; the nudge’s Name them here button starts the naming conversation', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    followTables('viewer');
    await post(handler, say('UPDATE'));
    expect(sentTexts()[0]).toMatch(/^This number is no longer able to log to that household/);
    expect(engine.loadHouseholdRows).not.toHaveBeenCalled();
    expect(api.rpc).not.toHaveBeenCalled();
    vi.mocked(fetch).mockClear();
    followTables();
    await post(handler, { id: 'm-2', type: 'button', button: { payload: 'reengagement_nudge:1:', text: 'Name them here' } });
    expect(api.rpc).toHaveBeenCalledWith('whatsapp_unnamed_expenses', expect.objectContaining({ p_profile_id: 'alice' }));
    expect(sentTexts()[0]).toMatch(/^Two entries this month have no category/);
  });
});

// ── v10.47.0 (W6b) — the replies of the templates that got senders ──────────────
describe('W6b template replies in the webhook', () => {
  const ENABLED = { WHATSAPP_OUTBOUND_ENABLED: 'true', WHATSAPP_APPROVED_TEMPLATES: 'partner_split_prompt,affordability_reply' };
  const TXN = '11111111-2222-4333-8444-555555555555';
  const post = async (handler: (r: Request) => Promise<Response>, message: Record<string, unknown>) => {
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [
      { from: '111', timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }] });
    return handler(new Request('https://edge.example.com/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sign(body) }, body }));
  };
  const templateSends = () => vi.mocked(fetch).mock.calls
    .map(([, o]) => JSON.parse(String(o?.body)))
    .filter((b) => b?.type === 'template')
    .map((b) => ({ name: b.template.name, body: b.template.components.find((c: { type: string }) => c.type === 'body')?.parameters.map((p: { text: string }) => p.text) }));
  function tables(opts: { sentMinutesAgo?: number; txn?: Record<string, unknown> } = {}) {
    api.from.mockImplementation((table: string) => {
      if (table === 'whatsapp_identities') return queryResult({ profile_id: 'alice', household_id: 'alice-house', phone_number: '111' });
      if (table === 'memberships') return queryResult({ role: 'owner' });
      if (table === 'profiles') return queryResult({ display_name: 'Rohan' });
      if (table === 'accounts') return queryResult([{ name: 'HDFC', kind: 'bank', currency: 'INR' }]);
      if (table === 'assets') return queryResult([]);
      if (table === 'whatsapp_preferences') return queryResult({ reads_enabled: true, marketing_opt_in: false, insights_opt_in: false, muted_topics: [], large_txn_threshold: 10000 });
      if (table === 'whatsapp_pending_turns') return queryResult(null);
      if (table === 'transactions') return queryResult(opts.txn ?? []);
      if (table === 'whatsapp_inbound_messages') {
        const q = queryResult([{ wa_message_id: 'm-1', attempts: 0 }], null, 0);
        q.maybeSingle.mockReturnValue(queryResult({ created_at: new Date(Date.now() - (opts.sentMinutesAgo ?? 1) * 60_000).toISOString() }));
        return q;
      }
      throw new Error(`Unexpected table ${table}`);
    });
  }

  it('CON-UNIT-W6B-012 · recurring Undo within 15 minutes removes that entry; Pause pauses its schedule; a late Undo is refused', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'));
    tables({ txn: { recurring_schedule_id: 'sched-1' } });
    api.rpc.mockImplementation(async (name: string) => ({ error: null, data:
      name === 'whatsapp_undo_recurring_post' ? { status: 'undone', description: 'Netflix', amount: 649, currency: 'INR', date: '2026-08-01' }
      : name === 'whatsapp_pause_schedule' ? { status: 'paused', name: 'Netflix' } : null }));
    await post(handler, { id: 'm-1', type: 'button', context: { id: 'wamid.X' }, button: { payload: `recurring_auto_logged:0:rec:${TXN}`, text: 'Undo' } });
    expect(api.rpc).toHaveBeenCalledWith('whatsapp_undo_recurring_post', { p_profile_id: 'alice', p_household_id: 'alice-house', p_wa_message_id: 'm-1', p_txn_id: TXN });
    expect(sentTexts()[0]).toBe('Undone. Netflix ₹649 for 1 Aug is removed. The schedule stays on for next month.');
    vi.mocked(fetch).mockClear();
    await post(handler, { id: 'm-2', type: 'button', context: { id: 'wamid.X' }, button: { payload: `recurring_auto_logged:1:rec:${TXN}`, text: 'Pause this one' } });
    expect(api.rpc).toHaveBeenCalledWith('whatsapp_pause_schedule', { p_profile_id: 'alice', p_household_id: 'alice-house', p_wa_message_id: 'm-2', p_schedule_id: 'sched-1' });
    expect(sentTexts()[0]).toBe('Paused Netflix. Nothing more will post until you turn it back on in Recurring.');
    vi.mocked(fetch).mockClear();
    api.rpc.mockClear();
    tables({ sentMinutesAgo: 30 });
    await post(handler, { id: 'm-3', type: 'button', context: { id: 'wamid.X' }, button: { payload: `recurring_auto_logged:0:rec:${TXN}`, text: 'Undo' } });
    expect(api.rpc).not.toHaveBeenCalledWith('whatsapp_undo_recurring_post', expect.anything());
    expect(sentTexts()[0]).toMatch(/^That's past the 15 minutes/);
  });

  it('CON-UNIT-W6B-013 · "1200 dinner shared" logs it, then prompts the logger; Split 50/50 writes the app\'s split for the usual partner', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'), ENABLED);
    tables({ txn: { amount: 1200, currency: 'INR', description: 'dinner', category: 'food_dining', deleted_at: null } });
    api.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => ({ error: null, data:
      name === 'whatsapp_log_transaction' ? { status: 'success', transaction_id: TXN, amount: args.p_amount, currency: 'INR', type: 'expense', category_id: 'food_dining', account_name: 'HDFC' }
      : name === 'whatsapp_usual_split_partner' ? [{ email: 'priya@example.com', first_name: 'Priya', times: 3 }]
      : name === 'whatsapp_split_even' ? { status: 'split' } : null }));
    await post(handler, { id: 'm-1', text: { body: '1200 dinner shared' } });
    const logged = api.rpc.mock.calls.find(([n]) => n === 'whatsapp_log_transaction')![1] as Record<string, unknown>;
    expect(logged).toEqual(expect.objectContaining({ p_amount: 1200 }));
    expect(String(logged.p_description ?? '')).not.toMatch(/shared/i);
    expect(templateSends()).toEqual([{ name: 'partner_split_prompt', body: ['You', '1,200', expect.any(String)] }]);
    vi.mocked(fetch).mockClear();
    await post(handler, { id: 'm-2', type: 'button', button: { payload: `partner_split_prompt:0:ps:${TXN}`, text: 'Split 50/50' } });
    const split = api.rpc.mock.calls.find(([n]) => n === 'whatsapp_split_even')![1] as Record<string, any>;
    expect(split).toEqual(expect.objectContaining({ p_txn_id: TXN, p_partner_email: 'priya@example.com', p_partner_share: 600 }));
    expect(split.p_split).toEqual(expect.objectContaining({ isSplit: true, totalAmount: 1200, yourShare: 600, paidBy: 'me' }));
    expect(sentTexts()[0]).toBe("Split. Your share of dinner is ₹600, and so is Priya's. It's under Splits in Vyact.");
    vi.mocked(fetch).mockClear();
    await post(handler, { id: 'm-3', type: 'button', button: { payload: `partner_split_prompt:2:ps:${TXN}`, text: 'Not shared' } });
    expect(sentTexts()[0]).toBe('Kept as yours: ₹1,200 for dinner.');
  });

  it('CON-UNIT-W6B-014 · an affordability answer that fits goes out as the card with the engine\'s figures, not as text', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'), ENABLED);
    tables();
    engine.loadHouseholdRows.mockResolvedValue({ profile: { display_name: 'Rohan Mehta' }, household: { base_currency: 'INR' } });
    engine.serverModelCall.mockReturnValue(async () => 'unused');
    engine.answerOnServer.mockResolvedValue({ reply: 'It fits.', intentId: 'forecast.affordability',
      resolved: { outcome: 'fits', amounts: { purchase: 40000, cushion: 4300, floor: 50000, free_to_spend: 94300 } } });
    api.rpc.mockResolvedValue({ error: null, data: null });
    await post(handler, { id: 'm-1', text: { body: 'can I afford 40000 for a phone?' } });
    expect(templateSends()).toEqual([{ name: 'affordability_reply', body: ['Rohan', '40,000', '4,300', '50,000'] }]);
    expect(sentTexts().filter(Boolean)).toEqual([]);
  });

  it('CON-UNIT-W6B-016 · "Can I afford to spend 5 rupees for tea" (no "?", found on production 27 Sep) is answered, never logged', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'), ENABLED);
    tables();
    engine.loadHouseholdRows.mockResolvedValue({ profile: { display_name: 'Rohan Mehta' }, household: { base_currency: 'INR' } });
    engine.serverModelCall.mockReturnValue(async () => 'unused');
    engine.answerOnServer.mockResolvedValue({ reply: 'It fits.', intentId: 'forecast.affordability',
      resolved: { outcome: 'fits', amounts: { purchase: 5, cushion: 44295, floor: 50000, free_to_spend: 94300 } } });
    api.rpc.mockResolvedValue({ error: null, data: null });
    await post(handler, { id: 'm-1', text: { body: 'Can I afford to spend 5 rupees for tea' } });
    expect(engine.answerOnServer).toHaveBeenCalledTimes(1);
    expect(api.rpc.mock.calls.map(c => c[0])).not.toContain('whatsapp_log_transaction');
    expect(templateSends()).toEqual([{ name: 'affordability_reply', body: ['Rohan', '5', '44,295', '50,000'] }]);
  });

  it('CON-UNIT-W6B-019 · "Why can\'t I spend 5 rupees although…" (logged as ₹5 on production, 27 Sep) is answered in text, never logged', async () => {
    const handler = await captureHandler(() => import('../../../../supabase/functions/whatsapp-webhook/index'), ENABLED);
    tables();
    engine.loadHouseholdRows.mockResolvedValue({ profile: { display_name: 'Rohan Mehta' }, household: { base_currency: 'INR' } });
    engine.serverModelCall.mockReturnValue(async () => 'unused');
    // Below the floor: the answer is text (the card's "above your safety floor" would be untrue).
    engine.answerOnServer.mockResolvedValue({ reply: 'Yes. ₹5 fits your Food & Dining budget.', intentId: 'forecast.affordability',
      resolved: { outcome: 'fits' } });
    api.rpc.mockResolvedValue({ error: null, data: null });
    await post(handler, { id: 'm-1', text: { body: "Why can't I spend 5 rupees although I have 80% of groceries budget and nearly 90% of food and dining budget" } });
    expect(engine.answerOnServer).toHaveBeenCalledTimes(1);
    expect(api.rpc.mock.calls.map(c => c[0])).not.toContain('whatsapp_log_transaction');
    expect(templateSends()).toEqual([]);
    expect(sentTexts().filter(Boolean).join(' ')).toContain('fits your Food & Dining budget');
  });
});
