import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LogIn, Mail } from 'lucide-react';
import Button from '../../components/ui/Button';
import { Input, Field } from '../../components/ui/Input';
import PasswordInput from '../../components/ui/PasswordInput';
import { signIn, signInMagicLink } from '../../lib/auth';
import GoogleButton from '../../components/auth/GoogleButton';
import { useStore } from '../../store';
import { Pip } from '../../components/layout/Brand';
import { postAuthPath } from '../../lib/postAuth';

// W0 (audit 2026-10-04, FE-PLT-01) — this page used its own helper that returned `next`
// unchecked, so /auth/sign-in?next=https://lookalike landed a real sign-in on another site.
// Same rule as sign-up and /auth/verified now: only in-app paths, a pending invite wins.
const getPostAuthPath = (next: string | null): string => postAuthPath(next);

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
      <GoogleButton consentByContinuing />

      <div className="my-4 flex items-center gap-3">
        <div className="flex-1 h-px bg-line" />
        <span className="text-[12px] text-ink-dim">or sign in with email</span>
        <div className="flex-1 h-px bg-line" />
      </div>

      {/* Secondary — email / password */}
      <form onSubmit={onSubmit}>
        <Field label="Email">
          <Input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder="you@example.com" />
        </Field>
        {mode === 'password' && (
          <div className="ui-field mb-3.5">
            <div className="flex items-baseline justify-between gap-3 mb-1.5">
              <label htmlFor="signin-password" className="ui-label">Password</label>
              <Link to="/auth/reset-password" className="text-[12.5px] font-medium text-coral hover:underline">Forgot?</Link>
            </div>
            <PasswordInput id="signin-password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
          </div>
        )}
        {error && <div role="alert" className="text-terra text-[0.84rem] mb-3">{error}</div>}
        <Button full type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : mode === 'password' ? <><LogIn size={14} /> Sign in</> : <><Mail size={14} /> Send magic link</>}
        </Button>
      </form>

      {/* AU1 — the magic link is a ghost button under Sign in (was a text link, then Forgot password and
          Create account stacked in the footer: three secondary paths). */}
      <Button variant="ghost" full className="mt-2.5"
        onClick={() => { setMode(m => m === 'password' ? 'magic' : 'password'); setError(''); }}>
        {mode === 'password' ? <><Mail size={14} /> Email me a sign-in link instead</> : <><LogIn size={14} /> Sign in with password instead</>}
      </Button>

      <div className="mt-5 pt-4 border-t border-line text-center text-sm text-ink-mid">
        New here? <Link to={params.get('next') ? `/auth/sign-up?next=${encodeURIComponent(params.get('next')!)}` : '/auth/sign-up'} className="text-coral font-medium hover:underline">Create an account</Link>
      </div>
    </AuthShell>
  );
}

// Board E — auth-card: a single glass card on the aurora ambient background,
// pip up top, whisper inputs. Shared by every auth screen.
export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ui-pilot min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <Link to="/" className="flex flex-col items-center gap-2 text-center mb-7">
          <Pip size={40} />
          <div>
            <div className="display-italic text-2xl text-ink leading-none">Vy<span style={{ color: 'var(--accent)' }}>act</span></div>
            <div className="text-[12px] text-ink-dim mt-1.5">Family budget app</div>
          </div>
        </Link>
        <div className="rounded-r3 sm:rounded-r4 p-6 sm:p-7" data-testid="auth-card" style={{ background: 'var(--glass-strong)', backdropFilter: 'var(--blur)', WebkitBackdropFilter: 'var(--blur)', border: '1px solid var(--glass-line)', boxShadow: 'var(--cast-3)' }}>
          <h1 className="display-italic text-2xl text-ink mb-5 text-center">{title}</h1>
          {children}
        </div>
        {/* v10.49.0 (#10) — the public library needs no account. A plain <a>: /learn is
            server-rendered, not an app route. */}
        <p className="text-center text-[0.84rem] text-ink-dim mt-5">
          Not ready to sign up? <a href="/learn" className="text-coral font-medium hover:underline">Browse free money lessons →</a>
        </p>
      </div>
    </div>
  );
}
