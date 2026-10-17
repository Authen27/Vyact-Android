// Vyact v10.28.0 — scroll and focus across history.
//
// The entity forms are pages now, so the screen that opened one unmounts while
// it is showing. A modal kept that screen's scroll position and gave focus back
// to its opener for free; a page has to put both back. Going BACK to a screen
// restores where it was scrolled to and focuses the control that last had focus
// there (normally the button that opened the form).
//
// Moving FORWARD to a different path still starts at the top, which is the
// v7.4.1 ScrollToTop behaviour this replaces. A query-only change (a filter)
// keeps its place.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

interface ControlRef {
  tag: string;
  label: string | null;
  testId: string | null;
  text: string;
  /** Position among identical controls, e.g. the third "edit ▸". */
  index: number;
}

const CONTROL = 'button, a[href], input, select, textarea, [tabindex]';
const scrollByEntry = new Map<string, number>();
const focusByEntry = new Map<string, ControlRef>();

const textOf = (el: Element) => (el.textContent ?? '').trim().slice(0, 80);

function twinsOf(ref: Omit<ControlRef, 'index'>): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(ref.tag)).filter(el =>
    el.getAttribute('aria-label') === ref.label
    && el.getAttribute('data-testid') === ref.testId
    && textOf(el) === ref.text);
}

function describeControl(target: Element): ControlRef | null {
  const control = target.closest<HTMLElement>(CONTROL);
  if (!control || control === document.body) return null;
  const ref = {
    tag: control.tagName.toLowerCase(),
    label: control.getAttribute('aria-label'),
    testId: control.getAttribute('data-testid'),
    text: textOf(control),
  };
  return { ...ref, index: Math.max(0, twinsOf(ref).indexOf(control)) };
}

export default function HistoryRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const entry = useRef(location.key);
  const path = useRef<string | null>(null);

  useEffect(() => {
    const onScroll = () => { scrollByEntry.set(entry.current, window.scrollY); };
    const onFocusIn = (event: FocusEvent) => {
      const ref = event.target instanceof Element ? describeControl(event.target) : null;
      if (ref) focusByEntry.set(entry.current, ref);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('focusin', onFocusIn);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  // Layout effect: the entry key must switch in the same commit that swaps the
  // screen, before the browser reports the scroll clamp that swap causes, or the
  // clamp would be recorded against the screen being left.
  useLayoutEffect(() => {
    const samePath = path.current === location.pathname;
    entry.current = location.key;
    path.current = location.pathname;
    if (samePath) return;

    if (navigationType !== 'POP') {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      return;
    }

    const top = scrollByEntry.get(location.key) ?? 0;
    const control = focusByEntry.get(location.key) ?? null;
    let scrolled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const restore = () => {
      if (!scrolled && document.documentElement.scrollHeight - window.innerHeight >= top) {
        window.scrollTo({ top, left: 0, behavior: 'auto' });
        scrolled = true;
      }
      const target = control ? twinsOf(control)[control.index] : undefined;
      if (target) target.focus({ preventScroll: true });
      // A lazily loaded screen may not have rendered yet; give it up to a second.
      if ((scrolled && (!control || target)) || attempts++ >= 20) {
        if (!scrolled) window.scrollTo({ top, left: 0, behavior: 'auto' });
        return;
      }
      timer = setTimeout(restore, 50);
    };
    restore();
    return () => clearTimeout(timer);
  }, [location.key, location.pathname, navigationType]);

  return null;
}
