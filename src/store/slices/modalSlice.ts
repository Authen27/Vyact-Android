// Vyact — global modal slice (TD-25 increment 1).
//
// All the app-root-mounted modal state (open*/close*/editing*) lives here. It is
// pure UI state with no cross-slice dependencies, which makes it the safest first
// extraction from the store god-module. Composed into `useStore` by store.ts; the
// `set`/`get` are the same store-wide handles, so behaviour is byte-identical.
import type { StateCreator } from 'zustand';
import type { Transaction, Goal, Budget, Debt, Asset, Account } from '../../types';
import type { Store } from '../../store';

export interface ModalSlice {
  // v6.2.3 — global transaction modal
  txnModalOpen: boolean;
  editingTxn: Transaction | null;
  /** v7.4.5 — Ask Vyact seeds the Add-Transaction modal with partial values. */
  seedTxn: Partial<Transaction> | null;
  openAddTxn: (seed?: Partial<Transaction>) => void;
  openEditTxn: (t: Transaction) => void;
  closeTxnModal: () => void;

  // v6.4 — goal & budget modals
  goalModalOpen: boolean;
  editingGoal: Goal | null;
  openAddGoal: () => void;
  openEditGoal: (g: Goal) => void;
  closeGoalModal: () => void;

  goalProgressModalOpen: boolean;
  progressGoal: Goal | null;
  openGoalProgress: (g: Goal) => void;
  closeGoalProgress: () => void;

  budgetModalOpen: boolean;
  editingBudget: Budget | null;
  openAddBudget: () => void;
  openEditBudget: (b: Budget) => void;
  closeBudgetModal: () => void;

  debtModalOpen: boolean;
  editingDebt: Debt | null;
  openAddDebt: () => void;
  openEditDebt: (d: Debt) => void;
  closeDebtModal: () => void;

  assetModalOpen: boolean;
  editingAsset: Asset | null;
  openAddAsset: () => void;
  openEditAsset: (a: Asset) => void;
  closeAssetModal: () => void;

  // v7.1.3 — global Account modal (Money Map)
  accountModalOpen: boolean;
  editingAccount: Account | null;
  openAddAccount: () => void;
  openEditAccount: (a: Account) => void;
  closeAccountModal: () => void;
}

export const createModalSlice: StateCreator<Store, [], [], ModalSlice> = (set) => ({
  // v6.2.3 — global transaction modal
  txnModalOpen: false,
  editingTxn: null,
  seedTxn: null,
  openAddTxn:    (seed) => set({ editingTxn: null, seedTxn: seed ?? null, txnModalOpen: true }),
  openEditTxn:   (t) => set({ editingTxn: t, seedTxn: null, txnModalOpen: true }),
  closeTxnModal: () => set({ txnModalOpen: false, editingTxn: null, seedTxn: null }),

  // v6.4 — goal & budget modals
  goalModalOpen: false,
  editingGoal: null,
  openAddGoal:     () => set({ editingGoal: null, goalModalOpen: true }),
  openEditGoal:    (g) => set({ editingGoal: g, goalModalOpen: true }),
  closeGoalModal:  () => set({ goalModalOpen: false, editingGoal: null }),

  goalProgressModalOpen: false,
  progressGoal: null,
  openGoalProgress:  (g) => set({ progressGoal: g, goalProgressModalOpen: true }),
  closeGoalProgress: () => set({ goalProgressModalOpen: false, progressGoal: null }),

  budgetModalOpen: false,
  editingBudget: null,
  openAddBudget:    () => set({ editingBudget: null, budgetModalOpen: true }),
  openEditBudget:   (b) => set({ editingBudget: b, budgetModalOpen: true }),
  closeBudgetModal: () => set({ budgetModalOpen: false, editingBudget: null }),

  debtModalOpen: false,
  editingDebt: null,
  openAddDebt:    () => set({ editingDebt: null, debtModalOpen: true }),
  openEditDebt:   (d) => set({ editingDebt: d, debtModalOpen: true }),
  closeDebtModal: () => set({ debtModalOpen: false, editingDebt: null }),

  assetModalOpen: false,
  editingAsset: null,
  openAddAsset:    () => set({ editingAsset: null, assetModalOpen: true }),
  openEditAsset:   (a) => set({ editingAsset: a, assetModalOpen: true }),
  closeAssetModal: () => set({ assetModalOpen: false, editingAsset: null }),

  accountModalOpen: false,
  editingAccount: null,
  openAddAccount:    () => set({ editingAccount: null, accountModalOpen: true }),
  openEditAccount:   (a) => set({ editingAccount: a, accountModalOpen: true }),
  closeAccountModal: () => set({ accountModalOpen: false, editingAccount: null }),
});
