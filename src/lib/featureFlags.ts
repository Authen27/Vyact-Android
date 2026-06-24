// Vyact v7.0.3 — Feature flags.
//
// Tiny localStorage-backed flag store. Single source of truth for v7.0.3's
// track-picker rollout (default OFF in v7.0.3, default ON in v7.1).
//
// Flags are read from `localStorage` under the `vt_feature_<name>` key. Any
// truthy string ("1", "true", "on") enables the flag.

const PREFIX = 'vt_feature_';

export type FeatureFlag = 'track_picker' | 'money_map';

/** Money Map ships with three states across two release windows.
 *  See docs/SOLUTION_MONEY_MAP.md → Rollout. Other flags are simple boolean. */
export type MoneyMapMode = 'off' | 'shadow' | 'on';

export function isFlagOn(flag: FeatureFlag): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    const raw = localStorage.getItem(PREFIX + flag);
    if (!raw) return false;
    const v = raw.toLowerCase();
    return v === '1' || v === 'true' || v === 'on' || v === 'yes' || v === 'shadow';
  } catch {
    return false;
  }
}

/** Read the multi-state Money Map flag. v7.2.0-rc rollout: when an explicit
 *  value is set in localStorage, it always wins. When no value is set, the
 *  default depends on the deployment:
 *    • Cloud builds (Supabase env vars present) default to `'shadow'` so
 *      transactions dual-write `account_id` + legacy `linkedAssetId` in the
 *      wild. This is the v7.2.0-rc target state per SOLUTION_MONEY_MAP.md.
 *    • Local-only builds default to `'off'` — there's no cloud schema to
 *      shadow against, and the LocalStorageAdapter still synthesises
 *      accounts from assets per CLAUDE.md "Cloud is opt-in".
 *  Override locally with `localStorage.setItem('vt_feature_money_map','off')`. */
export function getMoneyMapMode(): MoneyMapMode {
  if (typeof localStorage === 'undefined') return 'off';
  try {
    const raw = localStorage.getItem(PREFIX + 'money_map');
    if (raw) {
      const v = raw.toLowerCase();
      if (v === 'shadow')                                          return 'shadow';
      if (v === 'on' || v === '1' || v === 'true' || v === 'yes')  return 'on';
      if (v === 'off' || v === '0' || v === 'false' || v === 'no') return 'off';
    }
    // No explicit value — derive from the build's cloud config.
    const url = (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
      .env?.VITE_SUPABASE_URL;
    return url ? 'shadow' : 'off';
  } catch {
    return 'off';
  }
}

export function setFlag(flag: FeatureFlag, on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (on) localStorage.setItem(PREFIX + flag, '1');
    else    localStorage.removeItem(PREFIX + flag);
  } catch {
    /* quota / private mode — ignore */
  }
}

export function flagKey(flag: FeatureFlag): string {
  return PREFIX + flag;
}
