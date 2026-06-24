// Vyact v6.4.6 — Dynamic needs/wants categorisation.
//
// The need/want classification of each expense category is managed centrally in
// the `category_classifications` table (editable by admins) so it can evolve
// without an app release. In local-only mode (or if the fetch fails) we fall back
// to the static NEEDS_WANTS_MAP baked into constants.ts.

import { useEffect, useState } from 'react';
import { supabase, isCloudEnabled } from './supabase';
import { NEEDS_WANTS_MAP } from '../constants';

export type NeedWant = 'need' | 'want';
export type ClassificationMap = Record<string, NeedWant>;

let cache: ClassificationMap | null = null;
let inflight: Promise<ClassificationMap> | null = null;

export async function loadCategoryClassifications(force = false): Promise<ClassificationMap> {
  if (cache && !force) return cache;
  if (inflight && !force) return inflight;

  inflight = (async () => {
    const fallback: ClassificationMap = { ...NEEDS_WANTS_MAP };
    if (!isCloudEnabled() || !supabase) {
      cache = fallback;
      return fallback;
    }
    try {
      const { data, error } = await supabase
        .from('category_classifications')
        .select('category, classification');
      if (error || !data) { cache = fallback; return fallback; }
      const map: ClassificationMap = { ...fallback };
      for (const row of data as { category: string; classification: NeedWant }[]) {
        if (row.classification === 'need' || row.classification === 'want') {
          map[row.category] = row.classification;
        }
      }
      cache = map;
      return map;
    } catch {
      cache = fallback;
      return fallback;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function classifyCategory(catId: string, map?: ClassificationMap): NeedWant | undefined {
  return (map ?? cache ?? NEEDS_WANTS_MAP)[catId];
}

/** React hook: returns the live map, starting from the static fallback. */
export function useCategoryClassifications(): ClassificationMap {
  const [map, setMap] = useState<ClassificationMap>(cache ?? { ...NEEDS_WANTS_MAP });
  useEffect(() => {
    let alive = true;
    loadCategoryClassifications().then(m => { if (alive) setMap(m); });
    return () => { alive = false; };
  }, []);
  return map;
}
