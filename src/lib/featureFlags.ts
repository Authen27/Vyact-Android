// Vyact v7.0.3 — Feature flags.
//
// Tiny localStorage-backed flag store. Single source of truth for v7.0.3's
// track-picker rollout (default OFF in v7.0.3, default ON in v7.1).
//
// Flags are read from `localStorage` under the `vt_feature_<name>` key. Any
// truthy string ("1", "true", "on") enables the flag.

const PREFIX = 'vt_feature_';

// T5b (v10.121.0; audit XC-ARC-08) — the Money Map flag (`money_map`, getMoneyMapMode) is retired: the
// account pickers always read the household's accounts.
export type FeatureFlag = 'track_picker';

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

export function setFlag(flag: FeatureFlag, on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (on) localStorage.setItem(PREFIX + flag, '1');
    else    localStorage.removeItem(PREFIX + flag);
  } catch {
    // fault-ok: device storage is optional (private mode, quota)
  }
}

export function flagKey(flag: FeatureFlag): string {
  return PREFIX + flag;
}
