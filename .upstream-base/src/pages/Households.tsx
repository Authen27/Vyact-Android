// Vyact v4.1 — Households management page
//
// Lists every household the signed-in user belongs to. Click one to view
// members + pending invitations + activity log. Owners/admins can invite,
// remove, change roles. Anyone can leave (except sole owner).

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Users as UsersIcon, Mail, Trash2, LogOut, Shield, Activity, Copy, Check, Link as LinkIcon } from 'lucide-react';
import { useStore } from '../store';
import { Card, Panel } from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import HalfSheet from '../components/ui/HalfSheet';
import { Input, Select, Field, FieldRow } from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Chip from '../components/ui/Chip';
import { PROFILE_TYPES, CURRENCIES, deterministicColor } from '../constants';
import { HOUSEHOLD_TYPE_ORDER, normalizeHouseholdType, typeFits, inviteBlockedReason, householdLimitMessage, nextHouseholdAfterExit } from '../lib/householdTypes';
import {
  createInviteLink, listInvitations, revokeInvitation, INVITE_LABEL_SENTINEL,
  changeMemberRole, removeMembership, leaveHousehold, listActivity,
} from '../lib/auth';
import { track } from '../lib/analytics';
import { sb } from '../lib/supabase';
import { can, roleLabel, type Action } from '../lib/permissions';
import type { ProfileTypeKey, AppRole } from '../types';
import ActivityRow from '../components/households/ActivityRow';
import {
  formatActivity, ACTIVITY_TYPE_FILTERS, type ActivityRow as ActivityRowData,
} from '../lib/activityFormat';
import PageHead from '../components/ui/PageHead';
import { confirmSheet } from '../lib/confirmSheet';
import { deleteHouseholdRequest, leaveHouseholdRequest, removeMemberRequest, revokeInvitationRequest } from '../lib/confirmCopy';
import { checkInviteEmail, inviteEmailNotice, invitationWho, sendInviteEmail } from '../lib/invitations';

interface Membership {
  id: string;
  user_id: string | null;
  display_name: string;
  household_role: string | null;
  role: AppRole;
  joined_at: string;
}
interface Invitation {
  id: string;
  /** The label the inviter typed, or the "(shareable link)" sentinel (a legacy column name). */
  invited_email: string;
  /** v10.95.0 (#9) — the invitee's address, when the invitation is addressed to a person. */
  recipient_email?: string | null;
  role: AppRole;
  token: string;
  expires_at: string;
  created_at: string;
}
// v7.0.2 — concrete activity rendering uses the full payload from
// `activity_log` (`entity_id` + `changes`) so we can resolve human-friendly
// summaries and column-level diffs. The structural type matches what the
// `log_domain_activity()` trigger writes.
type ActivityEntry = ActivityRowData;

// Board E · M1/D1 — same avatar-initials fallback used by the household-switch
// pull-down (components/layout/HouseholdSheet.tsx), kept local since it's a
// two-line string helper not worth sharing a module for.
const initials = (name: string) =>
  name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'H';

// Board E · M1 — .role pill: owner solid accent, admin denim-tint, everyone
// else a neu-inset neutral chip. Read-only display only — an editable role
// keeps the native <Select> below it (a real dropdown beats a fake chip).
function RoleChip({ role }: { role: AppRole }) {
  const style = role === 'owner'
    ? { background: 'var(--accent)', color: 'var(--accent-ink)' }
    : role === 'admin'
    ? { background: 'color-mix(in srgb, hsl(var(--denim)) 16%, transparent)', color: 'var(--info-text)' }
    : { background: 'var(--sunken)', boxShadow: 'var(--neu-inset)' };
  return (
    <span
      className={`text-[12px] font-medium px-2.5 py-1 rounded-pill flex-shrink-0 whitespace-nowrap ${role === 'owner' || role === 'admin' ? '' : 'text-ink-mid'}`}
      style={style}
    >
      {roleLabel(role)}
    </span>
  );
}

