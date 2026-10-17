import React from 'react';
import { unexpected } from '../../lib/faults';
import { isChunkLoadError, shouldReloadForChunk, sessionStore } from '../../lib/chunkRecovery';
import { forceReloadForUpdate } from '../../lib/pwa';
import { Pip } from '../layout/Brand';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  copied?: boolean;
  showDetails?: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  /** W6 (FE-UIS-12): resets so far. A second "Try Again" reloads, because re-rendering re-throws. */
  private resets = 0;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, copied: false, showDetails: false };
  }

  componentDidCatch(error: Error) {
    // E2E-only: the synthetic error page (pages/__e2e__ErrorTest.tsx) throws
    // until this signal is set, so "Try Again" can recover it. Scoped strictly
    // to that one marker message — real errors never set the flag.
    if (error?.message === 'E2E-test-intentional-throw') {
      (window as unknown as { __e2e_error_recovered?: boolean }).__e2e_error_recovered = true;
      return;
    }
    // W6 (audit FE-UIS-12): a crash used to leave no trace at all. It is recorded on the app's
    // fault channel (the error only; no component state, no financial data).
    unexpected(error, 'render:ErrorBoundary');
    // A chunk from an older build: reload once to fetch the new one.
    if (isChunkLoadError(error) && shouldReloadForChunk(sessionStore(), Date.now())) void forceReloadForUpdate();
  }

  handleReset = () => {
    if (this.resets >= 1) { window.location.reload(); return; }
    this.resets += 1;
    this.setState({ hasError: false, error: null });
  };

  /** Aurora 4.0 ER1 — support can ask for this; it carries the error only (no state, no money). */
  handleCopy = async () => {
    const e = this.state.error;
    const details = [`Vyact ${__APP_VERSION__}`, `${window.location.pathname}`, e ? `${e.name}: ${e.message}` : 'Unknown error', e?.stack ?? '']
      .filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(details);
      this.setState({ copied: true });
    } catch {
      // Clipboard blocked (permissions, insecure context): show the text so it can be copied by hand.
      this.setState({ copied: false, showDetails: true });
    }
  };

  render() {
    if (this.state.hasError) {
      // Aurora 4.0 ER1 — a calm crash screen: Pip, what happened, that nothing was lost, and two
      // ways out. It replaced "Something broke" in large coral over a mono caps paragraph. It renders
      // outside the router (main.tsx), so "Go to Dashboard" is a plain link.
      return this.props.fallback || (
        <div role="alert" className="flex flex-col items-center justify-center gap-3 min-h-screen bg-bg text-ink p-8 text-center font-ui">
          <Pip size={56} />
          <h1 className="display-italic font-medium text-2xl">This page didn't load</h1>
          <p className="text-ink-mid text-[14.5px] max-w-[380px]">
            Nothing you entered was lost; your entries are saved on this device and sync when the page is back.
          </p>
          <div className="flex flex-wrap justify-center gap-2 mt-1">
            <button type="button" className="btn-primary" onClick={this.handleReset}>Try again</button>
            <a className="btn-ghost" href="/dashboard">Go to Dashboard</a>
          </div>
          <p className="text-ink-dim text-[12.5px] mt-1.5">
            Keeps happening?{' '}
            <button type="button" className="text-coral underline-offset-2 hover:underline min-h-[44px]" onClick={this.handleCopy}>
              {this.state.copied ? 'Copied' : 'Copy error details'}
            </button>{' '}
            for support
          </p>
          {this.state.showDetails && this.state.error && (
            <pre className="well text-left text-[12px] text-ink-mid p-3 max-w-[480px] w-full overflow-x-auto whitespace-pre-wrap select-all">
              {`${this.state.error.name}: ${this.state.error.message}`}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
