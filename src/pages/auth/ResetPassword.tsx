import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Mail, KeyRound, CheckCircle, Eye, EyeOff, AlertCircle,
  ShieldCheck, ArrowLeft, Lock,
} from 'lucide-react';
import Button from '../../components/ui/Button';
import { Input, Field } from '../../components/ui/Input';
import { requestPasswordReset, updatePassword, getSession, signInMagicLink } from '../../lib/auth';
import { isCloudEnabled, supabase } from '../../lib/supabase';
import GoogleButton from '../../components/auth/GoogleButton';
import { AuthShell } from './SignIn';

type Step = 'request' | 'sent' | 'set' | 'done';

const STEP_ORDER: Step[] = ['request', 'sent', 'set', 'done'];
const STEP_LABELS: Record<Step, string> = {
  request: 'Request',
  sent: 'Email',
  set: 'New password',
  done: 'Done',
};

// Lightweight strength estimator: 0–4. Not a security gate (Supabase enforces
// its own min) — purely a UX nudge so users pick something better than 8 chars.
function scorePassword(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!pw) return { score: 0, label: '' };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  const score = Math.min(4, s) as 0 | 1 | 2 | 3 | 4;
  const label = ['Too short', 'Weak', 'Okay', 'Strong', 'Excellent'][score];
  return { score, label };
}

