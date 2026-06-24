import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { UserPlus, Mail } from 'lucide-react';
import Button from '../../components/ui/Button';
import { Input, Field } from '../../components/ui/Input';
import { signUp, signIn } from '../../lib/auth';
import GoogleButton from '../../components/auth/GoogleButton';
import { AuthShell } from './SignIn';
import { useStore } from '../../store';

function getPostAuthPath(next: string | null): string {
  const pendingInvite = sessionStorage.getItem('pending_invite_token');
  if (next) return next;
  if (pendingInvite) return `/invite/${encodeURIComponent(pendingInvite)}`;
  return '/dashboard';
}

export default function SignUp() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [verificationPending, setVerificationPending] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const toast = useStore(s => s.toast);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setError(''); setSubmitting(true);
    const next = params.get('next');
    try {
      const result = await signUp({ email, password, displayName: name });

      // Path A — auto-confirm enabled (preferred): session is returned, log straight in.
      if (result.session) {
        toast(`Welcome, ${name}!`, 'success');
        navigate(getPostAuthPath(next));
        return;
      }

      // Path B — email confirmation enabled but user can sign in with password
      // anyway (no real gate). Try a password sign-in immediately so the user
      // doesn't have to wait for a verification email that may never arrive.
      try {
        await signIn(email, password);
        toast(`Welcome, ${name}! Your email is pending verification — check Settings to resend.`, 'success');
        navigate(getPostAuthPath(next));
        return;
      } catch {
        // Path C — confirmation strictly required by the project.
        // Show pending state but don't strand the user.
        setVerificationPending(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (verificationPending) {
    return (
      <AuthShell title="Account created">
        <div className="text-center">
          <Mail size={48} className="mx-auto text-coral mb-4" />
          <p className="text-ink-mid mb-2">
            Your account for <strong className="text-ink">{email}</strong> is created.
          </p>
          <p className="text-ink-mid text-sm mb-5">
            Email verification is pending — you can still sign in below. We will show
            a "verification pending" badge in your Settings until you confirm.
          </p>
          <Link
            to={`/auth/sign-in?email=${encodeURIComponent(email)}${params.get('next') ? `&next=${encodeURIComponent(params.get('next')!)}` : ''}`}
            className="btn-primary inline-flex items-center"
          >
            Continue to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account">

      {/* Primary CTA — Google SSO */}
      <GoogleButton />

      <div className="my-4 flex items-center gap-3">
        <div className="flex-1 h-px bg-line" />
        <span className="font-mono text-[0.6rem] tracking-wider uppercase text-ink-dim">or sign up with email</span>
        <div className="flex-1 h-px bg-line" />
      </div>

      {/* Secondary — email form */}
      <form onSubmit={onSubmit}>
        <Field label="Full name">
          <Input type="text" value={name} onChange={e => setName(e.target.value)} required autoFocus placeholder="Alex Morgan" />
        </Field>
        <Field label="Email">
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" />
        </Field>
        <Field label="Password" hint="min 8 chars">
          <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" minLength={8} />
        </Field>
        {error && <div className="text-terra text-[0.84rem] mb-3">{error}</div>}
        <Button full type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : <><UserPlus size={14} /> Sign up</>}
        </Button>
      </form>

      <div className="mt-5 pt-4 border-t border-line text-center text-sm text-ink-mid">
        Already have an account? <Link to={params.get('next') ? `/auth/sign-in?next=${encodeURIComponent(params.get('next')!)}` : '/auth/sign-in'} className="text-coral font-medium hover:underline">Sign in</Link>
      </div>
    </AuthShell>
  );
}
