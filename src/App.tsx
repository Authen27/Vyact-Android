import { useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useStore } from './store';
import { useTheme } from './hooks';
import { onStorageEvent } from './lib/storageEvents';
import { isOnboardingEnabled } from './config/features';
import { shouldOnboard, migrateExistingHousehold } from './lib/onboardingState';
import Layout from './components/layout/Layout';
import ToastHost from './components/ui/ToastHost';
import FaultsPanel from './components/dev/FaultsPanel';
import SyncHealthIndicator from './components/sync/SyncHealthIndicator';
import AuthGate from './components/auth/AuthGate';
import UpdateBanner from './components/layout/UpdateBanner';
import InstallBanner from './components/layout/InstallBanner';


import React, { Suspense } from 'react';
const TransactionFormModal = React.lazy(() => import('./components/transactions/TransactionFormModal'));
const BudgetFormModal = React.lazy(() => import('./components/budgets/BudgetFormModal'));
const DebtFormModal = React.lazy(() => import('./components/debts/DebtFormModal'));
const AssetFormModal = React.lazy(() => import('./components/assets/AssetFormModal'));
const AccountFormModal = React.lazy(() => import('./components/accounts/AccountFormModal'));
const Dashboard    = React.lazy(() => import('./pages/Dashboard'));
const Transactions = React.lazy(() => import('./pages/Transactions'));
const Reports      = React.lazy(() => import('./pages/Reports'));
const Recurring    = React.lazy(() => import('./pages/Recurring'));
const Planner      = React.lazy(() => import('./pages/Planner'));
const Chat         = React.lazy(() => import('./pages/Chat'));
const Onboarding   = React.lazy(() => import('./pages/Onboarding'));
const NudgeBanner  = React.lazy(() => import('./components/onboarding/NudgeBanner'));
const Households   = React.lazy(() => import('./pages/Households'));
const Settings     = React.lazy(() => import('./pages/Settings'));
const Budgets      = React.lazy(() => import('./pages/Budgets'));
const Debts        = React.lazy(() => import('./pages/Debts'));
const NetWorth     = React.lazy(() => import('./pages/NetWorth'));
const Accounts     = React.lazy(() => import('./pages/Accounts'));
const Splits       = React.lazy(() => import('./pages/Splits'));
const Help         = React.lazy(() => import('./pages/Help'));
const Insights     = React.lazy(() => import('./pages/Insights'));
const Privacy      = React.lazy(() => import('./pages/Privacy'));
const Terms        = React.lazy(() => import('./pages/Terms'));
const Cookies      = React.lazy(() => import('./pages/Cookies'));
const E2EErrorTest = React.lazy(() => import('./pages/__e2e__ErrorTest'));

const SignIn        = React.lazy(() => import('./pages/auth/SignIn'));
const SignUp        = React.lazy(() => import('./pages/auth/SignUp'));
const ResetPassword = React.lazy(() => import('./pages/auth/ResetPassword'));
const AcceptInvite  = React.lazy(() => import('./pages/auth/AcceptInvite'));
const VerifiedAuth = React.lazy(() => import('./pages/auth/VerifiedAuth'));

export default function App() {
  // reducedMotion="user" makes the WHOLE app honor the OS "reduce motion" setting
  // automatically — every motion component degrades to instant. This is the
  // accessibility foundation the rest of the motion work builds on.
  return (
    <MotionConfig reducedMotion="user">
      <AuthGate>
        <ScrollToTop />
        <AppShell />
        <Suspense fallback={null}>
          <RootModals />
        </Suspense>
        <ToastHost />
        <SyncHealthIndicator />
        {import.meta.env.DEV && <FaultsPanel />}
        <UpdateBanner />
        <InstallBanner />
        <Suspense fallback={null}>
          <NudgeBanner />
        </Suspense>
      </AuthGate>
    </MotionConfig>
  );
}

// v7.4.1 — Reset window scroll on every pathname change. Without this
// react-router preserves the previous tab's scroll position, leaving
// users mid-page when they jump to a new section.
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}

function RootModals() {
  const txnModalOpen = useStore(s => s.txnModalOpen);
  const budgetModalOpen = useStore(s => s.budgetModalOpen);
  const debtModalOpen = useStore(s => s.debtModalOpen);
  const assetModalOpen = useStore(s => s.assetModalOpen);
  const accountModalOpen = useStore(s => s.accountModalOpen);

  return (
    <>
      {txnModalOpen ? <TransactionFormModal /> : null}
      {budgetModalOpen ? <BudgetFormModal /> : null}
      {debtModalOpen ? <DebtFormModal /> : null}
      {assetModalOpen ? <AssetFormModal /> : null}
      {accountModalOpen ? <AccountFormModal /> : null}
    </>
  );
}

