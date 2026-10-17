import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { markRecovery, recoveryActive, clearRecovery } from '../passwordRecovery';

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

describe('set a new password only after a reset link (W6, audit FE-UIS-13)', () => {
  it('W6-UIS13-001 · a recovery lasts 15 minutes in this tab and ends when the password is set; no recovery, no step', () => {
    const s = memory();
    expect(recoveryActive(s, 1_000)).toBe(false);                 // a plain signed-in session
    markRecovery(s, 1_000);
    expect(recoveryActive(s, 1_000 + 14 * 60_000)).toBe(true);   // a refresh of the page still works
    expect(recoveryActive(s, 1_000 + 15 * 60_000)).toBe(false);
    markRecovery(s, 5_000);
    clearRecovery(s);
    expect(recoveryActive(s, 5_001)).toBe(false);
    expect(recoveryActive(null, 1)).toBe(false);
  });

  it('W6-UIS13-002 · ResetPassword opens "set" from a code exchange or PASSWORD_RECOVERY, never from any session; delete-immediately signs out', () => {
    const page = readFileSync(resolve(__dirname, '../../pages/auth/ResetPassword.tsx'), 'utf8');
    expect(page).toMatch(/session\?\.user && recoveryActive\(recoveryStore\(\), Date\.now\(\)\)\) setStep\('set'\)/);
    expect(page).toMatch(/event === 'PASSWORD_RECOVERY'\) \{\s*markRecovery\(/);
    expect(page).not.toMatch(/if \(!cancelled && session\?\.user\) setStep\('set'\)/);
    const settings = readFileSync(resolve(__dirname, '../../pages/Settings.tsx'), 'utf8');
    expect(settings).toMatch(/await executeAccountDeletion\(\);[\s\S]{0,140}await signOut\(\)/);
  });
});
