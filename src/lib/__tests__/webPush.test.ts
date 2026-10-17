// v10.48.0 (TD-22) — Web Push to the installed app.
//
// Pinned: (1) the message encryption is RFC 8291 — decrypted here by an independent
// receiver (HKDF written out with HMAC), not by the sender's own code; (2) the VAPID
// token verifies against the public key the browser subscribes with; (3) only real push
// services are ever contacted; (4) which notification reaches which device (P1 only, the
// device's switches, quiet hours in ITS zone, never a backlog); (5) the server raises the
// SAME notifications the app does, from the same rules, bundle included; (6) the
// web-push function end to end: test sends, dispatch raise → push → stamp → retire.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  b64url, fromB64url, concat, encryptPayload, vapidAuthorization, generateVapidKeys, sendWebPush, isPushEndpoint,
  RECORD_SIZE, type VapidKeys,
} from '../../../../supabase/functions/_shared/web-push';
import {
  skipReason, inQuietHours, payloadFor, testPayload, type SubscriptionRow, type NotificationRow,
} from '../../../../supabase/functions/_shared/web-push-rules';
import { notificationsOnServer, type HouseholdRows } from '../serverEngine';
import { budgetThresholdNotifs, staleBalanceNotifs, DEFAULT_PREFS } from '../notifications';
import { mapCloudRow } from '../supabaseAdapter';
import type { Budget, BudgetAllocation, Transaction, Account } from '../../types';
import { DEFAULT_RATES } from '../../constants';
import * as bundle from '../../../../supabase/functions/_shared/agent/engine.generated.js';
import { captureHandler, queryResult } from './helpers/edgeHarness';

const api = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } }));
vi.mock('https://esm.sh/@supabase/supabase-js@2.45.0', () => ({ createClient: () => api }));
const loader = vi.hoisted(() => ({ loadHouseholdRows: vi.fn() }));
vi.mock('../../../../supabase/functions/_shared/agent/householdLoader.ts', () => ({ loadHouseholdRows: loader.loadHouseholdRows }));
vi.mock('../../../../supabase/functions/_shared/agent/engine.ts', async () => {
  const { notificationsOnServer: real } = await import('../serverEngine');
  return { notificationsOnServer: real };
});

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── An independent receiver (what the browser does) ──────────────────────────
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
/** RFC 5869, written out: extract, then ONE expand block (every length here is ≤ 32). */
async function hkdfManual(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, len);
}
async function subscriber() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { keys, pub, auth, p256dh: b64url(pub), authB64: b64url(auth) };
}
async function receive(body: Uint8Array, sub: Awaited<ReturnType<typeof subscriber>>): Promise<{ text: string; rs: number }> {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const record = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, sub.keys.privateKey, 256));
  const ikm = await hkdfManual(sub.auth, ecdh, concat(enc.encode('WebPush: info\u0000'), sub.pub, asPublic), 32);
  const cek = await hkdfManual(salt, ikm, enc.encode('Content-Encoding: aes128gcm\u0000'), 16);
  const nonce = await hkdfManual(salt, ikm, enc.encode('Content-Encoding: nonce\u0000'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, record));
  expect(plain[plain.length - 1]).toBe(2);           // the last-record delimiter (RFC 8188 §2)
  return { text: dec.decode(plain.slice(0, -1)), rs };
}

