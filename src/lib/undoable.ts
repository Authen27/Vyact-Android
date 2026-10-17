// Aurora 4.0 CF1 — undo instead of asking, when it can be undone.
//
// A reversible action no longer asks first. Two shapes, both with an 8-second Undo in the toast
// (UNDO_MS, the same lifetime toastPolicy gives a toast with an action):
//  · act now, reverse on Undo — `offerUndo`, when the action has an exact reversal (skipping a bill:
//    its schedule's pointer goes back);
//  · hold, then commit — `deferCommit`, when it has none (revoking an invitation: a new one would be
//    a new link and a new email). The UI hides the item at once; the write runs when the 8 seconds are
//    up or the person navigates away (`flushDeferred`, wired in App), never on Undo.

export const UNDO_MS = 8_000;

type Toast = (text: string, type?: 'success' | 'error' | 'info' | 'warning', action?: { label: string; run: () => void }) => void;

/** The action already ran; Undo runs `undo`. */
export function offerUndo(toast: Toast, text: string, undo: () => void | Promise<unknown>): void {
  toast(text, 'info', { label: 'Undo', run: () => { void undo(); } });
}

interface Deferred { commit: () => Promise<unknown> | void; timer: ReturnType<typeof setTimeout> }
const pending = new Map<number, Deferred>();
let seq = 0;

async function run(id: number) {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  clearTimeout(entry.timer);
  await entry.commit();
}

/**
 * Shows `text` with Undo and runs `commit` after UNDO_MS (or on navigation). Undo cancels the commit
 * and calls `onUndo` so the UI can show the item again. Returns the id (tests).
 */
export function deferCommit(toast: Toast, text: string, commit: () => Promise<unknown> | void, onUndo?: () => void): number {
  const id = ++seq;
  const timer = setTimeout(() => { void run(id); }, UNDO_MS);
  pending.set(id, { commit, timer });
  toast(text, 'info', {
    label: 'Undo',
    run: () => {
      const entry = pending.get(id);
      if (!entry) return;               // already committed
      clearTimeout(entry.timer);
      pending.delete(id);
      onUndo?.();
    },
  });
  return id;
}

/** Commits every held action now (navigation away, page hide). */
export async function flushDeferred(): Promise<void> {
  await Promise.all([...pending.keys()].map(run));
}

/** How many held actions are waiting (tests). */
export function deferredCount(): number {
  return pending.size;
}