export default function ResetPassword() {
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // Three ways we can arrive at "set new password":
  //  1. PKCE recovery link: URL has `?code=...` — exchange it for a session.
  //  2. Legacy hash-token recovery: handled automatically by detectSessionInUrl,
  //     surfaces via the PASSWORD_RECOVERY auth event.
  //  3. Already-active recovery session (e.g. page refresh).
  useEffect(() => {
    if (!isCloudEnabled() || !supabase) return;
    let cancelled = false;

    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const errDesc = url.searchParams.get('error_description');
    if (errDesc) setError(decodeURIComponent(errDesc));

    (async () => {
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (error) {
          setError(error.message || 'This reset link is invalid or has expired. Request a new one.');
          return;
        }
        url.searchParams.delete('code');
        window.history.replaceState({}, '', url.pathname + (url.search || ''));
        setStep('set');
        return;
      }
      const session = await getSession();
      if (!cancelled && session?.user) setStep('set');
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setStep('set');
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  const strength = useMemo(() => scorePassword(newPassword), [newPassword]);
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  async function requestReset(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSubmitting(true);
    try {
      await requestPasswordReset(email);
      setStep('sent');
    } catch (e) { setError((e as Error).message); }
    finally { setSubmitting(false); }
  }

  async function setNew(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords don\u2019t match'); return; }
    setError(''); setSubmitting(true);
    try {
      await updatePassword(newPassword);
      setStep('done');
      setTimeout(() => navigate('/dashboard'), 1500);
    } catch (e) { setError((e as Error).message); }
    finally { setSubmitting(false); }
  }

  // ── Shared visual bits ────────────────────────────────────
  const StepDots = () => {
    const activeIdx = STEP_ORDER.indexOf(step);
    return (
      <ol className="flex items-center justify-center gap-2 mb-5" aria-label="Reset progress">
        {STEP_ORDER.map((s, i) => {
          const done = i < activeIdx;
          const active = i === activeIdx;
          return (
            <li key={s} className="flex items-center gap-2">
              <span
                aria-current={active ? 'step' : undefined}
                title={STEP_LABELS[s]}
                className={[
                  'h-1.5 rounded-full transition-all',
                  active ? 'w-8 bg-coral' : done ? 'w-4 bg-sage' : 'w-4 bg-line',
                ].join(' ')}
              />
            </li>
          );
        })}
      </ol>
    );
  };

  const ErrorBanner = ({ msg }: { msg: string }) => (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-terra/30 bg-terra/10 px-3 py-2.5 mb-3 text-[0.84rem] text-terra"
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span className="leading-snug">{msg}</span>
    </div>
  );

  const HeroIcon = ({ icon: Icon, tone = 'coral' }: { icon: typeof Mail; tone?: 'coral' | 'sage' }) => (
    <div
      className={[
        'mx-auto mb-4 h-14 w-14 rounded-full flex items-center justify-center',
        tone === 'sage' ? 'bg-sage/15 text-sage' : 'bg-coral/15 text-coral',
      ].join(' ')}
    >
      <Icon size={26} />
    </div>
  );

  // ── Local-only mode ───────────────────────────────────────
  if (!isCloudEnabled()) {
    return (
      <AuthShell title="Reset your password">
        <HeroIcon icon={Lock} />
        <p className="text-ink-mid text-sm text-center mb-4">
          Password reset needs cloud mode. You can still sign in below.
        </p>
        <GoogleButton />
        <div className="mt-5 pt-4 border-t border-line text-center text-sm text-ink-mid">
          <Link to="/auth/sign-in" className="text-coral font-medium hover:underline inline-flex items-center gap-1">
            <ArrowLeft size={14} /> Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  // ── Step: sent ────────────────────────────────────────────
  if (step === 'sent') return (
    <AuthShell title="Check your inbox">
      <StepDots />
      <div className="text-center">
        <HeroIcon icon={Mail} />
        <p className="text-ink-mid mb-2">We sent a password reset link to</p>
        <p className="text-ink font-medium mb-4 break-all">{email || 'your email'}</p>
        <p className="text-ink-dim text-[0.78rem] mb-5">
          The link is valid for 1 hour. Check your spam folder if it doesn't appear in a minute.
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => { setStep('request'); setError(''); }}
            className="text-coral hover:underline text-sm font-medium"
          >
            Use a different email
          </button>
          <Link to="/auth/sign-in" className="text-ink-mid hover:text-ink text-sm inline-flex items-center justify-center gap-1">
            <ArrowLeft size={14} /> Back to sign in
          </Link>
        </div>
      </div>
    </AuthShell>
  );

  // ── Step: done ────────────────────────────────────────────
  if (step === 'done') return (
    <AuthShell title="Password updated">
      <StepDots />
      <div className="text-center">
        <HeroIcon icon={CheckCircle} tone="sage" />
        <p className="text-ink-mid mb-1">You're all set.</p>
        <p className="text-ink-dim text-[0.78rem]">Redirecting to your dashboard…</p>
      </div>
    </AuthShell>
  );

  // ── Step: set ─────────────────────────────────────────────
  if (step === 'set') {
    const meterColors = ['bg-line', 'bg-terra', 'bg-honey', 'bg-sage', 'bg-olive'];
    return (
      <AuthShell title="Set a new password">
        <StepDots />
        <div className="flex items-center gap-2 text-[0.78rem] text-ink-mid mb-4 justify-center">
          <ShieldCheck size={14} className="text-sage" />
          <span>Your recovery link is verified. Choose a new password.</span>
        </div>
        <form onSubmit={setNew} noValidate>
          <Field label="New password" hint="min 8 chars">
            <div className="relative">
              <Input
                type={showPw ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required autoFocus minLength={8}
                className="pr-10"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPw(s => !s)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 px-3 flex items-center text-ink-dim hover:text-ink"
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>

          {newPassword.length > 0 && (
            <div className="-mt-2 mb-3.5" aria-live="polite">
              <div className="flex gap-1 mb-1">
                {[1, 2, 3, 4].map(i => (
                  <span
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      i <= strength.score ? meterColors[strength.score] : 'bg-line'
                    }`}
                  />
                ))}
              </div>
              <div className="font-mono text-[0.6rem] tracking-[0.12em] uppercase text-ink-dim">
                Strength: <span className="text-ink-mid">{strength.label}</span>
              </div>
            </div>
          )}

          <Field label="Confirm password">
            <Input
              type={showPw ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required minLength={8}
              autoComplete="new-password"
              aria-invalid={mismatch}
            />
          </Field>
          {mismatch && (
            <div className="text-terra text-[0.78rem] -mt-2 mb-3">Passwords don't match.</div>
          )}

          {error && <ErrorBanner msg={error} />}

          <Button full type="submit" disabled={submitting || mismatch || newPassword.length < 8}>
            {submitting ? 'Updating…' : <><KeyRound size={14} /> Update password</>}
          </Button>
        </form>
      </AuthShell>
    );
  }

  // ── Step: request (default) ───────────────────────────────
  return (
    <AuthShell title="Reset your password">
      <StepDots />
      <form onSubmit={requestReset}>
        <p className="text-ink-mid text-sm mb-4 text-center">
          Enter your email and we'll send you a secure reset link.
        </p>
        <Field label="Email">
          <Input
            type="email" value={email}
            onChange={e => setEmail(e.target.value)}
            required autoFocus placeholder="you@example.com"
            autoComplete="email"
          />
        </Field>
        {error && <ErrorBanner msg={error} />}
        <Button full type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : <><Mail size={14} /> Send reset link</>}
        </Button>
      </form>

      <div className="my-4 flex items-center gap-3">
        <div className="flex-1 h-px bg-line" />
        <span className="font-mono text-[0.6rem] tracking-wider uppercase text-ink-dim">or</span>
        <div className="flex-1 h-px bg-line" />
      </div>

      <GoogleButton />

      <button
        type="button"
        onClick={async () => {
          if (!email) { setError('Enter your email first, then use the magic link.'); return; }
          setError('');
          try { await signInMagicLink(email); setStep('sent'); }
          catch (e) { setError((e as Error).message); }
        }}
        className="w-full text-center text-coral hover:underline text-sm font-medium mt-3"
      >
        Email me a one-time sign-in link instead
      </button>

      <p className="text-ink-dim text-[0.78rem] text-center mt-3">
        Reset emails not arriving? Use Google or the one-time link above to get back in.
      </p>

      <div className="mt-5 pt-4 border-t border-line text-center text-sm text-ink-mid">
        <Link to="/auth/sign-in" className="text-coral font-medium hover:underline inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}
