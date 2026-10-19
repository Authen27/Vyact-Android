// Vyact — public landing page at "/" (v10.33.0; restored as the brand page in v10.50.0).
//
// Rendered Layout-less, before the `loading` gate (see App.tsx), and imported EAGERLY: the
// build pre-renders the same markup into dist/landing.html (scripts/prerender-landing.mjs),
// and a lazy import would swap that markup for a loading spinner before putting it back.
//
// The CTA reads real auth state, the same way AppShell/AuthGate do:
//   cloud mode + signed in  → "Go to Dashboard"
//   cloud mode + signed out → "Sign in" / sign-up with ?ref= per placement
//   local-only mode         → straight into the app, no auth concept here
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { isCloudEnabled } from '../lib/supabase';
import { track } from '../lib/analytics';
import LandingView from './LandingView';

type LandingWindow = { __vyLandingLive?: boolean; __vyPromo?: 'play' };

export default function Landing() {
  const session = useStore(s => s.session);
  const cloudMode = isCloudEnabled();
  // v10.108.0 — a tap on the promo poster before the app was up was handled by landing.html's boot
  // script (it counted the play and set __vyPromo). The app redraws #root on boot, so the player starts
  // here, once, rather than in the pre-rendered markup that the redraw would throw away.
  const [promoPlaying, setPromoPlaying] = useState(() =>
    typeof window !== 'undefined' && (window as unknown as LandingWindow).__vyPromo === 'play');
  // v10.54.0 — landing.html's boot script tracks CTA clicks until the app is up; from
  // here on the onCta below does, so it stands down (scripts/landingHtml.mjs, appBoot).
  useEffect(() => {
    (window as unknown as LandingWindow).__vyLandingLive = true;
  }, []);
  return (
    <LandingView
      cloudMode={cloudMode}
      signedIn={cloudMode && !!session}
      onCta={placement => track('landing_cta_click', { placement, page: '/' })}
      promoPlaying={promoPlaying}
      onPlayPromo={() => {
        if (promoPlaying) return;
        setPromoPlaying(true);
        track('landing_video_play', { page: '/' });
      }}
    />
  );
}
