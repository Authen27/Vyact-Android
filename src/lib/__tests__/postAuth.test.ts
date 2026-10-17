// v10.49.0 (#20) — where sign-in / sign-up lands. Pinned: an in-app path survives the
// Google redirect; anything that would leave the site is dropped; an invite wins.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeNext, rememberNext, postAuthPath } from '../postAuth';

let store: Record<string, string>;
beforeEach(() => {
  store = {};
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('post-auth landing', () => {
  it('CON-UNIT-PA-001 · only in-app paths: other origins, protocol-relative, javascript: and auth loops are dropped', () => {
    expect(safeNext('/budgets')).toBe('/budgets');
    expect(safeNext('/insights?tab=learn')).toBe('/insights?tab=learn');
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', 'budgets', '/auth/sign-in', '', null]) {
      expect(safeNext(bad), String(bad)).toBeNull();
    }
  });

  it('CON-UNIT-PA-002 · a `next` remembered before the Google redirect is used once; an invite wins; else the dashboard', () => {
    rememberNext('/debts');
    expect(postAuthPath()).toBe('/debts');
    expect(postAuthPath()).toBe('/dashboard');              // consumed
    rememberNext('https://evil.com');
    expect(postAuthPath()).toBe('/dashboard');              // never stored
    store.pending_invite_token = 'tok 1';
    expect(postAuthPath('/budgets')).toBe('/invite/tok%201');
  });

  it('CON-UNIT-PA-003 · W0: parser tricks that become another host are dropped (FE-PLT-01)', () => {
    for (const bad of ['/\t/evil.com', '/\n/evil.com', '/\r//evil.com', '/\u0000/x', '/\\/evil.com', '/budgets\\..\\x',
      '/a/../auth/sign-in', '/auth', ' //evil.com']) {
      expect(safeNext(bad), JSON.stringify(bad)).toBeNull();
    }
    // Encoded slashes stay a harmless in-app path; normal paths are unchanged.
    expect(safeNext('/%2F%2Fevil.com')).toBe('/%2F%2Fevil.com');
    expect(safeNext('/splits?id=7#share')).toBe('/splits?id=7#share');
    expect(safeNext('/a/../budgets')).toBe('/budgets');
  });
});
