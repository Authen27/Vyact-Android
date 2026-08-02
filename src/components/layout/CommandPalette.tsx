// ⌘K command palette (Aurora v10, handoff §6.4) — the guarantee that every
// route stays reachable under the new top-bar navigation. Glass modal;
// fuzzy-filters quick actions + all routes; full keyboard support.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Wallet, Sparkles, type LucideIcon } from 'lucide-react';
import { useStore } from '../../store';
import { SECTIONS, ACCOUNT_ROUTES, visiblePages } from './navModel';

interface Props { open: boolean; onClose: () => void }

interface Item {
  key: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  run: () => void;
  group: string;
}

export default function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate();
  const template = useStore(s => s.profile.template);
  const openAddTxn = useStore(s => s.openAddTxn);
  const openAddBudget = useStore(s => s.openAddBudget);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const visible = visiblePages(template);
    const ql = q.trim().toLowerCase();
    const match = (label: string, id: string) => !ql || label.toLowerCase().includes(ql) || id.includes(ql);
    const out: Item[] = [];
    const quick: Item[] = [
      { key: 'qa-txn', label: 'Add transaction', hint: 'Create', icon: Plus, run: () => openAddTxn(), group: 'Quick actions' },
      { key: 'qa-budget', label: 'New budget', hint: 'Create', icon: Wallet, run: () => openAddBudget(), group: 'Quick actions' },
      { key: 'qa-ask', label: 'Ask Vyact', hint: 'AI', icon: Sparkles, run: () => navigate('/chat'), group: 'Quick actions' },
    ];
    out.push(...quick.filter(a => match(a.label, a.key)));
    for (const s of SECTIONS) {
      for (const r of s.routes) {
        if (!visible.has(r.page)) continue;
        if (match(r.label, r.page)) out.push({ key: r.to, label: r.label, hint: 'Go', icon: r.icon, run: () => navigate(r.to), group: s.label });
      }
    }
    for (const r of ACCOUNT_ROUTES) {
      if (match(r.label, r.page)) out.push({ key: r.to, label: r.label, hint: 'Go', icon: r.icon, run: () => navigate(r.to), group: 'Account' });
    }
    return out;
  }, [q, template, navigate, openAddTxn, openAddBudget]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(items.length - 1, s + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); const it = items[sel]; if (it) { it.run(); onClose(); } }
      else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, sel, onClose]);

  if (!open) return null;

  let lastGroup = '';
  return (
    <div
      onMouseDown={onClose}
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
      style={{ background: 'rgba(6,10,12,0.5)', backdropFilter: 'blur(3px)' }}
      role="dialog" aria-modal="true" aria-label="Command palette"
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        className="glass-panel w-full max-w-[600px] rounded-r4 overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 py-4 border-b border-line">
          <Search size={17} className="text-ink-dim flex-shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => { setQ(e.target.value); setSel(0); }}
            placeholder="Search or jump to…"
            aria-label="Search or jump to"
            className="flex-1 bg-transparent border-none outline-none text-ink text-[16px]"
          />
          <span className="mono-label px-2 py-1 rounded-md" style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}>Esc</span>
        </div>
        <div className="max-h-[380px] overflow-y-auto p-2">
          {items.length === 0 && (
            <div className="py-7 text-center text-ink-dim text-sm">No matches for “{q}”.</div>
          )}
          {items.map((it, i) => {
            const showGroup = it.group !== lastGroup;
            lastGroup = it.group;
            const active = i === sel;
            return (
              <div key={it.key}>
                {showGroup && <div className="mono-label px-2.5 pt-2.5 pb-1">{it.group}</div>}
                <button
                  onMouseEnter={() => setSel(i)}
                  onClick={() => { it.run(); onClose(); }}
                  className="flex items-center gap-3 w-full text-left rounded-r2 px-3 py-2.5 transition-colors"
                  style={active ? { background: 'var(--hoverbg)', boxShadow: 'var(--neu-inset)' } : undefined}
                >
                  <span
                    className="w-[30px] h-[30px] rounded-lg flex items-center justify-center flex-shrink-0"
                    style={active
                      ? { background: 'var(--accent)', color: 'var(--accent-ink)' }
                      : { background: 'var(--canvas)', boxShadow: 'var(--neu-sm)', color: 'var(--ff-ink-2)' }}
                  >
                    <it.icon size={15} />
                  </span>
                  <span className="flex-1 text-[0.9rem] font-medium text-ink">{it.label}</span>
                  <span className="mono-label">{it.hint}</span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 px-4 py-2.5 border-t border-line text-ink-dim text-[11px]">
          <span>↑↓ navigate</span><span>↵ open</span>
          <span className="ml-auto">{items.length} results</span>
        </div>
      </div>
    </div>
  );
}