describe('Web Push crypto (RFC 8291 / 8292)', () => {
  it('CON-UNIT-WP-001 · a message encrypted for a subscription is read back by an independent receiver; each send is freshly keyed', async () => {
    const sub = await subscriber();
    const message = JSON.stringify({ title: 'Rent · ₹25,000 — due today', body: 'Auto-approve is off for this schedule' });
    const one = await encryptPayload(enc.encode(message), sub.p256dh, sub.authB64);
    const got = await receive(one, sub);
    expect(got.text).toBe(message);
    expect(got.rs).toBe(RECORD_SIZE);
    expect(one[20]).toBe(65);                                         // sender key: uncompressed P-256
    const two = await encryptPayload(enc.encode(message), sub.p256dh, sub.authB64);
    expect(b64url(two.slice(0, 16))).not.toBe(b64url(one.slice(0, 16)));   // fresh salt
    expect(b64url(two.slice(21, 86))).not.toBe(b64url(one.slice(21, 86))); // fresh sender key
    // Another device's keys cannot read it.
    await expect(receive(one, await subscriber())).rejects.toThrow();
    await expect(encryptPayload(enc.encode('x'), 'AAAA', sub.authB64)).rejects.toThrow('bad_p256dh');
    await expect(encryptPayload(new Uint8Array(4000), sub.p256dh, sub.authB64)).rejects.toThrow('payload_too_large');
  });

  it('CON-UNIT-WP-002 · the VAPID token is ES256, verifies with the advertised public key, and names the push service origin', async () => {
    const keys = await generateVapidKeys('https://vyact.app');
    expect(fromB64url(keys.publicKey)).toHaveLength(65);
    const now = 1_790_000_000;
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc:def', keys, now);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m).not.toBeNull();
    expect(m[4]).toBe(keys.publicKey);
    expect(JSON.parse(dec.decode(fromB64url(m[1])))).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(dec.decode(fromB64url(m[2])));
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: now + 12 * 3600, sub: 'https://vyact.app' });
    const verifyKey = await crypto.subtle.importKey('raw', fromB64url(m[4]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, fromB64url(m[3]), enc.encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
    // A pair round-tripped through JSON (as Vault stores it) still signs.
    const stored = JSON.parse(JSON.stringify(keys)) as VapidKeys;
    await expect(vapidAuthorization('https://web.push.apple.com/x', stored, now)).resolves.toContain('vapid t=');
  });

  it('CON-UNIT-WP-003 · only real push services are contacted; 201 is accepted, 404/410 retire the device', async () => {
    for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://web.push.apple.com/QK', 'https://updates.push.services.mozilla.com/wpush/v2/x',
      'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://api.push.apple.com/x']) expect(isPushEndpoint(ok), ok).toBe(true);
    for (const bad of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://evil.com/fcm.googleapis.com',
      'https://fcm.googleapis.com:8443/x', 'https://169.254.169.254/latest', 'not a url']) expect(isPushEndpoint(bad), bad).toBe(false);

    const keys = await generateVapidKeys('https://vyact.app');
    const sub = await subscriber();
    const target = { endpoint: 'https://fcm.googleapis.com/fcm/send/dev1', p256dh: sub.p256dh, auth: sub.authB64 };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    const out = await sendWebPush(target, { title: 'T', body: 'B' }, keys, { urgency: 'high', ttlSeconds: 600 }, fetchImpl);
    expect(out).toEqual({ status: 201, ok: true, gone: false });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(target.endpoint);
    expect(init.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '600', Urgency: 'high' });
    expect(init.headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(JSON.parse((await receive(init.body, sub)).text)).toEqual({ title: 'T', body: 'B' });

    fetchImpl.mockResolvedValueOnce(new Response('expired', { status: 410 }));
    expect(await sendWebPush(target, {}, keys, {}, fetchImpl)).toEqual({ status: 410, ok: false, gone: true, error: 'expired' });
    const never = vi.fn();
    expect(await sendWebPush({ ...target, endpoint: 'https://evil.com/x' }, {}, keys, {}, never))
      .toMatchObject({ ok: false, gone: true, error: 'endpoint_not_allowed' });
    expect(never).not.toHaveBeenCalled();
  });

  it('CON-UNIT-WP-003b · W0 (BE-FN-07): a network error or a push service that never answers is a failed delivery, not a crash', async () => {
    const keys = await generateVapidKeys('https://vyact.app');
    const sub = await subscriber();
    const target = { endpoint: 'https://fcm.googleapis.com/fcm/send/dev1', p256dh: sub.p256dh, auth: sub.authB64 };

    const refused = vi.fn().mockRejectedValue(new TypeError('connection reset'));
    expect(await sendWebPush(target, {}, keys, {}, refused))
      .toEqual({ status: 0, ok: false, gone: false, error: 'network: connection reset' });

    // A service that hangs is cut off by the timeout instead of holding the whole dispatch.
    const hangs = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      init.signal!.addEventListener('abort', () => rej(init.signal!.reason));
    }));
    const out = await sendWebPush(target, {}, keys, { timeoutMs: 30 }, hangs as unknown as typeof fetch);
    expect(out).toMatchObject({ status: 0, ok: false, gone: false });
    expect(out.error).toMatch(/^network: /);
  });
});

