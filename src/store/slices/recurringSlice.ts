// Vyact — recurring schedules slice (TD-25 increment 5).
//
// v7/v8.9 recurring schedules + the generation engine (R2 deterministic-id
// idempotency). Persists/generates through the adapter and reads the rest of the
// store via `get()`. Moved verbatim from the store god-module.
import type { StateCreator } from 'zustand';
import type { RecurringSchedule, Transaction } from '../../types';
import type { Store } from '../../store';
import { dueSchedules, generateTransaction, advanceSchedule, recurringInstanceId } from '../../lib/recurring';
import { uid, today } from '../../lib/format';
import { readLocalJson } from '../localJson';

export interface RecurringSlice {
  recurringSchedules: RecurringSchedule[];
  upsertRecurring: (s: Partial<RecurringSchedule>) => Promise<RecurringSchedule>;
  removeRecurring: (id: string) => Promise<void>;
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
      id: s.id || (Date.now().toString(36) + Math.random().toString(36).slice(2)),
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

    // Seed the first transaction so a freshly-created schedule shows up in Transactions
    // immediately — unless the caller already produced one (e.g. the txn modal mirrored
    // its just-saved row into a schedule and pre-set lastGenerated).
    let seededTxn: Transaction | null = null;
    if (isNew && !next.lastGenerated && next.active && next.startDate <= today()) {
      seededTxn = {
        ...(next.transactionTemplate as Omit<Transaction, 'id' | 'date'>),
        id: uid(),
        date: next.startDate,
      } as Transaction;
      try { await get().adapter.upsert('transactions', get().currentHouseholdId, seededTxn); }
      catch { /* local fallback below still updates state */ }
      next.lastGenerated = next.startDate;
    }

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

  runRecurringEngine: async () => {
    const { recurringSchedules, transactions, adapter, currentHouseholdId } = get();
    const due = dueSchedules(recurringSchedules);
    if (!due.length) { get().refreshNotifications(); return; }
    const newTxns: Transaction[] = [];
    const updated = [...recurringSchedules];
    for (const s of due) {
      if (s.autoConfirm) {
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
    get().refreshNotifications();
  },
});
