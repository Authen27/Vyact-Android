// Vyact v10.14 — email-based cross-household split sharing (cloud adapter).
// Wraps the `shared_splits`/`shared_split_shares` tables (see
// supabase/migrations/20260724130000_shared_splits.sql). Cloud-only — there
// is no email/auth identity to key on in local-only mode, so callers must
// gate on `isCloudEnabled()` themselves before calling any of these.
import { sb } from './supabase';
import type { SharedSplit, SharedSplitShare } from '../types';

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
}

/** Owner creates a shared split + one share row per participant email. */
export async function createSharedSplit(input: {
  ownerHouseholdId: string;
  txnId?: string;
  description: string;
  currency: string;
  totalAmount: number;
  txnType: 'expense' | 'income';
  date: string;
  participants: NewSharedSplitParticipant[];
}): Promise<SharedSplit> {
  const { data: session } = await sb().auth.getUser();
  const ownerUserId = session.user?.id;
  if (!ownerUserId) throw new Error('Must be signed in to share a split');

  const { data: splitRow, error: splitErr } = await sb()
    .from('shared_splits')
    .insert({
      owner_user_id: ownerUserId,
      owner_household_id: input.ownerHouseholdId,
      txn_id: input.txnId ?? null,
      description: input.description,
      currency: input.currency,
      total_amount: input.totalAmount,
      txn_type: input.txnType,
      date: input.date,
    })
    .select('*')
    .single();
  if (splitErr) throw splitErr;
  const split = splitRow as SplitRow;

  const { data: shareRows, error: shareErr } = await sb()
    .from('shared_split_shares')
    .insert(input.participants.map(p => ({
      split_id: split.id, email: p.email.toLowerCase().trim(), share: p.share,
    })))
    .select('*');
  if (shareErr) throw shareErr;

  return fromSplitRow(split, shareRows as ShareRow[]);
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

/** Owner marks a participant paid directly (e.g. "they paid me in cash"). */
export async function markShareRowPaid(shareId: string): Promise<void> {
  const { error } = await sb()
    .from('shared_split_shares')
    .update({ paid: true, paid_at: new Date().toISOString() })
    .eq('id', shareId);
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
