import { describe, it, expect } from 'vitest';
import { resolveMyRole, can } from '../permissions';

// CON-UNIT-078..080 — Phase 0 of the defect-triage plan.
//
// These pin the rule that decides WHICH ROLE the current user holds. It is the
// other half of `can()`, and it had two defects that between them produced a
// user-facing bug and a latent privilege hole:
//
//   1. In local-only mode `myRole` was never populated (its only writer was
//      gated behind cloud being ON), so `can()` fell through to deny-by-default
//      and every write-gated screen rendered read-only — no Add Budget, no
//      delete household, no recurring edit.
//
//   2. The 'owner' fallback was keyed on "no session" rather than "no cloud",
//      so a signed-out CLOUD user resolved to 'owner'. Unreachable while
//      nothing called it in that state; live the moment App.tsx did.
//
// The second is why these tests exist at all. A test that only covered the
// local-only case would have passed against the broken code.

describe('resolveMyRole — who am I in this household', () => {
  it('CON-UNIT-078 · local-only mode owns everything', () => {
    // One anonymous household on this device, no auth, no sharing, no server to
    // enforce anything. Denying writes here just bricks the app — which is
    // exactly what shipped.
    expect(resolveMyRole({ cloudEnabled: false, hasSession: false })).toBe('owner');
    // A stale session flag must not change the answer in local-only mode.
    expect(resolveMyRole({ cloudEnabled: false, hasSession: true })).toBe('owner');
    // And the role must be one that can actually manage things.
    expect(can(resolveMyRole({ cloudEnabled: false, hasSession: false }), 'manage_budgets')).toBe(true);
    expect(can(resolveMyRole({ cloudEnabled: false, hasSession: false }), 'delete_household')).toBe(true);
  });

  it('CON-UNIT-079 · a signed-out cloud user gets NO role — never owner', () => {
    // THE REGRESSION GUARD. The previous implementation returned 'owner' here,
    // because it asked "is there a session?" instead of "is this local-only?".
    const role = resolveMyRole({ cloudEnabled: true, hasSession: false });
    expect(role).toBeUndefined();
    expect(can(role, 'view')).toBe(true);              // reading is all they get
    expect(can(role, 'manage_budgets')).toBe(false);
    expect(can(role, 'delete_household')).toBe(false);
    expect(can(role, 'edit_household_settings')).toBe(false);
  });

  it('CON-UNIT-080 · a signed-in cloud user gets exactly their membership role', () => {
    expect(resolveMyRole({ cloudEnabled: true, hasSession: true, membershipRole: 'owner' })).toBe('owner');
    expect(resolveMyRole({ cloudEnabled: true, hasSession: true, membershipRole: 'viewer' })).toBe('viewer');
    // No membership row in this household ⇒ no role. Both shapes the query can
    // return (null from `.maybeSingle()`, or the field simply absent) must land
    // on undefined rather than falling through to a default.
    expect(resolveMyRole({ cloudEnabled: true, hasSession: true, membershipRole: null })).toBeUndefined();
    expect(resolveMyRole({ cloudEnabled: true, hasSession: true })).toBeUndefined();
    // A viewer is not silently upgraded by being signed in.
    expect(can(resolveMyRole({ cloudEnabled: true, hasSession: true, membershipRole: 'viewer' }), 'manage_budgets')).toBe(false);
  });
});
