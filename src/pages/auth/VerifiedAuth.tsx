import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, CheckCircle } from 'lucide-react';
import { AuthShell } from './SignIn';
import { getSession } from '../../lib/auth';

function getPostAuthPath(): string {
  const pendingInvite = sessionStorage.getItem('pending_invite_token');
  if (pendingInvite) return `/invite/${encodeURIComponent(pendingInvite)}`;
  return '/dashboard';
}

export default function VerifiedAuth() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getSession();
      if (cancelled || !session) return;
      navigate(getPostAuthPath(), { replace: true });
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  return (
    <AuthShell title="Finishing sign-in">
      <div className="text-center">
        <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-sage/15 text-sage flex items-center justify-center">
          <CheckCircle size={26} />
        </div>
        <p className="text-ink-mid mb-2">Your account is verified.</p>
        <p className="text-ink-dim text-sm inline-flex items-center gap-2 justify-center">
          <Mail size={14} /> Taking you back to Vyact…
        </p>
      </div>
    </AuthShell>
  );
}