// W6 (audit FE-UIS-13) — "set a new password" is for someone who came from a reset link.
//
// /auth/reset-password used to open its "set" step for ANY signed-in session, so a person with a
// minute at an unlocked, signed-in phone could set a new password there and lock the owner out,
// with no link and no code. Now the step opens only after a recovery: a reset link's code was
// exchanged, or Supabase raised PASSWORD_RECOVERY. That fact is kept for this tab for 15 minutes,
// so a refresh of the page still works.

const KEY = 'vy_pw_recovery_at';
const TTL_MS = 15 * 60_000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function markRecovery(store: Store | null, now: number): void {
  try { store?.setItem(KEY, String(now)); } catch { /* fault-ok: without storage a refresh asks for a new link */ }
}

export function recoveryActive(store: Store | null, now: number): boolean {
  try {
    const at = Number(store?.getItem(KEY) ?? 0);
    return at > 0 && now - at >= 0 && now - at < TTL_MS;
  } catch { return false; }
}

export function clearRecovery(store: Store | null): void {
  try { store?.removeItem(KEY); } catch { /* fault-ok: storage unavailable: nothing was kept there */ }
}

export function recoveryStore(): Store | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}
