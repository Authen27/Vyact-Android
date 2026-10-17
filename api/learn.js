// Vyact — public, server-rendered Learn library (Insights Hub v9.5.5; rebuilt v10.49.0).
//
// Social scrapers and AI crawlers don't run the SPA's JS, so the shareable + indexable
// surface for the evergreen library is rendered HERE, server-side, no login:
//   /learn                 → the library (topic hubs + every lesson), CollectionPage
//   /learn/topic/<topic>   → one topic hub (#10), CollectionPage + ItemList
//   /learn/<slug>          → one lesson: Article + Breadcrumb, VideoObject for the 45
//                            video cards (#12), 3–5 related lessons (#11), a "try it"
//                            link into the matching app feature (#20)
// Content is public educational material (no user data), read with the publishable key;
// RLS lets anon see published rows only (migration 20261004120000).

import {
  BASE, OG_IMAGE, esc, safeJsonLd as jsonLd, safeJs, httpUrl, page, topicSlug, featureFor, signUpUrl, demoUrl, youtubeId,
} from './_page.js';
import { readContent } from './_supabase.js';
import { demoRedirect } from './_demo.js';
import { seoFor } from './_seo.js';
import { ORG_ID } from './_brand.js';

// Kept as a named export: learnJsonLd.test.ts pins the script-breakout guard from here.
export const safeJsonLd = jsonLd;

const LESSON_COLS = 'slug,title,category,body_md,tags,reading_seconds,video_url,video_updated_at,source_name,source_url,why_it_matters,published_at,updated_at';
const LIST_COLS = 'slug,title,category,tags,body_md';
const PUBLISHED = 'format=eq.card&status=eq.published';

