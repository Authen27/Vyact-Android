import { useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from './store';
import { useTheme } from './hooks';
import { onStorageEvent } from './lib/storageEvents';
import { isOnboardingEnabled } from './config/features';
import { shouldOnboard, migrateExistingHousehold } from './lib/onboardingState';
import Layout from './components/layout/Layout';
import ToastHost from './components/ui/ToastHost';
import FaultsPanel from './components/dev/FaultsPanel';
import AuthGate from './components/auth/AuthGate';
import UpdateBanner from './components/layout/UpdateBanner';
import InstallBanner from './components/layout/InstallBanner';
import HistoryRestoration from './components/layout/HistoryRestoration';
import { bindAppNavigate } from './lib/appNavigation';
import { isFormRoute } from './lib/formRoutes';


import React, { Suspense } from 'react';
// v10.28.0 — the entity forms are routed pages (pages/FormPages.tsx), not root modals.
const FormPages    = React.lazy(() => import('./pages/FormPages'));
const Dashboard    = React.lazy(() => import('./pages/Dashboard'));
const Transactions = React.lazy(() => import('./pages/Transactions'));
const Reports      = React.lazy(() => import('./pages/Reports'));
const Recurring    = React.lazy(() => import('./pages/Recurring'));
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
const Landing      = React.lazy(() => import('./pages/Landing'));
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
        <HistoryRestoration />
        <NavigationBridge />
        <AppShell />
        <ToastHost />
        {/* SyncHealthIndicator removed (v10.20.4, product decision).
            It surfaced a "Some changes may not have synced" banner with a
            Refresh action on every dead-lettered write. Two problems made it
            worse than useless in practice:
              · it interrupted the user for a condition they cannot act on, and
              · its Refresh called `manualRefresh()`, which is a PULL — it can
                never re-send a write that failed to push, so the offered
                remedy did not address the message.
            Faults are still recorded in the `lib/faults.ts` ring buffer, so
            nothing is lost at the data layer and FaultsPanel (dev) still shows
            them. What is gone is the interruption. */}
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

// v10.28.0 — lets the store's openAdd*/openEdit* actions open the form pages.
// A Zustand action cannot call useNavigate(), so the live function is bound here.
function NavigationBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    bindAppNavigate(navigate);
    return () => bindAppNavigate(null);
  }, [navigate]);
  return null;
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

  // Resolve WHO I AM in the active household. Runs in BOTH modes.
  //
  // This used to live inside the realtime effect below, behind its
  // `!cloudEnabled || !session` guard — so in local-only mode it never ran at
  // all. `myRole` stayed at its initial `undefined`, `can()` fell through to
  // its deny-by-default (`action === 'view'`), and every write-gated screen
  // rendered read-only: no Add Budget, no delete household, no recurring edit.
  // The "local-only: you own everything" fallback inside refreshHouseholds was
  // dead code, because the only caller was gated on cloud being ON.
  //
  // It also blinded the whole e2e suite: Lane A builds in local-only mode, so
  // no test could ever open the editors those screens gate. Fixing the product
  // bug is what makes those journeys testable — hence Phase 0.
  useEffect(() => {
    void refreshHouseholds();
  }, [cloudEnabled, session, currentHouseholdId, refreshHouseholds]);

  // v4.1 — Realtime subscription on the active household. Cloud-only: there is
  // nothing to subscribe to in local-only mode, and 'local' is not a real row.
  useEffect(() => {
    if (!cloudEnabled || !session || !currentHouseholdId || currentHouseholdId === 'local') return;
    const unsub = subscribeRealtime(currentHouseholdId);
    return unsub;
  }, [cloudEnabled, session, currentHouseholdId, subscribeRealtime]);

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

  // Legal docs (rendered without Layout, and BEFORE the `loading` gate below) —
  // an anonymous visitor or crawler hitting these must see content immediately,
  // not an indefinite "Loading…" spinner (cloud-mode `loading` only resolves
  // once init() runs, which never happens for a signed-out session).
  const isLegalRoute = ['/privacy', '/terms', '/cookies'].some(p => location.pathname.startsWith(p));
  if (isLegalRoute) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms"   element={<Terms />} />
            <Route path="/cookies" element={<Cookies />} />
          </Routes>
        </Suspense>
      </div>
    );
  }

  // Landing page (rendered without Layout, and BEFORE the `loading` gate below,
  // for the same reason legal docs are above) — an anonymous visitor or crawler
  // hitting "/" must see content immediately, not an indefinite "Loading…"
  // spinner (cloud-mode `loading` only resolves once init() runs, which never
  // happens for a signed-out session).
  if (location.pathname === '/') {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <Landing />
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

  // Onboarding is a focused, full-bleed flow — render it WITHOUT the Layout
  // chrome (no top bar / sub-nav / mobile tab bar / FAB), mirroring how the
  // auth and legal routes render Layout-less above. Applies to desktop + mobile.
  if (onOnboardingRoute) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <Onboarding />
      </Suspense>
    );
  }

  // v10.28.0 — the entity forms (Add/Edit Transaction, Split, Debt, Budget,
  // Account, Asset, and Reconcile Account) are focused full-screen pages. Like
  // onboarding they render WITHOUT the Layout chrome: just the form, its Close
  // control and the Save bar.
  if (isFormRoute(location.pathname)) {
    return (
      <Suspense fallback={<div className="min-h-[100dvh]" style={{ background: 'var(--canvas)' }} />}>
        <FormPages />
      </Suspense>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/dashboard"    element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/reports"      element={<Reports />} />
          <Route path="/recurring"    element={<Recurring />} />
          <Route path="/planner"      element={<Navigate to="/insights?tab=for-you" replace />} />
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
