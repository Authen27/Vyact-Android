// v10.59.0 (owner, 4 Oct 2026) — household types: Personal · Couple · Family · Business.
// Pinned: the four types and their copy, the member limits (and that the migration's
// household_member_limit() says the same), the mapping of retired types, and what the
// invite button and type picker say before the database refuses.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  HOUSEHOLD_MEMBER_LIMIT, HOUSEHOLD_TYPE_ORDER, normalizeHouseholdType, typeFits, inviteBlockedReason, householdLimitMessage,
} from '../householdTypes';
import { PROFILE_TYPES } from '../../constants';

describe('household types', () => {
  it('CON-UNIT-HHT-001 · four types, in order, each with a label, a one-line description and what it allows', () => {
    expect(HOUSEHOLD_TYPE_ORDER).toEqual(['personal', 'couple', 'family', 'business']);
    expect(Object.keys(PROFILE_TYPES).sort()).toEqual([...HOUSEHOLD_TYPE_ORDER].sort());
    expect(PROFILE_TYPES.personal.detail).toMatch(/No one else can be invited/);
    expect(PROFILE_TYPES.couple.detail).toMatch(/one other person/);
    expect(PROFILE_TYPES.family.detail).toMatch(/as many people/);
    expect(PROFILE_TYPES.business.detail).toMatch(/cash runway/);
    expect(PROFILE_TYPES.business.label).toBe('Business');
  });

  it('CON-UNIT-HHT-002 · member limits: Personal 1, Couple 2, Family and Business none; the database migration says the same', () => {
    expect(HOUSEHOLD_MEMBER_LIMIT).toEqual({ personal: 1, couple: 2, family: null, business: null });
    const sql = readFileSync(resolve(__dirname, '../../../../supabase/migrations/20261007120000_household_types_v2.sql'), 'utf8');
    expect(sql).toMatch(/case p_type when 'personal' then 1 when 'couple' then 2 else null end/);
    expect(sql).toMatch(/check \(type in \('personal', 'couple', 'family', 'business'\)\)/);
    expect(sql).toMatch(/update public\.households set type = 'family' where type = 'shared'/);
    expect(sql).toMatch(/before insert on public\.invitations/);
    expect(sql).toMatch(/before insert on public\.memberships/);
    expect(sql).toMatch(/before update of type on public\.households/);
  });

  it('CON-UNIT-HHT-003 · retired types read as the migration maps them; anything unknown limits nothing', () => {
    expect(normalizeHouseholdType('shared')).toBe('family');
    expect(normalizeHouseholdType('multi_biz')).toBe('business');
    for (const t of HOUSEHOLD_TYPE_ORDER) expect(normalizeHouseholdType(t)).toBe(t);
    expect(normalizeHouseholdType(undefined)).toBe('family');
    expect(normalizeHouseholdType('nonsense')).toBe('family');
  });

  it('CON-UNIT-HHT-004 · invites: Personal never, Couple once (a pending invite holds the place), Family and Business always', () => {
    expect(inviteBlockedReason('personal', 1)).toMatch(/private/);
    expect(inviteBlockedReason('couple', 1)).toBeNull();
    expect(inviteBlockedReason('couple', 1, 1)).toMatch(/already waiting/);
    expect(inviteBlockedReason('couple', 2)).toMatch(/Change the type to Family/);
    expect(inviteBlockedReason('family', 9, 3)).toBeNull();
    expect(inviteBlockedReason('business', 12)).toBeNull();
    expect(inviteBlockedReason('shared', 4)).toBeNull();   // a stale cache: family
  });

  it('CON-UNIT-HHT-005 · a type change must fit the members already there; the database refusal reads as words', () => {
    expect(typeFits('personal', 1)).toBe(true);
    expect(typeFits('personal', 2)).toBe(false);
    expect(typeFits('couple', 2)).toBe(true);
    expect(typeFits('couple', 3)).toBe(false);
    expect(typeFits('family', 30)).toBe(true);
    expect(householdLimitMessage(new Error('HOUSEHOLD_FULL: a personal household has room for 1 member'))).toMatch(/private/);
    expect(householdLimitMessage(new Error('HOUSEHOLD_FULL: a couple household has room for 2 members'))).toMatch(/Family/);
    expect(householdLimitMessage({ message: 'HOUSEHOLD_TYPE_TOO_SMALL: 3 members' })).toMatch(/more members/);
    expect(householdLimitMessage(new Error('network down'))).toBeNull();
  });
});
