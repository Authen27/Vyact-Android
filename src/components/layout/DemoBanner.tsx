import { Sparkles } from 'lucide-react';

/** v10.57.0 (B20) — true on the guest demo build (demo.vyact.app, built with VYACT_DEMO=1). */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

/** Where the demo sends a visitor who wants their own household. `ref=demo` is read by the
 *  sign-up page like any other ref, so GA can count sign-ups that came from the demo. */
export const DEMO_SIGN_UP_URL = 'https://vyact.app/auth/sign-up?ref=demo';

/**
 * The strip across the top of the guest demo. The demo is the app in local-only mode on the
 * first-run demo household: nothing is saved to an account and nothing leaves the browser, so
 * the strip says so and offers the real thing. Renders nothing outside the demo build.
 */
export default function DemoBanner() {
  if (!IS_DEMO) return null;
  return (
    <div
      role="note"
      data-testid="demo-banner"
      className="w-full bg-coral text-[color:var(--accent-ink)] text-sm px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center"
    >
      <span className="inline-flex items-center gap-1.5">
        <Sparkles size={14} aria-hidden="true" />
        You’re exploring a demo household. Nothing here is saved to an account.
      </span>
      <a
        href={DEMO_SIGN_UP_URL}
        className="font-semibold underline underline-offset-2 whitespace-nowrap"
      >
        Start your own, free →
      </a>
    </div>
  );
}
