// Vyact v10.28.0 — the routed entity form pages.
//
// Each route resolves what its form needs (the entity being edited, an Ask
// Vyact seed) and hands the form body an `onClose` that returns the customer to
// where they came from. The form bodies are the same components the modals
// used; only their container changed (components/ui/FormPage.tsx).
import React, { type ReactNode, useCallback, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useStore, type Store } from '../store';
import { can } from '../lib/permissions';
import type { Transaction } from '../types';

const TransactionFormModal = React.lazy(() => import('../components/transactions/TransactionFormModal'));
const SplitFormModal       = React.lazy(() => import('../components/splits/SplitFormModal'));
const DebtFormModal        = React.lazy(() => import('../components/debts/DebtFormModal'));
const BudgetFormModal      = React.lazy(() => import('../components/budgets/BudgetFormModal'));
const AccountFormModal     = React.lazy(() => import('../components/accounts/AccountFormModal'));
const AssetFormModal       = React.lazy(() => import('../components/assets/AssetFormModal'));
const ReconcileSheet       = React.lazy(() => import('../components/accounts/ReconcileSheet'));

/**
 * Close = back to where the form was opened from. A form reached directly (a
 * refresh, a bookmark, a shared link) has no app entry behind it, so it replaces
 * itself with the entity's list screen rather than leaving the app.
 */
function useFormClose(fallback: string): () => void {
  const navigate = useNavigate();
  const closed = useRef(false);
  return useCallback(() => {
    // A save and an Escape in the same moment must not go back twice.
    if (closed.current) return;
    closed.current = true;
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, fallback]);
}

/**
 * The entity an edit route names, read ONCE when the page opens. Forms hydrate
 * from `initial`; a live row would re-hydrate them, wiping what was typed, each
 * time a sync refresh replaced the array (the modal slots held a snapshot too).
 */
function useRouteEntity<T extends { id: string }>(pick: (state: Store) => readonly T[]): T | null {
  const { id } = useParams();
  const [entity] = useState<T | null>(() => pick(useStore.getState()).find(item => item.id === id) ?? null);
  return entity;
}

function TransactionNew() {
  const location = useLocation();
  const [seed] = useState(() => (location.state as { seed?: Partial<Transaction> } | null)?.seed ?? null);
  const close = useFormClose('/transactions');
  return <TransactionFormModal seed={seed} onClose={close} />;
}

function TransactionEdit() {
  const txn = useRouteEntity(s => s.transactions);
  const close = useFormClose('/transactions');
  if (!txn) return <Navigate to="/transactions" replace />;
  return <TransactionFormModal initial={txn} onClose={close} />;
}

function SplitNew() {
  const close = useFormClose('/splits');
  return <SplitFormModal onClose={close} />;
}

function SplitEdit() {
  const txn = useRouteEntity(s => s.transactions);
  const close = useFormClose('/splits');
  if (!txn?.split?.isSplit) return <Navigate to="/splits" replace />;
  return <SplitFormModal initial={txn} onClose={close} />;
}

function DebtNew() {
  const close = useFormClose('/debts');
  return <DebtFormModal onClose={close} />;
}

function DebtEdit() {
  const debt = useRouteEntity(s => s.debts);
  const close = useFormClose('/debts');
  if (!debt) return <Navigate to="/debts" replace />;
  return <DebtFormModal initial={debt} onClose={close} />;
}

/** Budgets are the one form the screen gates by role; a direct link must not
 *  show a form whose save the store would refuse. */
function BudgetGate({ children }: { children: ReactNode }) {
  const myRole = useStore(s => s.myRole);
  if (myRole == null) return null; // role still resolving
  if (!can(myRole, 'manage_budgets')) return <Navigate to="/budgets" replace />;
  return <>{children}</>;
}

function BudgetNew() {
  const close = useFormClose('/budgets');
  return <BudgetGate><BudgetFormModal onClose={close} /></BudgetGate>;
}

function BudgetEdit() {
  const budget = useRouteEntity(s => s.budgets);
  const close = useFormClose('/budgets');
  if (!budget) return <Navigate to="/budgets" replace />;
  return <BudgetGate><BudgetFormModal initial={budget} onClose={close} /></BudgetGate>;
}

function AccountNew() {
  const close = useFormClose('/accounts');
  return <AccountFormModal onClose={close} />;
}

function AccountEdit() {
  const account = useRouteEntity(s => s.accounts);
  const close = useFormClose('/accounts');
  if (!account) return <Navigate to="/accounts" replace />;
  return <AccountFormModal initial={account} onClose={close} />;
}

function AccountReconcile() {
  const opened = useRouteEntity(s => s.accounts);
  // Reconcile reads the LIVE row: its figures are the ledger's, not a draft.
  const live = useStore(s => s.accounts.find(a => a.id === opened?.id)) ?? opened;
  const close = useFormClose('/accounts');
  if (!live) return <Navigate to="/accounts" replace />;
  return <ReconcileSheet account={live} onClose={close} />;
}

function AssetNew() {
  const close = useFormClose('/networth');
  return <AssetFormModal onClose={close} />;
}

function AssetEdit() {
  const asset = useRouteEntity(s => s.assets);
  const close = useFormClose('/networth');
  if (!asset) return <Navigate to="/networth" replace />;
  return <AssetFormModal initial={asset} onClose={close} />;
}

export default function FormPages() {
  return (
    <Routes>
      <Route path="/transactions/new"          element={<TransactionNew />} />
      <Route path="/transactions/:id/edit"     element={<TransactionEdit />} />
      <Route path="/splits/new"                element={<SplitNew />} />
      <Route path="/splits/:id/edit"           element={<SplitEdit />} />
      <Route path="/debts/new"                 element={<DebtNew />} />
      <Route path="/debts/:id/edit"            element={<DebtEdit />} />
      <Route path="/budgets/new"               element={<BudgetNew />} />
      <Route path="/budgets/:id/edit"          element={<BudgetEdit />} />
      <Route path="/accounts/new"              element={<AccountNew />} />
      <Route path="/accounts/:id/edit"         element={<AccountEdit />} />
      <Route path="/accounts/:id/reconcile"    element={<AccountReconcile />} />
      <Route path="/networth/assets/new"       element={<AssetNew />} />
      <Route path="/networth/assets/:id/edit"  element={<AssetEdit />} />
      <Route path="*"                          element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
