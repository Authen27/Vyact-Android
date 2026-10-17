// The household's zone, for the server (W3a, v10.65.0; owner decision D12).
//
// The app reads "today" on the DEVICE's clock (lib/format.ts). The server — WhatsApp, the scheduler,
// web push — has no device to ask, so it uses `households.timezone`. That zone comes from the owner's
// device: from the signup metadata when the account was made with email, and otherwise stamped here,
// once, the first time the owner opens the household on a device (`p_only_if_unset`: a zone already
// set is never overwritten). A failure is retried the next session; it never blocks the app.

import { supabase } from './supabase';
import { readString, setString } from './localStorageCompat';
import { expected } from './faults';

/** This device's IANA zone, e.g. "Asia/Kolkata", or null when the browser does not say. */
export function deviceTimeZone(): string | null {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

const stampKey = (householdId: string) => `tz_stamped_${householdId}`;

/** Owner only (the caller checks the role; the RPC checks it again). */
export async function stampHouseholdTimezone(householdId: string): Promise<void> {
  const tz = deviceTimeZone();
  if (!supabase || !tz || !householdId || householdId === 'local') return;
  if (readString(stampKey(householdId)) === tz) return;
  const { error } = await supabase.rpc('set_household_timezone', {
    p_household: householdId, p_tz: tz, p_only_if_unset: true,
  });
  if (error) { expected(error, 'stampHouseholdTimezone'); return; }
  setString(stampKey(householdId), tz);
}
