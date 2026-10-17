// W6 (audit FE-UIS-08) — how long a toast stays, and how a screen reader hears it.
//
// Every toast used to vanish after 3.2 s, errors included, and none was announced, so a failed
// "Update password" read as a success to a VoiceOver user. Errors and warnings now stay 10 s and
// can be dismissed; they are announced assertively, everything else politely.

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export function toastLifetimeMs(type: ToastKind, hasAction: boolean): number {
  if (type === 'error' || type === 'warning') return 10_000;
  // Aurora 4.0 CF1 — an Undo stays 8 s (lib/undoable.ts UNDO_MS: a held action commits then).
  return hasAction ? 8_000 : 3_200;
}

/** `alert` interrupts (failures); `status` waits its turn (confirmations, info). */
export function toastRole(type: ToastKind): 'alert' | 'status' {
  return type === 'error' || type === 'warning' ? 'alert' : 'status';
}
