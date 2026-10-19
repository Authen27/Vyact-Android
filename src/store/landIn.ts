// T5b (v10.121.0; audit XC-ARC-10) — a store write that follows an await lands only in the household it
// was made for.
//
// A save, a delete or a read takes a moment; switching household meanwhile used to put its result into
// the NEW household's lists on screen: the old household's transaction among the new one's, its role, its
// notifications. The next refresh corrected it, but until then the numbers were wrong, and an edit made in
// between acted on a row from somewhere else. Every household-scoped write after an await goes through
// this; T5B-007 (lib/__tests__/appGuards.test.ts) fails on a new post-await set() that doesn't.
//
//   const commit = landIn(set, get);
//   const saved = await adapter.upsert('goals', currentHouseholdId, g);
//   commit(currentHouseholdId, s => ({ goals: withRow(s.goals, saved) }));
//
// It returns whether the write landed. The adapter write itself is unaffected: it was made for, and is
// stored in, its own household.
import type { Store } from './index';

type Update = Partial<Store> | ((state: Store) => Partial<Store>);
type SetState = (update: (state: Store) => Partial<Store>) => void;

export function landIn(set: SetState, get: () => Store) {
  return (householdId: string | null | undefined, update: Update): boolean => {
    if (get().currentHouseholdId !== householdId) return false;
    set(state => (typeof update === 'function' ? update(state) : update));
    return true;
  };
}
