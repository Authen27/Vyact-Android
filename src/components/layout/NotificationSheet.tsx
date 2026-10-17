// Aurora notification pull-down (v10.1 · notifications-spec.md).
// Full-screen glass sheet drawn from the top (mobile + desktop 720px column),
// grouped Today / Earlier, P1 pinned first, coral unread dots, per-type inline
// decisions. Actions that resolve in place (approve / skip / dismiss) flip the
// row to read and keep the sheet open; navigation actions apply context and
// leave. Replaces the old anchored popover.
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import PullDownSheet from '../ui/PullDownSheet';
import PhonePushPrompt from './PhonePushPrompt';
import { Pip } from './Brand';
import { NOTIF_META, needsYou, notificationOccurrence } from '../../lib/notifications';
import { useInvitationNotifs } from './useInvitationNotifs';
import { confirmSheet } from '../../lib/confirmSheet';
import { declineInvitationRequest, joinInvitationRequest, revokeInvitationRequest } from '../../lib/confirmCopy';
import { invitationWho } from '../../lib/invitations';
import { inviteAcceptMessage } from '../../lib/householdTypes';
import { roleLabel } from '../../lib/permissions';
import type { AppRole, Notification, NotifActionSpec } from '../../types';

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

// Aurora 4.0 NT2 — phone-sized actions: 40px buttons in sans, not 32px display-font chips.
function ActionButton({ spec, onClick }: { spec: NotifActionSpec; onClick: () => void }) {
  const cls = spec.kind === 'primary' ? 'btn-primary'
    : spec.kind === 'neu' ? 'btn-secondary'
    : 'btn-ghost';
  return (
    <button type="button" className={`${cls} !h-10 !px-4 !font-ui !font-medium !text-[13.5px]`} onClick={e => { e.stopPropagation(); onClick(); }}>{spec.label}</button>
  );
}

