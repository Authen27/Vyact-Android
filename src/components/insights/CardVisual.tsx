// Vyact — evergreen card visuals, rendered from code (Insights Hub §4.2, v9.5.3).
//
// Zero hosted images: every card's visual is one of four zero-asset techniques —
// a themed Lucide icon, a big-number "stat hero", or a tiny inline SVG primitive
// (stack / bar2 / arc / arrow / compare2). All theme-aware via CSS vars, so they
// follow Paper Warm / Dark automatically.
import {
  AlertTriangle, Baby, BarChart3, Briefcase, CalendarCheck, CalendarClock,
  CalendarDays, CalendarRange, CalendarX, CheckCircle, CircleDot, Clock, Coffee,
  Coins, Compass, Droplet, Equal, Eye, FileText, Footprints, Gift, GraduationCap,
  Heart, HeartPulse, Home, Hourglass, KeyRound, Landmark, LayoutGrid, Map, PenLine,
  Percent, PiggyBank, Plane, Receipt, RefreshCcw, RefreshCw, Repeat, RotateCcw,
  Search, Shield, ShieldAlert, ShieldCheck, Smartphone, Smile, Sparkles, Sunrise,
  Tag, Tags, Target, TrendingDown, Umbrella, UserCheck, Users, Wallet, Wind, Zap,
  type LucideIcon,
} from 'lucide-react';
import type { EvergreenCard, StatRef, StackRef, Bar2Ref, ArcRef, ArrowRef, Compare2Ref } from '../../lib/evergreen';

const ICONS: Record<string, LucideIcon> = {
  AlertTriangle, Baby, BarChart3, Briefcase, CalendarCheck, CalendarClock,
  CalendarDays, CalendarRange, CalendarX, CheckCircle, CircleDot, Clock, Coffee,
  Coins, Compass, Droplet, Equal, Eye, FileText, Footprints, Gift, GraduationCap,
  Heart, HeartPulse, Home, Hourglass, KeyRound, Landmark, LayoutGrid, Map, PenLine,
  Percent, PiggyBank, Plane, Receipt, RefreshCcw, RefreshCw, Repeat, RotateCcw,
  Search, Shield, ShieldAlert, ShieldCheck, Smartphone, Smile, Sparkles, Sunrise,
  Tag, Tags, Target, TrendingDown, Umbrella, UserCheck, Users, Wallet, Wind, Zap,
};

// A small accent palette cycled by the diagram primitives.
const PALETTE = ['sage', 'coral', 'honey', 'denim', 'plum', 'terra'];
const hsl = (name: string, a = 1) => `hsl(var(--${name}) / ${a})`;

interface Props { card: EvergreenCard; className?: string }

/** The visual block at the top of every evergreen card. Height is fixed so a
 *  grid of mixed visual kinds stays tidy. */
export default function CardVisual({ card, className = '' }: Props) {
  return (
    <div className={`relative flex items-center justify-center overflow-hidden rounded-lg bg-bg3 ${className}`}>
      {render(card)}
    </div>
  );
}

function render(card: EvergreenCard) {
  switch (card.visual_kind) {
    case 'icon':    return <IconHero name={card.visual_ref as string} />;
    case 'stat':    return <StatHero ref_={card.visual_ref as StatRef} />;
    case 'diagram': {
      const r = card.visual_ref as StackRef | Bar2Ref;
      return r.primitive === 'bar2' ? <Bar2 ref_={r} /> : <Stack ref_={r as StackRef} />;
    }
    case 'arc':     return <Arc ref_={card.visual_ref as ArcRef} />;
    case 'arrow':   return <Arrow ref_={card.visual_ref as ArrowRef} />;
    case 'compare2':return <Compare2 ref_={card.visual_ref as Compare2Ref} />;
    default:        return <IconHero name="Sparkles" />;
  }
}

