// Vyact v4.1 — AuthGate
//
// Sits at the top of the route tree. Three modes:
//   1. Cloud disabled (no env vars) — render children, app behaves as v6/v7 local-only.
//   2. Cloud enabled, user authed — render children.
//   3. Cloud enabled, user NOT authed — render auth screen, redirect attempts back to original URL.

import { type ReactNode, useEffect } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { useStore } from '../../store';
import { isCloudEnabled, supabase } from '../../lib/supabase';

const PUBLIC_ROUTES = ['/auth/sign-in', '/auth/sign-up', '/auth/reset', '/auth/reset-password', '/auth/verified'];
// Routes that must remain reachable even when a session exists. The password
// recovery link logs the user in (PASSWORD_RECOVERY event) before they've set
// a new password — bouncing them to /dashboard would abandon the flow.
const RECOVERY_ROUTES = ['/auth/reset', '/auth/reset-password'];

export default function AuthGate({ children }: { children: ReactNode }) {
  const session = useStore(s => s.session);
  const sessionLoaded = useStore(s => s.sessionLoaded);
  const setSession = useStore(s => s.setSession);
  const init = useStore(s => s.init);
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

  const isPublic = PUBLIC_ROUTES.some(p => location.pathname.startsWith(p)) ||
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

  return <>{children}</>;
}
