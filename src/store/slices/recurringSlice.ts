// Vyact — recurring schedules slice (TD-25 increment 5).
//
// v7/v8.9 recurring schedules + the generation engine (R2 deterministic-id
// idempotency). Persists/generates through the adapter and reads the rest of the
// store via `get()`. Moved verbatim from the store god-module.
import type { StateCreator } from 'zustand';
import type { RecurringSchedule, Transaction } from '../../types';
import type { Store } from '../../store';
import {
  dueSchedules, generateTransaction, advanceSchedule, recurringInstanceId, isStaleOccurrence, serverPostsSchedule, isLoanEmiSchedule,
} from '../../lib/recurring';
import { uid, today } from '../../lib/format';
import { unexpected } from '../../lib/faults';
import { withRow, withRows } from '../../lib/rowMerge';
import { readLocalJson } from '../localJson';
import { landIn } from '../landIn';

export interface RecurringSlice {
  recurringSchedules: RecurringSchedule[];
  upsertRecurring: (s: Partial<RecurringSchedule>) => Promise<RecurringSchedule>;
  removeRecurring: (id: string) => Promise<void>;
  /** True when the occurrence was posted; false when it is no longer the one due (W4d: already handled). */
  approveRecurring: (id: string, occurrenceDate: string) => Promise<boolean>;
  /** Skip ONLY the occurrence named, and only while it is the one due (W4d); false when already handled. */
  skipRecurring: (id: string, occurrenceDate: string) => Promise<boolean>;
  /** Aurora 4.0 CF8 — Undo a skip: put the schedule back as it was before `skipRecurring`. */
  unskipRecurring: (before: RecurringSchedule) => Promise<boolean>;
  runRecurringEngine: () => Promise<void>;
}

export const createRecurringSlice: StateCreator<Store, [], [], RecurringSlice> = (set, get) => {
  // T5b (v10.121.0; audit XC-ARC-10) — a write after an await lands only in the household it was made for.
  const commit = landIn(set, get);
  return ({
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
      startDate: s.startDate || today(),
      nextDueDate: s.nextDueDate || s.startDate || today(),
      lastGenerated: s.lastGenerated,
      autoConfirm: s.autoConfirm ?? true,
      active: s.active ?? true,
      reminderLeadDays: s.reminderLeadDays,
      // W3e (audit FE-MNY-01, INT-TXN-03): the rule, the owner, the month-end rule and the version
      // used to be dropped here, so the form's RRULE never reached the database, the schedule's owner
      // was lost on every edit, and the `updated_at` precondition below was never sent.
      rrule: s.rrule,
      shortMonthPolicy: s.shortMonthPolicy,
      ownerMemberId: s.ownerMemberId,
      createdBy: s.createdBy ?? (isNew ? undefined : list[existingIdx].createdBy),
      updated_at: s.updated_at,
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
    const currentHouseholdId = get().currentHouseholdId;
    const saved = await get().adapter.upsert(
      'recurring', currentHouseholdId, next,
      next.id && next.updated_at ? next.updated_at : undefined,
    ) as RecurringSchedule;
    // F1b (FE-SYN-06): into the CURRENT list, not the one read before the await.
    commit(currentHouseholdId, state => ({
      recurringSchedules: withRow(state.recurringSchedules, saved),
      transactions: seededTxn ? [...state.transactions, seededTxn] : state.transactions,
    }));
    return saved;
  },

  removeRecurring: async (id) => {
    const currentHouseholdId = get().currentHouseholdId;
    await get().adapter.remove('recurring', currentHouseholdId, id);
    commit(currentHouseholdId, s => ({ recurringSchedules: s.recurringSchedules.filter(x => x.id !== id) }));
  },

  approveRecurring: async (id, occurrenceDate) => {
    const schedule = get().recurringSchedules.find(row => row.id === id);
    if (!schedule?.active || schedule.nextDueDate !== occurrenceDate || occurrenceDate > today()) return false;
    const transaction = generateTransaction(schedule);
    if (!get().transactions.some(row => row.id === transaction.id)) {
      await get().upsertTransaction(transaction);
    }
    await get().upsertRecurring(advanceSchedule(schedule));
    await get().refreshNotifications();
    return true;
  },

  // W4d (audit FE-UIS-04) — the bell's "Skip once" used to advance from wherever the pointer was NOW.
  // A card left over from a bill approved elsewhere therefore skipped the NEXT month's bill, which was
  // then never posted or asked for.
  skipRecurring: async (id, occurrenceDate) => {
    const schedule = get().recurringSchedules.find(row => row.id === id);
    if (!schedule?.active || schedule.nextDueDate !== occurrenceDate) return false;
    await get().upsertRecurring(advanceSchedule(schedule));
    await get().refreshNotifications();
    return true;
  },

  // Aurora 4.0 CF8 — skipping no longer asks first; its toast offers Undo for 8 seconds. Undo writes
  // back the schedule as it was before the skip (its pointer, dates and active flag), carrying the
  // CURRENT row's `updated_at` as the precondition so it is a normal edit, not a stale overwrite. It
  // refuses when the schedule is gone or has moved on again (approved or posted since).
  unskipRecurring: async (before) => {
    const current = get().recurringSchedules.find(row => row.id === before.id);
    if (!current || current.nextDueDate !== advanceSchedule(before).nextDueDate) return false;
    await get().upsertRecurring({ ...before, updated_at: current.updated_at });
    await get().refreshNotifications();
    return true;
  },

  runRecurringEngine: async () => {
    const { recurringSchedules, transactions, adapter, currentHouseholdId, cloudEnabled } = get();
    // W4b (v10.71.0; owner decision D16): in cloud mode the SERVER posts auto-approved bills from the
    // database's own copy (the recurring-post job), so this device never posts from a cache that may
    // not have heard of a pause, edit or delete made elsewhere (INT-TXN-06). It sees the posted row on
    // its next refresh. What the server does not post (loan EMIs, until D19) is still posted here, and
    // a local-only household posts everything here, as before.
    // W4f (D19): an EMI schedule never posts one full expense — the loan's own payment does it right.
    const due = dueSchedules(recurringSchedules).filter(s => !(cloudEnabled && serverPostsSchedule(s)) && !isLoanEmiSchedule(s));
    if (!due.length) { void get().refreshNotifications(); return; }
    const newTxns: Transaction[] = [];
    const advanced: RecurringSchedule[] = [];
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
        // A rule that runs out (COUNT / UNTIL) closes the schedule and stops here.
        for (let guard = 0; guard < 480 && ff.active && isStaleOccurrence(ff.nextDueDate); guard++) {
          ff = advanceSchedule(ff);
        }
        advanced.push(ff);
        try { await adapter.upsert('recurring', currentHouseholdId, ff); } catch (err) { unexpected(err, 'recurring.engine.fastForward'); }
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
      const next = advanceSchedule(s);
      advanced.push(next);
      // Persist the advanced schedule (lastGenerated / nextDueDate moved on; closed when its rule ran out).
      try { await adapter.upsert('recurring', currentHouseholdId, next); } catch (err) { unexpected(err, 'recurring.engine.advance'); }
    }
    // F1b (FE-SYN-06): the moved schedules and the posted rows go into the CURRENT lists.
    commit(currentHouseholdId, state => ({
      recurringSchedules: withRows(state.recurringSchedules, advanced),
      transactions: withRows(state.transactions, newTxns),
    }));
    void get().refreshNotifications();
  },
});
};
