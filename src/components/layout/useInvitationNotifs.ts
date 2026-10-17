// v10.95.0 (#9) — the bell's invitation cards, built from the store's live invitation lists on every
// render and never saved (lib/notifications.ts explains why). The badge and the sheet both read this.
import { useMemo } from 'react';
import { useStore } from '../../store';
import { invitationPendingNotifs, invitationReceivedNotifs } from '../../lib/notifications';
import type { Notification } from '../../types';

export function useInvitationNotifs(): Notification[] {
  const mine = useStore(s => s.myInvitations);
  const theirs = useStore(s => s.householdInvitations);
  const prefs = useStore(s => s.notificationPrefs);
  const householdId = useStore(s => s.currentHouseholdId);
  return useMemo(
    () => [...invitationReceivedNotifs(mine, prefs), ...invitationPendingNotifs(theirs, prefs, householdId)],
    [mine, theirs, prefs, householdId],
  );
}
