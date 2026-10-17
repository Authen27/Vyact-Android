// Vyact v10.15.0 — trigger transactional split emails (send-split-email edge fn).
// Best-effort: a failure here never blocks the split action that succeeded.
// v10.60.0 — the outcome is returned, not swallowed. Until 4 Oct 2026 no email provider was
// configured, the function answered `email_not_configured` on every call, and nothing in the
// app or the logs said so (docs/EMAIL_TEMPLATES.md §0).
import { supabase } from './supabase';

type SplitEmailEvent = 'shared' | 'settled' | 'closed';

export interface SplitEmailResult {
  /** True when every recipient's email was accepted by the provider. */
  ok: boolean;
  /** Why not: `email_not_configured`, `partial`, `unreachable`, or the function's error code. */
  reason?: string;
  sent?: number;
  recipients?: number;
}

/** The function's answer, as one result the caller can act on. Pure, so it is tested. */
export function readSplitEmailResult(data: unknown, error: unknown): SplitEmailResult {
  if (error) return { ok: false, reason: 'unreachable' };
  const d = (data ?? {}) as { ok?: boolean; reason?: string; error?: string; sent?: number; recipients?: number };
  if (d.error) return { ok: false, reason: d.error };
  if (d.ok === false) return { ok: false, reason: d.reason ?? 'not_sent' };
  if (typeof d.recipients === 'number' && typeof d.sent === 'number' && d.sent < d.recipients) {
    return { ok: false, reason: 'partial', sent: d.sent, recipients: d.recipients };
  }
  return { ok: true, sent: d.sent, recipients: d.recipients };
}

/**
 * What to tell the person when a 'shared' email did not go out (null when it did). The split is
 * saved either way. W1c (v10.64.0): each person is emailed once per split, and one person can
 * cause at most a daily number of split emails (`daily_limit`).
 */
export function splitEmailNotice(r: SplitEmailResult): string | null {
  if (r.ok) return null;
  if (r.reason === 'daily_limit') {
    return "Split shared. You've reached today's limit for split emails, so some people will only see it when they open Vyact.";
  }
  return "Split shared. They'll see it when they open Vyact, but the email couldn't be sent.";
}

export async function sendSplitEmail(
  args: { splitId?: string; shareId?: string; event: SplitEmailEvent },
): Promise<SplitEmailResult> {
  if (!supabase) return { ok: false, reason: 'local_only' };
  try {
    const { data, error } = await supabase.functions.invoke('send-split-email', { body: args });
    return readSplitEmailResult(data, error);
  } catch {
    // Email is a nicety layered on top of the in-app notification — never fatal.
    return { ok: false, reason: 'unreachable' };
  }
}
