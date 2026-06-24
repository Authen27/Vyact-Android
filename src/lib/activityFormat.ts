// Vyact v7.0.2 — Activity log formatting
//
// Turns the raw `activity_log` rows produced by the `log_domain_activity()`
// trigger into concrete, human-readable lines for the Households "Recent
// Activity" panel. The rows carry:
//   • action     — 'created' | 'updated' | 'deleted'
//   • entity_type— table name ('transactions','budgets','goals','debts',
//                  'assets','memberships', etc.)
//   • entity_id  — uuid of the affected row
//   • changes    — INSERT: to_jsonb(new); UPDATE: { old, new }; DELETE: to_jsonb(old)
//   • actor_id   — auth.users id (may be null for system events)
//
// Pure functions, no React, no I/O. Caller passes already-loaded entity
// arrays + members so we can resolve names/amounts without extra fetches.

import type { Transaction, Budget, Goal, Debt, Asset } from '../types';
import { fmt } from './format';
import { getCat } from '../constants';

export type EntityType =
  | 'transactions' | 'budgets' | 'goals' | 'debts' | 'assets'
  | 'memberships'  | 'invitations' | 'rates' | 'profile' | 'household';

export interface ActivityRow {
  id: string;
  actor_id: string | null;
  action: string;          // 'created' | 'updated' | 'deleted'
  entity_type: string;
  entity_id?: string | null;
  changes?: unknown;
  created_at: string;
}

export interface FormattedActivity {
  /** Short human verb e.g. "added", "updated", "removed", "joined". */
  verb: string;
  /** Subject of the action — already includes the entity label and a short
   *  identifier so the line reads naturally on its own. */
  subject: string;
  /** Optional one-line diff e.g. "amount: $50 → $65". Empty string when
   *  no meaningful diff was computable (e.g. INSERT/DELETE). */
  diff: string;
  /** Display name for the actor; "System" when null, "—" when unknown. */
  actorName: string;
  /** Tone token consumed by ActivityRow for the left-border accent. */
  tone: 'sage' | 'terra' | 'denim' | 'honey' | 'coral' | 'plum';
  /** lucide icon key — resolved at render time. */
  iconKey: 'txn' | 'budget' | 'goal' | 'debt' | 'asset' | 'member' | 'system';
}

interface ResolveCtx {
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  debts: Debt[];
  assets: Asset[];
  /** Minimal shape — only the auth user id and a display name are read.
   *  Both `Member` (legacy household roster) and Membership rows can be
   *  mapped onto this. Keeping the type structural lets callers pass either
   *  source without an adapter object. */
  members: Array<{ userId?: string | null; name: string }>;
  baseCurrency: string;
}

const ENTITY_LABEL: Record<string, { singular: string; iconKey: FormattedActivity['iconKey'] }> = {
  transactions: { singular: 'transaction', iconKey: 'txn' },
  budgets:      { singular: 'budget',      iconKey: 'budget' },
  goals:        { singular: 'goal',        iconKey: 'goal' },
  debts:        { singular: 'debt',        iconKey: 'debt' },
  assets:       { singular: 'asset',       iconKey: 'asset' },
  memberships:  { singular: 'member',      iconKey: 'member' },
  invitations:  { singular: 'invitation',  iconKey: 'member' },
};

function actorDisplayName(actorId: string | null, members: ResolveCtx['members']): string {
  if (!actorId) return 'System';
  const m = members.find(x => x.userId === actorId);
  if (m?.name) return m.name;
  // Unknown actor (left the household, removed user, etc.) — show a short
  // fingerprint of the uuid so two distinct unknown actors stay
  // distinguishable in the feed.
  return `Member ${actorId.slice(0, 4)}`;
}

function pickRow(changes: unknown, action: string): Record<string, unknown> | null {
  if (!changes || typeof changes !== 'object') return null;
  const c = changes as Record<string, unknown>;
  if (action === 'updated' && 'new' in c) return c.new as Record<string, unknown>;
  return c;
}

function pickOld(changes: unknown): Record<string, unknown> | null {
  if (!changes || typeof changes !== 'object') return null;
  const c = changes as Record<string, unknown>;
  if ('old' in c) return c.old as Record<string, unknown>;
  return null;
}

/** Build the subject phrase for a row. Falls back to entity label + short id
 *  when the changes payload doesn't carry a friendly column or the entity
 *  has been deleted from the in-memory store. */
