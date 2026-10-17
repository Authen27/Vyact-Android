import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toastLifetimeMs, toastRole } from '../toastPolicy';

const read = (p: string) => readFileSync(resolve(__dirname, '..', '..', p), 'utf8');

describe('toasts a screen reader hears (W6, audit FE-UIS-08)', () => {
  it('W6-UIS08-001 · errors and warnings stay 10 s and interrupt; confirmations stay as before and wait their turn', () => {
    expect(toastLifetimeMs('error', false)).toBe(10_000);
    expect(toastLifetimeMs('warning', true)).toBe(10_000);
    expect(toastLifetimeMs('success', false)).toBe(3_200);
    expect(toastLifetimeMs('info', true)).toBe(8_000);           // an Undo can still be reached (Aurora 4.0 CF1: 8 s)
    expect(toastRole('error')).toBe('alert');
    expect(toastRole('warning')).toBe('alert');
    expect(toastRole('success')).toBe('status');
    expect(toastRole('info')).toBe('status');
  });

  it('W6-UIS08-002 · the host is a live region with a role per toast and a close button; the store uses the policy; auth errors are alerts', () => {
    const host = read('components/ui/ToastHost.tsx');
    expect(host).toMatch(/aria-live="polite"/);
    expect(host).toMatch(/role=\{toastRole\(t\.type\)\}/);
    expect(host).toMatch(/aria-label="Dismiss notification"/);
    expect(read('store/slices/syncSlice.ts')).toMatch(/toastLifetimeMs\(type, !!action\)/);
    for (const page of ['pages/auth/SignIn.tsx', 'pages/auth/SignUp.tsx']) {
      expect(read(page), page).toMatch(/\{error && <div role="alert"/);
    }
  });
});
