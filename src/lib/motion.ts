// Vyact — shared motion vocabulary (v9.6.0).
//
// One spring + a small set of variants, reused everywhere, so motion reads
// designed rather than ad-hoc. Brand tone is "kitchen-table, not quarterly-
// statement": calm, soft, short (~180–260ms), small travel (8–12px), and amounts
// SETTLE exactly on their value (no overshoot on money). All of this is honored
// app-wide by `<MotionConfig reducedMotion="user">` at the root, plus the
// `useReducedMotion()` guards in number/bar animations.
import type { Transition, Variants } from 'framer-motion';

/** The house spring — gentle settle, no jarring overshoot. Reuse everywhere. */
export const spring: Transition = { type: 'spring', stiffness: 320, damping: 32, mass: 0.9 };
/** For numbers/amounts: never overshoot the real figure. */
export const springExact: Transition = { type: 'spring', stiffness: 300, damping: 34, bounce: 0 };
/** Quick eased tween for fades. */
export const ease: Transition = { duration: 0.2, ease: [0.22, 0.61, 0.36, 1] };

/** Dialog backdrop: pure fade in/out. */
export const backdrop: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: ease },
  exit: { opacity: 0, transition: ease },
};

/** Modal/dialog panel: fade + small lift, with a MATCHING exit (the gap today). */
export const dialogPanel: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: spring },
  exit: { opacity: 0, y: 8, scale: 0.99, transition: ease },
};

/** Popover / dropdown: scale from its anchored edge (caller sets transform-origin). */
export const popover: Variants = {
  hidden: { opacity: 0, y: -6, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { ...spring, stiffness: 420 } },
  exit: { opacity: 0, y: -4, scale: 0.98, transition: ease },
};

/** Bottom-anchored banner (sync health). */
export const banner: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: spring },
  exit: { opacity: 0, y: 12, transition: ease },
};

/** Toast: small rise + fade; the stack reflows via `layout`. */
export const toast: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: spring },
  exit: { opacity: 0, scale: 0.96, transition: ease },
};

/** Container that staggers its children in (KPI grid, insight chips). */
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.03 } },
};
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: spring },
};
