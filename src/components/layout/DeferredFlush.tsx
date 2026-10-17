// Aurora 4.0 CF1 — an action held for Undo (lib/undoable.ts deferCommit) commits as soon as the
// person navigates away or the page is hidden, not only when its 8 seconds are up, so leaving the
// screen never silently drops it.
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { flushDeferred } from '../../lib/undoable';

export default function DeferredFlush() {
  const { pathname } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    void flushDeferred();
  }, [pathname]);

  useEffect(() => {
    const onHide = () => { void flushDeferred(); };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  return null;
}