const plain = md => String(md || '').replace(/(^|\n)\s*(?:[-*•]|\d+[.)])\s+/g, '$1').replace(/[#*_`>[\]]/g, '').replace(/\(https?:[^)]*\)/g, '').replace(/\s+/g, ' ').trim();
export const metaDesc = body => {
  const t = plain(body);
  return t.length > 155 ? t.slice(0, 152).trimEnd() + '…' : t;
};
/** The first sentence, for list rows ("what is this lesson about"). */
export const firstSentence = body => {
  const t = plain(body);
  const m = /^(.{20,160}?[.!?])(\s|$)/.exec(t);
  return m ? m[1] : (t.length > 120 ? t.slice(0, 117).trimEnd() + '…' : t);
};

/** A small, safe markdown subset: paragraphs, "- " lists, "## " headings, **bold**. Everything escaped first. */
export function renderBody(md) {
  const inline = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return String(md || '').split(/\n\s*\n/).map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return '';
    if (lines.every(l => /^[-*•]\s+/.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    if (lines.every(l => /^\d+[.)]\s+/.test(l))) return `<ol>${lines.map(l => `<li>${inline(l.replace(/^\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    if (lines.length === 1 && /^#{2,4}\s+/.test(lines[0])) return `<h2>${inline(lines[0].replace(/^#+\s+/, ''))}</h2>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

/** #11 — 3–5 related lessons: shared tags weigh most, then the same topic. Deterministic. */
export function relatedLessons(card, all, max = 4) {
  const tags = new Set(card.tags || []);
  return all
    .filter(c => c.slug !== card.slug)
    .map(c => ({ c, score: (c.tags || []).filter(t => tags.has(t)).length * 2 + (c.category === card.category ? 3 : 0) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.title.localeCompare(b.c.title))
    .slice(0, max)
    .map(x => x.c);
}

// v10.57.0 (B19) — "Start here": three short paths through the library for the people Vyact
// serves first. Each lesson page shows its place in a path and links the next one; read lessons are
// ticked from this browser's own record (localStorage, no account, nothing sent anywhere).
export const START_PATHS = [
  { id: 'couples', title: 'Money as a couple', blurb: 'Share money without fighting about it.',
    slugs: ['ev-105-yours-mine-and-ours', 'ev-106-the-monthly-money-date', 'ev-086-talk-money-with-your-household', 'ev-104-shared-goals-shared-motivation', 'ev-107-one-person-shouldn-t-hold-it-all'] },
  { id: 'budgeting', title: 'New to budgeting', blurb: 'A budget you can actually keep.',
    slugs: ['ev-003-the-50-30-20-starting-point', 'ev-042-track-before-you-trim', 'ev-043-needs-vs-wants-gently', 'ev-045-the-category-that-ate-the-month', 'ev-050-review-beats-restrict'] },
  { id: 'debt', title: 'Get out of debt', blurb: 'What it really costs, and the order to pay it off.',
    slugs: ['ev-028-interest-is-the-real-cost', 'ev-027-avalanche-vs-snowball', 'ev-034-avalanche-in-one-line', 'ev-035-snowball-in-one-line', 'ev-039-clear-the-card-before-it-compounds'] },
];
export const YOUTUBE_CHANNEL = 'https://www.youtube.com/@askvyact';
const READ_KEY = 'vy_learn_read';

/** The path a lesson belongs to, its position, and the next lesson's slug (or null). */
export function pathFor(slug) {
  for (const p of START_PATHS) {
    const i = p.slugs.indexOf(slug);
    if (i >= 0) return { path: p, index: i, next: p.slugs[i + 1] || null };
  }
  return null;
}

const readTime = s => (s >= 60 ? `${Math.round(s / 60)} min` : `${s || 30} sec`);
const topicUrl = cat => `${BASE}/learn/topic/${topicSlug(cat)}`;
// v10.56.0 (B3) — the same Organization entity as every other page (api/_brand.js).
const orgRef = { '@type': 'Organization', '@id': ORG_ID, name: 'Vyact', url: BASE, logo: { '@type': 'ImageObject', url: OG_IMAGE } };

function topicPills(topics, current) {
  return `<div>${topics.map(t => t === current
    ? `<span class="pill" aria-current="page" style="border-color:hsl(var(--coral))">${esc(t)}</span>`
    : `<a class="pill" href="${topicUrl(t)}">${esc(t)}</a>`).join('')}</div>`;
}

function listItems(cards) {
  return `<div class="grid two">${cards.map(c => `<a class="item" href="${BASE}/learn/${esc(c.slug)}"><div class="t">${esc(c.title)}</div><div class="d">${esc(firstSentence(c.body_md))}</div></a>`).join('')}</div>`;
}

export function lessonPage(c, all = []) {
  const url = `${BASE}/learn/${c.slug}`;
  // #21 — a search-shaped question title and a quick answer, for the lessons that answer a live search.
  const seo = seoFor(c.slug);
  const headline = seo ? seo.title : c.title;
  const description = metaDesc(seo ? seo.answer : c.body_md);
  const feature = featureFor(c.category);
  const vid = youtubeId(c.video_url);
  const sourceUrl = httpUrl(c.source_url);
  const related = relatedLessons(c, all);
  const tags = (c.tags || []).map(t => `<span class="tag">#${esc(t)}</span>`).join('');
  const article = {
    '@context': 'https://schema.org', '@type': ['Article', 'LearningResource'],
    headline, ...(seo ? { alternativeHeadline: c.title, abstract: seo.answer } : {}), description, articleSection: c.category, keywords: (c.tags || []).join(', '),
    inLanguage: 'en', isAccessibleForFree: true, learningResourceType: 'concept explainer', educationalLevel: 'beginner',
    timeRequired: `PT${c.reading_seconds || 30}S`,
    ...(c.published_at ? { datePublished: c.published_at } : {}), ...(c.updated_at ? { dateModified: c.updated_at } : {}),
    author: orgRef, publisher: orgRef, mainEntityOfPage: url, image: OG_IMAGE,
    about: { '@type': 'Thing', name: `${c.category} — personal finance` },
    ...(sourceUrl ? { citation: { '@type': 'CreativeWork', name: c.source_name || sourceUrl, url: sourceUrl } } : {}),
  };
  const breadcrumb = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Learn', item: `${BASE}/learn` },
      { '@type': 'ListItem', position: 2, name: c.category, item: topicUrl(c.category) },
      { '@type': 'ListItem', position: 3, name: headline, item: url },
    ],
  };
  // #12 — the 45 video cards are YouTube Shorts.
  const video = vid ? {
    '@context': 'https://schema.org', '@type': 'VideoObject',
    name: c.title, description,
    thumbnailUrl: [`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`],
    uploadDate: c.video_updated_at || c.published_at || c.updated_at,
    contentUrl: `https://www.youtube.com/shorts/${vid}`, embedUrl: `https://www.youtube.com/embed/${vid}`,
    publisher: orgRef, inLanguage: 'en',
  } : null;
  // The quick answer as a one-question FAQ: the shape answer engines quote.
  const faq = seo ? {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: [{ '@type': 'Question', name: seo.title, acceptedAnswer: { '@type': 'Answer', text: seo.answer } }],
  } : null;
  const tryHref = signUpUrl(`learn_${c.slug}`, feature.next);
  const inPath = pathFor(c.slug);
  const nextCard = inPath && inPath.next ? all.find(x => x.slug === inPath.next) : null;
  const pathNote = inPath ? `<div class="answer" style="border-left-color:hsl(var(--sage))"><div class="kicker">Start here · ${esc(inPath.path.title)} · lesson ${inPath.index + 1} of ${inPath.path.slugs.length}</div>${nextCard
    ? `<p><a href="${BASE}/learn/${esc(nextCard.slug)}">Next: ${esc((seoFor(nextCard.slug) || {}).title || nextCard.title)} →</a></p>`
    : `<p>You’ve reached the end of this path. <a href="${BASE}/learn">More paths →</a></p>`}</div>` : '';
  const body = `<main>
<div class="kicker"><a href="${BASE}/learn">Learn</a> · <a href="${topicUrl(c.category)}">${esc(c.category)}</a></div>
<h1>${esc(headline)}</h1>
<div class="meta">${seo ? `${esc(c.title)} · ` : ''}${readTime(c.reading_seconds)} read · by Vyact</div>
${seo ? `<section class="answer" aria-label="Quick answer"><div class="kicker">Quick answer</div><p>${esc(seo.answer)}</p></section>` : ''}
<div class="lesson${vid ? ' has-video' : ''}">
${vid ? `<a class="video" href="https://www.youtube.com/shorts/${vid}" data-yt="${vid}" rel="noopener"><img src="https://i.ytimg.com/vi/${vid}/hqdefault.jpg" alt="" loading="lazy" width="480" height="360"><span>▶ Watch the 1-minute version</span></a>` : ''}
<div>
<article class="card">${renderBody(c.body_md)}${c.why_it_matters ? `<p><strong>Why it matters:</strong> ${esc(c.why_it_matters)}</p>` : ''}${tags ? `<div class="tags">${tags}</div>` : ''}
${sourceUrl ? `<p class="source">Source: <a href="${esc(sourceUrl)}" rel="nofollow noopener">${esc(c.source_name || new URL(sourceUrl).hostname)}</a></p>` : ''}</article>
<div class="try"><p>Put this into practice with your own household’s numbers — free to start.</p><a class="cta" href="${esc(tryHref)}" data-cta="try">${esc(feature.label)} →</a><p class="demo">Or <a href="${esc(demoUrl(feature.next))}" data-cta="demo">look around a demo household first</a>, no sign-up.</p></div>
</div>
</div>
${pathNote}
${related.length ? `<h2>Keep reading</h2>${listItems(related)}` : ''}
<p><a href="${topicUrl(c.category)}">More on ${esc(c.category)}</a> · <a href="${BASE}/learn">All lessons</a> · <a href="${YOUTUBE_CHANNEL}" rel="noopener">1-minute lessons on YouTube</a></p>
</main>`;
  const script = `if(window.vyTrack)vyTrack('learn_card_view',{slug:${safeJs(c.slug)},category:${safeJs(c.category)}});
try{var r=JSON.parse(localStorage.getItem('${READ_KEY}')||'[]');if(r.indexOf(${safeJs(c.slug)})<0){r.push(${safeJs(c.slug)});localStorage.setItem('${READ_KEY}',JSON.stringify(r.slice(-300)));}}catch(e){}
var v=document.querySelector('a[data-yt]');if(v)v.addEventListener('click',function(e){e.preventDefault();var id=v.getAttribute('data-yt');v.innerHTML='<iframe src="https://www.youtube-nocookie.com/embed/'+id+'?autoplay=1" title="Video" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';if(window.vyTrack)vyTrack('learn_video_play',{slug:${safeJs(c.slug)}});});`;
  return page({
    title: `${headline} · Vyact Learn`, description, canonical: url, ogType: 'article',
    jsonld: [article, breadcrumb, video, faq], body, script,
    sticky: { text: 'Track your money free with Vyact', label: 'Get started', href: signUpUrl(`learn_${c.slug}_sticky`, feature.next) },
  });
}

export function topicPage(topic, cards, topics) {
  const url = topicUrl(topic);
  const description = `Free, plain-English lessons on ${topic.toLowerCase()}: ${cards.slice(0, 3).map(c => c.title).join(', ')} and more, from Vyact Learn.`;
  const jsonld = [{
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: `${topic} — Vyact Learn`, description, url, publisher: orgRef,
    mainEntity: { '@type': 'ItemList', numberOfItems: cards.length,
      itemListElement: cards.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: `${BASE}/learn/${c.slug}`, name: c.title })) },
  }, {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Learn', item: `${BASE}/learn` },
      { '@type': 'ListItem', position: 2, name: topic, item: url },
    ],
  }];
  const feature = featureFor(topic);
  const body = `<main>
<div class="kicker"><a href="${BASE}/learn">Learn</a></div>
<h1>${esc(topic)}: free money lessons</h1>
<p class="lede">${cards.length} short lessons on ${esc(topic.toLowerCase())}, in plain English. Read one in a minute, then try it with your own numbers.</p>
${listItems(cards)}
<div class="try"><p>Ready to try it with your own money?</p><a class="cta" href="${esc(signUpUrl(`topic_${topicSlug(topic)}`, feature.next))}" data-cta="try">${esc(feature.label)} →</a></div>
<h2>Other topics</h2>${topicPills(topics, topic)}
</main>`;
  return page({
    title: `${topic} lessons · Vyact Learn`, description, canonical: url, jsonld, body,
    sticky: { text: 'Free money lessons + a family tracker', label: 'Get started', href: signUpUrl(`topic_${topicSlug(topic)}_sticky`, feature.next) },
  });
}

export function indexPage(cards) {
  const url = `${BASE}/learn`;
  const byCat = {};
  for (const c of cards) (byCat[c.category] ||= []).push(c);
  const topics = Object.keys(byCat).sort((a, b) => byCat[b].length - byCat[a].length);
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: 'Vyact Learn — free money lessons in plain English',
    description: 'A free library of short, plain-English money lessons for households: saving, budgeting, debt and loans, investing, net worth and the habits behind them.',
    url, publisher: orgRef,
    hasPart: topics.map(t => ({ '@type': 'CollectionPage', name: `${t} — Vyact Learn`, url: topicUrl(t) })),
    mainEntity: { '@type': 'ItemList', numberOfItems: cards.length,
      itemListElement: cards.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: `${BASE}/learn/${c.slug}`, name: c.title })) },
  };
  const sections = topics.map(t => `<h2 id="${topicSlug(t)}"><a href="${topicUrl(t)}" style="color:inherit;text-decoration:none">${esc(t)}</a></h2>${listItems(byCat[t])}`).join('');
  const bySlug = Object.fromEntries(cards.map(c => [c.slug, c]));
  const paths = START_PATHS.map(p => ({ ...p, items: p.slugs.filter(s => bySlug[s]) })).filter(p => p.items.length);
  const startHere = paths.length ? `<h2 id="start-here">Start here</h2>
<div class="grid two">${paths.map(p => `<div class="item" data-path="${p.id}"><div class="t">${esc(p.title)}</div><div class="d">${esc(p.blurb)} <span data-progress>${p.items.length} short lessons</span></div>
<ol style="margin:10px 0 0;padding-left:20px">${p.items.map(s => `<li style="margin:4px 0"><a href="${BASE}/learn/${esc(s)}" data-slug="${esc(s)}">${esc((seoFor(s) || {}).title || bySlug[s].title)}</a><span data-done hidden> ✓</span></li>`).join('')}</ol></div>`).join('')}</div>` : '';
  const body = `<main>
<div class="kicker">Vyact Learn</div>
<h1>Money lessons you can read in a minute</h1>
<p class="lede">${cards.length} short, plain-English lessons on saving, budgeting, debt, investing, net worth and the habits behind them — many with a one-minute video on <a href="${YOUTUBE_CHANNEL}" rel="noopener">YouTube</a>. Free, no sign-up to read.</p>
${topicPills(topics)}
${startHere}
${sections}
</main>`;
  // Ticks for lessons this browser has read, and "n of 5 read" per path.
  const script = `try{var r=JSON.parse(localStorage.getItem('${READ_KEY}')||'[]');document.querySelectorAll('[data-path]').forEach(function(p){var n=0,a=p.querySelectorAll('a[data-slug]');a.forEach(function(l){if(r.indexOf(l.getAttribute('data-slug'))>=0){n++;l.nextElementSibling.hidden=false;}});if(n)p.querySelector('[data-progress]').textContent=n+' of '+a.length+' read';});}catch(e){}`;
  return page({
    script,
    title: 'Free money lessons in plain English · Vyact Learn',
    description: 'Free, plain-English money lessons for households: emergency funds, budgets, debt payoff, investing, net worth and money habits. One-minute reads, no sign-up.',
    canonical: url, jsonld, body,
    sticky: { text: 'Lessons + a free family money tracker', label: 'Get started', href: signUpUrl('learn_index_sticky') },
  });
}

