// v7.3 — Money Map Item #4 (Saved Views).
//
// Generic save/apply/manage UI used on Transactions, Reports, and Insights.
// Filters are an opaque `Record<string, unknown>` per call-site; the bar
// passes them through verbatim except for the sanitize step on save —
// per SOLUTION_MONEY_MAP.md Sec-2, we MUST NOT persist:
//   - transaction ids
//   - member ids (household member identifiers)
//   - free-text descriptions / search strings
// Caller can also opt rows into household-shared visibility via the
// `is_shared` toggle in the Save dialog.

import { useState } from 'react';
import { Bookmark, BookmarkPlus, Trash2, Users, ChevronDown, Check } from 'lucide-react';
import type { SavedView, SavedViewPage } from '../../types';
import { useStore } from '../../store';
import { FEATURES } from '../../config/features';

const PRIVATE_FILTER_KEYS = new Set(['search', 'q', 'description', 'memberId', 'memberIds', 'txnId', 'transactionId']);

function sanitizeFilters(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (PRIVATE_FILTER_KEYS.has(k)) continue;
    if (v === undefined || v === null || v === '' || v === 'all') continue;
    out[k] = v;
  }
  return out;
}

export interface SavedViewsBarProps {
  page: SavedViewPage;
  /** Current filter state captured from the host page. */
  filters: Record<string, unknown>;
  /** Apply a saved filter set back into the page's local state. The host
   *  is responsible for mapping unknown keys back onto its setters. */
  onApply: (filters: Record<string, unknown>) => void;
}

// B4.4 (alpha item 3) — Saved Views hidden by default. This thin wrapper gates
// the bar without conditionally calling hooks inside the inner component; the
// saved_views table + RPC stay dormant (not deleted). Flip FEATURES.savedViews.show
// to restore for power users.
export function SavedViewsBar(props: SavedViewsBarProps) {
  if (!FEATURES.savedViews.show) return null;
  return <SavedViewsBarInner {...props} />;
}

function SavedViewsBarInner({ page, filters, onApply }: SavedViewsBarProps) {
  const savedViews   = useStore(s => s.savedViews);
  const upsertView   = useStore(s => s.upsertSavedView);
  const removeView   = useStore(s => s.removeSavedView);
  const cloudEnabled = useStore(s => s.cloudEnabled);
  const toast        = useStore(s => s.toast);

  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName]     = useState('');
  const [shared, setShared] = useState(false);

  const views = savedViews.filter(v => v.page === page);

  if (!cloudEnabled) {
    // Saved views are cloud-only (require RLS-enforced ownership). In
    // local-only mode we hide the surface rather than half-implement it.
    return null;
  }

  const apply = (v: SavedView) => {
    onApply(v.filters);
    setPicker(false);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) { toast('Name required', 'error'); return; }
    const clean = sanitizeFilters(filters);
    try {
      await upsertView({ page, name: trimmed, filters: clean, isShared: shared });
      toast('View saved', 'success');
      setSaving(false);
      setName('');
      setShared(false);
    } catch (err) {
      toast(`Save failed: ${(err as Error).message}`, 'error');
    }
  };

  const del = async (v: SavedView) => {
    if (!confirm(`Delete saved view "${v.name}"?`)) return;
    try { await removeView(v.id); toast('View deleted', 'success'); }
    catch (err) { toast(`Delete failed: ${(err as Error).message}`, 'error'); }
  };

  return (
    <div className="relative inline-flex items-center gap-2">
      <div className="relative">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line bg-bg2 hover:bg-bg3 text-[0.84rem] text-ink"
          onClick={() => setPicker(p => !p)}
          aria-haspopup="listbox"
          aria-expanded={picker}
        >
          <Bookmark className="w-3.5 h-3.5" />
          <span>Views{views.length ? ` (${views.length})` : ''}</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        {picker && (
          <div role="listbox" className="absolute right-0 z-30 mt-1 w-72 rounded-md border border-line2 bg-bg2 shadow-3 p-1">
            {views.length === 0 && (
              <div className="px-3 py-4 text-xs text-ink-dim text-center">
                No saved views yet. Save the current filters to reuse later.
              </div>
            )}
            {views.map(v => (
              <div key={v.id} className="flex items-center gap-1 group">
                <button
                  type="button"
                  className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded text-[0.84rem] text-ink text-left hover:bg-bg3"
                  onClick={() => apply(v)}
                >
                  <Check className="w-3.5 h-3.5 opacity-0" />
                  <span className="truncate flex-1">{v.name}</span>
                  {v.isShared && <Users className="w-3 h-3 text-ink-dim" aria-label="Shared" />}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${v.name}`}
                  className="p-1.5 rounded text-ink-dim hover:text-terra hover:bg-bg3 opacity-0 group-hover:opacity-100"
                  onClick={() => del(v)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line bg-bg2 hover:bg-bg3 text-[0.84rem] text-ink"
        onClick={() => setSaving(true)}
      >
        <BookmarkPlus className="w-3.5 h-3.5" />
        <span>Save view</span>
      </button>

      {saving && (
        <div role="dialog" aria-label="Save view" className="absolute right-0 top-full mt-1 z-40 w-80 rounded-md border border-line2 bg-bg2 shadow-3 p-3">
          <h4 className="text-[0.84rem] font-semibold text-ink mb-2">Save current filters</h4>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="View name"
            className="input w-full mb-2"
            onKeyDown={e => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setSaving(false); }}
          />
          <label className="flex items-start gap-2 text-[0.72rem] text-ink-mid mb-3">
            <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} className="mt-0.5" />
            <span>
              Share with household. <em className="text-ink-dim">Search terms, member ids, and transaction ids are stripped before saving regardless of this toggle.</em>
            </span>
          </label>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-ghost text-xs py-1.5 px-3" onClick={() => { setSaving(false); setName(''); setShared(false); }}>Cancel</button>
            <button type="button" className="btn-primary text-xs py-1.5 px-3" onClick={() => void save()}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SavedViewsBar;
