// Vyact v7.4.4 — Number-system preference overlay.
//
// The Supabase schema does not yet have a column for `numberSystem` on
// either `profiles` or `households`. Without an overlay, the cloud
// adapter strips the field on every round-trip and the controlled
// <select> in Settings snaps back to "western" on save / refresh.
//
// We persist the preference per-household in localStorage, mirroring
// the pattern used elsewhere for un-migrated schema. Cross-device
// sync of this preference will arrive with a future schema bump.

import type { NumberSystem } from './format';

const KEY_PREFIX = 'vt_number_system_';

export function readNumberSystemPref(householdId: string): NumberSystem | null {
  if (!householdId) return null;
  try {
    const v = localStorage.getItem(KEY_PREFIX + householdId);
    return v === 'indian' || v === 'western' ? v : null;
  } catch { return null; }
}

export function writeNumberSystemPref(householdId: string, val: NumberSystem): void {
  if (!householdId) return;
  try { localStorage.setItem(KEY_PREFIX + householdId, val); } catch { /* ignore */ }
}
