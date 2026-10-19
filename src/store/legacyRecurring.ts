// v8.9 — one-shot migration of the pre-cloud localStorage recurring list (the legacy global `recurring`
// key) into the household-scoped synced entity. It runs only when the household has no recurring rows
// yet but legacy data exists, and is idempotent thereafter.
//
// T5b (v10.121.0; audit XC-ARC-11) — the key used to be retired even when a schedule failed to store,
// losing it without a word. Now only the schedules that landed leave it: the rest stay, the household
// they belong to is remembered, the next load tries them again, and each failure is recorded. They never
// landed, so trying again brings nothing deleted back.
import type { DataAdapter } from '../lib/dataAdapter';
import type { RecurringSchedule } from '../types';
import { failedWrite } from '../lib/faults';
import { readLocalJson, readLocalString, removeLocal, setLocalJson, setLocalString } from './localJson';

/** The household the legacy schedules still waiting to be stored belong to. */
export const LEGACY_RECURRING_HID = 'recurring_legacy_household';

/** Stores the legacy schedules into `householdId`; true when it ran (the caller re-reads the list). */
export async function importLegacyRecurring(
  adapter: Pick<DataAdapter, 'upsert'>, householdId: string, householdHasSchedules: boolean,
): Promise<boolean> {
  const legacy = readLocalJson<RecurringSchedule[]>('recurring', []);
  const resuming = readLocalString(LEGACY_RECURRING_HID) === householdId;
  if (!legacy.length || (householdHasSchedules && !resuming)) return false;
  const left: RecurringSchedule[] = [];
  for (const s of legacy) {
    try { await adapter.upsert('recurring', householdId, s); }
    catch (e) { left.push(s); failedWrite(e, 'init.legacyRecurring:upsert'); }
  }
  if (left.length) {
    setLocalJson('recurring', left);
    setLocalString(LEGACY_RECURRING_HID, householdId);
  } else {
    removeLocal('recurring');             // retire the legacy global key once every schedule landed
    removeLocal(LEGACY_RECURRING_HID);
  }
  return true;
}
