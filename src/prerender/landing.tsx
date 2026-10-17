// Build-time entry: renders the public landing page to static HTML (v10.50.0).
// Used only by scripts/prerender-landing.mjs (a Vite SSR build of this file); never shipped
// to the browser. The visitor sees the signed-out page; the app re-renders it with real
// auth state once its script loads.
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import LandingView from '../pages/LandingView';

export * as copy from '../content/landingCopy';

export function renderLanding(cloudMode: boolean): string {
  return renderToString(
    <MemoryRouter initialEntries={['/']}>
      <LandingView cloudMode={cloudMode} signedIn={false} />
    </MemoryRouter>,
  );
}
