import { useState } from 'react';
import { signInOAuth } from '../../lib/auth';

// Primary Google sign-in CTA. Always rendered — provider misconfiguration
// surfaces as an inline error, not a missing button. signInOAuth redirects the
// browser to Google's consent screen, which returns to /auth/verified, where
// VerifiedAuth completes the session and routes to /dashboard. The Supabase
// Google provider + client ID/secret + redirect allowlist are configured in the
// Supabase dashboard (the secret lives only there, never in this repo).
export default function GoogleButton() {
  const [busy, setBusy] = useState(false);
  const [oauthError, setOauthError] = useState('');

  async function go() {
    setBusy(true);
    setOauthError('');
    try {
      await signInOAuth('google');   // redirects away on success
      // If we reach here the redirect didn't fire — treat as an error.
      setBusy(false);
    } catch (e) {
      setOauthError(
        (e as Error).message.includes('provider')
          ? 'Google sign-in is not configured yet. Please use email below.'
          : (e as Error).message
      );
      setBusy(false);
    }
  }

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 border border-line rounded-md py-2.5 text-sm font-medium text-ink hover:bg-bg3 transition-colors disabled:opacity-60"
      >
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 0-24c3.1 0 5.9 1.2 8 3.1l5.7-5.7A20 20 0 1 0 24 44a20 20 0 0 0 19.6-23.5z"/>
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 24 36c-5.2 0-9.6-3.3-11.2-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C39.9 36 44 30.6 44 24c0-1.2-.1-2.4-.4-3.5z"/>
        </svg>
        {busy ? 'Redirecting…' : 'Continue with Google'}
      </button>
      {oauthError && (
        <p className="text-terra text-[0.78rem] text-center mt-2">{oauthError}</p>
      )}
    </div>
  );
}
