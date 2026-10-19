// v10.49.0 (marketing #5) — funnel events. Pinned: every event carries `platform`;
// sign_up fires ONCE, on a new account's first sign-in, with where it came from (?ref=);
// an existing account signing in is not a sign-up.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let store: Record<string, string>;
beforeEach(() => {
  vi.resetModules();
  store = {};
  vi.stubEnv('MODE', 'production');   // track() is off under vitest by design
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// T4b (v10.125.0): the consent script sets __vyGaOn once analytics is allowed (or in the Android app).
function browser(standalone = false, analyticsOn = true) {
  const gtag = vi.fn();
  vi.stubGlobal('window', { gtag, matchMedia: () => ({ matches: standalone }), navigator: {}, __vyGaOn: analyticsOn });
  return gtag;
}

describe('funnel events', () => {
  it('CON-UNIT-FUN-001 · every event carries platform (web / pwa)', async () => {
    let gtag = browser(false);
    let a = await import('../analytics');
    a.track('budget_created', { surface: 'budgets' });
    expect(gtag).toHaveBeenCalledWith('event', 'budget_created', { surface: 'budgets', platform: 'web' });
    vi.resetModules();
    gtag = browser(true);
    a = await import('../analytics');
    a.track('pwa_install');
    expect(gtag).toHaveBeenCalledWith('event', 'pwa_install', { platform: 'pwa' });
  });

  it('CON-UNIT-FUN-002 · sign_up once, on a new account\'s first sign-in, with its ref; never for an existing account', async () => {
    const gtag = browser();
    const a = await import('../analytics');
    a.rememberSignupRef('learn_ev-001-the-500-a-day-idea');
    const now = Date.parse('2026-09-29T10:00:20Z');
    const fresh = { id: 'u1', created_at: '2026-09-29T10:00:00Z', app_metadata: { provider: 'google' } };
    expect(a.trackSignUpOnce(fresh, now)).toBe(true);
    expect(a.trackSignUpOnce(fresh, now)).toBe(false);          // a reload of that first session
    expect(gtag.mock.calls.filter(c => c[1] === 'sign_up')).toEqual([
      ['event', 'sign_up', { method: 'google', ref: 'learn_ev-001-the-500-a-day-idea', platform: 'web' }],
    ]);
    expect(a.trackSignUpOnce({ id: 'u2', created_at: '2026-01-01T00:00:00Z' }, now)).toBe(false);
    expect(gtag.mock.calls.filter(c => c[1] === 'sign_up')).toHaveLength(1);
  });

  it('CON-UNIT-FUN-003 · an email user who verifies hours later still counts, with household_created; the account flag and the 24 h window hold', async () => {
    const gtag = browser();
    const a = await import('../analytics');
    const created = Date.parse('2026-10-05T08:00:00Z');
    // v10.53.0 — verified 3 hours after signing up: the old 60 s rule never counted this.
    expect(a.trackSignUpOnce({ id: 'e1', created_at: '2026-10-05T08:00:00Z', app_metadata: { provider: 'email' } }, created + 3 * 3600_000)).toBe(true);
    expect(gtag.mock.calls.map(c => c[1])).toEqual(['sign_up', 'household_created']);
    expect(gtag.mock.calls[1]).toEqual(['event', 'household_created', { segment: 'individual', platform: 'web' }]);
    // Already counted on another device (account flag): not again.
    expect(a.trackSignUpOnce({ id: 'e2', created_at: '2026-10-05T08:00:00Z', user_metadata: { vy_signup_tracked: true } }, created + 60_000)).toBe(false);
    // Older than 24 h: an existing account, not a sign-up.
    expect(a.trackSignUpOnce({ id: 'e3', created_at: '2026-10-05T08:00:00Z' }, created + a.NEW_ACCOUNT_WINDOW_MS + 1)).toBe(false);
    expect(gtag.mock.calls.filter(c => c[1] === 'sign_up')).toHaveLength(1);
  });

  it('CON-UNIT-FUN-004 · GA user_id is a SHA-256 of the user id, never the id itself, and clears on sign-out', async () => {
    const gtag = browser();
    const a = await import('../analytics');
    await a.setAnalyticsUser('0b6c1d9e-1111-4222-8333-444455556666');
    const set = gtag.mock.calls.find(c => c[0] === 'set')!;
    expect(set[1].user_id).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(set)).not.toContain('0b6c1d9e');
    await a.setAnalyticsUser(null);
    expect(gtag.mock.calls.at(-1)).toEqual(['set', { user_id: null }]);
  });

  it('CON-UNIT-FUN-005 · nothing goes to Google before analytics is on (T4b, XC-PRV-03)', async () => {
    const gtag = browser(false, false);
    const a = await import('../analytics');
    a.track('budget_created', { surface: 'budgets' });
    await a.setAnalyticsUser('0b6c1d9e-1111-4222-8333-444455556666');
    expect(gtag).not.toHaveBeenCalled();
  });
});
