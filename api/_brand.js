// Vyact — the brand entity, in ONE place (v10.56.0, master to-do B3 / CMO #78–#79).
//
// Search engines and AI assistants learn what "Vyact" means from consistent, linked facts. Another
// product shares the name — an open-source local AI workspace (github.com/vyact/vyact) — and AI
// summaries have already mixed the two up (2 Oct 2026), so every page describes the entity the same
// way, under one @id, and says plainly which Vyact this is.
//
// Owner rules (2 Oct 2026): the brand is positioned as "the family budget app"; the only alias is
// "Vyact app" (no other alias, by owner rule). Every fact here must be true of the live product.

export const BASE = 'https://vyact.app';
export const ORG_ID = `${BASE}/#organization`;
export const APP_ID = `${BASE}/#app`;

/** The tagline under the logo everywhere (replaced the old "…Finance OS" tagline in v10.56.0). */
export const TAGLINE = 'Family budget app';

/** One sentence that says which Vyact this is. */
export const DISAMBIGUATION =
  'Vyact (vyact.app) is a family budget app for couples and households. It is not related to the open-source AI workspace of the same name.';

/** Profiles that are verifiably ours. Add each new one here as it goes live (B5/B6). */
export const SAME_AS = [
  'https://www.youtube.com/channel/UCMYdD2TEFJaCSJnsSBs8T7A',
  'https://www.youtube.com/@askvyact',
];

export const LOGO = `${BASE}/og-vyact.png`;

/** The Organization node. Pages that only reference it use `{ '@id': ORG_ID }`. */
export function organization(description) {
  return {
    '@context': 'https://schema.org', '@type': 'Organization', '@id': ORG_ID,
    name: 'Vyact', alternateName: ['Vyact app'], url: BASE,
    logo: { '@type': 'ImageObject', url: LOGO },
    ...(description ? { description } : {}),
    disambiguatingDescription: DISAMBIGUATION,
    email: 'support@vyact.app',
    sameAs: SAME_AS,
  };
}

/** A lightweight reference for publisher/author fields (no @context: it sits inside another node). */
export const orgRef = { '@type': 'Organization', '@id': ORG_ID, name: 'Vyact', url: BASE };