// ── Which notification reaches which device ───────────────────────────────────
const SUB: SubscriptionRow = {
  id: 's1', user_id: 'u1', household_id: 'h1', endpoint: 'https://fcm.googleapis.com/fcm/send/dev1', p256dh: 'p', auth: 'a',
  tz: 'Asia/Kolkata', prefs: { master: true, perType: {}, quietStart: '22:00', quietEnd: '07:00' },
  created_at: '2026-09-27T00:00:00Z', disabled_at: null,
};
const NOTIF: NotificationRow = {
  id: 'n1', household_id: 'h1', type: 'budget_threshold', priority: 'P1', title: 'Groceries at 85% of the September budget',
  body: '₹300 left', status: 'unread', created_at: '2026-09-27T05:00:00Z', deep_link: '/budgets?budgetId=b1',
  dedupe_key: 'budget_threshold:b1:groceries:2026-09-01:80',
};
// 05:30 UTC = 11:00 in India; 17:00 UTC = 22:30 in India.
const DAY = new Date('2026-09-27T05:30:00Z');
const NIGHT = new Date('2026-09-27T17:00:00Z');

describe('push rules', () => {
  it('CON-UNIT-WP-004 · P1 only, unread only, never a backlog, the device\'s switches, quiet hours in the device\'s own zone', () => {
    expect(skipReason(NOTIF, SUB, DAY)).toBeNull();
    expect(skipReason({ ...NOTIF, priority: 'P2' }, SUB, DAY)).toBe('not_action_required');
    expect(skipReason({ ...NOTIF, status: 'read' }, SUB, DAY)).toBe('already_seen');
    expect(skipReason({ ...NOTIF, household_id: 'h2' }, SUB, DAY)).toBe('other_household');
    expect(skipReason({ ...NOTIF, created_at: '2026-09-26T10:00:00Z' }, SUB, DAY)).toBe('before_subscribed');
    expect(skipReason(NOTIF, { ...SUB, prefs: { master: false } }, DAY)).toBe('all_off');
    expect(skipReason(NOTIF, { ...SUB, prefs: { perType: { budget_threshold: false } } }, DAY)).toBe('type_off');
    expect(skipReason(NOTIF, { ...SUB, disabled_at: '2026-09-27T01:00:00Z' }, DAY)).toBe('device_disabled');
    // 22:30 in India is quiet; the same instant is 17:00 in London, which is not.
    expect(skipReason(NOTIF, SUB, NIGHT)).toBe('quiet_hours');
    expect(skipReason(NOTIF, { ...SUB, tz: 'Europe/London' }, NIGHT)).toBeNull();
    expect(inQuietHours({ quietStart: '09:00', quietEnd: '17:00' }, 'Asia/Kolkata', DAY)).toBe(true);   // a daytime window
    expect(inQuietHours({ quietStart: '00:00', quietEnd: '00:00' }, 'Asia/Kolkata', NIGHT)).toBe(false);
    expect(inQuietHours(null, 'Not/AZone', NIGHT)).toBe(true);                                        // unknown zone → India time
  });

  it('CON-UNIT-WP-005 · the payload opens inside the app only; the test message states the device\'s local time', () => {
    expect(payloadFor(NOTIF)).toEqual({ title: NOTIF.title, body: '₹300 left', url: '/budgets?budgetId=b1', tag: NOTIF.dedupe_key, type: 'budget_threshold' });
    for (const link of ['https://evil.com', '//evil.com/x', 'javascript:alert(1)', null]) {
      expect(payloadFor({ ...NOTIF, deep_link: link }).url, String(link)).toBe('/');
    }
    expect(testPayload(DAY, 'Asia/Kolkata').body).toContain('sent at 11:00');
    expect(testPayload(DAY, 'Asia/Kolkata').url).toBe('/settings');
  });
});

