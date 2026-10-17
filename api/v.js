// Vyact — short links for videos: vyact.app/v/<n> → the matching Learn lesson (v10.57.0, B17).
//
// Links in YouTube Shorts descriptions and comments are not clickable, so a Short can only send
// people to the site by a URL they can say, read and type. "/v/3" is lesson ev-003. The redirect
// adds utm tags, so GA counts these visits as YouTube traffic and the lesson they came for.
// An unknown or unpublished number goes to the library rather than a dead end.

import { readContent } from './_supabase.js';
import { demoRedirect } from './_demo.js';

export function lessonId(n) {
  return /^\d{1,3}$/.test(String(n || '')) ? `ev-${String(n).padStart(3, '0')}` : null;
}

export function target(id, slug) {
  return slug
    ? `/learn/${encodeURIComponent(slug)}?utm_source=youtube&utm_medium=video&utm_campaign=${id}`
    : '/learn?utm_source=youtube&utm_medium=video';
}

export default async function handler(req, res, read = readContent) {
  if (demoRedirect(res, `/v/${encodeURIComponent(String((req.query || {}).n || ''))}`)) return;   // W8d (FE-PUB-05)
  const id = lessonId((req.query || {}).n);
  let slug = null;
  if (id) {
    try {
      const rows = await read(`select=slug&slug=like.${id}-*&format=eq.card&status=eq.published&limit=1`);
      slug = (rows && rows[0] && rows[0].slug) || null;
    } catch (e) {
      console.error('[v]', e && e.message);   // fall through to the library
    }
  }
  res.setHeader('Cache-Control', slug ? 'public, max-age=3600, s-maxage=86400' : 'no-store');
  res.redirect(302, target(id, slug));
}
