// T4D-010..016 — v10.127.0 (Track T4d; owner decisions 19 Oct 2026): the Vyact Android app registers its
// phone for lock-screen notifications through the Capacitor push plugin (window.Capacitor.Plugins), with no
// Capacitor package in the web build. On by default (Android's permission asked once, the first time), off when
// the person turns it off on that phone (a sign-out is not that choice), a rotated token replaces the old one,
// a tap opens the alert's page, and the server is the only source on a registered phone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rpc = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../supabase', () => ({ sb: () => ({ rpc, functions: { invoke } }) }));

const PREFS = { master: true, perType: {}, quietStart: '22:00', quietEnd: '07:00', webPushEnabled: false, defaultLeadDays: 3 } as const;
type Perm = 'granted' | 'denied' | 'prompt';
let store: Record<string, string>;

function phone({ perm = 'prompt' as Perm, answer = 'granted' as Perm, token = 'tok-1', plugin = true } = {}) {
  store = {};
  const listeners: Record<string, ((d: unknown) => void)[]> = {};
  const state = { perm, token };
  const push = {
    checkPermissions: vi.fn(async () => ({ receive: state.perm })),
    requestPermissions: vi.fn(async () => { state.perm = answer; return { receive: state.perm }; }),
    register: vi.fn(async () => { setTimeout(() => (listeners.registration ?? []).forEach(fn => fn({ value: state.token })), 0); }),
    unregister: vi.fn(async () => undefined),
    createChannel: vi.fn(async () => undefined),
    addListener: vi.fn((event: string, fn: (d: unknown) => void) => {
      (listeners[event] ??= []).push(fn);
      return Promise.resolve({ remove: async () => { listeners[event] = (listeners[event] ?? []).filter(f => f !== fn); } });
    }),
  };
  const history = { state: { idx: 3 } as unknown, pushState: vi.fn((s: unknown, _t: string, url: string) => { history.state = s; history.url = url; }), url: '' };
  const events: Event[] = [];
  vi.stubGlobal('window', {
    Capacitor: { isNativePlatform: () => true, Plugins: plugin ? { PushNotifications: push } : {} },
    history, dispatchEvent: (e: Event) => { events.push(e); return true; }, matchMedia: () => ({ matches: false }),
  });
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/129.0' });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; },
  });
  vi.stubGlobal('PopStateEvent', class extends Event { state: unknown; constructor(t: string, i?: { state?: unknown }) { super(t); this.state = i?.state; } });
  return { push, state, listeners, history, events, tap: (data: Record<string, unknown>) => (listeners.pushNotificationActionPerformed ?? []).forEach(fn => fn({ actionId: 'tap', notification: { data } })) };
}

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  rpc.mockResolvedValue({ data: { id: 'p1' }, error: null });
});
afterEach(() => vi.unstubAllGlobals());

const registered = () => rpc.mock.calls.filter(c => c[0] === 'register_native_push').map(c => c[1]);