// ── The server raises what the app raises ───────────────────────────────────
const HID = '11111111-1111-4111-8111-111111111111';
const BUDGET = '22222222-2222-4222-8222-222222222222';
const BANK = '33333333-3333-4333-8333-333333333333';
const stamp = { created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', deleted_at: null };
const txn = (id: string, p: Record<string, unknown>) => ({
  id, household_id: HID, created_by: null, member_id: null, currency: 'INR', date: '2026-09-20', description: 'x',
  note: null, recurring: null, extras: {}, account_id: BANK, to_account_id: null, initiated_by: null,
  recurring_schedule_id: null, debt_id: null, payment_mode: null, asset_id: null, type: 'expense', ...stamp, ...p,
});
function rows(): HouseholdRows {
  return {
    transactions: [
      txn('t1', { amount: 1700, category: 'groceries' }),      // 85% of 2,000
      txn('t2', { amount: 1300, category: 'food_dining' }),    // 130% of 1,000
      txn('t3', { amount: 100, category: 'shopping' }),        // 10%
    ],
    budgets: [{ id: BUDGET, household_id: HID, category: null, monthly_limit: 5000, currency: 'INR', color: null, period: 'monthly',
      period_start: '2026-09-01', period_end: '2026-09-30', scope: 'month', period_year: 2026, period_month: 9, custom_name: null, ...stamp }],
    budgetAllocations: [
      { id: 'a1', budget_id: BUDGET, household_id: HID, category: 'groceries', amount: 2000, ...stamp },
      { id: 'a2', budget_id: BUDGET, household_id: HID, category: 'food_dining', amount: 1000, ...stamp },
      { id: 'a3', budget_id: BUDGET, household_id: HID, category: 'shopping', amount: 1000, ...stamp },
    ],
    goals: [], debts: [], assets: [], recurring: [],
    accounts: [{ id: BANK, household_id: HID, kind: 'bank', name: 'HDFC', currency: 'INR', opening_balance: 50000, is_default: true,
      is_archived: false, reconciliation_offset: 0, reconciliation_log: [], payment_modes: [], asset_id: null, debt_id: null,
      last_reconciled_at: null, ...stamp, created_at: '2026-01-01T00:00:00Z' }],
    memberCount: 1, rates: [],
    profile: { display_name: 'Rohan', default_currency: 'INR', language: 'en', date_format: 'dmy' },
    household: { type: 'family', base_currency: 'INR', language: 'en', payoff_strategy: 'avalanche', extra_payment: 0 },
    email: '',
  };
}

describe('notifications raised on the server', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-27T05:30:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('CON-UNIT-WP-006 · the server raises exactly the app\'s notifications for the same rows (source and bundle), skipping what exists', () => {
    const r = rows();
    const server = notificationsOnServer(r, [], HID);
    const byType = (t: string) => server.filter(n => n.type === t);
    expect(byType('budget_threshold').map(n => [n.title, n.dedupe_key, n.priority])).toEqual([
      ['Groceries at 85% of the September budget', `budget_threshold:${BUDGET}:groceries:2026-09-01:80`, 'P1'],
      [expect.stringMatching(/ at 130% of the September budget$/), `budget_threshold:${BUDGET}:food_dining:2026-09-01:100`, 'P1'],
    ]);
    expect(byType('stale_balance')).toHaveLength(1);
    expect(server.every(n => n.household_id === HID && n.status === 'unread')).toBe(true);

    // The app's own generators over the adapter's own shapes give the same keys and words.
    const budgets = r.budgets.map(x => mapCloudRow('budgets', x)) as Budget[];
    const allocs = r.budgetAllocations.map(x => mapCloudRow('budgetAllocations', x)) as BudgetAllocation[];
    const txns = r.transactions.map(x => mapCloudRow('transactions', x)) as Transaction[];
    const accounts = r.accounts.map(x => mapCloudRow('accounts', x)) as Account[];
    const ctx = { householdId: HID, baseCurrency: 'INR', rates: { ...DEFAULT_RATES } };
    const app = [...budgetThresholdNotifs(budgets, allocs, txns, DEFAULT_PREFS, [], ctx), ...staleBalanceNotifs(accounts, DEFAULT_PREFS, [], ctx)];
    expect(app.map(n => [n.dedupeKey, n.title])).toEqual(
      [...byType('budget_threshold'), ...byType('stale_balance')].map(n => [n.dedupe_key, n.title]));

    // Already raised (by a device or an earlier run): not raised again.
    expect(notificationsOnServer(r, server.map(n => n.dedupe_key), HID)).toEqual([]);
    // The deployed bundle is the same function.
    const fromBundle = (bundle as unknown as { notificationsOnServer: typeof notificationsOnServer }).notificationsOnServer(r, [], HID);
    expect(fromBundle.map(n => [n.type, n.dedupe_key, n.title, n.body])).toEqual(server.map(n => [n.type, n.dedupe_key, n.title, n.body]));
  });
});

// ── The web-push function ─────────────────────────────────────────────────────
function tableSequence(results: Record<string, unknown[][]>) {
  const calls: Record<string, ReturnType<typeof queryResult>[]> = {};
  api.from.mockImplementation((table: string) => {
    const list = results[table] ?? [[null]];
    const i = (calls[table] ?? []).length;
    const [data, error = null, count = null] = list[Math.min(i, list.length - 1)];
    const q = queryResult(data, error, count as number | null);
    (calls[table] ??= []).push(q);
    return q;
  });
  return calls;
}

