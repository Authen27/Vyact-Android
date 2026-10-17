// W6 (audit FE-UIS-10; WCAG 2.1.4) — when a single-key shortcut may act.
//
// The global n/b/d/a shortcuts used to fire on any keydown whose key matched, so Cmd+A (select
// all) opened Add Asset, Ctrl+D (bookmark) opened Add Debt, and a key pressed inside an open
// dialog navigated the page underneath it. Pure, so it is unit-tested without a browser.
// v10.91.0 (owner decision 13 Oct 2026): those four are removed; the rule now guards the
// Transactions `/` (focus the search box), the one single-key shortcut left.

export interface ShortcutKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
}

export interface ShortcutTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

const FORM_TAGS = new Set(['input', 'textarea', 'select']);

/**
 * True when a bare-key shortcut may run: no Ctrl/Cmd/Alt (Shift is allowed — it is how "N" and,
 * on many layouts, "/" are typed), not while composing text, not while focus is in a form field
 * or an editable element, and not while a modal dialog is open.
 */
export function shortcutAllowed(e: ShortcutKeyEvent, focused: ShortcutTarget | null, dialogOpen: boolean): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
  if (dialogOpen) return false;
  if (focused) {
    if (FORM_TAGS.has((focused.tagName ?? '').toLowerCase())) return false;
    if (focused.isContentEditable) return false;
  }
  return true;
}

/** A modal is open: any element declaring aria-modal, or an open Radix dialog. */
export const OPEN_DIALOG_SELECTOR = '[aria-modal="true"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';
