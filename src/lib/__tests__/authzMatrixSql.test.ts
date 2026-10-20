import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { replayMigrations } from './helpers/replayMigrations';

// Q2-AZ-001..010 — v10.129.0 (Q2; audit DB-SEC-10, OPS-08, ADM-07 server half, XC-ARC-13; owner decision D10,
// 20 Oct 2026: "an authz matrix"). Who can read and change what, run against the schema every migration builds
// (helpers/replayMigrations.ts), as each kind of person:
//
//   anon         · not signed in
//   outsider     · signed in, owner of another household (H2), nothing in H1
//   owner/admin/member/viewer · the four roles in household H1
//   superAdmin / rolesAdmin / contentAdmin · Vyact staff (admin_roles), not in H1
//
// TABLES says, per table, what each of them may do to one row of H1 ("the target"): S sees it, I inserts a
// row of the same kind into H1 (as themselves), U changes it, D deletes it; '-' means refused. The expectation
// is what the policy is FOR (CLAUDE.md's rules), not whatever it does today. Where the two differ, the cell is a
// KNOWN GAP: it names its finding and the Track Q stage that closes it, and the test pins today's behaviour, so
// the fix makes this test fail until the gap entry is removed. Never widen an expectation to make a test pass.
//
// Every operation runs in its own transaction (rolled back) under the persona's role and JWT claims, as
// PostgREST would run it; deferred constraints are checked immediately.

const PERSONAS = ['anon', 'outsider', 'owner', 'admin', 'member', 'viewer', 'superAdmin', 'rolesAdmin', 'contentAdmin'] as const;
type Persona = typeof PERSONAS[number];
type SignedIn = Exclude<Persona, 'anon'>;
const MEMBERS = ['owner', 'admin', 'member', 'viewer'] as const;

const UID: Record<SignedIn, string> = {
  owner: '10000000-0000-4000-8000-0000000000a1',
  admin: '10000000-0000-4000-8000-0000000000a2',
  member: '10000000-0000-4000-8000-0000000000a3',
  viewer: '10000000-0000-4000-8000-0000000000a4',
  outsider: '10000000-0000-4000-8000-0000000000b1',
  superAdmin: '10000000-0000-4000-8000-0000000000c1',
  rolesAdmin: '10000000-0000-4000-8000-0000000000c2',
  contentAdmin: '10000000-0000-4000-8000-0000000000c3',
};
const EMAIL = (p: SignedIn) => `${p.toLowerCase()}@vyact.test`;

/** Fixed ids for the seeded rows: `id('txn', 1)` is H1's transaction, `id('txn', 2)` H2's. */
const ROW = { acct: 1, acctSpare: 2, txn: 3, asset: 4, debt: 5, goal: 6, budget: 7, alloc: 8, sched: 9, notif: 10, log: 11,
  loanEvent: 12, snap: 13, invite: 14, conv: 15, intent: 16, feedback: 17, usage: 18, view: 19, split: 20, share: 21, sub: 22,
  draft: 23, published: 24, published2: 25, model: 26, object: 27 } as const;
const id = (row: keyof typeof ROW, h: 1 | 2 = 1) =>
  `30000000-0000-4000-8000-${String(h * 100 + ROW[row]).padStart(12, '0')}`;

let db: PGlite;
let H1 = '';
let H2 = '';
const hh = (h: 1 | 2) => (h === 1 ? H1 : H2);

type Outcome = { ok: true; rows: number; data: Record<string, unknown>[] } | { ok: false; code: string; message: string };

