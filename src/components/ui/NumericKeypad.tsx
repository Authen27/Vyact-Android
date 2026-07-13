// Aurora in-sheet numeric keypad + amount field (v10.1, forms doctrine).
// Bespoke keypad (not the OS keyboard) so the sheet's chips stay visible and
// nothing is covered. Operates on a decimal STRING so partial entry ("46.")
// round-trips cleanly; the parent parses to a number on save.
import { Delete } from 'lucide-react';

/** Big mono amount display with currency prefix + blinking caret. */
export function AmountField({ value, currencySymbol = '$' }: { value: string; currencySymbol?: string }) {
  return (
    <div className="num font-bold text-[44px] leading-none tracking-tight flex items-baseline justify-center gap-0.5 py-1"
      aria-live="polite">
      <span className="text-[24px] font-medium text-ink-dim">{currencySymbol}</span>
      <span className="text-ink">{value || '0'}</span>
      <span className="inline-block w-[2px] h-[34px] bg-accent ml-0.5 animate-pulse" aria-hidden />
    </div>
  );
}

/** Append a keypad press to a decimal string, guarding format (one dot, 2 dp). */
export function applyKey(current: string, key: string): string {
  if (key === '⌫') return current.slice(0, -1);
  if (key === '.') return current.includes('.') ? current : (current === '' ? '0.' : current + '.');
  // digit
  if (current === '0') return key; // replace leading zero
  const dot = current.indexOf('.');
  if (dot !== -1 && current.length - dot > 2) return current; // max 2 decimals
  return current + key;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

export default function NumericKeypad({ onKey }: { onKey: (key: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2 pt-2.5" role="group" aria-label="Amount keypad">
      {KEYS.map(k => (
        <button
          key={k}
          type="button"
          onClick={() => onKey(k)}
          aria-label={k === '⌫' ? 'Backspace' : k}
          className="h-[52px] rounded-r3 flex items-center justify-center num text-[20px] font-semibold text-ink cursor-pointer transition-[box-shadow,transform] duration-100 active:translate-y-px"
          style={{ background: 'var(--canvas)', boxShadow: 'var(--neu-sm)' }}
        >
          {k === '⌫' ? <Delete size={20} strokeWidth={1.8} /> : k}
        </button>
      ))}
    </div>
  );
}
