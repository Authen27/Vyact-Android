// Vyact v4.1 — Households management page
//
// Lists every household the signed-in user belongs to. Click one to view
// members + pending invitations + activity log. Owners/admins can invite,
// remove, change roles. Anyone can leave (except sole owner).

import { useEffect, useMemo, useState } from 'react';
import { Plus, Users as UsersIcon, Mail, Trash2, LogOut, Shield, Activity, Copy, Check, Link as LinkIcon } from 'lucide-react';
import { useStore } from '../store';
import { Card, Panel } from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { Input, Select, Field, FieldRow } from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import { PROFILE_TYPES, CURRENCIES } from '../constants';
import {
  createInviteLink, listInvitations, revokeInvitation, INVITE_LABEL_SENTINEL,
  changeMemberRole, removeMembership, leaveHousehold, listActivity,
} from '../lib/auth';
import { sb } from '../lib/supabase';
import { can, roleLabel, type Action } from '../lib/permissions';
import type { ProfileTypeKey, AppRole } from '../types';
import ActivityRow from '../components/households/ActivityRow';
import {
  formatActivity, ACTIVITY_TYPE_FILTERS, type ActivityRow as ActivityRowData,
} from '../lib/activityFormat';

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
  invited_email: string;
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
  const myRole = useStore(s => s.myRole);
  const toast = useStore(s => s.toast);

  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

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
      <div>
        <h1 className="display-italic text-4xl text-ink mb-1.5">Households</h1>
        <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim mb-6">
          Local-only mode — set Supabase env vars to enable cloud
        </p>
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
    <div>
      <div className="flex justify-between items-start mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="display-italic text-4xl text-ink mb-1.5">Households</h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            {households.length} household{households.length === 1 ? '' : 's'} · signed in as {session?.user?.email}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={14} /> Create Household
        </Button>
      </div>

      {/* Household cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {households.map(h => {
          const meta = PROFILE_TYPES[h.type as ProfileTypeKey] || PROFILE_TYPES.family;
          const isActive = h.id === currentHouseholdId;
          return (
            <div key={h.id} className={`panel p-5 cursor-pointer transition-all ${isActive ? 'border-coral ring-1 ring-coral/30' : 'hover:border-line2'}`}
              onClick={() => switchHousehold(h.id)}>
              <div className="flex items-start justify-between mb-3">
                <span className="text-2xl">{meta.icon}</span>
                {isActive && <Badge tone="alert">ACTIVE</Badge>}
              </div>
              <div className="font-semibold text-ink mb-0.5">{h.name}</div>
              <div className="font-mono text-[0.6rem] tracking-wider uppercase text-ink-dim mb-3">
                {meta.label} · {h.baseCurrency}
              </div>
              <div className="font-mono text-[0.62rem] text-ink-dim">
                Created {new Date(h.createdAt).toLocaleDateString()}
              </div>
            </div>
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
                ? <button onClick={() => setInviteOpen(true)} className="font-mono text-[0.6rem] tracking-wider uppercase text-coral hover:opacity-70 flex items-center gap-1">
                    <Plus size={12} /> Invite
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
                      onLeave={async () => {
                        if (!confirm(`Leave ${active.name}?`)) return;
                        try {
                          await leaveHousehold(active.id);
                          await refreshHouseholds();
                          toast(`Left ${active.name}`, 'info');
                        } catch (e) { toast((e as Error).message, 'error'); }
                      }}
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

          {/* Danger zone */}
          <div className="mt-6">
            <Panel title="Danger Zone">
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-semibold text-ink">Rename household</div>
                    <div className="text-[0.78rem] text-ink-mid">Visible to all members.</div>
                  </div>
                  <Button variant="ghost" disabled={!can(myRole, 'edit_household_settings')}
                    onClick={async () => {
                      const next = prompt('New name:', active.name);
                      if (!next || next === active.name) return;
                      try { await renameHousehold(active.id, next); toast('Renamed', 'success'); }
                      catch (e) { toast((e as Error).message, 'error'); }
                    }}>
                    Rename
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-semibold text-ink">Leave this household</div>
                    <div className="text-[0.78rem] text-ink-mid">Sole owner must transfer first.</div>
                  </div>
                  <Button variant="ghost" disabled={households.length <= 1}
                    onClick={async () => {
                      if (!confirm(`Leave ${active.name}?`)) return;
                      try {
                        await leaveHousehold(active.id);
                        await refreshHouseholds();
                        toast(`Left ${active.name}`, 'info');
                      } catch (e) { toast((e as Error).message, 'error'); }
                    }}>
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
                      if (!confirm(`Permanently delete ${active.name}? This cannot be undone.`)) return;
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
          await createHousehold(name, type, currency);
          toast(`Created ${name}`, 'success');
          setCreateOpen(false);
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
  const ROLE_OPTIONS: AppRole[] = ['admin','member','viewer','child'];
  const toast = useStore(s => s.toast);
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
              <div className="font-mono text-[0.62rem] text-ink-dim mt-0.5">
                {m.household_role || '—'} · joined {new Date(m.joined_at).toLocaleDateString()}
              </div>
            </div>
            <div className="ml-auto flex w-full items-center justify-end gap-2 sm:w-auto sm:flex-shrink-0">
              {canEditRole ? (
                <Select value={m.role} className="w-full min-w-0 sm:w-[120px]"
                  onChange={async e => {
                    try { await changeMemberRole(m.id, e.target.value); onChanged(); toast('Role updated', 'success'); }
                    catch (err) { toast((err as Error).message, 'error'); }
                  }}>
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </Select>
              ) : (
                <Badge tone={m.role === 'owner' ? 'alert' : m.role === 'admin' ? 'info' : 'neutral'}>
                  {roleLabel(m.role)}
                </Badge>
              )}
              {isMe ? (
                <button onClick={onLeave} className="p-1.5 text-ink-mid hover:text-terra" title="Leave">
                  <LogOut size={14} />
                </button>
              ) : canRemoveRow ? (
                <button onClick={async () => {
                  if (!confirm(`Remove ${m.display_name}?`)) return;
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
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="divide-y divide-line">
      {invites.map(inv => {
        const url = `${window.location.origin}/invite/${encodeURIComponent(inv.token)}`;
        const expiry = new Date(inv.expires_at);
        const expired = expiry < new Date();
        const isLinkOnly = inv.invited_email === INVITE_LABEL_SENTINEL;
        const displayLabel = isLinkOnly ? 'Shareable link' : inv.invited_email;
        return (
          <div key={inv.id} className="px-4 py-3 flex flex-wrap items-start gap-3 sm:flex-nowrap sm:items-center">
            {isLinkOnly
              ? <LinkIcon size={14} className="text-coral flex-shrink-0" />
              : <Mail size={14} className="text-ink-dim flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="text-[0.86rem] font-semibold text-ink truncate">{displayLabel}</div>
              <div className="font-mono text-[0.62rem] text-ink-dim mt-0.5">
                {roleLabel(inv.role)} · {expired ? 'expired' : `expires ${expiry.toLocaleDateString()}`}
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
                <button onClick={async () => {
                  if (!confirm('Revoke this invitation?')) return;
                  try { await revokeInvitation(inv.id); onRevoked(); toast('Revoked', 'info'); }
                  catch (err) { toast((err as Error).message, 'error'); }
                }} className="p-1.5 text-ink-mid hover:text-terra" title="Revoke">
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
        try { await onCreated(name.trim(), type, currency); }
        finally { setSubmitting(false); setName(''); }
      }}>
        <Field label="Name"><Input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Smith Family · Acme Consulting · …" required /></Field>
        <Field label="Type">
          <Select value={type} onChange={e => setType(e.target.value as ProfileTypeKey)}>
            {Object.entries(PROFILE_TYPES).map(([k, m]) => <option key={k} value={k}>{m.icon} {m.label} — {m.desc}</option>)}
          </Select>
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
  const [role, setRole] = useState<'admin'|'member'|'viewer'|'child'>('member');
  const [householdRole, setHouseholdRole] = useState('partner');
  const [submitting, setSubmitting] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const toast = useStore(s => s.toast);

  function reset() {
    setLink(null); setLabel(''); setRole('member');
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
    <Modal open={open} onClose={() => { reset(); onClose(); }} title={`Invite to ${householdName}`}>
      {link ? (
        <div>
          <div className="text-center mb-4">
            <div className="mx-auto mb-3 h-14 w-14 rounded-full bg-coral/15 text-coral flex items-center justify-center">
              <LinkIcon size={26} />
            </div>
            <p className="text-ink mb-1 font-semibold">Invite link ready</p>
            <p className="text-ink-mid text-[0.84rem]">
              Share it however you like — message, email, in person. Anyone with the link can join as <strong>{roleLabel(role)}</strong>.
            </p>
          </div>

          <div className="bg-bg3 border border-line rounded-md p-3 font-mono text-[0.74rem] text-coral break-all mb-3 select-all">
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
          setSubmitting(true);
          try {
            const inv = await createInviteLink(householdId, role, householdRole, label.trim() || undefined);
            const url = `${window.location.origin}/invite/${encodeURIComponent((inv as { token: string }).token)}`;
            setLink(url);
            void copyLink(url);
            onSent();
          } catch (err) {
            toast((err as Error).message, 'error');
          } finally { setSubmitting(false); }
        }}>
          <p className="text-ink-mid text-[0.84rem] mb-4">
            Create a shareable link for this household. No email is sent — copy the link and share it offline.
          </p>

          <Field label="Label" hint="optional, for your reference">
            <Input
              autoFocus value={label} onChange={e => setLabel(e.target.value)}
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
                <option value="child">Child (own data only)</option>
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
              {submitting ? 'Creating…' : <><LinkIcon size={14} /> Create invite link</>}
            </Button>
          </div>
        </form>
      )}
    </Modal>
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
        <div className="flex flex-wrap gap-1">
          {ACTIVITY_TYPE_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setActivityType(f.value)}
              className={`font-mono text-[0.62rem] tracking-wider uppercase px-2.5 py-1 rounded ${
                activityType === f.value
                  ? 'bg-coral text-white'
                  : 'bg-bg3 text-ink-mid hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {memberships.length > 1 && (
          <div className="ml-auto flex items-center gap-2">
            <label className="font-mono text-[0.6rem] tracking-wider uppercase text-ink-dim">
              Member
            </label>
            <Select
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
                className="font-mono text-[0.62rem] tracking-wider uppercase text-coral hover:bg-bg3 px-2.5 py-1 rounded disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>
              <span className="font-mono text-[0.58rem] tracking-wider uppercase text-ink-dim">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="font-mono text-[0.62rem] tracking-wider uppercase text-coral hover:bg-bg3 px-2.5 py-1 rounded disabled:opacity-30 disabled:cursor-not-allowed"
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
