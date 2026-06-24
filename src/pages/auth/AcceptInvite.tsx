import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { CheckCircle, AlertTriangle, Mail } from 'lucide-react';
import Button from '../../components/ui/Button';
import { acceptInvitation, getSession } from '../../lib/auth';
import { AuthShell } from './SignIn';
import { useStore } from '../../store';

export default function AcceptInvite() {
  const params = useParams<{ token?: string; '*': string }>();
  const rawToken = params.token ?? params['*'] ?? new URLSearchParams(window.location.search).get('token') ?? '';
  const token = rawToken ? decodeURIComponent(rawToken) : '';
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'need_signin' | 'success' | 'error'>('loading');
  const [error, setError] = useState('');
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const switchHousehold = useStore(s => s.switchHousehold);
  const refresh = useStore(s => s.refresh);
  const toast = useStore(s => s.toast);

  useEffect(() => {
    if (!token) { setStatus('error'); setError('No invitation token'); return; }
    (async () => {
      const session = await getSession();
      if (!session) {
        // Stash token, prompt sign-in
        sessionStorage.setItem('pending_invite_token', token);
        setStatus('need_signin');
        return;
      }
      try {
        const result = await acceptInvitation(token);
        setHouseholdId(result.household_id);
        setStatus('success');
        // Switch to the new household after a moment
        setTimeout(async () => {
          await switchHousehold(result.household_id);
          await refresh();
          toast('Welcome to the household!', 'success');
          navigate('/dashboard');
        }, 1800);
      } catch (e) {
        setError((e as Error).message);
        setStatus('error');
      }
    })();
  }, [token, switchHousehold, refresh, toast, navigate]);

  if (status === 'loading') {
    return <AuthShell title="Accepting invitation…"><div className="text-center text-ink-mid py-6">One moment…</div></AuthShell>;
  }

  if (status === 'need_signin') {
    const next = encodeURIComponent(`/invite/${encodeURIComponent(token)}`);
    return (
      <AuthShell title="Sign in to accept">
        <div className="text-center">
          <Mail size={48} className="mx-auto text-coral mb-4" />
          <p className="text-ink-mid mb-5">
            You've been invited to join a household on Vyact. Sign in or create an account to accept.
          </p>
          <div className="space-y-2.5">
            <Link to={`/auth/sign-in?next=${next}`}>
              <Button full>Sign in</Button>
            </Link>
            <Link to={`/auth/sign-up?next=${next}`} className="block text-coral hover:underline text-sm font-medium">
              Don't have an account? Sign up
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  if (status === 'success') {
    return (
      <AuthShell title="Welcome!">
        <div className="text-center">
          <CheckCircle size={48} className="mx-auto text-sage mb-4" />
          <p className="text-ink-mid mb-2">Invitation accepted.</p>
          <p className="text-ink-dim text-sm">Switching to your new household…</p>
          {householdId && <code className="block mt-3 font-mono text-[0.62rem] text-ink-dim">{householdId}</code>}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Couldn't accept invitation">
      <div className="text-center">
        <AlertTriangle size={48} className="mx-auto text-terra mb-4" />
        <p className="text-ink-mid mb-2">Something went wrong:</p>
        <p className="text-terra text-[0.84rem] mb-5 font-mono">{error}</p>
        <p className="text-ink-dim text-sm mb-5">
          Common reasons: token expired, already accepted, or sent to a different email than you're signed in with.
        </p>
        <Link to="/dashboard">
          <Button variant="ghost" full>Back to app</Button>
        </Link>
      </div>
    </AuthShell>
  );
}
