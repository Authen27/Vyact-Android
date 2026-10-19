// T4D-020..024 — v10.127.0 (Track T4d): Firebase Cloud Messaging for the Vyact Android app
// (supabase/functions/_shared/fcm.ts). Pinned: the service account is read strictly; the assertion is a real
// RS256 JWT (verified here with the public key, not by the signer); the access token is fetched once and
// reused; the message is a notification with string data, the alerts channel and the alert's tag; a token
// FCM says is gone retires the phone, and a fault of OURS never counts against it.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseServiceAccount, signAssertion, fcmAccessToken, fcmMessage, fcmOutcome, sendFcm, resetFcmTokenCache,
  FCM_SCOPE, GOOGLE_TOKEN_URL, ANDROID_CHANNEL_ID, type ServiceAccount,
} from '../../../../supabase/functions/_shared/fcm';
import { ab, fromB64url } from '../../../../supabase/functions/_shared/web-push';
import { ANDROID_CHANNEL_ID as APP_CHANNEL } from '../nativePush';
import { testServiceAccount, tokenReply } from './helpers/fcmAccount';

let sa: ServiceAccount;
let publicKey: CryptoKey;
const PAYLOAD = { title: 'A bill is due', body: 'Open Vyact to approve or skip it.', url: '/recurring?id=rent', tag: 'recurring_due:rent:2026-10-19', type: 'recurring_due_confirm' };

beforeAll(async () => { ({ sa, publicKey } = await testServiceAccount()); });
beforeEach(() => resetFcmTokenCache());
afterEach(() => vi.restoreAllMocks());


describe('Firebase Cloud Messaging (T4d)', () => {
  it('T4D-020 · the service account is read strictly: project, a service-account email and a private key, or FCM is off', () => {
    expect(sa).toMatchObject({ project_id: 'vyact-app', client_email: 'fcm-sender@vyact-app.iam.gserviceaccount.com' });
    expect(Object.keys(sa).sort()).toEqual(['client_email', 'private_key', 'project_id']);   // nothing else kept
    for (const bad of [null, '', 'not json', '{}', JSON.stringify({ ...sa, project_id: 'Vyact App' }),
      JSON.stringify({ ...sa, client_email: 'someone@gmail.com' }), JSON.stringify({ ...sa, private_key: 'x' })]) {
      expect(parseServiceAccount(bad), String(bad).slice(0, 30)).toBeNull();
    }
  });

  it('T4D-021 · the assertion is an RS256 JWT for FCM, signed by the account\'s key, for one hour', async () => {
    const jwt = await signAssertion(sa, 1_760_000_000);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(fromB64url(h)))).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(new TextDecoder().decode(fromB64url(c)))).toEqual({
      iss: sa.client_email, scope: FCM_SCOPE, aud: GOOGLE_TOKEN_URL, iat: 1_760_000_000, exp: 1_760_003_600,
    });
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, ab(fromB64url(s)), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });

  it('T4D-022 · the access token is fetched from Google once and reused until a minute before it expires; a refusal is an error', async () => {
    let clock = 1_760_000_000_000;
    const fetchImpl = vi.fn(async () => tokenReply()) as unknown as typeof fetch;
    expect(await fcmAccessToken(sa, { fetchImpl, now: () => clock })).toBe('ya29.test-token');
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(GOOGLE_TOKEN_URL);
    expect(init.method).toBe('POST');
    expect(String(init.body)).toMatch(/^grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=[\w-]+\.[\w-]+\.[\w-]+$/);
    clock += 3_000_000;                                       // 50 minutes later: still good
    await fcmAccessToken(sa, { fetchImpl, now: () => clock });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock += 600_000;                                         // past expiry less a minute: fetched again
    await fcmAccessToken(sa, { fetchImpl, now: () => clock });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    resetFcmTokenCache();
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) as unknown as typeof fetch;
    await expect(fcmAccessToken(sa, { fetchImpl: refused })).rejects.toThrow('fcm_auth: 400 invalid_grant');
  });

  it('T4D-023 · one message: a notification the phone shows with the app closed, string data, the alerts channel and the alert\'s tag', async () => {
    expect(fcmMessage('tok-1', PAYLOAD)).toEqual({
      message: {
        token: 'tok-1',
        notification: { title: PAYLOAD.title, body: PAYLOAD.body },
        data: { url: PAYLOAD.url, tag: PAYLOAD.tag, type: PAYLOAD.type },
        android: { priority: 'HIGH', ttl: '86400s', notification: { tag: PAYLOAD.tag, channel_id: 'vyact_alerts', color: '#E26D5C' } },
      },
    });
    expect(ANDROID_CHANNEL_ID).toBe(APP_CHANNEL);              // the channel the app creates
    const fetchImpl = vi.fn(async (url: string) => (url === GOOGLE_TOKEN_URL ? tokenReply()
      : new Response(JSON.stringify({ name: 'projects/vyact-app/messages/1' }), { status: 200 }))) as unknown as typeof fetch;
    expect(await sendFcm(sa, 'tok-1', PAYLOAD, { fetchImpl })).toEqual({ status: 200, ok: true, gone: false, deviceFault: false });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(url).toBe('https://fcm.googleapis.com/v1/projects/vyact-app/messages:send');
    expect(init.headers.Authorization).toBe('Bearer ya29.test-token');
    expect(JSON.parse(init.body)).toEqual(fcmMessage('tok-1', PAYLOAD));
  });

  it('T4D-024 · a gone token retires the phone; our own faults (credentials, quota, outage, no answer) never count against it', async () => {
    const err = (status: number, code: string, message = '') => ({ error: { code: status, status: code, message,
      details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: code }] } });
    expect(fcmOutcome(404, err(404, 'UNREGISTERED'))).toMatchObject({ ok: false, gone: true, deviceFault: true });
    expect(fcmOutcome(403, err(403, 'SENDER_ID_MISMATCH'))).toMatchObject({ gone: true, deviceFault: true });
    expect(fcmOutcome(400, err(400, 'INVALID_ARGUMENT', 'The registration token is not a valid FCM registration token')))
      .toMatchObject({ gone: true, deviceFault: true });
    expect(fcmOutcome(400, err(400, 'INVALID_ARGUMENT', 'Invalid value at message.android.ttl'))).toMatchObject({ gone: false, deviceFault: false });
    for (const [s, c] of [[401, 'UNAUTHENTICATED'], [403, 'PERMISSION_DENIED'], [429, 'QUOTA_EXCEEDED'], [500, 'INTERNAL'], [503, 'UNAVAILABLE']] as const) {
      expect(fcmOutcome(s, err(s, c)), c).toMatchObject({ ok: false, gone: false, deviceFault: false });
    }
    // No answer at all, and credentials Google refuses: status 0, ours, and FCM is not called.
    const down = vi.fn(async (url: string) => { if (url === GOOGLE_TOKEN_URL) return tokenReply(); throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    expect(await sendFcm(sa, 'tok-1', PAYLOAD, { fetchImpl: down })).toMatchObject({ status: 0, ok: false, gone: false, deviceFault: false });
    resetFcmTokenCache();
    const noAuth = vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as unknown as typeof fetch;
    expect(await sendFcm(sa, 'tok-1', PAYLOAD, { fetchImpl: noAuth })).toMatchObject({ status: 0, deviceFault: false, error: 'fcm_auth: 400 invalid_grant' });
    expect(noAuth).toHaveBeenCalledTimes(1);
  });
});
