// Vyact v10.14 — email-based cross-household split sharing (cloud adapter).
// Wraps the `shared_splits`/`shared_split_shares` tables (see
// supabase/migrations/20260724130000_shared_splits.sql). Cloud-only — there
// is no email/auth identity to key on in local-only mode, so callers must
// gate on `isCloudEnabled()` themselves before calling any of these.
import type { SupabaseClient } from '@supabase/supabase-js';
import { sb } from './supabase';
import type { SharedSplit, SharedSplitShare, Transaction } from '../types';

interface SplitRow {
  id: string;
  owner_user_id: string;
  owner_household_id: string;
  txn_id: string | null;
  description: string;
  currency: string;
  total_amount: number;
  txn_type: 'expense' | 'income';
  date: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ShareRow {
  id: string;
  split_id: string;
  email: string;
  share: number;
  paid: boolean;
  paid_at: string | null;
  settled_user_id: string | null;
}

function fromShareRow(r: ShareRow): SharedSplitShare {
  return {
    id: r.id, splitId: r.split_id, email: r.email, share: r.share,
    paid: r.paid, paidAt: r.paid_at, settledUserId: r.settled_user_id,
  };
}

/** Resolve participant emails → display names for any that have an active Vyact
 *  account (via the resolve_participant_names RPC). Returns a lowercase-email →
 *  name map; emails with no account are simply absent. */
export async function resolveParticipantNames(emails: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(emails.map(e => e.toLowerCase().trim()).filter(Boolean))];
  if (!uniq.length) return {};
  const { data, error } = await sb().rpc('resolve_participant_names', { p_emails: uniq });
  if (error) throw error;
  const map: Record<string, string> = {};
  for (const row of (data as { email: string; display_name: string | null }[])) {
    if (row.display_name) map[row.email.toLowerCase()] = row.display_name;
  }
  return map;
}

function fromSplitRow(r: SplitRow, shares: ShareRow[]): SharedSplit {
  return {
    id: r.id, ownerUserId: r.owner_user_id, ownerHouseholdId: r.owner_household_id,
    txnId: r.txn_id, description: r.description, currency: r.currency,
    totalAmount: r.total_amount, txnType: r.txn_type, date: r.date,
    closedAt: r.closed_at, createdAt: r.created_at, updatedAt: r.updated_at,
    shares: shares.filter(s => s.split_id === r.id).map(fromShareRow),
  };
}

async function withShares(splits: SplitRow[]): Promise<SharedSplit[]> {
  if (!splits.length) return [];
  const { data, error } = await sb()
    .from('shared_split_shares')
    .select('*')
    .in('split_id', splits.map(s => s.id));
  if (error) throw error;
  const shares = data as ShareRow[];
  return splits.map(s => fromSplitRow(s, shares));
}

export interface NewSharedSplitParticipant {
  email: string;
  share: number;
  /** v10.121.0 (T5b) — the owner has marked this person paid; the share step settles their cloud share. */
  paid?: boolean;
}

/**
 * v10.112.0 (F1c, audit INT-TXN-11) — the queued "share this split" step: how one transaction's split
 * should look in the cloud. `deleted` removes the shared split (the split was deleted).
 */
export type SplitShareIntent =
  | {
    txnId: string; deleted?: false;
    description: string; currency: string; totalAmount: number; txnType: 'expense' | 'income'; date: string;
    participants: NewSharedSplitParticipant[];
  }
  | { txnId: string; deleted: true };

/**
 * v10.112.0 (F1c, audit INT-TXN-11; owner decision 18 Oct 2026: "today's calls, repeat-safe").
 *
 * Makes the owner's shared split for one transaction match `intent`, starting from whatever the cloud
 * holds now. It replaces the one-shot create / update / delete calls, which the Split form made
 * directly after queueing the transaction: offline, or before the transaction had landed, they failed
 * on its foreign key, and nothing ever tried again. The sync queue runs this once the transaction has
 * landed, and again after any failure:
 * - every run re-reads the cloud and does only what is missing, so a run cut off half-way (the split
 *   created, its shares not) is finished by the next, and a repeat changes nothing;
 * - an edit adds new people, removes unpaid shares no longer wanted and changes unpaid amounts. A paid
 *   share is never changed or removed;
 * - new shares are inserted LAST, so when `added` is above zero nothing after the insert can fail, and
 *   the caller emails them once;
 * - v10.121.0 (T5b; owner, 19 Oct 2026: "queue it") — a person the owner marked paid has their share
 *   settled (`paid`, `paid_at` now) here too, never un-settled. Marking paid used to call the cloud
 *   straight from the Splits page and swallow the failure, so offline the other household kept seeing
 *   the money as owed.
 *
 * Returns the split's id and how many people were added in this run, or null when there is no shared
 * split (deleted, or none wanted).
 */
