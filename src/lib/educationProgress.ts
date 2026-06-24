// v7.3 — Money Map Item #7 prep / SOLUTION_EDUCATION.md
//
// Read/write per-user onboarding & WhyChip dismissal state. Cloud writes
// land in `profiles.education_progress` (jsonb, Migration B). Local-only
// mode uses `vt_education_progress` in localStorage. The store keeps the
// authoritative copy on `profile.educationProgress`; this module is the
// merge + persistence layer.
//
// Risk S-3: cap at 50 keys. When over, prune the oldest by completed_at
// (falling back to dismissed_at), keeping the most recent 50.

import type { EducationProgress, EducationTopicState, Profile } from '../types';

const LOCAL_KEY = 'vt_education_progress';
const MAX_KEYS = 50;

export function readLocalEducationProgress(): EducationProgress {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as EducationProgress;
  } catch { /* noop */ }
  return {};
}

export function writeLocalEducationProgress(p: EducationProgress): void {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(p)); } catch { /* quota / private mode */ }
}

function pruneToMax(p: EducationProgress): EducationProgress {
  const keys = Object.keys(p);
  if (keys.length <= MAX_KEYS) return p;
  const ranked = keys
    .map(k => ({ k, t: p[k]?.completed_at ?? p[k]?.dismissed_at ?? '' }))
    .sort((a, b) => (b.t || '').localeCompare(a.t || ''));
  const keep = new Set(ranked.slice(0, MAX_KEYS).map(x => x.k));
  const out: EducationProgress = {};
  for (const k of keys) if (keep.has(k)) out[k] = p[k];
  return out;
}

/** Merge a per-topic patch into a progress map. Topic-level fields are
 *  shallow-merged so `markCompleted` after `markDismissed` keeps both
 *  timestamps. */
export function mergeProgress(
  base: EducationProgress,
  topicId: string,
  patch: EducationTopicState,
): EducationProgress {
  const merged: EducationProgress = { ...base, [topicId]: { ...(base[topicId] ?? {}), ...patch } };
  return pruneToMax(merged);
}

export function isCompleted(p: EducationProgress | undefined, topicId: string): boolean {
  return Boolean(p?.[topicId]?.completed_at);
}
export function isDismissed(p: EducationProgress | undefined, topicId: string): boolean {
  return Boolean(p?.[topicId]?.dismissed_at);
}

/** Returns the same Profile patch the store should send to `updateProfile`,
 *  pre-merged. Caller is responsible for invoking `updateProfile`. */
export function buildProfilePatch(
  profile: Profile,
  topicId: string,
  patch: EducationTopicState,
): Partial<Profile> {
  const next = mergeProgress(profile.educationProgress ?? {}, topicId, patch);
  return { educationProgress: next };
}