function IconHero({ name }: { name: string }) {
  const Icon = ICONS[name] ?? Sparkles;
  return (
    <div className="flex items-center justify-center w-full h-full">
      <span className="flex items-center justify-center w-14 h-14 rounded-full bg-coral-tint">
        <Icon size={26} strokeWidth={1.6} className="text-coral" />
      </span>
    </div>
  );
}

function StatHero({ ref_ }: { ref_: StatRef }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-3">
      <div className="num text-[1.6rem] leading-none font-semibold text-ink">{ref_.big}</div>
      {ref_.sub && <div className="text-[0.72rem] text-ink-mid mt-1.5">{ref_.sub}</div>}
    </div>
  );
}

function Stack({ ref_ }: { ref_: StackRef }) {
  const total = ref_.parts.reduce((s, [, v]) => s + v, 0) || 1;
  return (
    <div className="w-full px-4">
      <div className="flex h-5 w-full overflow-hidden rounded-full">
        {ref_.parts.map(([, v], i) => (
          <div key={i} style={{ width: `${(v / total) * 100}%`, background: hsl(PALETTE[i % PALETTE.length]) }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-0.5">
        {ref_.parts.map(([label, v], i) => (
          <span key={i} className="flex items-center gap-1 text-[0.62rem] text-ink-mid">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: hsl(PALETTE[i % PALETTE.length]) }} />
            {label} {v}
          </span>
        ))}
      </div>
    </div>
  );
}

function Bar2({ ref_ }: { ref_: Bar2Ref }) {
  const max = Math.max(ref_.a[1], ref_.b[1]) || 100;
  const bar = ([label, v]: [string, number], i: number) => (
    <div className="flex flex-col items-center justify-end gap-1 h-full">
      <div className="w-9 rounded-t" style={{ height: `${(v / max) * 64}px`, minHeight: 6, background: hsl(PALETTE[i % PALETTE.length]) }} />
      <span className="text-[0.6rem] text-ink-mid text-center max-w-[64px] leading-tight">{label}</span>
    </div>
  );
  return <div className="flex items-end gap-5 h-[88px] pb-1">{bar(ref_.a, 0)}{bar(ref_.b, 1)}</div>;
}

function Arc({ ref_ }: { ref_: ArcRef }) {
  const pct = Math.max(0, Math.min(100, ref_.pct));
  const r = 30, c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center justify-center">
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} fill="none" stroke={hsl('line')} strokeWidth="8" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={hsl('coral')} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform="rotate(-90 40 40)" />
        <text x="40" y="45" textAnchor="middle" className="num" fontSize="15" fill={hsl('ink')} fontWeight="600">{pct}%</text>
      </svg>
      {ref_.label && <div className="text-[0.62rem] text-ink-mid mt-0.5">{ref_.label}</div>}
    </div>
  );
}

function Arrow({ ref_ }: { ref_: ArrowRef }) {
  const up = ref_.dir === 'up';
  const color = up ? 'sage' : 'terra';
  return (
    <div className="flex flex-col items-center justify-center px-3">
      <svg width="48" height="48" viewBox="0 0 48 48" style={{ transform: up ? 'none' : 'scaleY(-1)' }}>
        <path d="M24 40 L24 12 M14 22 L24 12 L34 22" fill="none" stroke={hsl(color)} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {ref_.label && <div className="text-[0.62rem] text-ink-mid mt-1 text-center max-w-[140px]">{ref_.label}</div>}
    </div>
  );
}

function Compare2({ ref_ }: { ref_: Compare2Ref }) {
  const box = (label: string, i: number) => (
    <div className="flex-1 flex items-center justify-center rounded-md px-2 py-3 text-[0.66rem] font-medium text-center min-w-0"
      style={{ background: hsl(PALETTE[i % PALETTE.length], 0.12), color: hsl(PALETTE[i % PALETTE.length]) }}>
      {label}
    </div>
  );
  return (
    <div className="flex items-center gap-2 w-full px-4">
      {box(ref_.a, 0)}
      <span className="text-[0.6rem] font-mono text-ink-dim">vs</span>
      {box(ref_.b, 3)}
    </div>
  );
}
