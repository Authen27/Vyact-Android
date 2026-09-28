// Vyact — recurring schedules slice (TD-25 increment 5).
//
// v7/v8.9 recurring schedules + the generation engine (R2 deterministic-id
// idempotency). Persists/generates through the adapter and reads the rest of the
// store via `get()`. Moved verbatim from the store god-module.
import type { StateCreator } from 'zustand';
import type { RecurringSchedule, Transaction } from '../../types';
import type { Store } from '../../store';
import {
  dueSchedules, generateTransaction, advanceSchedule, recurringInstanceId, isStaleOccurrence,
} from '../../lib/recurring';
import { uid, today } from '../../lib/format';
import { readLocalJson } from '../localJson';

export interface RecurringSlice {
  recurringSchedules: RecurringSchedule[];
  upsertRecurring: (s: Partial<RecurringSchedule>) => Promise<RecurringSchedule>;
  removeRecurring: (id: string) => Promise<void>;
  approveRecurring: (id: string, occurrenceDate: string) => Promise<void>;
  runRecurringEngine: () => Promise<void>;
}

export const createRecurringSlice: StateCreator<Store, [], [], RecurringSlice> = (set, get) => ({
  recurringSchedules: readLocalJson<RecurringSchedule[]>('recurring', []),

  // ── v7: RECURRING ────────────────────────────────────────────
  upsertRecurring: async (s) => {
    const list = get().recurringSchedules;
    const existingIdx = s.id ? list.findIndex(x => x.id === s.id) : -1;
    const isNew = existingIdx < 0;

    const next: RecurringSchedule = {
      // `Date.now().toString(36) + Math.random().toString(36)` is not a UUID,
      // and `recurring_schedules.id` is a `uuid` column — so a user-created
      // schedule failed its cloud write with 22P02 exactly like the backfilled
      // ones. Every other entity in the app already mints ids with `uid()`
      // (crypto.randomUUID); recurring was the sole exception.
      id: s.id || uid(),
      transactionTemplate: s.transactionTemplate!,
      frequency: s.frequency!,
      dayOfMonth: s.dayOfMonth,
      weekday: s.weekday,
      startDate: s.startDate || new Date().toISOString().split('T')[0],
      nextDueDate: s.nextDueDate || s.startDate || new Date().toISOString().split('T')[0],
      lastGenerated: s.lastGenerated,
      autoConfirm: s.autoConfirm ?? true,
      active: s.active ?? true,
      reminderLeadDays: s.reminderLeadDays,
    };

    // 🔴 REMOVED IN v10.20.6 — creating a schedule no longer posts a transaction.
    //
    // This block used to "seed the first transaction so a freshly-created
    // schedule shows up in Transactions immediately". It dated that transaction
    // `next.startDate`, which for a new schedule is TODAY — so setting up rent
    // for the 28th charged you on the 8th, for an amount that had not been
    // spent. Reported 2026-09-08 as "the newly added recurring schedule for a
    // different time now appears as transaction for current day - this is
    // invalid", and it is: the ledger must record money that moved, and no money
    // moved when you described a future bill.
    //
    // It also set `lastGenerated = startDate`, telling the engine an occurrence
    // had already been produced — so the schedule's first REAL due date was
    // silently consumed by a transaction on the wrong date.
    //
    // A schedule is a TEMPLATE. `runRecurringEngine` materialises it on its due
    // date, which is the one place that should ever create one. Covered by
    // CON-E2E-033.
    const seededTxn: Transaction | null = null;

    // v8.9 — persist through the adapter so the schedule is household-scoped +
    // synced (and attributed to the creating user server-side via created_by).
    const saved = await get().adapter.upsert(
      'recurring', get().currentHouseholdId, next,
      next.id && next.updated_at ? next.updated_at : undefined,
    ) as RecurringSchedule;
    const updated = existingIdx >= 0
      ? list.map(x => x.id === saved.id ? saved : x)
      : [...list, saved];
    set({
      recurringSchedules: updated,
      transactions: seededTxn ? [...get().transactions, seededTxn] : get().transactions,
    });
    return saved;
  },

  removeRecurring: async (id) => {
    await get().adapter.remove('recurring', get().currentHouseholdId, id);
    set({ recurringSchedules: get().recurringSchedules.filter(s => s.id !== id) });
  },

  approveRecurring: async (id, occurrenceDate) => {
    const schedule = get().recurringSchedules.find(row => row.id === id);
    if (!schedule?.active || schedule.nextDueDate !== occurrenceDate || occurrenceDate > today()) return;
    const transaction = generateTransaction(schedule);
    if (!get().transactions.some(row => row.id === transaction.id)) {
      await get().upsertTransaction(transaction);
    }
    await get().upsertRecurring(advanceSchedule(schedule));
    await get().refreshNotifications();
  },

  runRecurringEngine: async () => {
    const { recurringSchedules, transactions, adapter, currentHouseholdId } = get();
    const due = dueSchedules(recurringSchedules);
    if (!due.length) { void get().refreshNotifications(); return; }
    const newTxns: Transaction[] = [];
    const updated = [...recurringSchedules];
    for (const s of due) {
      // v10.20.6 — refuse to invent history.
      //
      // A schedule whose nextDueDate is months in the past is corrupt data, not
      // a backlog: until v10.20.6 saving an EDIT recomputed nextDueDate from the
      // schedule's original startDate and could land it half a year back. The
      // engine then materialised one back-dated transaction per page refresh,
      // silently restating months that were already closed.
      //
      // The source of that corruption is fixed in Recurring.tsx, but schedules
      // carrying a bad date already exist on devices, so the engine refuses them
      // too: past the catch-up horizon it fast-forwards WITHOUT writing. A
      // genuine offline gap (under MAX_CATCHUP_DAYS) still catches up normally.
      if (isStaleOccurrence(s.nextDueDate)) {
        // Fast-forward in one pass to the first occurrence inside the horizon —
        // advancing a single period would leave it stale and require one
        // refresh per missed month to recover. Bounded so a corrupt schedule
        // cannot spin: 480 monthly steps is 40 years.
        let ff = s;
        for (let guard = 0; guard < 480 && isStaleOccurrence(ff.nextDueDate); guard++) {
          ff = advanceSchedule(ff);
        }
        const i = updated.findIndex(x => x.id === s.id);
        updated[i] = ff;
        try { await adapter.upsert('recurring', currentHouseholdId, ff); } catch { /* best-effort */ }
        continue;
      }
      // An approval-required schedule is LEFT DUE — the engine must not touch
      // it. Until this guard existed the loop skipped only the generation step
      // and still fell through to advanceSchedule below, so a manual schedule
      // rolled silently past its due date: no transaction, and no occurrence
      // left for the user to approve. `approveRecurring` advances it instead,
      // once the user acts on the notification.
      if (!s.autoConfirm) continue;

      // R2 (sync fix): idempotency guard. Skip if this occurrence already
      // exists locally (it may have been generated on another device and
      // pulled in, or generated in a prior engine run before the schedule
      // advance synced). The deterministic id makes the cloud upsert a no-op
      // too, but this also avoids a transient in-memory duplicate.
      const occId = recurringInstanceId(s.id, s.nextDueDate);
      const exists = transactions.some(
        t => t.id === occId || (t.recurringScheduleId === s.id && t.date === s.nextDueDate),
      );
      if (!exists) {
        const txn = generateTransaction(s);
        await adapter.upsert('transactions', currentHouseholdId, txn);
        newTxns.push(txn);
      }
      const advanced = advanceSchedule(s);
      const idx = updated.findIndex(x => x.id === s.id);
      updated[idx] = advanced;
      // Persist the advanced schedule (lastGenerated / nextDueDate moved on).
      try { await adapter.upsert('recurring', currentHouseholdId, advanced); } catch { /* best-effort */ }
    }
    set({
      recurringSchedules: updated,
      transactions: [...transactions, ...newTxns],
    });
    void get().refreshNotifications();
  },
});
