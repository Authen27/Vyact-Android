// Vyact — modal + form-navigation slice (TD-25 increment 1).
//
// App-level modal state (goals, the Ask drawer) lives here. It is pure UI state
// with no cross-slice dependencies, which made it the safest first extraction
// from the store god-module. Composed into `useStore` by store.ts.
//
// v10.28.0 — the entity forms (transaction, split, debt, budget, account, asset)
// are no longer modals. Each is a routed, full-screen page (lib/formRoutes.ts,
// pages/FormPages.tsx), so their `{entity}ModalOpen` / `editing{Entity}` /
// `close{Entity}Modal` slots are gone. The openAdd* / openEdit* actions keep
// their names and signatures, so every caller (the FAB, the N/B/D/A shortcuts,
// the command palette, Ask Vyact and notification seeds) opens the page as it
// used to open the modal.
import type { StateCreator } from 'zustand';
import type { Transaction, Goal, Budget, Debt, Asset, Account } from '../../types';
import type { Store } from '../../store';
import { appNavigate } from '../../lib/appNavigation';
import { formPath } from '../../lib/formRoutes';

export interface ModalSlice {
  /** v7.4.5 — a seed pre-fills the Add Transaction page (Ask Vyact, notifications). */
  openAddTxn: (seed?: Partial<Transaction>) => void;
  openEditTxn: (t: Transaction) => void;

  // v6.4 — goal modals
  goalModalOpen: boolean;
  editingGoal: Goal | null;
  openAddGoal: () => void;
  openEditGoal: (g: Goal) => void;
  closeGoalModal: () => void;

  goalProgressModalOpen: boolean;
  progressGoal: Goal | null;
  openGoalProgress: (g: Goal) => void;
  closeGoalProgress: () => void;

  openAddBudget: () => void;
  openEditBudget: (b: Budget) => void;

  openAddDebt: () => void;
  openEditDebt: (d: Debt) => void;

  openAddAsset: () => void;
  openEditAsset: (a: Asset) => void;

  // v7.1.3 — accounts (Money Map)
  openAddAccount: () => void;
  openEditAccount: (a: Account) => void;

  // v10.16 — a split is transaction-backed, so editing takes the backing
  // Transaction (the one carrying `split`).
  openAddSplit: () => void;
  openEditSplit: (t: Transaction) => void;

  // v10.1.1 — Ask Vyact drawer. Owned by the store so the shell chrome (desktop
  // header ✦ Ask chip + mobile tab-bar Ask slot, per the Batch A board) can open
  // the same right-side drawer FloatingTools hosts.
  askOpen: boolean;
  openAsk: () => void;
  closeAsk: () => void;
}

export const createModalSlice: StateCreator<Store, [], [], ModalSlice> = (set) => ({
  openAddTxn:  (seed) => appNavigate(formPath.transactionNew(), seed ? { state: { seed } } : undefined),
  openEditTxn: (t) => appNavigate(formPath.transactionEdit(t.id)),

  // v6.4 — goal modals
  goalModalOpen: false,
  editingGoal: null,
  openAddGoal:     () => set({ editingGoal: null, goalModalOpen: true }),
  openEditGoal:    (g) => set({ editingGoal: g, goalModalOpen: true }),
  closeGoalModal:  () => set({ goalModalOpen: false, editingGoal: null }),

  goalProgressModalOpen: false,
  progressGoal: null,
  openGoalProgress:  (g) => set({ progressGoal: g, goalProgressModalOpen: true }),
  closeGoalProgress: () => set({ goalProgressModalOpen: false, progressGoal: null }),

  openAddBudget:  () => appNavigate(formPath.budgetNew()),
  openEditBudget: (b) => appNavigate(formPath.budgetEdit(b.id)),

  openAddDebt:  () => appNavigate(formPath.debtNew()),
  openEditDebt: (d) => appNavigate(formPath.debtEdit(d.id)),

  openAddAsset:  () => appNavigate(formPath.assetNew()),
  openEditAsset: (a) => appNavigate(formPath.assetEdit(a.id)),

  openAddAccount:  () => appNavigate(formPath.accountNew()),
  openEditAccount: (a) => appNavigate(formPath.accountEdit(a.id)),

  openAddSplit:  () => appNavigate(formPath.splitNew()),
  openEditSplit: (t) => appNavigate(formPath.splitEdit(t.id)),

  // v10.1.1 — Ask Vyact drawer
  askOpen: false,
  openAsk:  () => set({ askOpen: true }),
  closeAsk: () => set({ askOpen: false }),
});
