// Vyact v10.28.0 — router navigation for code that is not a component.
//
// The store's openAdd*/openEdit* actions open the entity form PAGES, so they
// have to navigate — but a Zustand action cannot call `useNavigate()`. App.tsx
// mounts a bridge inside the router that binds the live navigate function here.
import type { NavigateOptions } from 'react-router-dom';

type NavigateFn = (to: string, options?: NavigateOptions) => void;

let bound: NavigateFn | null = null;

export function bindAppNavigate(navigate: NavigateFn | null): void {
  bound = navigate;
}

export function appNavigate(to: string, options?: NavigateOptions): void {
  if (bound) {
    // Opening the page already showing (a double-tap on the FAB) replaces it,
    // so Close does not land on a second copy of the same form.
    const here = typeof window !== 'undefined' ? window.location.pathname : null;
    bound(to, here === to ? { ...options, replace: true } : options);
    return;
  }
  // No router mounted yet: a full load reaches the same page. Router state (an
  // Ask Vyact seed) cannot travel this way, so the form opens blank.
  if (typeof window !== 'undefined') window.location.assign(to);
}