export default function NotificationSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const notifications = useStore(s => s.notifications);
  const currentHouseholdId = useStore(s => s.currentHouseholdId);
  const households = useStore(s => s.households);
  const recurringSchedules = useStore(s => s.recurringSchedules);
  const markRead = useStore(s => s.markNotificationRead);
  const markAllRead = useStore(s => s.markAllNotificationsRead);
  const dismiss = useStore(s => s.dismissNotification);
  const approveRecurring = useStore(s => s.approveRecurring);
  const skipRecurring = useStore(s => s.skipRecurring);
  const debts = useStore(s => s.debts);
  const toast = useStore(s => s.toast);
  // v10.95.0 (#9) — invitation cards: built from live lists, never saved; refreshed when the bell opens.
  const invitationCards = useInvitationNotifs();
  const myInvitations = useStore(s => s.myInvitations);
  const householdInvitations = useStore(s => s.householdInvitations);
  const refreshInvitations = useStore(s => s.refreshInvitations);
  const joinInvitation = useStore(s => s.joinInvitation);
  const declineMyInvitation = useStore(s => s.declineMyInvitation);
  const revokeHouseholdInvitation = useStore(s => s.revokeHouseholdInvitation);
  const switchHousehold = useStore(s => s.switchHousehold);
  useEffect(() => { if (open) void refreshInvitations(); }, [open, refreshInvitations]);

  const householdName = households.find(h => h.id === currentHouseholdId)?.name || 'This household';

  // NT1 — "Needs you" sits above Today and Earlier and keeps each card until it is handled; a bill to
  // approve no longer looks like any other update, or drops into "Earlier" once a day passes.
  const { pending, today, earlier, unread } = useMemo(() => {
    const active = [...notifications, ...invitationCards]
      .filter(n => n.status !== 'dismissed' && (!n.householdId || n.householdId === currentHouseholdId))
      // P1 (action-required) pinned first, then newest first.
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === 'P1' ? -1 : 1;
        return b.createdAt.localeCompare(a.createdAt);
      });
    const rest = active.filter(n => !needsYou(n));
    return {
      pending: active.filter(needsYou),
      today: rest.filter(n => isToday(n.createdAt)),
      earlier: rest.filter(n => !isToday(n.createdAt)),
      unread: active.filter(n => n.status === 'unread').length,
    };
  }, [notifications, invitationCards, currentHouseholdId]);

  // v10.95.0 (#9; owner decisions 13 Oct 2026) — an invitation card acts only after the person confirms:
  // Join asks the invitation link's question (FE-PLT-07), Decline and Revoke ask because they affect the
  // other person. Each answers "Already handled" when the invitation is gone, never a success it did not have.
  async function joinFromCard(n: Notification) {
    const inv = myInvitations.find(i => i.id === n.invitationId);
    if (!inv) { toast('Already handled', 'info'); void refreshInvitations(); return; }
    if (!(await confirmSheet(joinInvitationRequest({
      household: inv.householdName, role: roleLabel(inv.role as AppRole), inviter: inv.invitedByName,
    })))) return;
    try {
      const householdId = await joinInvitation(inv.id);
      onClose();
      await switchHousehold(householdId);
      toast(`Welcome to ${inv.householdName}`, 'success');
      navigate('/dashboard');
    } catch (e) {
      toast(inviteAcceptMessage(e), 'error');
      void refreshInvitations();
    }
  }

  async function declineFromCard(n: Notification) {
    const inv = myInvitations.find(i => i.id === n.invitationId);
    if (!inv) { toast('Already handled', 'info'); void refreshInvitations(); return; }
    if (!(await confirmSheet(declineInvitationRequest({ household: inv.householdName, inviter: inv.invitedByName })))) return;
    try {
      const declined = await declineMyInvitation(inv.id);
      toast(declined ? 'Invitation declined' : 'Already handled', 'info');
    } catch {
      toast('Could not decline the invitation. Please retry.', 'error');
    }
  }

  async function revokeFromCard(n: Notification) {
    const inv = householdInvitations.find(i => i.id === n.invitationId);
    if (!inv) { toast('Already handled', 'info'); void refreshInvitations(); return; }
    if (!(await confirmSheet(revokeInvitationRequest({ who: invitationWho(inv) })))) return;
    try {
      const revoked = await revokeHouseholdInvitation(inv.id);
      toast(revoked ? 'Invitation revoked' : 'Already handled', revoked ? 'success' : 'info');
    } catch {
      toast('Could not revoke the invitation. Please retry.', 'error');
    }
  }

  function runAction(n: Notification, actionId: string) {
    switch (actionId) {
      case 'join': void joinFromCard(n); return;
      case 'decline': void declineFromCard(n); return;
      case 'revoke': void revokeFromCard(n); return;
      // W4d (audit FE-UIS-04) — both act on THE CARD'S occurrence only, and only while it is the one
      // due. A card for a bill already handled elsewhere says so, instead of skipping next month's bill
      // or claiming a post that never happened.
      case 'approve': {   // recurring_due_confirm — post the txn, advance, stay open
        const s = recurringSchedules.find(x => x.id === n.scheduleId);
        const occurrence = notificationOccurrence(n) ?? s?.nextDueDate;
        if (!s || !occurrence) { markRead(n.id); toast('Already handled', 'info'); return; }
        void approveRecurring(s.id, occurrence).then(posted => {
          markRead(n.id);
          toast(posted ? 'Approved — transaction posted' : 'Already handled', posted ? 'success' : 'info');
        }).catch(() => toast('Could not approve this bill. Please retry.', 'error'));
        return;
      }
      case 'skip': {      // skip this occurrence: advance without posting, stay open
        const s = recurringSchedules.find(x => x.id === n.scheduleId);
        const occurrence = notificationOccurrence(n) ?? s?.nextDueDate;
        if (!s || !occurrence) { markRead(n.id); toast('Already handled', 'info'); return; }
        void skipRecurring(s.id, occurrence).then(skipped => {
          markRead(n.id);
          toast(skipped ? 'Skipped once' : 'Already handled', 'info');
        }).catch(() => toast('Could not skip this bill. Please retry.', 'error'));
        return;
      }
      case 'dismiss':
        dismiss(n.id);
        return;
      case 'record': {    // debt_payment_due — W4f (D19): the loan's own Pay sheet, prefilled with the EMI due
        // (it used to seed a plain expense with no category, which landed in Food & Dining).
        const d = debts.find(x => x.id === n.debtId);
        markRead(n.id);
        onClose();
        navigate(d ? `/debts?pay=${d.id}` : '/debts');
        return;
      }
      default: {          // view / review / edit / see_txns / update → navigate + leave
        markRead(n.id);
        onClose();
        if (n.deepLink) navigate(n.deepLink);
      }
    }
  }

  function onRowTap(n: Notification) {
    // Whole-row tap navigates (P2 + read rows); P1 unread rows use their buttons.
    if (n.status === 'unread' && n.actions?.length) return;
    markRead(n.id);
    onClose();
    if (n.deepLink) navigate(n.deepLink);
  }

  const empty = pending.length === 0 && today.length === 0 && earlier.length === 0;

  const Group = ({ label, rows, count }: { label: string; rows: Notification[]; count?: boolean }) => rows.length ? (
    /* Board M2 — the list is inset so unread dots sit in a gutter left of the
       icon tiles, exactly at the sheet's content edge. */
    <div className="pl-3">
      <h3 className="font-ui text-[13px] font-semibold text-ink pt-2.5 pb-1">
        {label}{count && <span className="font-normal text-ink-dim"> · {rows.length}</span>}
      </h3>
      {rows.map(n => {
        const meta = NOTIF_META[n.type];
        return (
          <div
            key={n.id}
            onClick={() => onRowTap(n)}
            className={`relative flex items-start gap-3 rounded-r2 px-1 py-3 border-b border-line last:border-0 transition-colors hover:bg-bg3/60 cursor-pointer ${n.status === 'read' ? 'opacity-60' : ''}`}
          >
            {n.status === 'unread' && (
              <span className="absolute -left-3 top-6 w-[7px] h-[7px] rounded-full" style={{ background: 'var(--accent)' }} aria-label="unread" />
            )}
            {/* Board M2 — read rows drop the tint: sunken inset tile. */}
            <span className="w-[38px] h-[38px] rounded-xl flex items-center justify-center flex-shrink-0 text-[16px]"
              style={n.status === 'read'
                ? { background: 'var(--sunken)', boxShadow: 'var(--neu-inset)', color: 'var(--ff-ink-3)' }
                : { background: `color-mix(in srgb, ${n.tint || meta.tint} 16%, transparent)`, color: n.tint || meta.tint }}>
              {meta.icon}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[14px] text-ink leading-snug">{n.title}</div>
              {n.body && <div className="text-[13px] text-ink-mid mt-0.5">{n.body}</div>}
              {n.status === 'unread' && n.actions?.length ? (
                <div className="flex flex-wrap gap-2 mt-2">
                  {n.actions.map(a => <ActionButton key={a.id} spec={a} onClick={() => runAction(n, a.id)} />)}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  ) : null;

  return (
    <PullDownSheet
      open={open}
      onClose={onClose}
      ariaLabel="Notifications"
      header={
        <div className="flex items-center justify-between pt-6 pb-1">
          <div>
            <h2 className="font-display text-2xl font-medium text-ink leading-none">Notifications</h2>
            <div className="ui-label mt-1.5">{unread} unread · {householdName}</div>
          </div>
          {unread > 0 && (
            <button className="btn-ghost btn-sm" style={{ color: 'var(--accent-text)' }} onClick={markAllRead}>Mark all read</button>
          )}
        </div>
      }
      footer={
        <button
          className="w-full text-center font-ui text-[13.5px] font-medium min-h-[44px] py-1.5"
          style={{ color: 'var(--accent-text)' }}
          onClick={() => { onClose(); navigate('/settings#notifications'); }}
        >
          Notification settings →
        </button>
      }
    >
      <PhonePushPrompt />
      {empty ? (
        <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
          <Pip size={52} />
          <div className="font-display text-lg font-semibold text-ink">All caught up</div>
          <p className="text-[0.85rem] text-ink-dim max-w-[240px]">Nothing needs you right now. We'll nudge you when something does.</p>
        </div>
      ) : (
        <>
          <Group label="Needs you" rows={pending} count />
          <Group label="Today" rows={today} />
          <Group label="Earlier" rows={earlier} />
        </>
      )}
    </PullDownSheet>
  );
}
