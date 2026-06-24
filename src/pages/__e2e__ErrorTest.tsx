import React from 'react';

// Exercises the top-level ErrorBoundary (CON-E2E-005). It throws on EVERY
// render until a recovery signal is set, then renders normally.
//
// Why "every render, not just the first": when a render throws, React 18
// re-invokes the component before settling on the boundary fallback. A
// throw-ONCE module flag therefore lets the second invocation succeed and the
// boundary never latches. Throwing until an explicit signal makes the
// fallback deterministic.
//
// The recovery signal (`window.__e2e_error_recovered`) is set by the
// ErrorBoundary's componentDidCatch — but ONLY for this synthetic error's
// message, so production error handling is unaffected. Clicking the
// boundary's "Try Again" then re-renders this component, which now recovers.
//
// Explicit return type is required because TS infers throw-only functions as
// () => void, which doesn't satisfy React's ComponentType<any> contract used
// by React.lazy() in App.tsx.
export const E2E_ERROR_MESSAGE = 'E2E-test-intentional-throw';

export default function E2EErrorTest(): React.ReactElement {
  const recovered = (window as unknown as { __e2e_error_recovered?: boolean }).__e2e_error_recovered;
  if (!recovered) {
    throw new Error(E2E_ERROR_MESSAGE);
  }
  return (
    <div className="p-8 text-center">
      <div className="display-italic text-2xl text-sage mb-2">Recovered</div>
      <p className="text-ink-mid text-sm">The error boundary reset successfully.</p>
    </div>
  );
}