describe('web-push function', () => {
  let keys: VapidKeys;
  let dev1: Awaited<ReturnType<typeof subscriber>>;
  let dev2: Awaited<ReturnType<typeof subscriber>>;
  beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks();
    keys = await generateVapidKeys('https://vyact.app');
    dev1 = await subscriber();
    dev2 = await subscriber();
  });
  afterEach(() => vi.unstubAllGlobals());
  const load = () => captureHandler(() => import('../../../../supabase/functions/web-push/index'));
  const post = (h: (r: Request) => Promise<Response>, body: unknown, headers: Record<string, string> = {}, query = '') =>
    h(new Request(`https://fn.example.com/web-push${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));
  const subRow = (id: string, d: Awaited<ReturnType<typeof subscriber>>, p: Partial<SubscriptionRow> = {}) => ({
    ...SUB, id, endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: d.p256dh, auth: d.authB64,
    user_agent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36', ...p,
  });

  it('CON-UNIT-WP-007 · a test goes to the caller\'s own devices, readable by each, with the push service\'s answer; signed out → 401; rate-limited', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const handler = await load();
    api.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    api.rpc.mockImplementation(async (name: string) => (name === 'web_push_vapid' ? { data: keys, error: null } : { data: null, error: null }));
    const calls = tableSequence({ push_deliveries: [[null, null, 0], [null]], push_subscriptions: [[[subRow('s1', dev1)]]] });
    const res = await post(handler, { mode: 'test' }, { Authorization: 'Bearer user-jwt' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1, results: [{ device: 'Chrome on Android', status: 201, accepted: true, gone: false }] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://fcm.googleapis.com/fcm/send/s1');
    expect(JSON.parse((await receive(init.body, dev1)).text)).toMatchObject({ title: 'Vyact notifications are on', url: '/settings' });
    expect(calls.push_subscriptions[0].eq).toHaveBeenCalledWith('user_id', 'u1');      // only the caller's devices
    expect(calls.push_deliveries[1].insert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'test', status: 201, subscription_id: 's1' }));
    expect(api.rpc).toHaveBeenCalledWith('web_push_mark_device', { p_id: 's1', p_status: 201, p_ok: true, p_gone: false });

    api.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });
    expect((await post(handler, { mode: 'test' }, { Authorization: 'Bearer nope' })).status).toBe(401);
    api.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    tableSequence({ push_deliveries: [[null, null, 5]] });
    expect((await post(handler, { mode: 'test' }, { Authorization: 'Bearer user-jwt' })).status).toBe(429);
  });

  it('CON-UNIT-WP-008 · dispatch: raises the app\'s notifications, pushes new P1s to eligible devices, stamps them, retires a gone device', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T05:30:00Z'));
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      new Response(null, { status: url.endsWith('/s2') ? 410 : 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const handler = await load();
    loader.loadHouseholdRows.mockResolvedValue(rows());
    api.rpc.mockImplementation(async (name: string, args: { p?: string }) => {
      if (name === 'web_push_cron_ok') return { data: args.p === 'cron-secret-of-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', error: null };
      if (name === 'web_push_vapid') return { data: keys, error: null };
      return { data: null, error: null };
    });
    const pending: NotificationRow[] = [
      { ...NOTIF, id: 'n1', household_id: HID },
      { ...NOTIF, id: 'n2', household_id: HID, priority: 'P2', type: 'income_landed', dedupe_key: 'income_landed:t9' },
    ];
    const calls = tableSequence({
      push_subscriptions: [[[
        subRow('s1', dev1, { household_id: HID, user_id: 'u1' }),
        subRow('s2', dev2, { household_id: HID, user_id: 'u2' }),
        subRow('s3', dev2, { household_id: HID, user_id: 'u3', prefs: { perType: { budget_threshold: false } } }),
        subRow('s4', dev2, { household_id: HID, user_id: 'u4' }),     // no longer a member
      ]]],
      memberships: [[[{ household_id: HID, user_id: 'u1' }, { household_id: HID, user_id: 'u2' }, { household_id: HID, user_id: 'u3' }]]],
      notifications: [[[]], [null], [pending], [null]],
      push_deliveries: [[null]],
    });

    // No secret, no service key: refused before anything is read.
    expect((await post(handler, {}, {}, '?mode=dispatch')).status).toBe(403);
    expect(api.from).not.toHaveBeenCalledWith('push_subscriptions');

    const res = await post(handler, {}, { 'x-cron-secret': 'cron-secret-of-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' }, '?mode=dispatch');
    expect(res.status).toBe(200);
    const out = await res.json();
    // 1. Raised: the budget lines at 85% / 130% and the stale balance, as the app would.
    const upsert = calls.notifications[1].upsert.mock.calls[0];
    expect(upsert[1]).toEqual({ onConflict: 'household_id,dedupe_key', ignoreDuplicates: true });
    expect(upsert[0].map((n: { type: string }) => n.type).sort()).toEqual(['budget_threshold', 'budget_threshold', 'stale_balance']);
    expect(out.raised).toBe(3);
    // 2. Pushed: the P1 to u1 (accepted) and u2 (gone); u3 switched budgets off; u4 left; the P2 to nobody.
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(['https://fcm.googleapis.com/fcm/send/s1', 'https://fcm.googleapis.com/fcm/send/s2']);
    expect(JSON.parse((await receive(fetchMock.mock.calls[0][1].body, dev1)).text)).toEqual(payloadFor(pending[0]));
    expect(out.pushed).toBe(1);
    // s2 was retired by its 410, so the next row skips it as disabled.
    expect(out.skipped).toEqual({ type_off: 1, not_a_member: 2, not_action_required: 2, device_disabled: 1 });
    expect(api.rpc).toHaveBeenCalledWith('web_push_mark_device', { p_id: 's2', p_status: 410, p_ok: false, p_gone: true });
    // 3. Stamped: both rows considered are done.
    expect(calls.notifications[3].update).toHaveBeenCalledWith({ pushed_at: '2026-09-27T05:30:00.000Z' });
    expect(calls.notifications[3].in).toHaveBeenCalledWith('id', ['n1', 'n2']);
    vi.useRealTimers();
  });

  it('CON-UNIT-W3-D12-005 · a push held back for quiet hours stays pending, goes out when they end, and reaches each device once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    loader.loadHouseholdRows.mockResolvedValue({ ...rows(), transactions: [], budgets: [], budgetAllocations: [], accounts: [], recurring: [] });
    const secret = 'cron-secret-of-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    api.rpc.mockImplementation(async (name: string, args: { p?: string }) => {
      if (name === 'web_push_cron_ok') return { data: args.p === secret, error: null };
      if (name === 'web_push_vapid') return { data: keys, error: null };
      return { data: null, error: null };
    });
    const pending: NotificationRow[] = [{ ...NOTIF, id: 'n1', household_id: HID, created_at: '2026-09-27T16:00:00Z' }];
    const handler = await load();
    const run = async (at: string, delivered: { notification_id: string; subscription_id: string }[]) => {
      vi.setSystemTime(new Date(at));
      const calls = tableSequence({
        push_subscriptions: [[[subRow('s1', dev1, { household_id: HID, user_id: 'u1' })]]],
        memberships: [[[{ household_id: HID, user_id: 'u1' }]]],
        notifications: [[[]], [pending], [null]],
        push_deliveries: [[delivered], [null]],
      });
      const out = await (await post(handler, {}, { 'x-cron-secret': secret }, '?mode=dispatch')).json();
      return { out, calls };
    };

    // 22:30 in India: inside the device's quiet hours. Nothing is sent, and the row is NOT stamped.
    const night = await run('2026-09-27T17:00:00Z', []);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(night.out).toEqual(expect.objectContaining({ pushed: 0, deferred: 1, skipped: { quiet_hours: 1 } }));
    expect(night.calls.notifications.some(q => q.update.mock.calls.length)).toBe(false);

    // 07:30 in India: quiet hours are over — pushed, then stamped.
    const morning = await run('2026-09-28T02:00:00Z', []);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(morning.out).toEqual(expect.objectContaining({ pushed: 1, deferred: 0 }));
    expect(morning.calls.notifications[2].in).toHaveBeenCalledWith('id', ['n1']);

    // A run that finds the device already reached does not push it again.
    fetchMock.mockClear();
    const again = await run('2026-09-28T02:15:00Z', [{ notification_id: 'n1', subscription_id: 's1' }]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(again.out.skipped).toEqual({ already_pushed: 1 });
    vi.useRealTimers();
  });
});