/** Run one statement as `p`, in a transaction that is always rolled back. */
async function as(p: Persona, sql: string, params: unknown[] = []): Promise<Outcome> {
  await db.exec('begin');
  try {
    await db.exec('set constraints all immediate');
    if (p === 'anon') {
      await db.exec(`set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    } else {
      // A sign-in a minute ago (amr), so actions that need a recent sign-in can be reached.
      const claims = { sub: UID[p], role: 'authenticated', email: EMAIL(p),
        amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }] };
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await db.exec('set local role authenticated');
    }
    const r = await db.query<Record<string, unknown>>(sql, params);
    return { ok: true, rows: r.rows.length, data: r.rows };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { ok: false, code: err.code ?? '?', message: err.message ?? String(e) };
  } finally {
    await db.exec('rollback');
  }
}

// ── The tables ─────────────────────────────────────────────────────────────────────────────────────────────────

interface TableCase {
  table: string;
  /** WHERE clause naming the target row for household h (1 = H1, the one under test; 2 = H2, for cross-tenant). */
  target: (h: 1 | 2) => string;
  /** SET clause that changes nothing (the U test). */
  touch: string;
  /** INSERT of a new row of this kind into household h as `p` (null: the table has no way in from the API). */
  insert: (p: Persona, h: 1 | 2) => string;
  /** Row seeded per household, so cross-tenant checks run (household-scoped tables only). */
  householdScoped?: boolean;
  /** Persona → 'SIUD' with '-' for refused. Personas not listed: '----'. */
  expect: Partial<Record<Persona, string>>;
  /** Today's behaviour where it differs from the intent, with the finding and the stage that fixes it. */
  gaps?: Partial<Record<Persona, { actual: string; finding: string }>>;
}

const uid = (p: Persona) => (p === 'anon' ? 'null' : `'${UID[p]}'`);
const h1Writers = { owner: 'SIUD', admin: 'SIUD', member: 'SIUD', viewer: 'S---' };
const allMembersRead = { owner: 'S---', admin: 'S---', member: 'S---', viewer: 'S---' };
const everyoneSignedIn = (cell: string) =>
  Object.fromEntries(PERSONAS.filter(p => p !== 'anon').map(p => [p, cell])) as Partial<Record<Persona, string>>;

const TABLES: TableCase[] = [
  { table: 'transactions', householdScoped: true, target: h => `id = '${id('txn', h)}'`, touch: 'description = description',
    insert: (p, h) => `insert into transactions (household_id, created_by, type, amount, currency, date, description, category, account_id)
      values ('${hh(h)}', ${uid(p)}, 'expense', 5, 'USD', current_date, 'new', 'groceries', '${id('acct', h)}')`,
    expect: h1Writers },
  { table: 'accounts', householdScoped: true, target: h => `id = '${id('acct', h)}'`, touch: 'name = name',
    insert: (_p, h) => `insert into accounts (household_id, kind, name, currency) values ('${hh(h)}', 'bank', 'New', 'USD')`,
    // No client delete: delete_account / move_account_and_delete decide (v10.117.0).
    expect: { owner: 'SIU-', admin: 'SIU-', member: 'SIU-', viewer: 'S---' } },
  { table: 'assets', householdScoped: true, target: h => `id = '${id('asset', h)}'`, touch: 'name = name',
    insert: (_p, h) => `insert into assets (household_id, type, name, value, liquidity) values ('${hh(h)}', 'investment', 'New', 1, 'long')`,
    expect: h1Writers },
  { table: 'debts', householdScoped: true, target: h => `id = '${id('debt', h)}'`, touch: 'name = name',
    insert: (_p, h) => `insert into debts (household_id, type, name, current_balance, interest_rate, minimum_payment, direction)
      values ('${hh(h)}', 'other', 'New', 0, 0, 0, 'owed_to_me')`,
    expect: h1Writers },
  { table: 'goals', householdScoped: true, target: h => `id = '${id('goal', h)}'`, touch: 'name = name',
    insert: (_p, h) => `insert into goals (household_id, type, name, target_amount) values ('${hh(h)}', 'savings', 'New', 10)`,
    expect: h1Writers },
  { table: 'recurring_schedules', householdScoped: true, target: h => `id = '${id('sched', h)}'`, touch: 'active = active',
    insert: (p, h) => `insert into recurring_schedules (household_id, created_by, txn_template, frequency, start_date, next_due_date)
      values ('${hh(h)}', ${uid(p)}, '{}'::jsonb, 'monthly', current_date, current_date)`,
    expect: h1Writers },
  { table: 'exchange_rates', householdScoped: true, target: h => `household_id = '${hh(h)}' and currency_code = 'EUR'`,
    touch: 'rate_to_usd = rate_to_usd',
    insert: (_p, h) => `insert into exchange_rates (household_id, currency_code, rate_to_usd) values ('${hh(h)}', 'GBP', 1.3)`,
    expect: h1Writers },
  { table: 'budgets', householdScoped: true, target: h => `id = '${id('budget', h)}'`, touch: 'color = color',
    insert: (_p, h) => `insert into budgets (household_id, monthly_limit, scope, period, period_year) values ('${hh(h)}', 100, 'annual', 'annual', 2027)`,
    // Budgets are the owner's and admins' (the owner/admin budget guard).
    expect: { owner: 'SIUD', admin: 'SIUD', member: 'S---', viewer: 'S---' } },
  { table: 'budget_allocations', householdScoped: true, target: h => `id = '${id('alloc', h)}'`, touch: 'amount = amount',
    insert: (_p, h) => `insert into budget_allocations (budget_id, household_id, category, amount) values ('${id('budget', h)}', '${hh(h)}', 'dining', 10)`,
    expect: { owner: 'SIUD', admin: 'SIUD', member: 'S---', viewer: 'S---' } },
  { table: 'notifications', householdScoped: true, target: h => `id = '${id('notif', h)}'`, touch: 'status = status',
    insert: (p, h) => `insert into notifications (household_id, type, title, dedupe_key, source) values ('${hh(h)}', 'budget_threshold', 'New', 'new:${p}', 'client')`,
    // Viewers may mark read, never add or delete (v10.116.0).
    expect: { owner: 'SIUD', admin: 'SIUD', member: 'SIUD', viewer: 'S-U-' } },
  { table: 'activity_log', householdScoped: true, target: h => `id = '${id('log', h)}'`, touch: 'action = action',
    insert: (p, h) => `insert into activity_log (household_id, actor_id, action, entity_type) values ('${hh(h)}', ${uid(p)}, 'created', 'x')`,
    // Members read their household's log; nobody writes it from the app; admins only through admin_activity_feed.
    expect: allMembersRead },
  { table: 'loan_payment_events', householdScoped: true, target: h => `operation_id = '${id('loanEvent', h)}'`, touch: 'amount = amount',
    insert: (_p, h) => `insert into loan_payment_events (operation_id, household_id, debt_id, amount, interest, principal)
      values (gen_random_uuid(), '${hh(h)}', '${id('debt', h)}', 1, 0, 1)`,
    expect: allMembersRead },
  { table: 'net_worth_snapshots', householdScoped: true, target: h => `id = '${id('snap', h)}'`, touch: 'currency = currency',
    insert: (_p, h) => `insert into net_worth_snapshots (household_id, month, total_assets, total_liabilities, liquid_assets, currency)
      values ('${hh(h)}', '2026-01-01', 1, 0, 1, 'USD')`,
    // Written only through record_net_worth_snapshot.
    expect: allMembersRead },
  { table: 'invitations', householdScoped: true, target: h => `id = '${id('invite', h)}'`, touch: 'role = role',
    insert: (p, h) => `insert into invitations (household_id, invited_email, invited_by, role) values ('${hh(h)}', 'New', ${uid(p)}, 'member')`,
    expect: { owner: 'SI-D', admin: 'SI-D' } },
  { table: 'agent_conversations', householdScoped: true, target: h => `id = '${id('conv', h)}'`, touch: 'last_turn_at = last_turn_at',
    insert: (p, h) => `insert into agent_conversations (household_id, user_id, channel) values ('${hh(h)}', ${uid(p)}, 'chat')`,
    // Thread metadata only (household, person, channel, times): no message text.
    expect: { owner: 'SIU-', admin: 'SIU-', member: 'SIU-', viewer: 'SIU-' } },
  { table: 'agent_pending_intents', householdScoped: true, target: h => `id = '${id('intent', h)}'`, touch: 'status = status',
    insert: (p, h) => `insert into agent_pending_intents (conversation_id, household_id, user_id, channel, candidate)
      values ('${id('conv', h)}', '${hh(h)}', ${uid(p)}, 'chat', '{}'::jsonb)`,
    // The target is the owner's; each member sees and answers only their own.
    expect: { owner: 'SIU-', admin: '-I--', member: '-I--', viewer: '-I--' } },
  { table: 'ai_feedback', householdScoped: true, target: h => `id = '${id('feedback', h)}'`, touch: 'rating = rating',
    insert: (p, h) => `insert into ai_feedback (household_id, user_id, rating, turn_id, surface) values ('${hh(h)}', ${uid(p)}, 1, 'new-${p}', 'app')`,
    expect: { owner: 'SIUD', admin: '-I--', member: '-I--', viewer: '-I--' } },
  { table: 'ai_usage', householdScoped: true, target: h => `id = '${id('usage', h)}'`, touch: 'intent = intent',
    insert: (p, h) => `insert into ai_usage (household_id, user_id, source) values ('${hh(h)}', ${uid(p)}, 'client')`,
    // Members read their household's usage (no content in it); content admins read it all; the server meters.
    expect: { owner: 'SI--', admin: 'SI--', member: 'SI--', viewer: 'SI--', superAdmin: 'S---', contentAdmin: 'S---' } },
  { table: 'saved_views', householdScoped: true, target: h => `id = '${id('view', h)}'`, touch: 'name = name',
    insert: (p, h) => `insert into saved_views (user_id, household_id, page, name, is_shared) values (${uid(p)}, '${hh(h)}', 'transactions', 'New', false)`,
    // The target is the owner's own (not shared) view.
    expect: { owner: 'SIUD', admin: '-I--', member: '-I--', viewer: '-I--' } },
  { table: 'shared_splits', householdScoped: true, target: h => `id = '${id('split', h)}'`, touch: 'description = description',
    insert: (p, h) => `insert into shared_splits (owner_user_id, owner_household_id, description, currency, total_amount, date)
      values (${uid(p)}, '${hh(h)}', 'New', 'USD', 10, current_date)`,
    // The owner's split; the outsider has a share in it (a participant reads it); anyone in the household may
    // start their own split there.
    expect: { owner: 'SIUD', outsider: 'S---', admin: '-I--', member: '-I--', viewer: '-I--' } },
  { table: 'shared_split_shares', target: h => `id = '${id('share', h)}'`, touch: 'share = share',
    insert: (_p, h) => `insert into shared_split_shares (split_id, email, share) values ('${id('split', h)}', 'new@vyact.test', 5)`,
    // A share is the split owner's, and the person it is addressed to (by confirmed email) reads it.
    expect: { owner: 'SIUD', outsider: 'S---' } },
  { table: 'subscriptions', householdScoped: true, target: h => `id = '${id('sub', h)}'`, touch: 'status = status',
    insert: (p, h) => `insert into subscriptions (user_id, household_id, tier, status) values (${uid(p)}, '${hh(h)}', 'free', 'active')`,
    expect: { owner: 'S---', superAdmin: 'S---', rolesAdmin: 'S---' } },
  { table: 'households', target: () => `id = '${H1}'`, touch: 'name = name',
    insert: p => `insert into households (name, type, created_by) values ('New', 'personal', ${uid(p)})`,
    // Anyone signed in starts their own household; staff with the roles tier read every household row.
    expect: { outsider: '-I--', owner: 'SIUD', admin: 'SI--', member: 'SI--', viewer: 'SI--',
      superAdmin: 'SI--', rolesAdmin: 'SI--', contentAdmin: '-I--' } },
  { table: 'memberships', target: () => `household_id = '${H1}' and user_id = '${UID.viewer}'`, touch: 'display_name = display_name',
    insert: p => `insert into memberships (household_id, user_id, role, display_name) values ('${H1}', ${uid(p)}, 'member', 'New')`,
    // The target is the viewer's membership. Joining is only by accepting an invitation (v10.114.0).
    expect: { owner: 'S-UD', admin: 'S-UD', member: 'S---', viewer: 'S--D', superAdmin: 'S---', rolesAdmin: 'S---' } },
  { table: 'profiles', target: () => `id = '${UID.owner}'`, touch: 'display_name = display_name',
    insert: p => `insert into profiles (id) values (${uid(p)})`,
    // The owner's profile: their own, the people they share a household with, and roles-tier staff.
    expect: { owner: 'S-U-', admin: 'S---', member: 'S---', viewer: 'S---', superAdmin: 'S---', rolesAdmin: 'S---' } },
  { table: 'content_favorites', target: () => `user_id = '${UID.owner}' and content_id = '${id('published')}'`, touch: 'created_at = created_at',
    insert: p => `insert into content_favorites (user_id, content_id) values (${uid(p)}, '${id('published2')}')`,
    expect: { ...everyoneSignedIn('-I--'), owner: 'SI-D' } },
  { table: 'content_items', target: () => `id = '${id('draft')}'`, touch: 'title = title',
    insert: p => `insert into content_items (slug, title, body, topic, author_name) values ('new-${p}', 'New', 'Body', 'budgeting', 'A')`,
    // The target is a draft: only content staff see it (a published item is checked in Q2-AZ-003).
    expect: { superAdmin: 'SIUD', contentAdmin: 'SIUD' } },
  { table: 'category_classifications', target: () => `category = 'seed_cat'`, touch: 'label = label',
    insert: () => `insert into category_classifications (category, classification) values ('new_cat', 'want')`,
    expect: { ...everyoneSignedIn('S---'), superAdmin: 'SIUD', contentAdmin: 'SIUD' } },
  { table: 'ai_model_configs', target: () => `id = '${id('model')}'`, touch: 'priority = priority',
    insert: () => `insert into ai_model_configs (seam, provider, model, base_url, enabled) values ('assistant', 'p', 'm2', 'https://x.test', false)`,
    expect: { superAdmin: 'SIUD', rolesAdmin: 'S---', contentAdmin: 'S---' } },
  { table: 'admin_roles', target: () => `user_id = '${UID.superAdmin}'`, touch: 'role = role',
    insert: p => `insert into admin_roles (user_id, role) values (${uid(p)}, 'content')`,
    // Staff read their own row; roles are granted outside the API (Track Q3 adds audited grant/revoke).
    expect: { superAdmin: 'S---' } },
  { table: 'sms_format_recipes', target: () => `signature = 'seed-sig'`, touch: 'status = status',
    insert: () => `insert into sms_format_recipes (signature, locators) values ('new-sig', '{}'::jsonb)`,
    expect: everyoneSignedIn('S---') },
  { table: 'migration_issues', target: () => `step = 'seed'`, touch: 'step = step',
    insert: () => `insert into migration_issues (step) values ('x')`,
    expect: {},
    gaps: Object.fromEntries(PERSONAS.map(p => [p, { actual: 'SIUD',
      finding: 'DB-OPS-03 / D4 (Track Q3): production-only table without RLS, open to the API' }])) },
  { table: 'storage.objects', target: () => `id = '${id('object')}'`, touch: 'name = name',
    insert: p => `insert into storage.objects (bucket_id, name) values ('insight-infographics', 'new-${p}.png')`,
    // The Insights infographics bucket: public images, written by content staff.
    expect: { anon: 'S---', ...everyoneSignedIn('S---'), superAdmin: 'SIUD', contentAdmin: 'SIUD' } },
];

/** Tables that RLS closes to the API completely (no policy for anon, authenticated or public). */
const SERVER_ONLY = ['ask_vyact_relay', 'invite_email_log', 'push_deliveries', 'push_subscriptions', 'split_email_log',
  'whatsapp_identities', 'whatsapp_inbound_messages', 'whatsapp_pending_turns', 'whatsapp_preferences',
  'whatsapp_rule_state', 'whatsapp_verification_otps'];

// ── Seeding ────────────────────────────────────────────────────────────────────────────────────────────────────

async function seed() {
  const users = Object.entries(UID).map(([p, u]) => `('${u}', '${EMAIL(p as SignedIn)}', now(), '{"display_name": "${p}"}'::jsonb)`);
  await db.exec(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ${users.join(', ')}`);
  // Each new person gets a personal household (handle_new_user). The owner's becomes H1, the outsider's H2.
  H1 = (await db.query<{ id: string }>(`select id from households where created_by = $1`, [UID.owner])).rows[0].id;
  H2 = (await db.query<{ id: string }>(`select id from households where created_by = $1`, [UID.outsider])).rows[0].id;
  await db.exec(`
    update households set type = 'family', name = 'H1' where id = '${H1}';
    update households set type = 'family', name = 'H2' where id = '${H2}';
    insert into memberships (household_id, user_id, role, display_name) values
      ('${H1}', '${UID.admin}', 'admin', 'admin'), ('${H1}', '${UID.member}', 'member', 'member'),
      ('${H1}', '${UID.viewer}', 'viewer', 'viewer');
    insert into admin_roles (user_id, role) values
      ('${UID.superAdmin}', 'super'), ('${UID.rolesAdmin}', 'roles'), ('${UID.contentAdmin}', 'content');
    insert into content_items (id, slug, title, body, topic, author_name, status) values
      ('${id('draft')}', 'seed-draft', 'Draft', 'Body', 'budgeting', 'A', 'draft'),
      ('${id('published')}', 'seed-published', 'Published', 'Body', 'budgeting', 'A', 'published'),
      ('${id('published2')}', 'seed-published-2', 'Published 2', 'Body', 'budgeting', 'A', 'published');
    insert into content_favorites (user_id, content_id) values ('${UID.owner}', '${id('published')}');
    insert into category_classifications (category, classification) values ('seed_cat', 'need');
    insert into sms_format_recipes (signature, locators) values ('seed-sig', '{}'::jsonb);
    insert into ai_model_configs (id, seam, provider, model, base_url, enabled) values ('${id('model')}', 'assistant', 'p', 'm', 'https://x.test', false);
    insert into migration_issues (step) values ('seed');
    insert into storage.objects (id, bucket_id, name) values ('${id('object')}', 'insight-infographics', 'seed.png');
  `);
  for (const h of [1, 2] as const) {
    const H = hh(h);
    const u = h === 1 ? UID.owner : UID.outsider;
    // H1's split is shared with the outsider; H2's with nobody in H1.
    const shareTo = h === 1 ? EMAIL('outsider') : 'stranger@vyact.test';
    await db.exec(`
      insert into accounts (id, household_id, kind, name, currency) values
        ('${id('acct', h)}', '${H}', 'bank', 'Bank', 'USD'), ('${id('acctSpare', h)}', '${H}', 'bank', 'Spare', 'USD');
      insert into transactions (id, household_id, created_by, type, amount, currency, date, description, category, account_id)
        values ('${id('txn', h)}', '${H}', '${u}', 'expense', 10, 'USD', current_date, 'seed', 'groceries', '${id('acct', h)}');
      insert into assets (id, household_id, type, name, value, liquidity) values ('${id('asset', h)}', '${H}', 'investment', 'Fund', 100, 'long');
      insert into debts (id, household_id, type, name, current_balance, interest_rate, minimum_payment, direction)
        values ('${id('debt', h)}', '${H}', 'other', 'Lent to a friend', 0, 0, 0, 'owed_to_me');
      insert into goals (id, household_id, type, name, target_amount) values ('${id('goal', h)}', '${H}', 'savings', 'Trip', 100);
      insert into budgets (id, household_id, monthly_limit, scope, period, period_year, period_month)
        values ('${id('budget', h)}', '${H}', 100, 'month', 'monthly', 2026, 10);
      insert into budget_allocations (id, budget_id, household_id, category, amount) values ('${id('alloc', h)}', '${id('budget', h)}', '${H}', 'groceries', 50);
      insert into exchange_rates (household_id, currency_code, rate_to_usd) values ('${H}', 'EUR', 1.1);
      insert into recurring_schedules (id, household_id, created_by, txn_template, frequency, start_date, next_due_date)
        values ('${id('sched', h)}', '${H}', '${u}', '{}'::jsonb, 'monthly', current_date, current_date);
      insert into notifications (id, household_id, type, title, dedupe_key, source) values ('${id('notif', h)}', '${H}', 'budget_threshold', 'Seed', 'seed', 'client');
      insert into activity_log (id, household_id, actor_id, action, entity_type) values ('${id('log', h)}', '${H}', '${u}', 'created', 'seed');
      insert into loan_payment_events (operation_id, household_id, debt_id, amount, interest, principal) values ('${id('loanEvent', h)}', '${H}', '${id('debt', h)}', 1, 0, 1);
      insert into net_worth_snapshots (id, household_id, month, total_assets, total_liabilities, liquid_assets, currency)
        values ('${id('snap', h)}', '${H}', date_trunc('month', current_date)::date, 1, 0, 1, 'USD');
      insert into invitations (id, household_id, invited_email, invited_by, role, token) values ('${id('invite', h)}', '${H}', 'Pat', '${u}', 'member', 'seed-${h}');
      insert into agent_conversations (id, household_id, user_id, channel) values ('${id('conv', h)}', '${H}', '${u}', 'chat');
      insert into agent_pending_intents (id, conversation_id, household_id, user_id, channel, candidate) values ('${id('intent', h)}', '${id('conv', h)}', '${H}', '${u}', 'chat', '{}'::jsonb);
      insert into ai_feedback (id, household_id, user_id, rating, turn_id, surface) values ('${id('feedback', h)}', '${H}', '${u}', 1, 'seed', 'app');
      insert into ai_usage (id, household_id, user_id, source) values ('${id('usage', h)}', '${H}', '${u}', 'client');
      insert into saved_views (id, user_id, household_id, page, name, is_shared) values ('${id('view', h)}', '${u}', '${H}', 'transactions', 'Mine', false);
      insert into shared_splits (id, owner_user_id, owner_household_id, description, currency, total_amount, date)
        values ('${id('split', h)}', '${u}', '${H}', 'Dinner', 'USD', 30, current_date);
      insert into shared_split_shares (id, split_id, email, share) values ('${id('share', h)}', '${id('split', h)}', '${shareTo}', 10);
      insert into subscriptions (id, user_id, household_id, tier, status) values ('${id('sub', h)}', '${u}', '${H}', 'free', 'active');
    `);
  }
}

beforeAll(async () => {
  ({ db } = await replayMigrations());
  await seed();
}, 180_000);
afterAll(async () => { await db?.close(); });

/**
 * Refused for authorization: a privilege or RLS refusal (42501), or a tenant-consistency trigger refusing a link to
 * a household the row is not in (23503, v10.117.0). Anything else is a fixture problem and fails the test.
 */
const TENANT_GUARD = /belongs to a different household|is not a household the owner belongs to/;
const REFUSED = (o: Outcome) => !o.ok && (o.code === '42501' || (o.code === '23503' && TENANT_GUARD.test(o.message)));

/** What `p` can do to table t's target row in household h, as 'SIUD' with '-' for refused. */
async function cellFor(t: TableCase, p: Persona, h: 1 | 2): Promise<{ cell: string; problems: string[] }> {
  const problems: string[] = [];
  const name = t.table.includes('.') ? t.table : `public.${t.table}`;
  const sel = await as(p, `select 1 from ${name} where ${t.target(h)}`);
  const ins = await as(p, `${t.insert(p, h)} returning 1`);
  const upd = await as(p, `update ${name} set ${t.touch} where ${t.target(h)} returning 1`);
  const del = await as(p, `delete from ${name} where ${t.target(h)} returning 1`);
  const flag = (letter: string, o: Outcome, refusedIf: (o: Outcome) => boolean) => {
    if (o.ok && o.rows > 0) return letter;
    if ((o.ok && o.rows === 0) || refusedIf(o)) return '-';
    problems.push(`${t.table}/${p}/${letter}: ${o.ok ? '' : `${o.code} ${o.message}`}`);
    return '?';
  };
  // A refused insert must be refused for authorization, not fail on the fixture. A refused read, update or
  // delete may also match no rows (RLS hides the row); signed out, a policy's helper function can refuse the
  // whole statement instead (42501).
  const cell = flag('S', sel, REFUSED) + flag('I', ins, REFUSED) + flag('U', upd, REFUSED) + flag('D', del, REFUSED);
  return { cell, problems };
}

describe('who can read and change each table (DB-SEC-10, OPS-08)', () => {
  it('Q2-AZ-001 · every person, every table, H1\'s row: as intended, or a recorded gap', async () => {
    const mismatches: string[] = [];
    const problems: string[] = [];
    const gaps: string[] = [];
    for (const t of TABLES) {
      for (const p of PERSONAS) {
        const { cell, problems: pr } = await cellFor(t, p, 1);
        problems.push(...pr);
        const gap = t.gaps?.[p];
        const want = gap?.actual ?? t.expect[p] ?? '----';
        if (gap) gaps.push(`${t.table}/${p}: ${gap.actual} (intended ${t.expect[p] ?? '----'}) — ${gap.finding}`);
        if (cell !== want) mismatches.push(`${t.table}/${p}: got ${cell}, want ${want}${gap ? ' (a recorded gap changed: update or remove it)' : ''}`);
      }
    }
    expect(problems, 'a fixture or statement failed for a reason other than authorization').toEqual([]);
    expect(mismatches).toEqual([]);
    expect(gaps.length).toBe(PERSONAS.length);   // migration_issues only, today
  });

  it('Q2-AZ-002 · nobody in H1 reaches H2\'s rows, in any table, by any operation', async () => {
    const leaks: string[] = [];
    for (const t of TABLES.filter(x => x.householdScoped)) {
      for (const p of MEMBERS) {
        const { cell, problems } = await cellFor(t, p, 2);
        if (cell !== '----' || problems.length) leaks.push(`${t.table}/${p}: ${cell} ${problems.join('; ')}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('Q2-AZ-003 · published content is public; a member\'s shared saved view is the household\'s', async () => {
    for (const p of PERSONAS) {
      const r = await as(p, `select 1 from content_items where id = '${id('published')}'`);
      expect(r.ok && r.rows, `${p} reads published content`).toBe(1);
    }
    await db.exec(`update saved_views set is_shared = true where id = '${id('view')}'`);
    try {
      for (const p of PERSONAS) {
        const r = await as(p, `select 1 from saved_views where id = '${id('view')}'`);
        expect(r.ok && r.rows, `${p} reads the owner's shared view`).toBe((MEMBERS as readonly string[]).includes(p) ? 1 : 0);
      }
    } finally {
      await db.exec(`update saved_views set is_shared = false where id = '${id('view')}'`);
    }
  });

  it('Q2-AZ-004 · the views show only the households the person is in', async () => {
    for (const p of PERSONAS) {
      const mine = await as(p, `select id from my_households where id in ('${H1}', '${H2}') order by name`);
      const byAccount = await as(p, `select 1 from v_txn_by_account where household_id = '${H1}'`);
      const byMember = await as(p, `select 1 from v_txn_by_member where household_id = '${H1}'`);
      const inH1 = (MEMBERS as readonly string[]).includes(p);
      const want = p === 'outsider' ? [H2] : inH1 ? [H1] : [];
      expect(mine.ok ? mine.data.map(r => r.id) : mine, `${p} · my_households`).toEqual(want);
      expect(byAccount.ok ? byAccount.rows > 0 : 'refused', `${p} · v_txn_by_account`).toBe(inH1 ? true : byAccount.ok ? false : 'refused');
      expect(byMember.ok ? byMember.rows > 0 : 'refused', `${p} · v_txn_by_member`).toBe(inH1 ? true : byMember.ok ? false : 'refused');
    }
  });

  it('Q2-AZ-005 · tables only the server writes: RLS on, and no policy lets the API in', async () => {
    const open = await db.query<{ t: string; p: string }>(`
      select tablename t, policyname p from pg_policies
       where schemaname = 'public' and tablename = any($1)
         and roles && array['anon', 'authenticated', 'public']::name[]`, [SERVER_ONLY]);
    expect(open.rows).toEqual([]);
    const rls = await db.query<{ relname: string }>(`select relname from pg_class
      where relnamespace = 'public'::regnamespace and relname = any($1) and relrowsecurity order by 1`, [SERVER_ONLY]);
    expect(rls.rows.map(r => r.relname)).toEqual([...SERVER_ONLY].sort());
    // Every table in public is either in the matrix or server-only, so a new table must be placed in one.
    const all = await db.query<{ relname: string }>(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') order by 1`);
    const placed = new Set([...TABLES.map(t => t.table), ...SERVER_ONLY]);
    expect(all.rows.map(r => r.relname).filter(t => !placed.has(t))).toEqual([]);
  });
});

// ── Functions the API can call ─────────────────────────────────────────────────────────────────────────────────

/** Pure helpers (or ones that answer only about the caller), callable by anyone: nothing to protect. */
const ANON_CALLABLE = ['ai_usage_stage_ms_ok(jsonb)', 'household_member_limit(text)', 'is_member(uuid)', 'is_valid_timezone(text)',
  'loan_digits(integer)', 'loan_emi(numeric,numeric,integer,integer)', 'loan_instalments_left(numeric,numeric,numeric)',
  'loan_interest(numeric,numeric,integer)', 'loan_minor_scale(text)', 'loan_next_instalment(date,integer)',
  'loan_rate_on(jsonb,numeric,date)', 'recurrence_rrule_from_legacy(text,integer,integer,date)', 'role_in(uuid)'];

/** Callable when signed in, by what they act on. Every one is in the RPC matrix below, or acts only on the caller. */
const SIGNED_IN_CALLABLE: Record<string, 'household' | 'caller' | 'staff' | 'policy helper' | 'loan'> = {
  'account_dependencies(uuid)': 'household', 'delete_account(uuid)': 'household', 'move_account_and_delete(uuid,uuid)': 'household',
  'delete_debt(uuid)': 'household', 'ensure_cash_account(uuid)': 'household', 'erase_household_data(uuid)': 'household',
  'leave_household(uuid)': 'household', 'record_net_worth_snapshot(uuid,date,numeric,numeric,numeric,text)': 'household',
  'set_household_timezone(uuid,text,boolean)': 'household', 'transfer_ownership(uuid,uuid)': 'household',
  'upsert_budget(uuid,jsonb,text)': 'household', 'upsert_budget_with_allocations(uuid,jsonb,jsonb,text)': 'household',
  'prepare_ai_call(uuid,text,text,integer,boolean)': 'household',
  'register_push_subscription(text,text,text,uuid,text,text,jsonb)': 'household', 'register_native_push(text,uuid,text,text,jsonb)': 'household',
  'settle_share(uuid)': 'household',
  // The loan functions: authorization is tested with a real loan in loanModelSql / loanAutomationSql.
  'loan_due(uuid,date)': 'loan', 'pay_loan(uuid,uuid,text,numeric,date,uuid,uuid,text,text,numeric,numeric)': 'loan',
  'mark_loan_paid_off(uuid,text)': 'loan', 'reverse_loan_payment(uuid)': 'loan',
  'accept_invitation_by_id(uuid)': 'caller', 'accept_invitation_link(text)': 'caller', 'decline_invitation(uuid)': 'caller',
  'deactivate_my_account()': 'caller', 'reactivate_my_account()': 'caller', 'get_my_whatsapp_preferences()': 'caller',
  'set_my_whatsapp_preferences(boolean,boolean,text[],numeric,boolean)': 'caller', 'my_email()': 'caller',
  'my_pending_invitations()': 'caller', 'native_push_status(text)': 'caller', 'push_subscription_status(text)': 'caller',
  'unregister_native_push(text)': 'caller', 'unregister_push_subscription(text)': 'caller',
  'resolve_participant_names(text[])': 'caller', 'recently_reauthenticated(integer)': 'caller',
  'admin_activity_feed(integer,timestamp with time zone)': 'staff', 'admin_ai_feedback_summary()': 'staff',
  'admin_ai_usage_summary()': 'staff', 'admin_dashboard_kpis()': 'staff', 'admin_list_users()': 'staff',
  'admin_weekly_trend(integer)': 'staff',
  'is_admin(text)': 'policy helper', 'is_split_participant(uuid)': 'policy helper', 'owns_shared_split(uuid)': 'policy helper',
  'agent_conversation_in_household(uuid,uuid)': 'policy helper',
};

type Expect = 'ok' | 'refused' | 'empty';
interface RpcCase {
  name: string;
  sql: string;
  expect: Partial<Record<Persona, Expect>>;   // unlisted: 'refused'
  gaps?: Partial<Record<Persona, { actual: Expect; finding: string }>>;
}
const membersOk = { owner: 'ok', admin: 'ok', member: 'ok', viewer: 'ok' } as const;

const RPCS = (): RpcCase[] => [
  { name: 'ensure_cash_account', sql: `select ensure_cash_account('${H1}')`, expect: membersOk },
  { name: 'account_dependencies', sql: `select account_dependencies('${id('acct')}')`, expect: membersOk },
  { name: 'delete_account', sql: `select delete_account('${id('acctSpare')}')`, expect: { owner: 'ok', admin: 'ok' } },
  { name: 'move_account_and_delete', sql: `select move_account_and_delete('${id('acctSpare')}', '${id('acct')}')`, expect: { owner: 'ok', admin: 'ok' } },
  { name: 'delete_debt', sql: `select delete_debt('${id('debt')}')`, expect: { owner: 'ok', admin: 'ok', member: 'ok' } },
  { name: 'erase_household_data', sql: `select erase_household_data('${H1}')`, expect: { owner: 'ok', admin: 'ok' } },
  { name: 'set_household_timezone', sql: `select set_household_timezone('${H1}', 'Asia/Kolkata', true)`, expect: { owner: 'ok' } },
  { name: 'transfer_ownership', sql: `select transfer_ownership('${H1}', '${UID.admin}')`, expect: { owner: 'ok' } },
  { name: 'leave_household', sql: `select leave_household('${H1}')`,
    // The last owner cannot leave; someone not in it leaves nothing (a no-op, not an error).
    expect: { admin: 'ok', member: 'ok', viewer: 'ok', outsider: 'ok', superAdmin: 'ok', rolesAdmin: 'ok', contentAdmin: 'ok' } },
  { name: 'record_net_worth_snapshot',
    sql: `select record_net_worth_snapshot('${H1}', date_trunc('month', current_date)::date, 1, 0, 1, 'USD')`, expect: membersOk },
  { name: 'upsert_budget', sql: `select id from upsert_budget('${H1}', '{"scope": "annual", "period": "annual", "period_year": 2028, "monthly_limit": 100}'::jsonb, 'create')`,
    expect: { owner: 'ok', admin: 'ok' },
    gaps: { member: { actual: 'ok', finding: 'DB-SEC-03 (Track Q3): upsert_budget checks membership only; production adds the owner/admin guard' },
      viewer: { actual: 'ok', finding: 'DB-SEC-03 (Track Q3): a viewer can write a budget through upsert_budget' } } },
  { name: 'upsert_budget_with_allocations',
    sql: `select upsert_budget_with_allocations('${H1}', '{"scope": "annual", "period": "annual", "period_year": 2028, "monthly_limit": 100}'::jsonb, '[{"category": "dining", "amount": 10}]'::jsonb, 'create')`,
    expect: { owner: 'ok', admin: 'ok' },
    gaps: { member: { actual: 'ok', finding: 'DB-SEC-03 (Track Q3)' }, viewer: { actual: 'ok', finding: 'DB-SEC-03 (Track Q3)' } } },
  { name: 'register_push_subscription',
    sql: `select register_push_subscription('https://fcm.googleapis.com/fcm/send/abc', '${'B'.repeat(87)}', '${'a'.repeat(22)}', '${H1}', 'ua', 'Asia/Kolkata', '{}'::jsonb)`,
    expect: membersOk },
  { name: 'register_native_push', sql: `select register_native_push('${'t'.repeat(40)}:${'x'.repeat(100)}', '${H1}', 'ua', 'Asia/Kolkata', '{}'::jsonb)`,
    expect: membersOk },
  { name: 'settle_share', sql: `select settle_share('${id('share')}')`, expect: { outsider: 'ok' } },
  // Staff tiers (ADM-07, server half): roles = people and households; content = Learn and Pip's usage.
  { name: 'admin_activity_feed', sql: `select * from admin_activity_feed(10, null)`, expect: { superAdmin: 'ok', rolesAdmin: 'ok' } },
  { name: 'admin_dashboard_kpis', sql: `select admin_dashboard_kpis()`, expect: { superAdmin: 'ok', rolesAdmin: 'ok' } },
  { name: 'admin_list_users', sql: `select * from admin_list_users()`,
    expect: { superAdmin: 'ok', rolesAdmin: 'ok', owner: 'empty', admin: 'empty', member: 'empty', viewer: 'empty', outsider: 'empty', contentAdmin: 'empty' } },
  { name: 'admin_weekly_trend', sql: `select * from admin_weekly_trend(4)`,
    expect: { superAdmin: 'ok', rolesAdmin: 'ok', owner: 'empty', admin: 'empty', member: 'empty', viewer: 'empty', outsider: 'empty', contentAdmin: 'empty' } },
  { name: 'admin_ai_usage_summary', sql: `select admin_ai_usage_summary()`, expect: { superAdmin: 'ok', contentAdmin: 'ok' } },
  { name: 'admin_ai_feedback_summary', sql: `select admin_ai_feedback_summary()`, expect: { superAdmin: 'ok', contentAdmin: 'ok' } },
];

describe('who can call each function (DB-SEC-10, ADM-07)', () => {
  it('Q2-AZ-006 · anon can call only pure helpers; every signed-in function is placed; the rest are the server\'s', async () => {
    const fns = await db.query<{ f: string; anon: boolean; au: boolean }>(`
      select p.oid::regprocedure::text as f, has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as au
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
         and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
       order by 1`);
    expect(fns.rows.filter(r => r.anon).map(r => r.f)).toEqual([...ANON_CALLABLE].sort());
    const signedIn = fns.rows.filter(r => r.au && !r.anon).map(r => r.f);
    expect(signedIn).toEqual(Object.keys(SIGNED_IN_CALLABLE).sort());
  });

  it('Q2-AZ-007 · each household, staff and split function, as each person', async () => {
    const mismatches: string[] = [];
    const gaps: string[] = [];
    const cases = RPCS();
    for (const c of cases) {
      for (const p of PERSONAS) {
        const o = await as(p, c.sql);
        const got: Expect | string = o.ok ? (o.rows === 0 ? 'empty' : 'ok') : 'refused';
        const gap = c.gaps?.[p];
        const want = gap?.actual ?? c.expect[p] ?? 'refused';
        if (gap) gaps.push(`${c.name}/${p}: ${gap.actual} (intended ${c.expect[p] ?? 'refused'}) — ${gap.finding}`);
        if (got !== want) mismatches.push(`${c.name}/${p}: got ${got}${o.ok ? '' : ` (${o.code} ${o.message})`}, want ${want}`);
      }
    }
    expect(mismatches).toEqual([]);
    // Every household function is in the matrix.
    const covered = new Set(cases.map(c => c.name));
    const household = Object.entries(SIGNED_IN_CALLABLE).filter(([, k]) => k === 'household' || k === 'staff').map(([f]) => f.split('(')[0]);
    expect(household.filter(f => !covered.has(f))).toEqual(['prepare_ai_call']);   // Q2-AZ-008
  });

  it('Q2-AZ-008 · prepare_ai_call answers member: false for someone not in the household, and reserves nothing', async () => {
    for (const p of PERSONAS.filter(x => x !== 'anon')) {
      const o = await as(p, `select prepare_ai_call('${H1}', 'assistant', 'chat', 10, true) as r`);
      expect(o.ok, `${p}: ${o.ok ? '' : o.message}`).toBe(true);
      if (o.ok) expect((o.data[0].r as { member: boolean }).member, p).toBe((MEMBERS as readonly string[]).includes(p));
    }
    expect((await as('anon', `select prepare_ai_call('${H1}', 'assistant', 'chat', 10, true)`)).ok).toBe(false);
  });

  it('Q2-AZ-009 · upsert_budget cannot touch another household\'s budget (DB-SEC-03, a recorded gap)', async () => {
    // H1's owner names H2's budget id in replace mode. Intended: refused, H2 untouched.
    const o = await as('owner', `select household_id, monthly_limit from upsert_budget('${H1}',
      '{"id": "${id('budget', 2)}", "monthly_limit": 999}'::jsonb, 'replace')`);
    // KNOWN GAP (Track Q3): `on conflict (id) do update` rewrites H2's budget. When Q3 fixes it, this becomes
    // `expect(o.ok).toBe(false)` (or no row of H2's), and the gap entry goes.
    expect(o.ok && o.data[0]).toEqual({ household_id: H2, monthly_limit: '999' });
  });
});
