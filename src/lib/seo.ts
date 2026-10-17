// Vyact — small SEO helpers for SPA views (v10.49.0, marketing #10).

/**
 * Point `<link rel="canonical">` at `url` while a view is shown; returns the undo, so a
 * React effect can use it directly (`return setCanonical(url)`). An in-app lesson and its
 * public page (vyact.app/learn/<slug>) are the same content: the public page is the one
 * search engines should index.
 */
export function setCanonical(url: string): () => void {
  if (typeof document === 'undefined') return () => {};
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const created = !link;
  const previous = link?.href ?? null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = url;
  return () => {
    if (!link) return;
    if (created) link.remove();
    else if (previous != null) link.href = previous;
  };
}
