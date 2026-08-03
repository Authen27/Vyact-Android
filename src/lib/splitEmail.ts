// Vyact v10.15.0 — trigger transactional split emails (send-split-email edge fn).
// Best-effort: a failure here never blocks the split action that succeeded, and
// the function itself is a no-op until RESEND_API_KEY is configured server-side.
import { supabase } from './supabase';

type SplitEmailEvent = 'shared' | 'settled' | 'closed';

export async function sendSplitEmail(
  args: { splitId?: string; shareId?: string; event: SplitEmailEvent },
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.functions.invoke('send-split-email', { body: args });
  } catch {
    // Email is a nicety layered on top of the in-app notification — never fatal.
  }
}
