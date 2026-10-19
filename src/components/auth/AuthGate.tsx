// Vyact v4.1 — AuthGate
//
// Sits at the top of the route tree. Three modes:
//   1. Cloud disabled (no env vars) — render children, app behaves as v6/v7 local-only.
//   2. Cloud enabled, user authed — render children.
//   3. Cloud enabled, user NOT authed — render auth screen, redirect attempts back to original URL.

import { type ReactNode, useEffect, useState } from 'react';
import { expected, unexpected } from '../../lib/faults';
import { useLocation, Navigate } from 'react-router-dom';
import { useStore } from '../../store';
import { isCloudEnabled, supabase } from '../../lib/supabase';
import { reactivateIfNeeded, acceptPolicies, signOut as authSignOut } from '../../lib/auth';
import { POLICY_VERSION } from '../../lib/policyVersion';
import PolicyUpdateSheet from './PolicyUpdateSheet';
import { trackSignUpOnce, setAnalyticsUser } from '../../lib/analytics';

const PUBLIC_ROUTES = [
  '/auth/sign-in', '/auth/sign-up', '/auth/reset', '/auth/reset-password', '/auth/verified',
  // Legal docs must be reviewable without an account — sign-up/login is not a
  // prerequisite to read them, and they need to be crawlable for trust/compliance.
  '/privacy', '/terms', '/cookies',
];
// Routes that must remain reachable even when a session exists. The password
// recovery link logs the user in (PASSWORD_RECOVERY event) before they've set
// a new password — bouncing them to /dashboard would abandon the flow.
const RECOVERY_ROUTES = ['/auth/reset', '/auth/reset-password'];

export default function AuthGate({ children }: { children: ReactNode }) {
  const session = useStore(s => s.session);
  const sessionLoaded = useStore(s => s.sessionLoaded);
  const setSession = useStore(s => s.setSession);
  const init = useStore(s => s.init);
  const toast = useStore(s => s.toast);
  // T4b (v10.125.0, XC-PRV-09) — the signed-in person's recorded acceptance is not this POLICY_VERSION.
  const [needsConsent, setNeedsConsent] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (!isCloudEnabled() || !supabase) {
      // Local-only mode — just init the app
      init();
      return;
    }

    // Hydrate session from Supabase + subscribe to changes
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session, true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess, true);
    });
    return () => sub.subscription.unsubscribe();
  }, [init, setSession]);

  // On every successful sign-in, clear any deactivation / pending-deletion
  // hold (Settings → Danger Zone) and record first-time ToS/Privacy consent
  // for flows that couldn't write it directly (OAuth redirect, email
  // verification pending) — see lib/auth.ts reactivateIfNeeded/acceptPolicies.
  // v10.53.0 (#55) — GA4 user_id follows the session: a hash of the user id while signed
  // in, cleared on sign-out.
  useEffect(() => {
    if (!isCloudEnabled()) return;
    void setAnalyticsUser(session?.user?.id ?? null);
  }, [session?.user?.id]);

  useEffect(() => {
    if (!isCloudEnabled() || !session?.user) return;
    // v10.53.0 (#46) — after counting a sign-up, mark the account so a second device
    // doesn't count it again (fire-and-forget; the per-device flag still holds).
    if (trackSignUpOnce(session.user)) {
      void supabase?.auth.updateUser({ data: { vy_signup_tracked: true } }).catch(() => { /* fault-ok: the device's own once-only mark still stops a second event here */ });
    }
    (async () => {
      if (sessionStorage.getItem('pending_policy_accept')) {
        // W8a (XC-PRV-09): a failed write is reported, and the flag stays so the next load retries it.
        try {
          await acceptPolicies(session.user.id);
          sessionStorage.removeItem('pending_policy_accept');
        } catch (e) { unexpected(e, 'consent:record'); }
      }
      // T4b (v10.125.0; owner, 19 Oct 2026: "accept on change") — an acceptance of an older text, or none
      // (a Google sign-up whose record was lost), is asked for again. Offline or unreadable: not asked now.
      try {
        const { data, error } = await supabase!.from('profiles').select('privacy_version').eq('id', session.user.id).maybeSingle();
        if (!error && data && (data as { privacy_version: string | null }).privacy_version !== POLICY_VERSION) setNeedsConsent(true);
      } catch (e) { expected(e, 'consent:read'); }
      const reactivated = await reactivateIfNeeded().catch(() => false);
      if (reactivated) toast('Welcome back — your account has been reactivated.', 'success');
    })();
  }, [session?.user?.id]);

  // Cloud disabled → bypass auth entirely
  if (!isCloudEnabled()) return <>{children}</>;

  // Wait for session check to complete
  if (!sessionLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="display-italic text-3xl text-coral mb-2">Vyact</div>
          <div className="mono-label">Checking your session…</div>
        </div>
      </div>
    );
  }

  // The landing page at "/" is public too, but it must be an EXACT match, not
  // folded into PUBLIC_ROUTES' .startsWith() scan — every path in the app
  // starts with "/", so adding it to that array would silently disable the
  // sign-in gate for the entire app.
  const isRoot = location.pathname === '/';
  const isPublic = isRoot || PUBLIC_ROUTES.some(p => location.pathname.startsWith(p)) ||
                   location.pathname.startsWith('/invite/');

  // Not signed in + on a private route → bounce to sign-in
  if (!session && !isPublic) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth/sign-in?next=${next}`} replace />;
  }

  // Signed in + on auth page → bounce to app (except recovery, which needs
  // the user to stay so they can set a new password).
  if (session && location.pathname.startsWith('/auth/') &&
      !RECOVERY_ROUTES.some(p => location.pathname.startsWith(p))) {
    return <Navigate to="/dashboard" replace />;
  }

  // T4b — never over the legal pages themselves, so the new text can be read first.
  const onLegalPage = /^\/(privacy|terms|cookies)\b/.test(location.pathname);
  return (
    <>
      {children}
      {session && needsConsent && !onLegalPage && (
        <PolicyUpdateSheet
          onAccept={async () => { await acceptPolicies(session.user.id); setNeedsConsent(false); toast('Thanks, that\'s recorded', 'success'); }}
          onSignOut={() => { void authSignOut(); }} />
      )}
    </>
  );
}
