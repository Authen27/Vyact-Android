// Vyact v7.0.3 — Track picker.
//
// Step 1 of the new transaction flow: pick a mental model (Spend / Income /
// Transfer / Investment). Keyboard `1`–`4` jump straight to a track; `Esc`
// cancels through the parent modal.

import { useEffect } from 'react';
import { ArrowDownCircle, ArrowUpCircle, ArrowRightLeft, TrendingUp } from 'lucide-react';
import type { TxnType } from '../../types';

export interface TrackOption {
  type: TxnType;
  label: string;
  hint: string;
  icon: typeof ArrowDownCircle;
  tone: string; // tailwind color token (border + text accent)
}

export const TRACKS: TrackOption[] = [
  { type: 'expense',    label: 'Spend',      hint: 'Money out — bills, food, subscriptions', icon: ArrowDownCircle, tone: 'coral' },
  { type: 'income',     label: 'Income',     hint: 'Money in — salary, freelance, gift',      icon: ArrowUpCircle,   tone: 'sage' },
  { type: 'transfer',   label: 'Transfer',   hint: 'Move money between your own accounts',    icon: ArrowRightLeft,  tone: 'denim' },
  { type: 'investment', label: 'Investment', hint: 'Buy, sell, dividends, capital gains',     icon: TrendingUp,      tone: 'honey' },
];

const TONE_CLASSES: Record<string, { icon: string; hoverBorder: string }> = {
  coral: { icon: 'text-coral', hoverBorder: 'hover:border-coral' },
  sage:  { icon: 'text-sage',  hoverBorder: 'hover:border-sage' },
  denim: { icon: 'text-denim', hoverBorder: 'hover:border-denim' },
  honey: { icon: 'text-honey', hoverBorder: 'hover:border-honey' },
};

interface Props {
  onPick: (type: TxnType) => void;
  onCancel: () => void;
}

export default function TrackPicker({ onPick, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === '1') { e.preventDefault(); onPick(TRACKS[0].type); }
      else if (k === '2') { e.preventDefault(); onPick(TRACKS[1].type); }
      else if (k === '3') { e.preventDefault(); onPick(TRACKS[2].type); }
      else if (k === '4') { e.preventDefault(); onPick(TRACKS[3].type); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onPick]);

  return (
    <div data-testid="track-picker" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {TRACKS.map((t, i) => {
        const Icon = t.icon;
        const cls = TONE_CLASSES[t.tone];
        return (
          <button
            key={t.type}
            type="button"
            onClick={() => onPick(t.type)}
            data-testid={`track-pick-${t.type}`}
            className={`group relative text-left p-4 rounded-lg border border-line bg-bg2 hover:bg-bg3 ${cls.hoverBorder} transition-colors`}
          >
            <div className="flex items-start gap-3">
              <Icon className={`w-6 h-6 ${cls.icon} flex-shrink-0`} />
              <div className="min-w-0">
                <div className="font-medium text-ink leading-tight">{t.label}</div>
                <div className="text-[0.78rem] text-ink-dim mt-0.5 leading-snug">{t.hint}</div>
              </div>
              <span className="ml-auto font-mono text-[0.6rem] tracking-wider text-ink-dim opacity-60 group-hover:opacity-100">
                {i + 1}
              </span>
            </div>
          </button>
        );
      })}
      <div className="sm:col-span-2 flex justify-end pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="font-mono text-[0.62rem] tracking-wider uppercase text-ink-dim hover:underline"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
