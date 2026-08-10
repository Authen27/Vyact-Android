// Vyact v10.17 — circular 24h time picker (clock dial).
//
// Tap or drag the hour hand (outer ring 0–11, inner ring 12–23), then the
// minute hand. Emits a normalized `HH:MM` string so the transaction form's
// `form.time` + `normalizeTimeInput` stay unchanged. Pointer + keyboard
// accessible; Aurora-tokened.
import { useRef, useState } from 'react';

interface Props {
  value: string;                 // 'HH:MM'
  onChange: (v: string) => void;
  className?: string;
}

const SIZE = 232;
const C = SIZE / 2;
const R_OUT = 94;   // hours 0–11
const R_IN = 60;    // hours 12–23
const R_MIN = 94;   // minutes

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (h: number, m: number) => `${pad(((h % 24) + 24) % 24)}:${pad(((m % 60) + 60) % 60)}`;

function parse(v: string): { h: number; m: number } {
  const [hh, mm] = (v || '00:00').split(':');
  let h = parseInt(hh, 10); let m = parseInt(mm, 10);
  if (isNaN(h)) h = 0; if (isNaN(m)) m = 0;
  return { h: Math.max(0, Math.min(23, h)), m: Math.max(0, Math.min(59, m)) };
}

// Polar → cartesian, 0 at top, clockwise.
const px = (angleDeg: number, r: number) => C + r * Math.sin((angleDeg * Math.PI) / 180);
const py = (angleDeg: number, r: number) => C - r * Math.cos((angleDeg * Math.PI) / 180);

export default function TimeDial({ value, onChange, className = '' }: Props) {
  const { h, m } = parse(value);
  const [mode, setMode] = useState<'h' | 'm'>('h');
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  function applyPoint(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / SIZE || 1;
    const dx = (clientX - rect.left) / scale - C;
    const dy = (clientY - rect.top) / scale - C;
    let ang = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = top, clockwise
    if (ang < 0) ang += 360;
    if (mode === 'h') {
      const idx = Math.round(ang / 30) % 12;          // 0..11 (0 = 12 o'clock)
      const inner = Math.hypot(dx, dy) < (R_OUT + R_IN) / 2;
      onChange(fmt(inner ? idx + 12 : idx, m));        // inner top → 12, outer top → 0
    } else {
      onChange(fmt(h, Math.round(ang / 6) % 60));
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    dragging.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    applyPoint(e.clientX, e.clientY);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (dragging.current) applyPoint(e.clientX, e.clientY);
  }
  function onPointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    if (mode === 'h') setMode('m');   // hour picked → advance to minutes (Material-style)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    if (mode === 'h') onChange(fmt(h + step, m));
    else onChange(fmt(h, m + step));
  }

  const handAngle = mode === 'h' ? (h % 12) * 30 : m * 6;
  const handR = mode === 'h' ? (h < 12 ? R_OUT : R_IN) : R_MIN;
  const hx = px(handAngle, handR);
  const hy = py(handAngle, handR);

  const outerHours = Array.from({ length: 12 }, (_, i) => i);        // 0..11
  const innerHours = Array.from({ length: 12 }, (_, i) => i + 12);   // 12..23
  const minuteTicks = Array.from({ length: 12 }, (_, i) => i * 5);   // 0,5,..55

  // Active number sits on the coral hand — white reads on coral in both themes.
  const numFill = (active: boolean) => (active ? '#ffffff' : 'hsl(var(--ink))');

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      {/* Digital readout — tap H or M to switch which ring is being set. */}
      <div className="flex items-center gap-1 font-mono text-[2rem] leading-none select-none">
        <button type="button" onClick={() => setMode('h')}
          className={`px-1.5 rounded-md transition-colors ${mode === 'h' ? 'text-coral' : 'text-ink'}`}
          aria-label="Set hour">{pad(h)}</button>
        <span className="text-ink-dim">:</span>
        <button type="button" onClick={() => setMode('m')}
          className={`px-1.5 rounded-md transition-colors ${mode === 'm' ? 'text-coral' : 'text-ink'}`}
          aria-label="Set minute">{pad(m)}</button>
        <span className="ml-2 font-mono text-[0.6rem] tracking-wider uppercase text-ink-dim self-center">24h</span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-[232px] max-w-full touch-none cursor-pointer select-none outline-none"
        role="slider" tabIndex={0}
        aria-label={mode === 'h' ? 'Hour' : 'Minute'}
        aria-valuetext={fmt(h, m)}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
      >
        {/* face */}
        <circle cx={C} cy={C} r={C - 2} fill="var(--sunken)" stroke="hsl(var(--line))" strokeWidth={1} />
        {/* selection hand */}
        <line x1={C} y1={C} x2={hx} y2={hy} stroke="hsl(var(--coral))" strokeWidth={2} />
        <circle cx={C} cy={C} r={3} fill="hsl(var(--coral))" />
        <circle cx={hx} cy={hy} r={16} fill="hsl(var(--coral))" />

        {mode === 'h' ? (
          <>
            {outerHours.map(n => {
              const active = n === h;
              return (
                <text key={`o${n}`} x={px(n * 30, R_OUT)} y={py(n * 30, R_OUT)} dy="0.35em"
                  textAnchor="middle" fontSize="14" fontFamily="var(--ff-mono, monospace)"
                  fill={active ? numFill(true) : 'hsl(var(--ink))'} style={{ pointerEvents: 'none' }}>{pad(n)}</text>
              );
            })}
            {innerHours.map(n => {
              const active = n === h;
              return (
                <text key={`i${n}`} x={px((n - 12) * 30, R_IN)} y={py((n - 12) * 30, R_IN)} dy="0.35em"
                  textAnchor="middle" fontSize="12" fontFamily="var(--ff-mono, monospace)"
                  fill={active ? numFill(true) : 'var(--ff-ink-3)'} style={{ pointerEvents: 'none' }}>{n}</text>
              );
            })}
          </>
        ) : (
          minuteTicks.map(n => {
            const active = n === m;
            return (
              <text key={`m${n}`} x={px(n * 6, R_MIN)} y={py(n * 6, R_MIN)} dy="0.35em"
                textAnchor="middle" fontSize="14" fontFamily="var(--ff-mono, monospace)"
                fill={active ? numFill(true) : 'hsl(var(--ink))'} style={{ pointerEvents: 'none' }}>{pad(n)}</text>
            );
          })
        )}
      </svg>
      <div className="font-mono text-[0.58rem] tracking-wider uppercase text-ink-dim">
        {mode === 'h' ? 'Pick the hour · outer 0–11 · inner 12–23' : 'Pick the minute'}
      </div>
    </div>
  );
}
