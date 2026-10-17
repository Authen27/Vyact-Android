// W1c (v10.64.0, audit 2026-10-04 BE-FN-06 / INT-HH-11 / XC-PRV-13) — send-split-email is not a
// relay: every value in the email is escaped, the caller is authorised before any work, and only
// the shares claim_split_emails() hands back are mailed. Mocked Supabase client and provider; not
// a deployed-function test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureHandler, queryResult } from './helpers/edgeHarness';
import { money, splitInviteEmail, splitSettledEmail, type SplitEmailData } from '../../../../supabase/functions/_shared/emailTemplates';

const api = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(),
  auth: { getUser: vi.fn(), admin: { getUserById: vi.fn() } },
}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.45.0', () => ({ createClient: () => api }));
vi.mock('https://deno.land/x/denomailer@1.6.0/mod.ts', () => ({ SMTPClient: class { send() {} close() {} } }));

const OWNER = { id: 'owner', email: 'owner@example.com' };
const FRIEND = { id: 'friend', email: 'friend@example.com' };
let split: Record<string, unknown>;
let shares: { id: string; email: string; share: number; paid: boolean }[];
let claim: { claimed: string[]; limited: number };
let deletes: unknown[];
const fetchMock = vi.fn();

const post = (handler: (r: Request) => Promise<Response>, body: unknown) =>
  handler(new Request('https://edge.example.com/send-split-email', {
    method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify(body),
  }));

let handler: (r: Request) => Promise<Response>;
beforeEach(async () => {
  vi.resetModules();
  split = { id: 's1', owner_user_id: OWNER.id, description: 'Dinner', currency: 'INR', total_amount: 300, date: '2026-10-05', closed_at: null };
  shares = [
    { id: 'sh-owner', email: OWNER.email, share: 100, paid: true },
    { id: 'sh-a', email: 'a@example.com', share: 100, paid: false },
    { id: 'sh-b', email: 'b@example.com', share: 100, paid: false },
  ];
  claim = { claimed: ['sh-a', 'sh-b'], limited: 0 };
  deletes = [];
  api.auth.getUser.mockResolvedValue({ data: { user: OWNER }, error: null });
  api.auth.admin.getUserById.mockResolvedValue({ data: { user: { email: OWNER.email, user_metadata: { full_name: 'Owner' } } } });
  api.from.mockImplementation((table: string) => {
    if (table === 'shared_splits') return queryResult(split);
    if (table === 'shared_split_shares') return queryResult(shares);
    if (table === 'split_email_log') {
      const q = queryResult(null);
      q.eq.mockImplementation((col: string, value: unknown) => { if (col === 'share_id') deletes.push(value); return q; });
      return q;
    }
    throw new Error(`unexpected table ${table}`);
  });
  api.rpc.mockImplementation(async (name: string) =>
    name === 'claim_split_emails' ? { data: claim, error: null } : { data: [], error: null });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
  handler = await captureHandler(() => import('../../../../supabase/functions/send-split-email/index'), { RESEND_API_KEY: 'test-resend' });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

const claimCall = () => api.rpc.mock.calls.find(c => c[0] === 'claim_split_emails');
const mailedTo = () => fetchMock.mock.calls.map(c => JSON.parse(String((c[1] as RequestInit).body)).to);

describe('split email templates (W1c)', () => {
  it('CON-UNIT-W1-025 · every value is escaped, a malformed currency is dropped, a subject cannot fold', () => {
    const d: SplitEmailData = {
      ownerName: 'Vyact Security\r\nBcc: victim@example.com', ownerEmail: 'o@example.com',
      description: '<a href="https://evil.example">Verify</a>', date: '2026-10-05',
      currency: '<a href="https://evil.example">x</a>', total: 10, recipientShare: 5,
      participants: [{ name: '<img src=x onerror=alert(1)>', share: 5, isRecipient: true }],
      appUrl: 'https://vyact.app', recipientEmail: 'r@example.com',
    };
    const mail = splitInviteEmail(d);
    expect(mail.html).not.toMatch(/<a href="https:\/\/evil|<img/);
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text).toContain('<a href="https://evil.example">Verify</a>');   // plain text keeps the words, not markup
    expect(money(5, '<b>x</b>')).toBe('5');
    expect(money(5, 'CHF')).toBe('5 CHF');
    expect(money(5, 'INR')).toBe('₹5');
    expect(splitSettledEmail({ settledLabel: 'Sam', amount: 5, currency: '"><script>', description: 'x', appUrl: 'https://vyact.app' }).html)
      .not.toContain('<script>');
  });
});

describe('send-split-email (W1c)', () => {
  it('CON-UNIT-W1-026 · authorised before any work: non-owner, closed split, unsettled share', async () => {
    api.auth.getUser.mockResolvedValue({ data: { user: FRIEND }, error: null });
    expect((await post(handler, { splitId: 's1', event: 'shared' })).status).toBe(403);
    api.auth.getUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    split.closed_at = '2026-10-05T10:00:00Z';
    expect((await post(handler, { splitId: 's1', event: 'shared' })).status).toBe(409);
    split.closed_at = null;
    expect((await post(handler, { splitId: 's1', event: 'closed' })).status).toBe(409);
    api.auth.getUser.mockResolvedValue({ data: { user: { id: 'a', email: 'a@example.com' } }, error: null });
    expect((await post(handler, { splitId: 's1', shareId: 'sh-a', event: 'settled' })).status).toBe(409);
    expect(claimCall()).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CON-UNIT-W1-027 · mails exactly the claimed shares, never the owner; a repeat call mails nobody', async () => {
    const res = await post(handler, { splitId: 's1', event: 'shared' });
    expect(await res.json()).toEqual({ ok: true, sent: 2, recipients: 2 });
    expect(claimCall()?.[1]).toEqual(expect.objectContaining({
      p_sender: OWNER.id, p_split: 's1', p_event: 'shared', p_share_ids: ['sh-a', 'sh-b'], p_daily_cap: 50,
    }));
    expect(mailedTo()).toEqual(['a@example.com', 'b@example.com']);

    claim = { claimed: [], limited: 0 };
    fetchMock.mockClear();
    expect(await (await post(handler, { splitId: 's1', event: 'shared' })).json()).toEqual({ ok: true, sent: 0, recipients: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CON-UNIT-W1-028 · over the daily cap says so; a failed delivery gives its claim back', async () => {
    claim = { claimed: ['sh-a'], limited: 1 };
    fetchMock.mockResolvedValue(new Response('{"name":"rate_limited"}', { status: 429 }));
    const body = await (await post(handler, { splitId: 's1', event: 'shared' })).json();
    expect(body).toEqual({ ok: false, reason: 'daily_limit', sent: 0, recipients: 1, limited: 1 });
    expect(deletes).toEqual(['sh-a']);
  });

  it('CON-UNIT-W1-029 · a malformed cap setting keeps the default; it can never mean "no cap"', async () => {
    const { dailyCap, DEFAULT_DAILY_CAP } = await import('../../../../supabase/functions/send-split-email/index');
    expect(DEFAULT_DAILY_CAP).toBe(50);
    for (const raw of ['', 'unlimited', '-1', '1e9', '50/day', ' ']) expect(dailyCap(raw), raw).toBe(50);
    expect(dailyCap('10')).toBe(10);
    expect(dailyCap(' 0 ')).toBe(0);
  });
});
