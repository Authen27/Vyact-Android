// T4b (v10.125.0; audit XC-PRV-03; owner, 19 Oct 2026) — the app's view of the analytics choice.
//
// The choice itself is made by the one consent script every counting page carries (api/_consent.js,
// injected into index.html at build time): it asks on the web, and treats analytics as on in the Android
// app, whose own permissions cover it. This module reads and changes that choice for Settings, and is the
// only place the app reaches into the script's `window.__vyAnalytics`.

interface ConsentApi {
  site: boolean;
  native: boolean;
  choice: () => string | null;
  allow: () => void;
  decline: () => void;
}

declare global {
  interface Window { __vyAnalytics?: ConsentApi; __vyGaOn?: boolean }
}

export type AnalyticsState =
  /** Not counted here (localhost, a preview, stage/dev, tests): nothing to choose. */
  | 'unavailable'
  /** The Android app: on, through the app's own permissions. */
  | 'app'
  | 'on'
  | 'off'
  /** On the web, not chosen yet: the banner is asking. */
  | 'ask';

const api = (): ConsentApi | undefined => (typeof window === 'undefined' ? undefined : window.__vyAnalytics);

export function analyticsState(): AnalyticsState {
  const a = api();
  if (!a?.site) return 'unavailable';
  if (a.native) return 'app';
  const c = a.choice();
  return c === 'granted' ? 'on' : c === 'denied' ? 'off' : 'ask';
}

/** Allow or stop usage analytics on this device (the web only; the app's is set by the app). */
export function setAnalyticsAllowed(allowed: boolean): void {
  const a = api();
  if (!a?.site || a.native) return;
  if (allowed) a.allow(); else a.decline();
}
