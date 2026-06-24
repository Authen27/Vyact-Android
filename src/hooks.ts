// Lightweight custom hooks
import { useEffect, useState, useCallback } from 'react';
import type React from 'react';
import { useStore } from './store';
import { LOCALES } from './constants';

// useTranslation — returns t() bound to current language
export function useTranslation() {
  const lang = useStore(s => s.profile.language || 'en');
  const t = useCallback((key: string): string =>
    LOCALES[lang]?.strings?.[key] ?? LOCALES.en.strings[key] ?? key, [lang]);
  return { t, lang };
}

// useShortcuts — global keyboard shortcuts
export function useShortcuts(handlers: Record<string, () => void>) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        if (e.key === 'Escape') (document.activeElement as HTMLElement)?.blur();
        return;
      }
      const handler = handlers[e.key];
      if (handler) { e.preventDefault(); handler(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers]);
}

// useScrollDirection — returns 'up' | 'down' | 'idle' based on window scroll.
// Used by AddFab to hide while the user is reading down the page and re-show
// the moment they scroll back up. Threshold filters out tiny scrolls.
export function useScrollDirection(threshold = 6): 'up' | 'down' | 'idle' {
  const [dir, setDir] = useState<'up' | 'down' | 'idle'>('idle');
  useEffect(() => {
    let last = window.scrollY;
    let ticking = false;
    function update() {
      const y = window.scrollY;
      const delta = y - last;
      if (Math.abs(delta) > threshold) {
        setDir(delta > 0 ? 'down' : 'up');
        last = y;
      }
      // Treat the very top of the page as idle so the FAB always shows there.
      if (y < 24) setDir('idle');
      ticking = false;
    }
    function onScroll() {
      if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return dir;
}

// useEdgeSwipe — fire `onSwipe` when the user swipes right from the very
// left edge of the viewport. Only active on touch devices below `lg`
// (1024px) — desktop is a no-op so it never interferes with selection.
//
// Tuning rationale:
//   • 24px hit area avoids competing with iOS' system back-swipe.
//   • deltaX > 60 + |deltaY| < 40 within 400ms filters out vertical
//     scrolls and accidental drags.
export function useEdgeSwipe(onSwipe: () => void, edgePx = 24) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let startX = 0, startY = 0, startT = 0, tracking = false;
    function onStart(e: TouchEvent) {
      if (window.innerWidth >= 1024) return;
      const t = e.touches[0];
      if (!t) return;
      if (t.clientX > edgePx) return;
      startX = t.clientX; startY = t.clientY; startT = Date.now();
      tracking = true;
    }
    function onMove(e: TouchEvent) {
      if (!tracking) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (Date.now() - startT > 400) { tracking = false; return; }
      if (dx > 60 && dy < 40) {
        tracking = false;
        onSwipe();
      }
    }
    function onEnd() { tracking = false; }
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove',  onMove,  { passive: true });
    window.addEventListener('touchend',   onEnd,   { passive: true });
    window.addEventListener('touchcancel',onEnd,   { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove',  onMove);
      window.removeEventListener('touchend',   onEnd);
      window.removeEventListener('touchcancel',onEnd);
    };
  }, [onSwipe, edgePx]);
}

// useSwipeToClose — attach to a panel element ref. Fires `onClose` when
// the user swipes left across the panel by more than `thresholdPx`.
export function useSwipeToClose(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  active: boolean,
  thresholdPx = 80,
) {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) return;
    let startX = 0, startY = 0, tracking = false;
    function onStart(e: TouchEvent) {
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX; startY = t.clientY; tracking = true;
    }
    function onMove(e: TouchEvent) {
      if (!tracking) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (dx < -thresholdPx && dy < 60) {
        tracking = false;
        onClose();
      }
    }
    function onEnd() { tracking = false; }
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove',  onMove,  { passive: true });
    el.addEventListener('touchend',   onEnd,   { passive: true });
    el.addEventListener('touchcancel',onEnd,   { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove',  onMove);
      el.removeEventListener('touchend',   onEnd);
      el.removeEventListener('touchcancel',onEnd);
    };
  }, [ref, onClose, active, thresholdPx]);
}

// useTheme — initialize theme on mount and listen for system changes
export function useTheme() {
  const setTheme = useStore(s => s.setTheme);
  const theme    = useStore(s => s.theme);
  useEffect(() => {
    setTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme, setTheme]);
}
