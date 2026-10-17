// Aurora 4.0 PH1 / X4 — the current page's own "add" action, shared with the app shell.
// A page declares it once, through <PageHead action={…}>. Phones show it as the small outlined + in
// the mobile header (the page's title row is hidden there, X3); desktop shows it as the page's own
// button, and the floating + lists the OTHER things you can add.
import { createContext, useContext, useEffect, useRef } from 'react';

/** What a page can add. The floating + leaves the current page's own entity out of its menu. */
export type AddEntity = 'transaction' | 'split' | 'budget' | 'debt' | 'asset' | 'schedule' | 'account' | 'household';

export interface PageAction {
  /** The button's visible text, which is also the header +'s accessible name ("+ Add Loan"). */
  label: string;
  onClick: () => void;
  entity?: AddEntity;
  /** Show the action as the header + on phones. False where the tab bar's + already does it. */
  headerPlus?: boolean;
}

export interface Ctx {
  action: PageAction | null;
  setAction: (action: PageAction | null) => void;
}

/** Provided by Layout, which holds the state (a .ts module cannot render the provider). */
export const PageActionContext = createContext<Ctx>({ action: null, setAction: () => {} });

/** The page action the shell renders (header + on phones, the floating +'s menu filter on desktop). */
export function usePageAction(): PageAction | null {
  return useContext(PageActionContext).action;
}

/**
 * Registers `action` for the shell while the calling page is mounted. The handler is read through a
 * ref, so a page re-rendering with a new inline callback does not churn the shell.
 */
export function useRegisterPageAction(action: PageAction | undefined) {
  const { setAction } = useContext(PageActionContext);
  const run = useRef(action?.onClick);
  run.current = action?.onClick;
  const label = action?.label;
  const entity = action?.entity;
  const headerPlus = action?.headerPlus;
  useEffect(() => {
    if (!label) return;
    setAction({ label, entity, headerPlus, onClick: () => run.current?.() });
    return () => setAction(null);
  }, [label, entity, headerPlus, setAction]);
}