function AppShell() {
  const loading = useStore(s => s.loading);
  const cloudEnabled = useStore(s => s.cloudEnabled);
  const session = useStore(s => s.session);
  const currentHouseholdId = useStore(s => s.currentHouseholdId);
  const subscribeRealtime = useStore(s => s.subscribeRealtime);
  const refreshHouseholds = useStore(s => s.refreshHouseholds);
  const runRecurring = useStore(s => s.runRecurringEngine);
  const location = useLocation();
  const profile = useStore(s => s.profile);
  const transactions = useStore(s => s.transactions);
  useTheme();

  // Per-household onboarding trigger (spec §2). A household that already has data
  // or a recorded `onboardedAt` is an existing/returning one — migrate it to
  // `skipped` so it is NEVER re-onboarded (spec §3.4). A genuinely fresh
  // household with the flag on is sent through the flow once.
  const hasExistingData = !loading && (transactions.length > 0 || !!profile.onboardedAt);
  useEffect(() => {
    if (loading || !isOnboardingEnabled() || !currentHouseholdId) return;
    if (hasExistingData) migrateExistingHousehold(currentHouseholdId);
  }, [loading, currentHouseholdId, hasExistingData]);

  // Periodic recurring + notifications check (every 60s while app open)
  useEffect(() => {
    const id = setInterval(() => { runRecurring(); }, 60_000);
    return () => clearInterval(id);
  }, [runRecurring]);

  // TD-14 — surface local-storage / IndexedDB quota failures as a toast.
  // Without this the cache layer silently drops writes once the browser
  // hits its quota and the user has no idea their data isn't persisting.
  // Debounced via a sticky flag so a burst of failed writes shows once.
  useEffect(() => {
    let warned = false;
    const unsub = onStorageEvent((e) => {
      if (e.kind !== 'quota-exceeded' || warned) return;
      warned = true;
      useStore.getState().toast(
        'Local storage is full. Export a backup from Settings and clear old data.',
        'error',
      );
      // Allow another warning after a minute in case the user clears space.
      setTimeout(() => { warned = false; }, 60_000);
    });
    return unsub;
  }, []);

  // v4.1 — Realtime subscription on the active household
  useEffect(() => {
    if (!cloudEnabled || !session || !currentHouseholdId || currentHouseholdId === 'local') return;
    refreshHouseholds();
    const unsub = subscribeRealtime(currentHouseholdId);
    return unsub;
  }, [cloudEnabled, session, currentHouseholdId, subscribeRealtime, refreshHouseholds]);

  // Auth-only routes (rendered without Layout)
  const isAuthRoute = location.pathname.startsWith('/auth/') || location.pathname.startsWith('/invite/');
  if (isAuthRoute) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/auth/sign-in"        element={<SignIn />} />
          <Route path="/auth/sign-up"        element={<SignUp />} />
          <Route path="/auth/reset"          element={<ResetPassword />} />
          <Route path="/auth/reset-password" element={<ResetPassword />} />
          <Route path="/auth/verified"       element={<VerifiedAuth />} />
          <Route path="/invite/*"            element={<AcceptInvite />} />
        </Routes>
      </Suspense>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="display-italic text-3xl text-coral mb-2">Vyact</div>
          <div className="mono-label">Loading…</div>
        </div>
      </div>
    );
  }

  // Per-household onboarding (spec §2): a fresh household with the flag on is
  // routed into the flow on first entry. Existing households (data present /
  // onboardedAt set) are migrated to `skipped` above and fall through here. When
  // the flag is off, shouldOnboard() is always false → app behaves as before.
  const onOnboardingRoute = location.pathname.startsWith('/onboarding');
  if (!hasExistingData && !onOnboardingRoute && shouldOnboard(currentHouseholdId)) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <Layout>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/"             element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard"    element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/reports"      element={<Reports />} />
          <Route path="/recurring"    element={<Recurring />} />
          <Route path="/planner"      element={<Planner />} />
          <Route path="/chat"         element={<Chat />} />
          <Route path="/households"   element={<Households />} />
          <Route path="/budgets"      element={<Budgets />} />
          <Route path="/splits"       element={<Splits />} />
          <Route path="/debts"        element={<Debts />} />
          <Route path="/networth"     element={<NetWorth />} />
          <Route path="/accounts"     element={<Accounts />} />
          <Route path="/settings"     element={<Settings />} />
          <Route path="/help"         element={<Help />} />
          <Route path="/insights"     element={<Insights />} />
          <Route path="/privacy"      element={<Privacy />} />
          <Route path="/terms"        element={<Terms />} />
          <Route path="/cookies"      element={<Cookies />} />
          <Route path="/__e2e_error"  element={<E2EErrorTest />} />
          <Route path="/onboarding"   element={<Onboarding />} />
          <Route path="*"             element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );

}

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="display-italic text-3xl text-coral mb-2">Vyact</div>
        <div className="mono-label">Loading…</div>
      </div>
    </div>
  );
}
