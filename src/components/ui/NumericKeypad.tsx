// Aurora amount field (v10.1, forms doctrine; keypad removed v10.5.4 — the
// OS's own number keyboard covers typing fine, so the bespoke in-sheet keypad
// was just an extra tap away from a control the device already provides).
// Operates on a decimal STRING so partial entry ("46.") round-trips cleanly;
// the parent parses to a number on save.

/** Strip a free-typed/pasted string down to a valid decimal: digits, at most
 *  one dot, max 2 decimal places. */
export function sanitizeAmount(raw: string): string {
  let out = raw.replace(/[^0-9.]/g, '');
  const firstDot = out.indexOf('.');
  if (firstDot !== -1) {
    out = out.slice(0, firstDot + 1) + out.slice(firstDot + 1).replace(/\./g, '');
  }
  const dot = out.indexOf('.');
  if (dot !== -1 && out.length - dot > 3) out = out.slice(0, dot + 3);
  return out;
}

/** Big mono editable amount input with currency prefix (board §.amount —
 *  38px mobile / 40px desktop, 24px muted currency, bare on the sheet). */
export function AmountField({ value, currencySymbol = '$', onChange }: {
  value: string; currencySymbol?: string; onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-baseline justify-center gap-0.5 py-1">
      <span className="text-[24px] font-medium text-ink-dim">{currencySymbol}</span>
      <input
        type="text" inputMode="decimal" autoComplete="off" placeholder="0"
        aria-label="Amount"
        className="num font-bold text-[38px] sm:text-[40px] leading-none tracking-tight text-ink bg-transparent border-none outline-none text-center w-full max-w-[200px]"
        value={value}
        onChange={e => onChange(sanitizeAmount(e.target.value))}
      />
    </div>
  );
}