describe('lock-screen notifications in the Android app (T4d)', () => {
  it('T4D-010 · on by default: the first start asks Android once and registers the phone with its household, zone and switches', async () => {
    const p = phone();
    const m = await import('../webPush');
    expect(m.pushBlocker()).toBeNull();                                 // the plugin is there: push works here
    await m.syncPush('h1', { ...PREFS, lockScreenDetails: false } as never);
    expect(p.push.requestPermissions).toHaveBeenCalledTimes(1);
    expect(p.push.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: 'vyact_alerts', importance: 4 }));
    expect(registered()).toEqual([{
      p_token: 'tok-1', p_household_id: 'h1', p_user_agent: 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/129.0',
      p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      p_prefs: { master: true, perType: {}, quietStart: '22:00', quietEnd: '07:00', lockScreenDetails: false },
    }]);
    expect(m.deviceHasServerPush()).toBe(true);                         // the app's own local notifications stop
    expect(m.pushWanted(PREFS as never)).toBe(true);                    // although webPushEnabled is false
    await m.syncPush('h2', PREFS as never);                             // a household switch: registered again, no prompt
    expect(p.push.requestPermissions).toHaveBeenCalledTimes(1);
    expect(registered().map(r => r.p_household_id)).toEqual(['h1', 'h2']);
  });

  it('T4D-011 · refused permission: nothing registered and never asked again by itself; a tap in Settings asks and says it is blocked', async () => {
    const p = phone({ answer: 'denied' });
    const m = await import('../webPush');
    await m.syncPush('h1', PREFS as never);
    await m.syncPush('h1', PREFS as never);
    expect(p.push.requestPermissions).toHaveBeenCalledTimes(1);
    expect(registered()).toEqual([]);
    expect(m.deviceHasServerPush()).toBe(false);
    expect(await m.enablePush('h1', PREFS as never)).toEqual({ ok: false, reason: 'denied' });
    expect(p.push.requestPermissions).toHaveBeenCalledTimes(2);
  });

  it('T4D-012 · turned off in Settings it stays off on this phone; turning it on registers again; a sign-out is not that choice', async () => {
    const p = phone({ perm: 'granted' });
    const m = await import('../webPush');
    await m.syncPush('h1', PREFS as never);
    await m.disablePush({ byChoice: true });
    expect(rpc).toHaveBeenCalledWith('unregister_native_push', { p_token: 'tok-1' });
    expect(p.push.unregister).toHaveBeenCalledTimes(1);
    expect(m.pushWanted(PREFS as never)).toBe(false);
    rpc.mockClear();
    await m.syncPush('h1', PREFS as never);
    expect(registered()).toEqual([]);                                   // off stays off
    expect(await m.enablePush('h1', PREFS as never)).toEqual({ ok: true });
    expect(registered()).toHaveLength(1);
    expect(m.pushWanted(PREFS as never)).toBe(true);

    await m.disablePush();                                              // signing out
    rpc.mockClear();
    await m.syncPush('h1', PREFS as never);                             // the next sign-in: on again by default
    expect(registered()).toHaveLength(1);
  });

  it('T4D-013 · a rotated token replaces the old one on the server', async () => {
    const p = phone({ perm: 'granted' });
    const m = await import('../webPush');
    await m.syncPush('h1', PREFS as never);
    p.state.token = 'tok-2';
    await m.syncPush('h1', PREFS as never);
    expect(registered().map(r => r.p_token)).toEqual(['tok-1', 'tok-2']);
    expect(rpc).toHaveBeenCalledWith('unregister_native_push', { p_token: 'tok-1' });
  });

  it('T4D-014 · a tap opens the alert\'s page in the app (also the tap that started it); never an outside address', async () => {
    const p = phone({ perm: 'granted' });
    const m = await import('../webPush');
    await m.syncPush('h1', PREFS as never);
    p.tap({ url: '/budgets?budgetId=b1', tag: 't', type: 'budget_threshold' });
    expect(p.history.pushState).toHaveBeenCalledWith({ usr: null, key: 'push4', idx: 4 }, '', '/budgets?budgetId=b1');
    expect(p.events.map(e => e.type)).toEqual(['popstate']);            // the router reads the new address
    for (const url of ['//evil.example', '/\\evil.example', 'https://evil.example', undefined]) p.tap({ url });
    expect(p.history.pushState).toHaveBeenCalledTimes(1);
    await m.syncPush('h1', PREFS as never);
    expect(p.push.addListener.mock.calls.filter(c => c[0] === 'pushNotificationActionPerformed')).toHaveLength(1);   // once per start
  });

  it('T4D-015 · Settings\' status and test use this phone\'s token; a passive sign-out drops it on the phone', async () => {
    const p = phone({ perm: 'granted' });
    const m = await import('../webPush');
    await m.syncPush('h1', PREFS as never);
    rpc.mockResolvedValueOnce({ data: { registered: true, active: true, last_status: 200 }, error: null });
    expect(await m.devicePushStatus()).toEqual({ registered: true, active: true, last_status: 200 });
    expect(rpc).toHaveBeenLastCalledWith('native_push_status', { p_token: 'tok-1' });
    invoke.mockResolvedValue({ data: { results: [{ device: 'Vyact app on Android', status: 200, accepted: true, gone: false }] }, error: null });
    expect(await m.sendTestPush()).toEqual({ ok: true, results: [{ device: 'Vyact app on Android', status: 200, accepted: true, gone: false }] });
    expect(invoke).toHaveBeenCalledWith('web-push', { body: { mode: 'test', fcmToken: 'tok-1' } });
    await m.forgetPushOnDevice();
    expect(p.push.unregister).toHaveBeenCalledTimes(1);
    expect(m.deviceHasServerPush()).toBe(false);
    expect(m.pushWanted(PREFS as never)).toBe(true);                    // not a choice to turn it off
  });

  it('T4D-016 · the bell\'s "get these on your phone" card is for browsers only; prefs changes reach a phone registered by default', () => {
    const src = (p: string) => readFileSync(resolve(__dirname, '..', '..', p), 'utf8');
    expect(src('components/layout/PhonePushPrompt.tsx')).toMatch(/pushBlocker\(\) === 'unsupported' \|\| isNativeApp\(\) \|\| !prefs\.master/);
    expect(src('store/slices/notifySlice.ts')).toMatch(/if \(cloudEnabled && currentHouseholdId && currentHouseholdId !== 'local'\) \{\s*void syncPush\(currentHouseholdId, next\);/);
    expect(src('components/settings/PushNotifications.tsx')).toMatch(/await disablePush\(\{ byChoice: true \}\);/);
  });
});
