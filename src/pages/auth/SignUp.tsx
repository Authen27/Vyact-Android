import { useState, useEffect } from 'react';
import { unexpected } from '../../lib/faults';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { UserPlus, Mail } from 'lucide-react';
import Button from '../../components/ui/Button';
import { Input, Field } from '../../components/ui/Input';
import PasswordInput from '../../components/ui/PasswordInput';
import { signUp, signIn, acceptPolicies } from '../../lib/auth';
import GoogleButton from '../../components/auth/GoogleButton';
import { AuthShell } from './SignIn';
import { useStore } from '../../store';
import { rememberSignupRef } from '../../lib/analytics';
import { postAuthPath, rememberNext } from '../../lib/postAuth';

// v10.49.0 (#20) — one rule for where sign-up lands (lib/postAuth.ts): a pending invite,
// else the in-app `next` a landing / Learn link asked for, else the dashboard.
const getPostAuthPath = (next: string | null): string => postAuthPath(next);

export default function SignUp() {
  const [params] = useSearchParams();
  const [name, setName] = useState('');
  // v10.59.0 — a split invitation links here with ?email= (the address the split was shared with).
  const [email, setEmail] = useState(() => (params.get('email') ?? '').trim().slice(0, 254));
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [verificationPending, setVerificationPending] = useState(false);
  const navigate = useNavigate();
  // v10.49.0 (#5) — where this sign-up came from (landing / Learn links carry ?ref=).
  useEffect(() => { rememberSignupRef(params.get('ref')); rememberNext(params.get('next')); }, [params]);
  // v10.49.0 (#20) — two steps: choose Google or email first; the email form only when asked for.
  const [step, setStep] = useState<'choose' | 'email'>(() => (params.get('method') === 'email' ? 'email' : 'choose'));
  const toast = useStore(s => s.toast);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (!agreed) { setError('Please confirm you are 18 or older and accept the Terms of Service and Privacy Policy to continue'); return; }
    setError(''); setSubmitting(true);
    const next = params.get('next');
    // Consumed by AuthGate on next session hydration — covers the email-verification-pending
    // path where signIn() below can throw before we get a chance to record acceptance here.
    sessionStorage.setItem('pending_policy_accept', '1');
    try {
      const result = await signUp({ email, password, displayName: name });

      // Path A — auto-confirm enabled (preferred): session is returned, log straight in.
      if (result.session && result.user) {
        await acceptPolicies(result.user.id).catch(e => unexpected(e, 'consent:record'));   // W8a (XC-PRV-09): never silent
        toast(`Welcome, ${name}!`, 'success');
        navigate(getPostAuthPath(next));
        return;
      }

      // Path B — email confirmation enabled but user can sign in with password
      // anyway (no real gate). Try a password sign-in immediately so the user
      // doesn't have to wait for a verification email that may never arrive.
      try {
        await signIn(email, password);
        if (result.user) await acceptPolicies(result.user.id).catch(e => unexpected(e, 'consent:record'));   // W8a (XC-PRV-09): never silent
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

      <label className="flex items-start gap-2 text-[0.82rem] text-ink-mid select-none cursor-pointer mb-4">
        <input type="checkbox" className="mt-0.5" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
        <span>
          I am 18 or older and agree to the <Link to="/terms" target="_blank" className="text-coral hover:underline">Terms of Service</Link>,{' '}
          <Link to="/privacy" target="_blank" className="text-coral hover:underline">Privacy Policy</Link>, and{' '}
          <Link to="/cookies" target="_blank" className="text-coral hover:underline">Cookie Policy</Link>.
        </span>
      </label>

      {step === 'choose' ? (
        <>
          {/* Step 1 — Google is one tap; email is one more step. */}
          <GoogleButton requireAgreement agreed={agreed} next={params.get('next')} />
          <button type="button" className="btn-ghost w-full mt-3 inline-flex items-center justify-center gap-2" onClick={() => setStep('email')}>
            <Mail size={14} /> Sign up with email
          </button>
          <p className="text-center text-[0.78rem] text-ink-dim mt-3">Free to start. Invite your household once you’re in.</p>
        </>
      ) : (
      <form onSubmit={onSubmit}>
        <Field label="Full name">
          <Input type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required autoFocus placeholder="Alex Morgan" />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" />
        </Field>
        <Field label="Password" hint="min 8 chars">
          <PasswordInput autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" minLength={8} />
        </Field>
        {error && <div role="alert" className="text-terra text-[0.84rem] mb-3">{error}</div>}
        <Button full type="submit" disabled={submitting || !agreed}>
          {submitting ? 'Creating account…' : <><UserPlus size={14} /> Sign up</>}
        </Button>
        <button type="button" className="w-full text-center text-[0.82rem] text-ink-dim mt-3 hover:text-ink" onClick={() => setStep('choose')}>
          ← Use Google instead
        </button>
      </form>
      )}

      <div className="mt-5 pt-4 border-t border-line text-center text-sm text-ink-mid">
        Already have an account? <Link to={params.get('next') ? `/auth/sign-in?next=${encodeURIComponent(params.get('next')!)}` : '/auth/sign-in'} className="text-coral font-medium hover:underline">Sign in</Link>
      </div>
    </AuthShell>
  );
}
