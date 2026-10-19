import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// FU-SQL-001..002 — v10.109.0 (owner decisions 16 Oct 2026: "Archive the concept of Pulse"; a migration
// unpublishes the published content that mentions it). Whole words only: "impulse" and the "HeartPulse"
// icon are not Pulse. Nothing is deleted; drafts stay drafts; a second run changes nothing.

const db = new PGlite();
const MIGRATION = readFileSync(new URL('../../../../supabase/migrations/20261029120000_unpublish_pulse_content.sql', import.meta.url), 'utf8');
const EARLIER = '2026-10-01 12:00:00+00';

const rows = async () => (await db.query<{ slug: string; status: string; updated_at: string }>(
  'select slug, status, updated_at::text from content_items order by slug')).rows;

beforeAll(async () => {
  await db.exec(`
    set timezone = 'UTC';
    create table content_items (
      id uuid primary key default gen_random_uuid(), slug text not null unique, title text not null, summary text,
      body text not null default '', status text not null default 'draft', format text not null default 'article',
      visual_ref jsonb, body_md text, tags text[], updated_at timestamptz not null default '${EARLIER}');
    insert into content_items (slug, title, summary, body, status, visual_ref, body_md, tags) values
      ('ev-115-your-pulse-gently-read', 'Your Pulse, gently read', null, '', 'published', '{"primitive":"arc"}', 'The Pulse Score is a gentle signal.', array['vyact','pulse']),
      ('body-mentions',   'Reading your month', null, 'Check your pulse score weekly.', 'published', null, null, null),
      ('tag-only',        'A wellness card', null, '', 'published', null, null, array['Pulse']),
      ('impulse-buys',    'Beat the impulse buy', 'Impulse purchases add up.', 'Wait a day before an impulse buy.', 'published', '{"icon":"HeartPulse"}', null, array['impulse']),
      ('draft-pulse',     'Pulse draft', null, 'pulse', 'draft', null, null, null),
      ('plain-published', 'Pay yourself first', null, 'Save first.', 'published', null, null, null);
  `);
  await db.exec(MIGRATION);
}, 60000);
afterAll(async () => { await db.close(); });

describe('Pulse content is unpublished (v10.109.0)', () => {
  it('FU-SQL-001 · every published item that names Pulse goes back to draft; impulse, HeartPulse and drafts are untouched', async () => {
    const byslug = Object.fromEntries((await rows()).map(r => [r.slug, r]));
    for (const slug of ['ev-115-your-pulse-gently-read', 'body-mentions', 'tag-only']) {
      expect(byslug[slug].status).toBe('draft');
      expect(byslug[slug].updated_at > EARLIER).toBe(true);
    }
    expect(byslug['impulse-buys']).toMatchObject({ status: 'published', updated_at: EARLIER });
    expect(byslug['plain-published']).toMatchObject({ status: 'published', updated_at: EARLIER });
    expect(byslug['draft-pulse']).toMatchObject({ status: 'draft', updated_at: EARLIER });
    expect((await db.query<{ n: number }>('select count(*)::int as n from content_items')).rows[0].n).toBe(6);   // nothing deleted
  });

  it('FU-SQL-002 · idempotent: a second run changes nothing', async () => {
    const before = await rows();
    await db.exec(MIGRATION);
    expect(await rows()).toEqual(before);
  });
});
