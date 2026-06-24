import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LogIn, Mail, KeyRound } from 'lucide-react';
import Button from '../../components/ui/Button';
import { Input, Field } from '../../components/ui/Input';
import { signIn, signInMagicLink } from '../../lib/auth';
import GoogleButton from '../../components/auth/GoogleButton';
import { useStore } from '../../store';

function getPostAuthPath(next: string | null): string {
  const pendingInvite = sessionStorage.getItem('pending_invite_token');
  if (next) return next;
  if (pendingInvite) return `/invite/${encodeURIComponent(pendingInvite)}`;
  return '/dashboard';
}

export default function SignIn() {
  const [mode, setMode] = useState<'password' | 'magic'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [magicSent, setMagicSent] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const toast = useStore(s => s.toast);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSubmitting(true);
    const next = params.get('next');
    try {
      if (mode === 'password') {
        await signIn(email, password);
        toast('Welcome back', 'success');
        navigate(getPostAuthPath(next));
      } else {
        await signInMagicLink(email);
        setMagicSent(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (magicSent) {
    return (
      <AuthShell title="Check your inbox">
        <div className="text-center">
          <Mail size={48} className="mx-auto text-coral mb-4" />
          <p className="text-ink-mid mb-4">
            We sent a sign-in link to <strong className="text-ink">{email}</strong>. Click it to continue.
          </p>
          <button onClick={() => setMagicSent(false)} className="text-coral hover:underline text-sm">
            Use a different email
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Welcome back">

      {/* Primary CTA — Google SSO */}
      <GoogleButton />

      <div className="my-4 flex items-center gap-3">
        <div className="flex-1 h-px bg-line" />
        <span className="font-mono text-[0.6rem] tracking-wider uppercase text-ink-dim">or sign in with email</span>
        <div className="flex-1 h-px bg-line" />
      </div>

      {/* Secondary — email / password */}
      <form onSubmit={onSubmit}>
        <Field label="Email">
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder="you@example.com" />
        </Field>
        {mode === 'password' && (
          <Field label="Password">
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
          </Field>
        )}
        {error && <div className="text-terra text-[0.84rem] mb-3">{error}</div>}
        <Button full type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : mode === 'password' ? <><LogIn size={14} /> Sign in</> : <><Mail size={14} /> Send magic link</>}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => { setMode(m => m === 'password' ? 'magic' : 'password'); setError(''); }}
        className="w-full text-center text-coral hover:underline text-sm font-medium mt-3"
      >
        {mode === 'password' ? 'Sign in with magic link instead' : 'Sign in with password instead'}
      </button>

      <div className="mt-5 pt-4 border-t border-line text-center text-sm text-ink-mid">
        <Link to="/auth/reset-password" className="hover:underline flex items-center justify-center gap-1.5">
          <KeyRound size={12} /> Forgot password?
        </Link>
        <div className="mt-2.5">
          New here? <Link to={params.get('next') ? `/auth/sign-up?next=${encodeURIComponent(params.get('next')!)}` : '/auth/sign-up'} className="text-coral font-medium hover:underline">Create an account</Link>
        </div>
      </div>
    </AuthShell>
  );
}

export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="block text-center mb-8">
          <div className="display-italic text-4xl text-coral leading-none">Vyact</div>
          <div className="font-mono text-[0.6rem] tracking-[0.2em] uppercase text-ink-dim mt-1.5">Family Finance OS</div>
        </Link>
        <div className="panel p-7">
          <h1 className="display-italic text-2xl text-ink mb-5 text-center">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}
