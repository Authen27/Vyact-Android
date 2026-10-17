// #9 (v10.94.0; owner decision 13 Oct 2026) — send-invite-email emails a household invitation to the
// person it is addressed to. The caller is authorised before any work, the address is the stored one,
// every value in the email is escaped, and only a claimed send goes out. Mocked Supabase client and
// provider; not a deployed-function test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureHandler, queryResult } from './helpers/edgeHarness';
import { householdInviteEmail } from '../../../../supabase/functions/_shared/emailTemplates';

const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), auth: { getUser: vi.fn() } }));
vi.mock('https://esm.sh/@supabase/supabase-js@2.45.0', () => ({ createClient: () => api }));
vi.mock('https://deno.land/x/denomailer@1.6.0/mod.ts', () => ({ SMTPClient: class { send() {} close() {} } }));

const INV_ID = '30000000-0000-4000-8000-000000000001';
const OWNER = { id: 'owner', email: 'asha@example.com', user_metadata: {} };
let invitation: Record<string, unknown> | null;
let myRole: string | null;
let claim: string;
let released: unknown[];
const fetchMock = vi.fn();

const post = (handler: (r: Request) => Promise<Response>, body: unknown) =>
  handler(new Request('https://edge.example.com/send-invite-email', {
    method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify(body),
  }));
const load = (env: Record<string, string> = { RESEND_API_KEY: 'test-resend' }) =>
  captureHandler(() => import('../../../../supabase/functions/send-invite-email/index'), env);

let handler: (r: Request) => Promise<Response>;
beforeEach(async () => {
  vi.resetModules();
  invitation = {
    id: INV_ID, household_id: 'h1', recipient_email: 'sam@example.com', role: 'member', token: 'ab+c/d=',
    expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), accepted_at: null,
  };
  myRole = 'owner';
  claim = 'claimed';
  released = [];
  api.auth.getUser.mockResolvedValue({ data: { user: OWNER }, error: null });
  api.from.mockImplementation((table: string) => {
    if (table === 'invitations') return queryResult(invitation);
    if (table === 'memberships') return queryResult(myRole ? { role: myRole } : null);
    if (table === 'households') return queryResult({ name: 'Sharma family' });
    if (table === 'profiles') return queryResult({ display_name: 'Asha' });
    if (table === 'invite_email_log') {
      const q = queryResult(null);
      q.eq.mockImplementation((col: string, value: unknown) => { if (col === 'invitation_id') released.push(value); return q; });
      return q;
    }
    throw new Error(`unexpected table ${table}`);
  });
  api.rpc.mockImplementation(async (name: string) =>
    name === 'claim_invite_email' ? { data: claim, error: null } : { data: null, error: { message: 'unexpected rpc' } });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
  handler = await load();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

const claimCall = () => api.rpc.mock.calls.find(c => c[0] === 'claim_invite_email');
const sent = () => fetchMock.mock.calls.map(c => JSON.parse(String((c[1] as RequestInit).body)));

describe('household invitation email (#9)', () => {
  it('INV-E-001 · every value is escaped and the subject cannot fold', () => {
    const mail = householdInviteEmail({
      inviterName: 'Vyact Security\r\nBcc: victim@example.com', inviterEmail: 'asha@example.com',
      household: '<img src=x onerror=alert(1)>', roleLabel: '<b>Admin</b>',
      inviteUrl: 'https://vyact.app/invite/ab%2Bc', expiresOn: '2026-10-27',
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).not.toMatch(/<img|<b>Admin/);
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(mail.html).toContain('href="https://vyact.app/invite/ab%2Bc"');
    expect(mail.text).toContain('Accept the invitation: https://vyact.app/invite/ab%2Bc');
    expect(mail.text).toContain('The invitation expires on 2026-10-27.');
  });

  it('INV-E-002 · authorised before any work: signed out, bad id, unknown, not an owner or admin, no address, closed, own email', async () => {
    const cases: Array<[() => void, unknown, number, string]> = [
      [() => api.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'jwt' } }), { invitationId: INV_ID }, 401, 'unauthorized'],
      [() => {}, { invitationId: 'not-a-uuid' }, 400, 'bad_request'],
      [() => { invitation = null; }, { invitationId: INV_ID }, 404, 'invitation_not_found'],
      [() => { myRole = 'member'; }, { invitationId: INV_ID }, 403, 'forbidden'],
      [() => { myRole = null; }, { invitationId: INV_ID }, 403, 'forbidden'],
      [() => { invitation!.recipient_email = null; }, { invitationId: INV_ID }, 409, 'no_recipient'],
      [() => { invitation!.accepted_at = '2026-10-10T10:00:00Z'; }, { invitationId: INV_ID }, 409, 'invitation_closed'],
      [() => { invitation!.expires_at = '2026-01-01T00:00:00Z'; }, { invitationId: INV_ID }, 409, 'invitation_closed'],
      [() => { invitation!.recipient_email = 'asha@example.com'; }, { invitationId: INV_ID }, 409, 'own_email'],
    ];
    for (const [arrange, body, status, error] of cases) {
      const saved = { ...invitation! };
      arrange();
      const res = await post(handler, body);
      expect([res.status, (await res.json()).error], error).toEqual([status, error]);
      invitation = saved; myRole = 'owner';
    }
    expect(claimCall()).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('INV-E-003 · with no email provider set it sends nothing and claims nothing', async () => {
    vi.resetModules();
    handler = await load({});
    vi.stubGlobal('fetch', fetchMock);
    expect(await (await post(handler, { invitationId: INV_ID })).json()).toEqual({ ok: false, reason: 'email_not_configured' });
    expect(claimCall()).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('INV-E-004 · a claimed invitation is emailed once, to its stored address, with its own link', async () => {
    expect(await (await post(handler, { invitationId: INV_ID })).json()).toEqual({ ok: true });
    expect(claimCall()?.[1]).toEqual({ p_sender: 'owner', p_invitation: INV_ID, p_daily_cap: 20 });
    const [mail] = sent();
    expect(sent()).toHaveLength(1);
    expect(mail.to).toBe('sam@example.com');
    expect(mail.subject).toBe('Asha invited you to "Sharma family" on Vyact');
    expect(mail.text).toContain('Asha (asha@example.com) invited you to share their household');
    expect(mail.text).toContain('they\'ve given you Member access');
    expect(mail.text).toContain(`https://vyact.app/invite/${encodeURIComponent('ab+c/d=')}`);
  });

  it('INV-E-005 · already sent or over the cap sends nothing; a failed delivery gives its claim back', async () => {
    for (const c of ['already_sent', 'daily_limit']) {
      claim = c;
      expect(await (await post(handler, { invitationId: INV_ID })).json()).toEqual({ ok: false, reason: c });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    claim = 'claimed';
    fetchMock.mockResolvedValue(new Response('{"name":"rate_limited"}', { status: 429 }));
    expect(await (await post(handler, { invitationId: INV_ID })).json()).toEqual({ ok: false, reason: 'send_failed' });
    expect(released).toEqual([INV_ID]);
  });

  it('INV-E-006 · the cap setting: default 20, and a malformed value can never mean "no cap"', async () => {
    const { dailyCap, DEFAULT_DAILY_CAP } = await import('../../../../supabase/functions/send-invite-email/index');
    expect(DEFAULT_DAILY_CAP).toBe(20);
    for (const raw of ['', 'unlimited', '-1', '1e9', ' ']) expect(dailyCap(raw), raw).toBe(20);
    expect(dailyCap(' 5 ')).toBe(5);
  });
});
