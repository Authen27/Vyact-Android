// W6 (audit FE-UIC-13) — one save at a time.
//
// A React `saving` flag alone does not stop a double tap: both taps run in the same tick, before
// the re-render that disables the button, so both start a save. A new recurring schedule mints
// its id inside the save, so two taps made two schedules (and posted the bill twice a month).
// The slot is a ref, read and set synchronously.

export interface ExclusiveSlot { current: boolean }

/**
 * Run `fn` unless a run on the same slot is still in flight. Returns false when the call was
 * dropped because one was already running.
 */
export async function runExclusive(slot: ExclusiveSlot, fn: () => Promise<void>): Promise<boolean> {
  if (slot.current) return false;
  slot.current = true;
  try {
    await fn();
    return true;
  } finally {
    slot.current = false;
  }
}
