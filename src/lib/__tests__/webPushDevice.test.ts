// v10.48.1 — setting up push on THIS device (lib/webPush.ts).
//
// The owner's first test: the switch showed "on" (the old Browser push setting) while
// the phone had never subscribed, so alerts appeared in the bell and never in the
// phone's notifications. Pinned: each way enabling can stop says why, a push service
// that refuses (Brave can block Google's) is told apart from a Vyact server error, a
// successful enable registers the subscription with the server, and nothing is
// "on for this device" until the server has it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../supabase', () => ({ sb: () => ({ rpc, functions: { invoke } }) }));

const PUBLIC_KEY = 'BPubKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const PREFS = { master: true, perType: {}, quietStart: '22:00', quietEnd: '07:00', webPushEnabled: true, defaultLeadDays: 3 };

interface Env { permission?: NotificationPermission; ask?: NotificationPermission; pong?: boolean; subscribe?: () => Promise<unknown>; brave?: boolean; ios?: boolean; standalone?: boolean; noSw?: boolean }
let store: Record<string, string>;

function browser(env: Env = {}) {
  store = {};
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/dev1', options: {}, toJSON: () => ({ keys: { p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) } }), unsubscribe: vi.fn().mockResolvedValue(true) };
  const worker = {
    postMessage: (_m: unknown, ports: MessagePort[]) => { if (env.pong !== false) ports[0].postMessage({ type: 'VYACT_PUSH_PONG', version: 1 }); },
  };
  const pushManager = { getSubscription: vi.fn().mockResolvedValue(null), subscribe: vi.fn(env.subscribe ?? (async () => sub)) };
  const reg = { active: worker, pushManager };
  const Notification = Object.assign(function Notification() { /* not constructed */ }, {
    permission: env.permission ?? 'default',
    requestPermission: vi.fn(async () => env.ask ?? 'granted'),
  });
  const nav = {
    userAgent: env.ios ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1' : 'Mozilla/5.0 (Linux; Android 14) Chrome/129 Mobile Safari/537.36',
    platform: env.ios ? 'iPhone' : 'Linux armv8l', maxTouchPoints: 5, standalone: !!env.standalone,
    ...(env.brave ? { brave: { isBrave: async () => true } } : {}),
    serviceWorker: { getRegistration: vi.fn().mockResolvedValue(env.noSw ? undefined : reg), ready: Promise.resolve(reg) },
  };
  vi.stubGlobal('navigator', nav);
  vi.stubGlobal('window', { navigator: nav, PushManager: function PushManager() { /* marker */ }, Notification, matchMedia: () => ({ matches: !!env.standalone }) });
  vi.stubGlobal('Notification', Notification);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; },
  });
  return { sub, pushManager, Notification };
}

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  invoke.mockResolvedValue({ data: { publicKey: PUBLIC_KEY }, error: null });
  rpc.mockResolvedValue({ data: { id: 's1' }, error: null });
});
afterEach(() => vi.unstubAllGlobals());

