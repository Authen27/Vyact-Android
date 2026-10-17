// v10.60.0 — the split email's outcome is read, not swallowed (docs/EMAIL_TEMPLATES.md §0):
// "not configured", a provider refusing some recipients, or no answer at all are failures
// the app reports; a full send is success.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readSplitEmailResult } from '../splitEmail';

describe('split email outcome', () => {
  it('CON-UNIT-SPL-005 · not configured, partial, error and unreachable are failures; a full send is success', () => {
    expect(readSplitEmailResult({ ok: false, reason: 'email_not_configured' }, null)).toEqual({ ok: false, reason: 'email_not_configured' });
    expect(readSplitEmailResult({ ok: true, sent: 1, recipients: 2 }, null)).toEqual({ ok: false, reason: 'partial', sent: 1, recipients: 2 });
    expect(readSplitEmailResult({ error: 'forbidden' }, null)).toEqual({ ok: false, reason: 'forbidden' });
    expect(readSplitEmailResult(null, new Error('down'))).toEqual({ ok: false, reason: 'unreachable' });
    expect(readSplitEmailResult({ ok: true, sent: 2, recipients: 2 }, null)).toEqual({ ok: true, sent: 2, recipients: 2 });
  });

  it('CON-UNIT-SPL-006 · the function sends from vyact.app with replies to support, and logs every outcome without addresses', () => {
    const fn = readFileSync(resolve(__dirname, '../../../../supabase/functions/send-split-email/index.ts'), 'utf8');
    // v10.94.0: the transport moved to _shared/emailTransport.ts (send-invite-email uses it too).
    const transport = readFileSync(resolve(__dirname, '../../../../supabase/functions/_shared/emailTransport.ts'), 'utf8');
    expect(fn).toMatch(/from '\.\.\/_shared\/emailTransport\.ts';/);
    expect(transport).toContain("const DEFAULT_FROM = 'Vyact <hello@vyact.app>';");
    expect(fn + transport).not.toContain('onboarding@resend.dev');
    expect(transport).toContain("|| 'support@vyact.app'");
    expect(fn).toMatch(/outcome: 'email_not_configured'/);
    expect(fn).toMatch(/console\.log\(JSON\.stringify\(\{ fn: 'send-split-email', event, recipients, sent, limited \}\)\)/);
    expect(transport).toMatch(/return res\.ok \|\| refused\(fn, 'resend', res\)/);
  });
});