function unavailable(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Retry-After', '300');
  res.setHeader('Cache-Control', 'no-store');
  res.status(503).send(page({
    title: 'Vyact Learn', description: 'Free money lessons.', canonical: `${BASE}/learn`, jsonld: [], robots: 'noindex',
    body: '<main><h1>Lessons are loading slowly</h1><p class="lede">Please try again in a minute.</p></main>',
  }));
}

function notFound(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(404).send(page({
    title: 'Lesson not found · Vyact', description: 'This lesson could not be found.', canonical: `${BASE}/learn`, jsonld: [], robots: 'noindex',
    body: `<main><h1>Lesson not found</h1><p><a href="${BASE}/learn">Browse all lessons →</a></p></main>`,
  }));
}

const CACHE = 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800';

export default async function handler(req, res) {
  {
    // W8d (audit FE-PUB-05): the demo sends Learn visitors to vyact.app.
    const q = req.query || {};
    const s = String(q.slug || '').trim(), t = String(q.topic || '').trim().toLowerCase();
    if (demoRedirect(res, s ? `/learn/${encodeURIComponent(s)}` : t ? `/learn/topic/${encodeURIComponent(t)}` : '/learn')) return;
  }
  try {
    const q = req.query || {};
    const slug = String(q.slug || '').trim();
    const topic = String(q.topic || '').trim().toLowerCase();
    const all = await readContent(`select=${LIST_COLS}&${PUBLISHED}&order=category.asc,title.asc&limit=1000`);
    // W7b (audit FE-PUB-03): an empty library is a failed read (the lessons exist), not a page — do not let
    // the CDN keep "no lessons" for a day; answer 503, uncached, as the sitemap and llms.txt already do.
    if (!all.length) return unavailable(res);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (topic) {
      const cards = all.filter(c => topicSlug(c.category) === topic);
      if (!cards.length) return notFound(res);
      const topics = [...new Set(all.map(c => c.category))].sort();
      res.setHeader('Cache-Control', CACHE);
      return res.status(200).send(topicPage(cards[0].category, cards, topics));
    }
    if (slug) {
      const rows = await readContent(`select=${LESSON_COLS}&${PUBLISHED}&slug=eq.${encodeURIComponent(slug)}&limit=1`);
      if (!rows.length) return notFound(res);
      res.setHeader('Cache-Control', CACHE);
      return res.status(200).send(lessonPage(rows[0], all));
    }
    res.setHeader('Cache-Control', CACHE);
    return res.status(200).send(indexPage(all));
  } catch (e) {
    console.error('[learn]', e && e.message);
    return unavailable(res);
  }
}