describe('turning push on for this device', () => {
  it('CON-UNIT-WPD-001 · success: asks permission first, subscribes with the server key, registers the subscription with zone and switches', async () => {
    const b = browser();
    const { enablePush, deviceHasServerPush } = await import('../webPush');
    expect(deviceHasServerPush()).toBe(false);
    const r = await enablePush('h1', PREFS as never);
    expect(r).toEqual({ ok: true });
    expect(b.Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('web-push', { body: { mode: 'key' } });
    expect(b.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(rpc).toHaveBeenCalledWith('register_push_subscription', expect.objectContaining({
      p_endpoint: 'https://fcm.googleapis.com/fcm/send/dev1', p_household_id: 'h1', p_p256dh: 'P'.repeat(87), p_auth: 'A'.repeat(22),
      // T4c (v10.126.0): prefs saved before the switch existed send details on.
      p_prefs: { master: true, perType: {}, quietStart: '22:00', quietEnd: '07:00', lockScreenDetails: true },
    }));
    expect(deviceHasServerPush()).toBe(false);          // permission is still 'default' in this stub
  });

  it('CON-UNIT-WPD-002 · each stop says why: blocked, an old worker, no worker, iPhone outside the Home Screen', async () => {
    browser({ ask: 'denied' });
    let m = await import('../webPush');
    expect(await m.enablePush('h1', PREFS as never)).toEqual({ ok: false, reason: 'denied' });
    expect(invoke).not.toHaveBeenCalled();

    vi.resetModules(); browser({ pong: false });
    m = await import('../webPush');
    expect(await m.enablePush('h1', PREFS as never)).toEqual({ ok: false, reason: 'update_needed' });

    vi.resetModules(); browser({ noSw: true });
    m = await import('../webPush');
    expect((await m.enablePush('h1', PREFS as never)).ok).toBe(false);

    vi.resetModules(); browser({ ios: true, standalone: false });
    m = await import('../webPush');
    expect(await m.enablePush('h1', PREFS as never)).toEqual({ ok: false, reason: 'ios_not_installed' });
  });

  it('CON-UNIT-WPD-003 · the browser\'s push service refusing is NOT a Vyact error; in Brave the message says what to switch on', async () => {
    const refuse = async () => { const e = new Error('Registration failed - push service error'); e.name = 'AbortError'; throw e; };
    browser({ brave: true, subscribe: refuse });
    const m = await import('../webPush');
    const r = await m.enablePush('h1', PREFS as never);
    expect(r).toEqual({ ok: false, reason: 'push_service', detail: 'AbortError: Registration failed - push service error' });
    expect(rpc).not.toHaveBeenCalledWith('register_push_subscription', expect.anything());
    const msg = m.pushRefusalMessage('push_service', (r as { detail: string }).detail);
    expect(msg).toContain('Brave');
    expect(msg).toContain('Use Google services for push messaging');
    expect(msg).toContain('Chrome');

    vi.resetModules(); browser({ subscribe: refuse });
    const chrome = await import('../webPush');
    expect(chrome.pushRefusalMessage('push_service', 'x')).not.toContain('Brave');
  });

  it('CON-UNIT-WPD-004 · Vyact failing to hand out its key or register is a server error, told apart from the push service', async () => {
    browser();
    invoke.mockResolvedValue({ data: null, error: new Error('500') });
    let m = await import('../webPush');
    expect(await m.enablePush('h1', PREFS as never)).toEqual({ ok: false, reason: 'server', detail: 'push_key_unavailable' });

    vi.resetModules(); browser();
    invoke.mockResolvedValue({ data: { publicKey: PUBLIC_KEY }, error: null });
    rpc.mockResolvedValue({ data: null, error: new Error('not_a_member') });
    m = await import('../webPush');
    expect(await m.enablePush('h1', PREFS as never)).toEqual({ ok: false, reason: 'server', detail: 'not_a_member' });
  });

  it('CON-UNIT-WPD-005 · "on for this device" needs a registered subscription; the silent re-sync never prompts', async () => {
    const b = browser({ permission: 'default' });
    const m = await import('../webPush');
    await m.syncPush('h1', PREFS as never);
    expect(b.Notification.requestPermission).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    // No subscription in the browser → not registered, whatever the saved preference says.
    expect(await m.devicePushStatus()).toEqual({ registered: false });
  });

  it('CON-UNIT-WPD-006 · T4c (BE-FN-12): "Show details on the lock screen" off reaches the server with the switches', async () => {
    browser({ permission: 'granted' });
    const m = await import('../webPush');
    await m.syncPush('h1', { ...PREFS, lockScreenDetails: false } as never);
    expect(rpc).toHaveBeenCalledWith('register_push_subscription', expect.objectContaining({
      p_prefs: { master: true, perType: {}, quietStart: '22:00', quietEnd: '07:00', lockScreenDetails: false },
    }));
  });

  it('CON-UNIT-WPD-007 · T4c: the Android app (a WebView, no Web Push) says so and where push works, without asking for permission', async () => {
    const b = browser();
    (globalThis.window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true };
    const m = await import('../webPush');
    expect(m.pushBlocker()).toBe('native_app');
    expect(await m.enablePush('h1', PREFS as never)).toEqual({ ok: false, reason: 'native_app' });
    expect(b.Notification.requestPermission).not.toHaveBeenCalled();
    expect(m.pushRefusalMessage('native_app')).toBe(
      "The Vyact Android app can't show notifications on your lock screen yet. To get them now, open vyact.app in Chrome, add it to your Home screen, and turn them on there.");
    await m.syncPush('h1', PREFS as never);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('passive sign-out (W7a, audit FE-PLT-08)', () => {
  it('W7a-PLT08-001 · an expired session drops the device subscription without a server call', async () => {
    const b = browser({ permission: 'granted' });
    b.pushManager.getSubscription.mockResolvedValue(b.sub);
    store['vyact_push_endpoint'] = b.sub.endpoint;
    const { forgetPushOnDevice } = await import('../webPush');
    await forgetPushOnDevice();
    expect(b.sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(store['vyact_push_endpoint']).toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('W7a-PLT08-002 · the store runs it on the signed-in → signed-out transition', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const slice = readFileSync(resolve(__dirname, '../../store/slices/cloudAuthSlice.ts'), 'utf8');
    // W8a (FE-SYN-10): the cleared state is the shared SIGNED_OUT_STATE (also used on a switch of user).
    expect(slice).toMatch(/wasSignedIn && !isSignedIn[\s\S]*?void forgetPushOnDevice\(\);[\s\S]*?set\(\{ \.\.\.SIGNED_OUT_STATE \}\)/);
    expect(slice).toMatch(/export const SIGNED_OUT_STATE = \{\s*households: \[\]/);
  });
});
