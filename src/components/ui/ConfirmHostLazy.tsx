import { lazy, Suspense } from 'react';
import { useConfirmStore } from '../../lib/confirmSheet';

// The confirmation sheet's host (and the dialog library it renders through) is loaded the first time
// something asks, not with the app's entry chunk: mounting it eagerly in App added ~40 KB to the entry
// chunk that every page — the landing page included — downloads first.
const ConfirmHost = lazy(() => import('./ConfirmHost'));

export default function ConfirmHostLazy() {
  const asking = useConfirmStore(s => s.current !== null);
  if (!asking) return null;
  return <Suspense fallback={null}><ConfirmHost /></Suspense>;
}