function entitySummary(row: ActivityRow, ctx: ResolveCtx): string {
  const meta = ENTITY_LABEL[row.entity_type] ?? { singular: row.entity_type, iconKey: 'system' as const };
  const eid = row.entity_id ?? '';
  const r = pickRow(row.changes, row.action);

  switch (row.entity_type) {
    case 'transactions': {
      const cat = String(r?.category ?? '');
      const amt = Number(r?.amount ?? 0);
      const cur = String(r?.currency ?? ctx.baseCurrency);
      const desc = String(r?.description ?? '').trim();
      const label = desc || (cat ? getCat(cat).label : 'transaction');
      return amt > 0 ? `${label} · ${fmt(amt, cur)}` : label;
    }
    case 'budgets': {
      const cat = String(r?.category ?? '');
      const lim = Number(r?.limit ?? 0);
      const cur = String(r?.currency ?? ctx.baseCurrency);
      const label = cat ? getCat(cat).label : 'budget';
      return lim > 0 ? `${label} budget · ${fmt(lim, cur)}` : `${label} budget`;
    }
    case 'goals': {
      const name = String(r?.name ?? '').trim();
      const target = Number(r?.target ?? 0);
      const cur = String(r?.currency ?? ctx.baseCurrency);
      if (name && target > 0) return `${name} · ${fmt(target, cur)}`;
      return name || `goal ${eid.slice(0, 4)}`;
    }
    case 'debts': {
      const name = String(r?.name ?? '').trim();
      const bal = Number(r?.current_balance ?? r?.currentBalance ?? 0);
      const cur = String(r?.currency ?? ctx.baseCurrency);
      if (name && bal > 0) return `${name} · ${fmt(bal, cur)} balance`;
      return name || `debt ${eid.slice(0, 4)}`;
    }
    case 'assets': {
      const name = String(r?.name ?? '').trim();
      const val = Number(r?.value ?? 0);
      const cur = String(r?.currency ?? ctx.baseCurrency);
      if (name && val > 0) return `${name} · ${fmt(val, cur)}`;
      return name || `asset ${eid.slice(0, 4)}`;
    }
    case 'memberships': {
      const role = String(r?.role ?? '').trim();
      const display = String(r?.display_name ?? '').trim();
      if (display) return role ? `${display} (${role})` : display;
      return role ? `member · ${role}` : `member ${eid.slice(0, 4)}`;
    }
    case 'invitations': {
      const email = String(r?.invited_email ?? '').trim();
      const role = String(r?.role ?? '').trim();
      if (email) return role ? `${email} (${role})` : email;
      return `invitation ${eid.slice(0, 4)}`;
    }
    default:
      return `${meta.singular} ${eid.slice(0, 4)}`;
  }
}

/** Material columns to surface in the diff line, per entity. Order matters —
 *  the first ≤ 2 changed fields are shown. Money fields are formatted via
 *  the row's own currency (or base) so the line stays self-contained. */
const DIFF_COLUMNS: Record<string, Array<{ key: string; label: string; kind: 'money' | 'plain' | 'bool' }>> = {
  transactions: [
    { key: 'amount',         label: 'amount',   kind: 'money' },
    { key: 'category',       label: 'category', kind: 'plain' },
    { key: 'description',    label: 'note',     kind: 'plain' },
    { key: 'date',           label: 'date',     kind: 'plain' },
    { key: 'excluded',       label: 'excluded', kind: 'bool'  },
  ],
  budgets: [
    { key: 'limit',          label: 'limit',    kind: 'money' },
    { key: 'category',       label: 'category', kind: 'plain' },
    { key: 'period',         label: 'period',   kind: 'plain' },
  ],
  goals: [
    { key: 'target',         label: 'target',   kind: 'money' },
    { key: 'current',        label: 'progress', kind: 'money' },
    { key: 'completed',      label: 'completed',kind: 'bool'  },
    { key: 'name',           label: 'name',     kind: 'plain' },
  ],
  debts: [
    { key: 'current_balance',label: 'balance',  kind: 'money' },
    { key: 'currentBalance', label: 'balance',  kind: 'money' },
    { key: 'minimum_payment',label: 'min pmt',  kind: 'money' },
    { key: 'interest_rate',  label: 'APR',      kind: 'plain' },
  ],
  assets: [
    { key: 'value',          label: 'value',    kind: 'money' },
    { key: 'name',           label: 'name',     kind: 'plain' },
  ],
  memberships: [
    { key: 'role',           label: 'role',     kind: 'plain' },
    { key: 'household_role', label: 'role',     kind: 'plain' },
  ],
  invitations: [
    { key: 'role',           label: 'role',     kind: 'plain' },
  ],
};