export default function Households() {
  const cloudEnabled = useStore(s => s.cloudEnabled);
  const session = useStore(s => s.session);
  const households = useStore(s => s.households);
  const currentHouseholdId = useStore(s => s.currentHouseholdId);
  const refreshHouseholds = useStore(s => s.refreshHouseholds);
  const switchHousehold = useStore(s => s.switchHousehold);
  const createHousehold = useStore(s => s.createHousehold);
  const deleteHousehold = useStore(s => s.deleteHousehold);
  const renameHousehold = useStore(s => s.renameHousehold);
  const updateProfile = useStore(s => s.updateProfile);
  const myRole = useStore(s => s.myRole);
  const toast = useStore(s => s.toast);

  // W7a (audit INT-HH-13): leaving the household that is open moves the app to one the person is
  // still in (it used to stay on the old one, whose reads now fail). Both Leave buttons use this.
  async function leaveActive(h: { id: string; name: string }) {
    if (!(await confirmSheet(leaveHouseholdRequest({ household: h.name })))) return;
    try {
      await leaveHousehold(h.id);
      await refreshHouseholds();
      const next = nextHouseholdAfterExit(useStore.getState().households, h.id);
      if (h.id === currentHouseholdId && next) await switchHousehold(next);
      toast(`Left ${h.name}`, 'info');
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  // v10.49.0 (#32) — the "Invite your partner" prompt after the first entry lands here.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('invite') !== '1') return;
    if (can(myRole, 'invite_member')) setInviteOpen(true);
    const rest = new URLSearchParams(searchParams);
    rest.delete('invite');
    setSearchParams(rest, { replace: true });
  }, [searchParams, setSearchParams, myRole]);

  const [members, setMembers] = useState<Membership[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [activityType, setActivityType] = useState<string>('all');
  const [activityActor, setActivityActor] = useState<string>('all');

  // v7.0.2 — store entities feed `formatActivity` so amount/category/name
  // diffs render with the same currency formatting used elsewhere.
  const transactions = useStore(s => s.transactions);
  const budgets = useStore(s => s.budgets);
  const goals = useStore(s => s.goals);
  const debts = useStore(s => s.debts);
  const assets = useStore(s => s.assets);
  const householdMembers = useStore(s => s.members);
  const profile = useStore(s => s.profile);

  const active = households.find(h => h.id === currentHouseholdId);

  useEffect(() => {
    if (!cloudEnabled || !session || !active) return;
    void loadHouseholdDetails(active.id);
  }, [cloudEnabled, session, active]);

  async function loadHouseholdDetails(hid: string) {
    setLoading(true);
    try {
      const [m, i, a] = await Promise.all([
        sb().from('memberships').select('*').eq('household_id', hid).order('joined_at')
          .then(r => (r.data || []) as Membership[]),
        listInvitations(hid).catch(() => []) as Promise<Invitation[]>,
        listActivity(hid, 100).catch(() => []) as Promise<ActivityEntry[]>,
      ]);
      setMembers(m); setInvites(i); setActivity(a);
    } finally {
      setLoading(false);
    }
  }

  // Local-only mode banner
  if (!cloudEnabled) {
    return (
      <div className="ui-pilot">
        <PageHead title="Households" subtitle="Local-only mode — set Supabase env vars to enable cloud" />

        {/* Basic household identity (name/type) still lives on this device even
            without cloud — it just isn't shared with other members/devices. */}
        {active && (
          <Panel title="Household Settings" sub={active.name}>
            <div className="p-5 grid sm:grid-cols-2 gap-4">
              <HouseholdNameField name={active.name}
                onSave={async next => { await renameHousehold(active.id, next); toast('Renamed', 'success'); }} />
              <div>
                <label htmlFor="households-type" className="mono-label mb-1.5 block">Household Type</label>
                <Select id="households-type" value={normalizeHouseholdType(active.type)}
                  onChange={e => updateProfile({ household: e.target.value as ProfileTypeKey })}>
                  {HOUSEHOLD_TYPE_ORDER.map(k => (
                    <option key={k} value={k}>{PROFILE_TYPES[k].icon} {PROFILE_TYPES[k].label} — {PROFILE_TYPES[k].desc}</option>
                  ))}
                </Select>
                <p className="text-[0.78rem] text-ink-mid mt-1.5">{PROFILE_TYPES[normalizeHouseholdType(active.type)].detail}</p>
              </div>
            </div>
          </Panel>
        )}

        <Panel>
          <div className="p-6 max-w-prose">
            <p className="text-ink-mid leading-relaxed mb-3">
              Multi-user households require cloud sync. To enable:
            </p>
            <ol className="text-ink-mid leading-relaxed list-decimal pl-5 space-y-1 mb-3">
              <li>Create a Supabase project at supabase.com</li>
              <li>Run <code className="font-mono text-coral bg-bg3 px-1.5 rounded">db/schema.sql</code> in the SQL Editor</li>
              <li>Copy your project URL + anon key into <code className="font-mono text-coral bg-bg3 px-1.5 rounded">react/.env.local</code></li>
              <li>Restart the dev server</li>
            </ol>
            <p className="text-ink-mid leading-relaxed">
              See <code className="font-mono text-coral bg-bg3 px-1.5 rounded">ARCHITECTURE.md</code> for the full design.
            </p>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="ui-pilot">
      {/* HH4 — on phones the header + creates a household (the page button is desktop-only). */}
      <PageHead
        title="Households"
        subtitle={<>{households.length} household{households.length === 1 ? '' : 's'} · signed in as {session?.user?.email}</>}
        action={{ label: 'Create Household', icon: true, entity: 'household', onClick: () => setCreateOpen(true) }}
      />

      {/* Household cards — board E · .hh-card: same neu treatment + member
          avatar stack as the household-switch pull-down (HouseholdSheet.tsx);
          only the active card has a roster to show, others fall back to
          their initials. */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {households.map(h => {
          const meta = PROFILE_TYPES[normalizeHouseholdType(h.type)];
          const isActive = h.id === currentHouseholdId;
          // `members` (below) is the cloud Membership[] rows for the active
          // household; the avatar stack wants the entity-level Member[] (has
          // .name), same source HouseholdSheet.tsx uses for its own stack.
          const stack = isActive ? householdMembers.slice(0, 3) : [];
          return (
            <button key={h.id} onClick={() => switchHousehold(h.id)}
              className="text-left rounded-r3 p-5 transition-transform hover:-translate-y-0.5"
              style={{
                background: 'var(--canvas)',
                boxShadow: isActive
                  ? 'var(--neu), 0 0 0 2px var(--accent), 0 0 24px color-mix(in srgb, var(--accent) 30%, transparent)'
                  : 'var(--neu)',
              }}>
              <div className="flex items-start justify-between mb-3">
                {stack.length > 0 ? (
                  <span className="flex" aria-hidden>
                    {stack.map((m, i) => (
                      <span key={m.id}
                        className="w-8 h-8 rounded-full flex items-center justify-center font-display font-bold text-[11px]"
                        style={{
                          background: i === 0 ? 'var(--coral-grad)' : deterministicColor(m.name || m.id),
                          marginLeft: i === 0 ? 0 : -8,
                          boxShadow: '0 0 0 2px var(--canvas)',
                          color: i === 0 ? 'var(--accent-ink)' : '#fff',
                        }}>
                        {initials(m.name || '?')}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-2xl" aria-hidden>{meta.icon}</span>
                )}
                {isActive
                  ? <span className="mono-label px-2 py-0.5 rounded-pill flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent-text)' }}>✓ current</span>
                  : null}
              </div>
              <div className="font-semibold text-ink mb-0.5">{h.name}</div>
              <div className="text-[12px] text-ink-dim mb-3">
                {meta.label} · {h.baseCurrency}
              </div>
              <div className="text-[12px] text-ink-dim">
                Created {new Date(h.createdAt).toLocaleDateString()}
              </div>
            </button>
          );
        })}
      </div>

      {/* Active household details */}
      {active && (
        <>
          <div className="display-italic text-2xl text-ink mb-3">
            {active.name} · Members &amp; Activity
          </div>
          <div className="grid lg:grid-cols-2 gap-3.5 mb-3.5">
            <Panel
              title={`Members (${members.length})`}
              action={can(myRole, 'invite_member')
                ? <button onClick={() => {
                      // v10.59.0 — Personal is private and Couple has room for one; say so up front.
                      const blocked = inviteBlockedReason(active.type, members.length, invites.length);
                      if (blocked) toast(blocked, 'info'); else setInviteOpen(true);
                    }}
                    className="text-[13px] font-medium text-coral hover:opacity-70 flex items-center gap-1 min-h-[44px] px-1">
                    <Plus size={14} /> Invite
                  </button>
                : null}
            >
              {loading
                ? <div className="text-center py-6 mono-label">Loading…</div>
                : members.length === 0
                  ? <EmptyState icon={<UsersIcon size={32} />} message="No members" />
                  : <MembersList
                      members={members} myRole={myRole}
                      currentUserId={session!.user.id}
                      onChanged={() => active && loadHouseholdDetails(active.id)}
                      onLeave={() => leaveActive(active)}
                    />
              }
            </Panel>

            <Panel
              title={`Pending Invitations (${invites.length})`}
              sub={can(myRole, 'invite_member') ? '' : 'view-only'}
            >
              {invites.length === 0
                ? <EmptyState icon={<Mail size={32} />} message="No pending invitations" />
                : <InvitesList invites={invites} canRevoke={can(myRole, 'invite_member')}
                    onRevoked={() => active && loadHouseholdDetails(active.id)} />
              }
            </Panel>
          </div>

          {can(myRole, 'view_activity_log') && (
            <ActivityPanel
              activity={activity}
              activityType={activityType}
              activityActor={activityActor}
              setActivityType={setActivityType}
              setActivityActor={setActivityActor}
              memberships={members}
              ctx={{
                transactions, budgets, goals, debts, assets,
                members: householdMembers,
                baseCurrency: profile.baseCurrency,
              }}
            />
          )}

          {/* Household settings — type lives on the household record itself, not
              the user's profile, so it's edited here rather than in Settings. */}
          <div className="mt-3.5">
            <Panel title="Household Settings">
              <div className="p-4 max-w-md space-y-4">
                <HouseholdNameField name={active.name} disabled={!can(myRole, 'edit_household_settings')}
                  onSave={async next => {
                    try { await renameHousehold(active.id, next); toast('Renamed', 'success'); }
                    catch (e) { toast((e as Error).message, 'error'); throw e; }
                  }} />
                <div>
                <label htmlFor="households-type" className="mono-label mb-1.5 block">Household Type</label>
                <Select id="households-type" value={normalizeHouseholdType(active.type)}
                  disabled={!can(myRole, 'edit_household_settings')}
                  onChange={async e => {
                    const next = e.target.value as ProfileTypeKey;
                    if (!typeFits(next, members.length)) {
                      toast(`This household has ${members.length} members — more than a ${PROFILE_TYPES[next].label} household allows.`, 'error');
                      return;
                    }
                    try { await updateProfile({ household: next }); }
                    catch (err) { toast(householdLimitMessage(err) ?? (err as Error).message, 'error'); }
                  }}>
                  {HOUSEHOLD_TYPE_ORDER.map(k => (
                    <option key={k} value={k} disabled={!typeFits(k, members.length)}>
                      {PROFILE_TYPES[k].icon} {PROFILE_TYPES[k].label} — {PROFILE_TYPES[k].desc}
                    </option>
                  ))}
                </Select>
                <p className="text-[0.78rem] text-ink-mid mt-1.5">{PROFILE_TYPES[normalizeHouseholdType(active.type)].detail}</p>
                </div>
              </div>
            </Panel>
          </div>

          {/* Danger zone — only what cannot be undone easily: leave and delete (HH2). */}
          <div className="mt-6">
            <Panel title="Danger Zone">
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-semibold text-ink">Leave this household</div>
                    <div className="text-[0.78rem] text-ink-mid">Sole owner must transfer first.</div>
                  </div>
                  <Button variant="ghost" disabled={households.length <= 1}
                    onClick={() => leaveActive(active)}>
                    <LogOut size={14} /> Leave
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-semibold text-terra">Delete household</div>
                    <div className="text-[0.78rem] text-ink-mid">Permanent. All transactions/members/data gone.</div>
                  </div>
                  <Button variant="danger" disabled={!can(myRole, 'delete_household')}
                    onClick={async () => {
                      if (!(await confirmSheet(deleteHouseholdRequest({ household: active.name })))) return;
                      try {
                        await deleteHousehold(active.id);
                        toast(`Deleted ${active.name}`, 'warning');
                      } catch (e) { toast((e as Error).message, 'error'); }
                    }}>
                    <Trash2 size={14} /> Delete
                  </Button>
                </div>
              </div>
            </Panel>
          </div>
        </>
      )}

      <CreateHouseholdModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async (name, type, currency) => {
          try {
            await createHousehold(name, type, currency);
            toast(`Created ${name}`, 'success');
            setCreateOpen(false);
          } catch (e) {
            // HH-REG-001 — this previously had no catch, so any failure
            // (expired session, RLS denial, network blip) surfaced as
            // nothing at all: the modal just sat there with no feedback.
            // Re-throw so CreateHouseholdModal knows to keep the typed
            // values instead of clearing them like a successful submit.
            toast((e as Error).message, 'error');
            throw e;
          }
        }}
      />

      {active && (
        <InviteModal
          open={inviteOpen}
          householdName={active.name}
          householdId={active.id}
          onClose={() => setInviteOpen(false)}
          onSent={() => { setInviteOpen(false); if (active) loadHouseholdDetails(active.id); }}
        />
      )}
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────

function MembersList({
  members, myRole, currentUserId, onChanged, onLeave,
}: {
  members: Membership[]; myRole: AppRole | undefined;
  currentUserId: string;
  onChanged: () => void; onLeave: () => void;
}) {
  const ROLE_OPTIONS: AppRole[] = ['admin','member','viewer'];
  const toast = useStore(s => s.toast);
  const householdName = useStore(s => s.households.find(h => h.id === s.currentHouseholdId)?.name ?? 'this household');
  return (
    <div className="divide-y divide-line">
      {members.map(m => {
        const isMe = m.user_id === currentUserId;
        const canEditRole = can(myRole, 'change_member_role') && m.role !== 'owner' && !isMe;
        const canRemoveRow = can(myRole, 'remove_member') && m.role !== 'owner' && !isMe;
        return (
          <div key={m.id} className="px-4 py-3 flex flex-wrap items-start gap-3 sm:flex-nowrap sm:items-center">
            <div className="w-8 h-8 rounded-full bg-coral/15 text-coral font-mono text-xs font-bold flex items-center justify-center flex-shrink-0">
              {m.display_name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[0.86rem] font-semibold text-ink truncate flex items-center gap-2">
                {m.display_name}
                {isMe && <Badge tone="info">YOU</Badge>}
              </div>
              <div className="text-[12px] text-ink-dim mt-0.5">
                {m.household_role || '—'} · joined {new Date(m.joined_at).toLocaleDateString()}
              </div>
            </div>
            <div className="ml-auto flex w-full items-center justify-end gap-2 sm:w-auto sm:flex-shrink-0">
              {canEditRole ? (
                <Select value={m.role} className="w-full min-w-0 sm:w-[120px]" aria-label={`Role for ${m.display_name}`}
                  onChange={async e => {
                    try { await changeMemberRole(m.id, e.target.value); onChanged(); toast('Role updated', 'success'); }
                    catch (err) { toast((err as Error).message, 'error'); }
                  }}>
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </Select>
              ) : (
                <RoleChip role={m.role} />
              )}
              {isMe ? (
                <button onClick={onLeave} className="p-1.5 text-ink-mid hover:text-terra" title="Leave">
                  <LogOut size={14} />
                </button>
              ) : canRemoveRow ? (
                <button onClick={async () => {
                  if (!(await confirmSheet(removeMemberRequest({ name: m.display_name || 'this member', household: householdName })))) return;
                  try { await removeMembership(m.id); onChanged(); toast('Removed', 'info'); }
                  catch (err) { toast((err as Error).message, 'error'); }
                }} className="p-1.5 text-ink-mid hover:text-terra" title="Remove">
                  <Trash2 size={14} />
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InvitesList({ invites, canRevoke, onRevoked }: {
  invites: Invitation[]; canRevoke: boolean; onRevoked: () => void;
}) {
  const toast = useStore(s => s.toast);
  const refreshInvitations = useStore(s => s.refreshInvitations);
  const [copied, setCopied] = useState<string | null>(null);
  // v10.95.0 (#9, owner decision 13 Oct 2026; closes R4) — Revoke asks, then revokes at once. It used to
  // hide the row and write the revoke after an 8-second Undo, so a tab closed inside that window left a
  // live link behind a screen that said "revoked".
  async function revoke(inv: Invitation) {
    if (!(await confirmSheet(revokeInvitationRequest({ who: invitationWho({ recipientEmail: inv.recipient_email, label: inv.invited_email }) })))) return;
    try {
      const revoked = await revokeInvitation(inv.id);
      toast(revoked ? 'Invitation revoked' : 'Already handled', revoked ? 'success' : 'info');
      onRevoked();
      void refreshInvitations();
    } catch (err) { toast((err as Error).message, 'error'); }
  }
  return (
    <div className="divide-y divide-line">
      {invites.map(inv => {
        const url = `${window.location.origin}/invite/${encodeURIComponent(inv.token)}`;
        const expiry = new Date(inv.expires_at);
        const expired = expiry < new Date();
        const isLinkOnly = inv.invited_email === INVITE_LABEL_SENTINEL;
        const displayLabel = inv.recipient_email || (isLinkOnly ? 'Shareable link' : inv.invited_email);
        const labelNote = inv.recipient_email && !isLinkOnly ? `${inv.invited_email} · ` : '';
        return (
          <div key={inv.id} className="px-4 py-3 flex flex-wrap items-start gap-3 sm:flex-nowrap sm:items-center">
            {isLinkOnly && !inv.recipient_email
              ? <LinkIcon size={14} className="text-coral flex-shrink-0" />
              : <Mail size={14} className="text-ink-dim flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="text-[0.86rem] font-semibold text-ink truncate">{displayLabel}</div>
              <div className="text-[12px] text-ink-dim mt-0.5">
                {labelNote}{roleLabel(inv.role)} · {expired ? 'expired' : `expires ${expiry.toLocaleDateString()}`}
              </div>
            </div>
            <div className="ml-auto flex w-full items-center justify-end gap-2 sm:w-auto sm:flex-shrink-0">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(url);
                  setCopied(inv.id);
                  setTimeout(() => setCopied(null), 1800);
                  toast('Link copied', 'success');
                }}
                className="p-1.5 text-ink-mid hover:text-coral" title="Copy link"
              >
                {copied === inv.id ? <Check size={14} className="text-sage" /> : <Copy size={14} />}
              </button>
              {canRevoke && (
                <button onClick={() => { void revoke(inv); }} className="p-1.5 text-ink-mid hover:text-terra" title="Revoke" aria-label="Revoke invitation">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CreateHouseholdModal({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void;
  onCreated: (name: string, type: ProfileTypeKey, currency: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ProfileTypeKey>('family');
  const [currency, setCurrency] = useState('USD');
  const [submitting, setSubmitting] = useState(false);

  return (
    <Modal open={open} onClose={onClose} title="Create Household">
      <form onSubmit={async e => {
        e.preventDefault(); if (!name.trim()) return;
        setSubmitting(true);
        try {
          await onCreated(name.trim(), type, currency);
          setName('');
        } catch {
          // Already toasted by onCreated — keep the typed name/type/currency
          // so a transient failure doesn't force retyping.
        } finally { setSubmitting(false); }
      }}>
        <Field label="Name"><Input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Smith Family · Acme Consulting · …" required /></Field>
        <Field label="Type">
          <Select value={type} onChange={e => setType(e.target.value as ProfileTypeKey)}>
            {HOUSEHOLD_TYPE_ORDER.map(k => <option key={k} value={k}>{PROFILE_TYPES[k].icon} {PROFILE_TYPES[k].label} — {PROFILE_TYPES[k].desc}</option>)}
          </Select>
          <p className="text-[0.78rem] text-ink-mid mt-1.5">{PROFILE_TYPES[type].detail}</p>
        </Field>
        <Field label="Base currency">
          <Select value={currency} onChange={e => setCurrency(e.target.value)}>
            {Object.entries(CURRENCIES).map(([code, c]) => <option key={code} value={code}>{c.symbol} {code} — {c.name}</option>)}
          </Select>
        </Field>
        <div className="flex gap-2 mt-5 pt-4 border-t border-line">
          <Button variant="ghost" onClick={onClose} full>Cancel</Button>
          <Button type="submit" disabled={submitting || !name.trim()} full>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function InviteModal({ open, householdId, householdName, onClose, onSent }: {
  open: boolean; householdId: string; householdName: string;
  onClose: () => void; onSent: () => void;
}) {
  const [label, setLabel] = useState('');
  // v10.95.0 (#9; owner decision 13 Oct 2026) — optional: the invitee's address. Vyact emails the
  // invitation, and they find it in their bell once signed in with it. Empty = a link-only invitation.
  const [email, setEmail] = useState('');
  const [emailedTo, setEmailedTo] = useState<string | null>(null);
  const [role, setRole] = useState<'admin'|'member'|'viewer'>('member');
  const [householdRole, setHouseholdRole] = useState('partner');
  const [submitting, setSubmitting] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const toast = useStore(s => s.toast);
  const myEmail = useStore(s => s.session?.user?.email);
  const refreshInvitations = useStore(s => s.refreshInvitations);

  function reset() {
    setLink(null); setLabel(''); setEmail(''); setEmailedTo(null); setRole('member');
    setHouseholdRole('partner'); setCopied(false);
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      toast('Link copied', 'success');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast('Copy failed — select and copy manually', 'error');
    }
  }

  async function shareLink(url: string) {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${householdName} on Vyact`,
          text: `You're invited to join ${householdName} on Vyact.`,
          url,
        });
      } catch { /* user cancelled */ }
    } else {
      void copyLink(url);
    }
  }

  return (
    <HalfSheet open={open} onClose={() => { reset(); onClose(); }} title={`Invite to ${householdName}`}>
      {link ? (
        <div>
          <div className="text-center mb-4">
            <div className="mx-auto mb-3 h-14 w-14 rounded-full bg-coral/15 text-coral flex items-center justify-center">
              <LinkIcon size={26} />
            </div>
            <p className="text-ink mb-1 font-semibold">{emailedTo ? 'Invitation sent' : 'Invite link ready'}</p>
            <p className="text-ink-mid text-[0.84rem]">
              {emailedTo
                ? <>We emailed it to <strong>{emailedTo}</strong>. They'll also find it in their notifications when they sign in with that address. </>
                : 'Share it however you like — message, email, in person. '}
              Anyone with the link can join as <strong>{roleLabel(role)}</strong>.
            </p>
          </div>

          <div className="well p-3 font-mono text-[0.74rem] text-coral break-all mb-3 select-all">
            {link}
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <Button variant="ghost" full onClick={() => copyLink(link)}>
              {copied ? <><Check size={14} className="text-sage" /> Copied</> : <><Copy size={14} /> Copy link</>}
            </Button>
            <Button full onClick={() => shareLink(link)}>
              <LinkIcon size={14} /> Share…
            </Button>
          </div>

          <div className="rounded-md bg-honey/10 border border-honey/30 px-3 py-2 text-[0.78rem] text-ink-mid">
            <strong className="text-ink">Heads up:</strong> the link is a bearer secret —
            anyone who has it can join the household. Revoke it from the Pending Invitations
            list if you change your mind. Links expire in 14 days.
          </div>

          <div className="flex gap-2 mt-5 pt-4 border-t border-line">
            <Button variant="ghost" onClick={() => { reset(); onClose(); }} full>Done</Button>
            <Button variant="ghost" onClick={reset} full>Create another</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={async e => {
          e.preventDefault();
          const check = checkInviteEmail(email, myEmail);
          if (!check.ok) {
            toast(check.reason === 'own'
              ? "That's your own email. Enter the address of the person you're inviting."
              : 'Enter a valid email address, or leave it empty to share a link.', 'error');
            return;
          }
          setSubmitting(true);
          try {
            const inv = await createInviteLink(householdId, role, householdRole, label.trim() || undefined, check.email);
            track('member_invited', { invite_role: role });
            const url = `${window.location.origin}/invite/${encodeURIComponent((inv as { token: string }).token)}`;
            setLink(url);
            void copyLink(url);
            onSent();
            void refreshInvitations();
            if (check.email) {
              // The invitation is saved either way; the email is on top of it, and its outcome is said.
              const result = await sendInviteEmail((inv as { id: string }).id);
              const notice = inviteEmailNotice(result, check.email);
              toast(notice.message, notice.tone);
              if (result.ok) setEmailedTo(check.email);
            }
          } catch (err) {
            toast(householdLimitMessage(err) ?? (err as Error).message, 'error');
          } finally { setSubmitting(false); }
        }}>
          <p className="text-ink-mid text-[0.84rem] mb-4">
            Add their email and Vyact emails them the invitation; they'll also find it in their notifications when
            they sign in with that address. Or leave it empty and share the link yourself.
          </p>

          <Field label="Their email" hint="optional">
            <Input
              autoFocus type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false}
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="name@example.com"
              maxLength={254}
            />
          </Field>

          <Field label="Label" hint="optional, for your reference">
            <Input
              value={label} onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Partner, Mom, Accountant"
              maxLength={80}
            />
          </Field>

          <FieldRow>
            <Field label="App role">
              <Select value={role} onChange={e => setRole(e.target.value as typeof role)}>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer (read-only)</option>
              </Select>
            </Field>
            <Field label="Household role">
              <Select value={householdRole} onChange={e => setHouseholdRole(e.target.value)}>
                <option value="primary">Primary</option>
                <option value="partner">Partner</option>
                <option value="child">Child</option>
                <option value="elder">Elder</option>
              </Select>
            </Field>
          </FieldRow>

          <div className="flex gap-2 mt-5 pt-4 border-t border-line">
            <Button variant="ghost" onClick={onClose} full>Cancel</Button>
            <Button type="submit" disabled={submitting} full>
              {submitting ? 'Creating…' : email.trim() ? <><Mail size={14} /> Send invitation</> : <><LinkIcon size={14} /> Create invite link</>}
            </Button>
          </div>
        </form>
      )}
    </HalfSheet>
  );
}

void Shield;
void Card;

// ── Activity panel ─────────────────────────────────────────────
// v7.0.2 — replaces the old "<action> on <entity_type>" line. Each row
// resolves to actor + verb + concrete subject (with money formatting) and,
// on UPDATEs, an inline column-level diff. Type and member filters narrow
// the feed; "Show all entries" reveals the rest beyond the first 25.

interface ActivityPanelProps {
  activity: ActivityEntry[];
  activityType: string;
  activityActor: string;
  setActivityType: (v: string) => void;
  setActivityActor: (v: string) => void;
  memberships: Membership[];
  ctx: Parameters<typeof formatActivity>[1];
}

function ActivityPanel({
  activity, activityType, activityActor,
  setActivityType, setActivityActor, memberships, ctx,
}: ActivityPanelProps) {
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);

  // Build an actor lookup ({ userId: name }) from the Membership rows so the
  // formatter can resolve actor_id → display_name without an extra fetch.
  const memberLookup = useMemo(
    () => memberships
      .filter(m => m.user_id)
      .map(m => ({ userId: m.user_id, name: m.display_name })),
    [memberships],
  );
  const ctxWithMembers = useMemo(
    () => ({ ...ctx, members: memberLookup }),
    [ctx, memberLookup],
  );

  const filtered = useMemo(() => {
    const typeBucket = ACTIVITY_TYPE_FILTERS.find(f => f.value === activityType);
    return activity.filter(row => {
      if (typeBucket && typeBucket.entities.length > 0
          && !typeBucket.entities.includes(row.entity_type)) return false;
      if (activityActor !== 'all' && row.actor_id !== activityActor) return false;
      return true;
    });
  }, [activity, activityType, activityActor]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [activityType, activityActor]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Panel
      title="Recent Activity"
      sub={`${filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filtered.length)} of ${filtered.length} entries`}
    >
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Activity type">
          {ACTIVITY_TYPE_FILTERS.map(f => (
            <Chip key={f.value} on={activityType === f.value} onClick={() => setActivityType(f.value)}>
              {f.label}
            </Chip>
          ))}
        </div>
        {memberships.length > 1 && (
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="activity-actor" className="ui-label">
              Member
            </label>
            <Select
              id="activity-actor"
              value={activityActor}
              className="w-auto min-w-[140px]"
              onChange={e => setActivityActor(e.target.value)}
            >
              <option value="all">Everyone</option>
              {memberships.filter(m => m.user_id).map(m => (
                <option key={m.id} value={m.user_id as string}>{m.display_name}</option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={<Activity size={32} />} message={
          activity.length === 0 ? 'No activity yet' : 'No matches for the current filter'
        } />
      ) : (
        <>
          <div className="divide-y divide-line">
            {visible.map(row => (
              <ActivityRow
                key={row.id}
                createdAt={row.created_at}
                formatted={formatActivity(row, ctxWithMembers)}
              />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-line">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="text-[13px] font-medium text-coral hover:bg-bg3 px-3 min-h-[44px] rounded-r2 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>
              <span className="text-[12px] text-ink-dim">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="text-[13px] font-medium text-coral hover:bg-bg3 px-3 min-h-[44px] rounded-r2 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/** Aurora 4.0 HH2 — the household's name is a field in Household settings (it sat as "Rename" next to
 *  Leave and Delete). Save is offered only when the name changed; nothing is asked first. */
function HouseholdNameField({ name, disabled = false, onSave }: {
  name: string; disabled?: boolean; onSave: (next: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(name); }, [name]);
  const next = draft.trim();
  const changed = next.length > 0 && next !== name;
  async function save() {
    if (!changed) return;
    setBusy(true);
    try { await onSave(next); } catch { setDraft(name); } finally { setBusy(false); }
  }
  return (
    <div>
      <label htmlFor="household-name" className="mono-label mb-1.5 block">Household name</label>
      <div className="flex gap-2">
        <Input id="household-name" value={draft} maxLength={80} disabled={disabled} className="flex-1"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }} />
        <Button variant="ghost" disabled={disabled || !changed || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <p className="text-[12px] text-ink-dim mt-1.5">Visible to all members.</p>
    </div>
  );
}
