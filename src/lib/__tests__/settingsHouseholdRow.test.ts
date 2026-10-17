import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canEditHouseholdRow } from '../permissions';

describe('Settings: household fields and the profile email (W6, audit FE-UIS-06)', () => {
  it('W6-UIS06-001 · only the owner edits the household row in cloud mode (RLS "owners update household"); local-only has one user', () => {
    expect(canEditHouseholdRow('owner', true)).toBe(true);
    for (const role of ['admin', 'member', 'viewer', 'child', undefined] as const) {
      expect(canEditHouseholdRow(role as never, true), String(role)).toBe(false);
    }
    expect(canEditHouseholdRow(undefined, false)).toBe(true);
    // The policy the rule mirrors.
    const baseline = readFileSync(resolve(__dirname, '../../../../supabase/migrations/00000000000001_production_state_baseline.sql'), 'utf8');
    expect(baseline).toMatch(/create policy "owners update household"\s+on households for update using \(role_in\(id\) = 'owner'\);/);
  });

  it('W6-UIS06-002 · currency, language, payoff strategy and extra payment are read-only for others; the email is shown, never saved', () => {
    const src = readFileSync(resolve(__dirname, '../../pages/Settings.tsx'), 'utf8');
    for (const id of ['settings-language', 'settings-currency', 'settings-payoff']) {
      expect(src, id).toMatch(new RegExp(`<Select id="${id}"[^>]*disabled=\\{!canEditHousehold\\}`));
    }
    expect(src).toMatch(/id="settings-extra-payment"[\s\S]{0,160}disabled=\{!canEditHousehold\}/);
    expect(src).toMatch(/canEditHousehold\s*\n?\s*\? <button className="btn-primary" onClick=\{saveDebtPrefs\}>/);
    expect(src).toMatch(/await updateProfile\(\{ name \}\);/);
    expect(src).not.toMatch(/setEmail\(/);
  });
});
