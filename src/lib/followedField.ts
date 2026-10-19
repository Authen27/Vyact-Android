// v10.113.0 (owner, 18 Oct 2026: "the name goes empty") — an editable field whose starting value may
// still be loading. `useState(value)` copies it once, so a form opened before its data loaded kept the
// empty or default value: Settings showed an empty name box, and its "Save Preferences" wrote a 0 extra
// payment over the real one. The field shows the loaded value until the person edits it, and follows
// it again after a save. Pure, so it is tested; `useFollowedField` (hooks.ts) holds the state.

export interface FollowedField<T> {
  /** What the person typed; only shown once they have edited the field. */
  value: T;
  edited: boolean;
}

/** What the field shows: the person's edit, or else the current loaded value. */
export function followedValue<T>(field: FollowedField<T>, source: T): T {
  return field.edited ? field.value : source;
}