function formatField(v: unknown, kind: 'money' | 'plain' | 'bool', currency: string): string {
  if (v == null || v === '') return '∅';
  if (kind === 'money') {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? fmt(n, currency) : String(v);
  }
  if (kind === 'bool') return v ? 'yes' : 'no';
  const s = String(v);
  return s.length > 32 ? s.slice(0, 30) + '…' : s;
}

/** Build a one-line diff for UPDATE rows. Returns '' for non-updates or
 *  when no material columns moved. Surfaces at most 2 columns to keep the
 *  feed scannable; an extra "+N more" tail signals deeper changes. */
function diffSummary(row: ActivityRow, ctx: ResolveCtx): string {
  if (row.action !== 'updated') return '';
  const oldRow = pickOld(row.changes);
  const newRow = pickRow(row.changes, row.action);
  if (!oldRow || !newRow) return '';
  const cols = DIFF_COLUMNS[row.entity_type] ?? [];
  const parts: string[] = [];
  let extra = 0;
  const seen = new Set<string>();
  const cur = String(newRow.currency ?? ctx.baseCurrency);
  for (const col of cols) {
    if (seen.has(col.label)) continue;
    if (!(col.key in newRow) && !(col.key in oldRow)) continue;
    const before = oldRow[col.key];
    const after  = newRow[col.key];
    if (before === after) continue;
    if (parts.length < 2) {
      parts.push(`${col.label}: ${formatField(before, col.kind, cur)} → ${formatField(after, col.kind, cur)}`);
      seen.add(col.label);
    } else {
      extra++;
    }
  }
  if (parts.length === 0) return '';
  return extra > 0 ? `${parts.join(' · ')} · +${extra} more` : parts.join(' · ');
}

const VERB_BY_ACTION: Record<string, Record<string, string>> = {
  transactions: { created: 'logged',   updated: 'updated', deleted: 'removed' },
  budgets:      { created: 'set',      updated: 'changed', deleted: 'deleted' },
  goals:        { created: 'created',  updated: 'updated', deleted: 'removed' },
  debts:        { created: 'added',    updated: 'updated', deleted: 'cleared' },
  assets:       { created: 'added',    updated: 'updated', deleted: 'removed' },
  memberships:  { created: 'joined',   updated: 'role changed for', deleted: 'left' },
  invitations:  { created: 'invited',  updated: 'updated invitation for', deleted: 'revoked invite for' },
};
function verbFor(entity: string, action: string): string {
  return VERB_BY_ACTION[entity]?.[action] ?? action;
}

const TONE_BY_KEY: Record<FormattedActivity['iconKey'], FormattedActivity['tone']> = {
  txn:    'sage',
  budget: 'denim',
  goal:   'coral',
  debt:   'terra',
  asset:  'plum',
  member: 'honey',
  system: 'denim',
};

export function formatActivity(row: ActivityRow, ctx: ResolveCtx): FormattedActivity {
  const meta = ENTITY_LABEL[row.entity_type] ?? { singular: row.entity_type, iconKey: 'system' as const };
  // Deletions get a terra tone regardless of base entity colour so destructive
  // events read at a glance.
  const baseTone = TONE_BY_KEY[meta.iconKey];
  const tone: FormattedActivity['tone'] = row.action === 'deleted' ? 'terra' : baseTone;
  return {
    verb: verbFor(row.entity_type, row.action),
    subject: entitySummary(row, ctx),
    diff: diffSummary(row, ctx),
    actorName: actorDisplayName(row.actor_id, ctx.members),
    tone,
    iconKey: meta.iconKey,
  };
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45)        return 'just now';
  if (s < 90)        return '1 min ago';
  if (s < 3600)      return `${Math.round(s / 60)} min ago`;
  if (s < 5400)      return '1 hr ago';
  if (s < 86400)     return `${Math.round(s / 3600)} hr ago`;
  if (s < 172800)    return 'yesterday';
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

export const ACTIVITY_TYPE_FILTERS: Array<{ value: string; label: string; entities: string[] }> = [
  { value: 'all',     label: 'All',          entities: [] },
  { value: 'money',   label: 'Money',        entities: ['transactions'] },
  { value: 'plans',   label: 'Plans',        entities: ['budgets', 'goals'] },
  { value: 'debts',   label: 'Debts',        entities: ['debts'] },
  { value: 'assets',  label: 'Net worth',    entities: ['assets'] },
  { value: 'people',  label: 'People',       entities: ['memberships', 'invitations'] },
];