export async function syncSharedSplit(
  client: SupabaseClient, ownerHouseholdId: string, intent: SplitShareIntent,
): Promise<{ splitId: string; added: number } | null> {
  const { data: auth } = await client.auth.getUser();
  const ownerUserId = auth.user?.id;
  // A session that can't be read is transient: the queue tries again.
  if (!ownerUserId) throw new Error('Must be signed in to share a split');

  const { data: found, error: findError } = await client.from('shared_splits').select('*')
    .eq('owner_user_id', ownerUserId).eq('txn_id', intent.txnId).order('created_at', { ascending: true });
  if (findError) throw findError;
  let split = ((found ?? []) as SplitRow[])[0];

  if (intent.deleted) {
    if (split) {
      const { error } = await client.from('shared_splits').delete().eq('id', split.id);   // shares cascade
      if (error) throw error;
    }
    return null;
  }

  const fields = {
    description: intent.description, currency: intent.currency, total_amount: intent.totalAmount,
    txn_type: intent.txnType, date: intent.date,
  };
  if (!split) {
    if (!intent.participants.length) return null;
    const { data, error } = await client.from('shared_splits')
      .insert({ owner_user_id: ownerUserId, owner_household_id: ownerHouseholdId, txn_id: intent.txnId, ...fields })
      .select('*').single();
    if (error) throw error;
    split = data as SplitRow;
  } else if (split.description !== fields.description || split.currency !== fields.currency
      || Number(split.total_amount) !== fields.total_amount || split.txn_type !== fields.txn_type || split.date !== fields.date) {
    const { error } = await client.from('shared_splits').update(fields).eq('id', split.id);
    if (error) throw error;
  }

  const { data: shareRows, error: sharesError } = await client.from('shared_split_shares').select('*').eq('split_id', split.id);
  if (sharesError) throw sharesError;
  const shares = (shareRows ?? []) as ShareRow[];
  const want = new Map(intent.participants.map(p => [p.email.toLowerCase().trim(), p]));
  const have = new Map(shares.map(s => [s.email.toLowerCase(), s]));
  for (const s of shares) {
    if (want.has(s.email.toLowerCase()) || s.paid) continue;
    const { error } = await client.from('shared_split_shares').delete().eq('id', s.id).eq('paid', false);
    if (error) throw error;
  }
  const paidNow = () => ({ paid: true, paid_at: new Date().toISOString() });
  for (const [email, p] of want) {
    const current = have.get(email);
    if (!current || current.paid) continue;
    const change = {
      ...(Number(current.share) === p.share ? {} : { share: p.share }),
      ...(p.paid ? paidNow() : {}),
    };
    if (!Object.keys(change).length) continue;
    const { error } = await client.from('shared_split_shares').update(change).eq('id', current.id).eq('paid', false);
    if (error) throw error;
  }
  const missing = [...want].filter(([email]) => !have.has(email));
  if (missing.length) {
    const { error } = await client.from('shared_split_shares')
      .insert(missing.map(([email, p]) => ({ split_id: split.id, email, share: p.share, ...(p.paid ? paidNow() : {}) })));
    if (error) throw error;
  }
  return { splitId: split.id, added: missing.length };
}

/**
 * v10.121.0 (T5b) — the share step for a split transaction, as the Split form and the Splits page both
 * queue it: everyone with an email but you, with their share and whether you marked them paid. Null when
 * the row is not a split.
 */
export function shareIntentForTxn(
  txn: Pick<Transaction, 'id' | 'type' | 'currency' | 'date' | 'description' | 'split'>,
): Extract<SplitShareIntent, { participants: NewSharedSplitParticipant[] }> | null {
  if (!txn.split) return null;
  return {
    txnId: txn.id,
    description: txn.description,
    currency: txn.currency,
    totalAmount: txn.split.totalAmount,
    txnType: txn.type === 'income' ? 'income' : 'expense',
    date: txn.date,
    participants: txn.split.participants
      .filter(p => !p.isYou && p.email)
      .map(p => ({ email: p.email!, share: p.share, ...(p.paid ? { paid: true } : {}) })),
  };
}

/** Splits the signed-in user owns (any household — this is cross-household by design). */
export async function fetchOwnedSharedSplits(): Promise<SharedSplit[]> {
  const { data: session } = await sb().auth.getUser();
  const uid = session.user?.id;
  if (!uid) return [];
  const { data, error } = await sb()
    .from('shared_splits')
    .select('*')
    .eq('owner_user_id', uid)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return withShares(data as SplitRow[]);
}

/** Splits where the signed-in user's verified email appears as a participant
 *  (RLS: `shared_splits_select` matches via `is_split_participant`) — excludes
 *  splits the user owns themselves, which `fetchOwnedSharedSplits` covers. */
export async function fetchSharedWithMe(): Promise<SharedSplit[]> {
  const { data: session } = await sb().auth.getUser();
  const uid = session.user?.id;
  if (!uid) return [];
  const { data, error } = await sb()
    .from('shared_splits')
    .select('*')
    .neq('owner_user_id', uid)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return withShares(data as SplitRow[]);
}

/** Participant self-service settle — goes through the settle_share() RPC
 *  since participants have no direct UPDATE policy on shared_split_shares. */
export async function settleSharedSplitShare(shareId: string): Promise<void> {
  const { error } = await sb().rpc('settle_share', { p_share_id: shareId });
  if (error) throw error;
}

/** Owner closes a split once all shares are settled. */
export async function closeSharedSplit(splitId: string): Promise<void> {
  const { error } = await sb()
    .from('shared_splits')
    .update({ closed_at: new Date().toISOString() })
    .eq('id', splitId);
  if (error) throw error;
}

// v10.16's owner-side create / edit / delete calls are replaced by `syncSharedSplit` (F1c, v10.112.0),
// run from the sync queue. RLS already permits the owner's INSERT / UPDATE / DELETE it uses.
