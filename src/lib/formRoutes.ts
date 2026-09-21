// Vyact v10.28.0 — the entity forms are dedicated pages.
//
// Add/Edit Transaction, Split, Debt, Budget, Account and Asset, and Reconcile
// Account, used to be global modals over whatever screen opened them. Each is
// now a route of its own. This module owns every one of those paths, so no
// caller spells a URL (the store's openAdd*/openEdit* actions and the Accounts
// Reconcile buttons build them here), and App.tsx can tell a form route from a
// screen route and render it without the Layout chrome.

const seg = (id: string) => encodeURIComponent(id);

export const formPath = {
  transactionNew:   () => '/transactions/new',
  transactionEdit:  (id: string) => `/transactions/${seg(id)}/edit`,
  /** A split is transaction-backed: the id is the backing transaction's. */
  splitNew:         () => '/splits/new',
  splitEdit:        (txnId: string) => `/splits/${seg(txnId)}/edit`,
  debtNew:          () => '/debts/new',
  debtEdit:         (id: string) => `/debts/${seg(id)}/edit`,
  budgetNew:        () => '/budgets/new',
  budgetEdit:       (id: string) => `/budgets/${seg(id)}/edit`,
  accountNew:       () => '/accounts/new',
  accountEdit:      (id: string) => `/accounts/${seg(id)}/edit`,
  accountReconcile: (id: string) => `/accounts/${seg(id)}/reconcile`,
  assetNew:         () => '/networth/assets/new',
  assetEdit:        (id: string) => `/networth/assets/${seg(id)}/edit`,
} as const;

const FORM_ROUTE = /^\/(?:transactions|splits|debts|budgets|accounts|networth\/assets)\/(?:new|[^/]+\/edit)\/?$|^\/accounts\/[^/]+\/reconcile\/?$/;

/** True for a path that renders a focused, full-screen form page. */
export function isFormRoute(pathname: string): boolean {
  return FORM_ROUTE.test(pathname);
}
