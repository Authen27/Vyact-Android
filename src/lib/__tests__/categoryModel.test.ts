import { describe, expect, it } from 'vitest';
import {
  EXPENSE_CATEGORIES, INCOME_CATEGORIES, CATEGORIES_BY_TYPE,
  NEEDS_WANTS_MAP, LEGACY_CATEGORY_ALIASES, needsWantsForCategory,
} from '../../constants';

// CON-UNIT-155..162 — the v10.21 category model.
//
// Reported by the user: "Travel and Transport categories are alike, combine
// them to Travel", plus five categories that did not exist. Two things make
// this more than a list edit:
//
//   1. `transport` is a RETIRED id that still exists in stored rows. Anything
//      keyed on the category set has to keep resolving it, or historical
//      transactions lose their label and their needs/wants classification.
//   2. Three separate places hold a copy of the category set — the client
//      constants, the WhatsApp parser's allowlist, and the agent's. They are
//      not imported from one another (the server ones are Deno), so they drift
//      silently and a category the app offers becomes one WhatsApp rejects.

const EXPENSE_IDS = EXPENSE_CATEGORIES.map(c => c.id) as string[];

describe('category model · transport merged into travel', () => {
  it('CON-UNIT-155 · transport is no longer offered, travel is, and it carries the route icon', () => {
    expect(EXPENSE_IDS).not.toContain('transport');
    expect(EXPENSE_IDS).toContain('travel');

    const travel = EXPENSE_CATEGORIES.find(c => c.id === 'travel')!;
    // The user asked for neither a car nor a plane — a route, start to
    // destination, because the category now covers the whole journey.
    expect(travel.icon).toBe('🛣️');
    expect(travel.label).toBe('Travel');
  });

  it('CON-UNIT-156 · the five requested categories exist with distinct ids, labels and icons', () => {
    const added = ['holiday_outstay', 'gifts_donations', 'electronics_decor',
      'personal_care', 'repairs_maintenance'];
    for (const id of added) expect(EXPENSE_IDS, `missing ${id}`).toContain(id);

    // Icons must be distinguishable — a duplicated glyph makes two categories
    // indistinguishable in the picker, which is how transport/travel started.
    const icons = EXPENSE_CATEGORIES.map(c => c.icon);
    expect(new Set(icons).size, 'duplicate icon in the expense set').toBe(icons.length);
    const labels = EXPENSE_CATEGORIES.map(c => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('CON-UNIT-157 · every offered expense category has a needs/wants classification', () => {
    // Pulse, the 50/30/20 split and the planner all read this map. A category
    // absent from it silently drops out of those calculations rather than
    // failing loudly.
    for (const id of EXPENSE_IDS) {
      expect(needsWantsForCategory(id), `${id} has no needs/wants entry`).toBeDefined();
    }
  });

  it('CON-UNIT-158 · a stored transport row still resolves — label and classification', () => {
    // Historical rows keep the retired id until the migration runs, and a
    // device whose cache predates it keeps sending the old value.
    expect(LEGACY_CATEGORY_ALIASES.transport).toBe('travel');
    expect(NEEDS_WANTS_MAP.transport).toBeDefined();
  });

  it('CON-UNIT-159 · travel is a need and the holiday half is the want', () => {
    // The merge changed what `travel` MEANS: getting around, not a holiday.
    // Classifying it as a want would misstate the needs/wants split for every
    // household that commutes.
    expect(needsWantsForCategory('travel')).toBe('need');
    expect(needsWantsForCategory('holiday_outstay')).toBe('want');
  });

  it('CON-UNIT-160 · type-scoping still holds — no category is offered for both types', () => {
    const incomeIds = INCOME_CATEGORIES.map(c => c.id) as string[];
    expect(EXPENSE_IDS.filter(id => incomeIds.includes(id))).toEqual([]);
    expect(CATEGORIES_BY_TYPE.expense).toBe(EXPENSE_CATEGORIES);
    // Transfers and investments carry no category — enforced by the DB's
    // ck_txn_category_by_type; asserted here so the client set never grows one.
    expect(EXPENSE_IDS).not.toContain('transfer');
    expect(EXPENSE_IDS).not.toContain('investment');
  });
});

// ── Parity: three copies of the category set, no shared import ──────────────
// The server files are Deno modules and cannot import the client constants, so
// the sets are duplicated by necessity. That makes drift a matter of when, not
// if — and the failure mode is quiet: a category the app offers is rejected by
// the WhatsApp parser as unknown, so a logged expense silently lands in
// "other" or asks for clarification the user cannot resolve.
import { EXPENSE_IDS as WA_EXPENSE_IDS } from '../../../../supabase/functions/_shared/whatsapp-parser';
import { EXPENSE_IDS as AGENT_EXPENSE_IDS } from '../../../../supabase/functions/_shared/agent/types';

describe('category model · the client, WhatsApp and agent sets must not drift', () => {
  const client = new Set(EXPENSE_CATEGORIES.map(c => c.id) as string[]);

  it('CON-UNIT-161 · the WhatsApp parser accepts exactly what the app offers', () => {
    expect([...WA_EXPENSE_IDS].sort()).toEqual([...client].sort());
  });

  it('CON-UNIT-162 · the agent accepts exactly what the app offers', () => {
    expect([...AGENT_EXPENSE_IDS].sort()).toEqual([...client].sort());
  });
});
