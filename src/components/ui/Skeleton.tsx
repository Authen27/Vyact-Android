import type { CSSProperties } from 'react';

// Aurora 4.0 LD1 — skeletons in the page's own shape. While a household loads (or a page's code
// arrives) each screen shows grey blocks where its heroes, panels and rows will be, instead of a
// spinner or a blank page. Purely presentational; `aria-busy` + one status line for screen readers.

export function Sk({ w = '100%', h = 14, r = 8, className = '', style }: {
  w?: number | string; h?: number; r?: number; className?: string; style?: CSSProperties;
}) {
  return <span aria-hidden className={`sk ${className}`} style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

function HeroSkeleton() {
  return (
    <div className="card-raised p-[18px]">
      <Sk w="40%" h={10} />
      <Sk w="55%" h={26} style={{ marginTop: 12 }} />
      <Sk h={10} style={{ marginTop: 18 }} />
      <Sk w="80%" h={10} style={{ marginTop: 8 }} />
    </div>
  );
}

function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="panel p-4">
      <Sk w="45%" h={11} />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-2.5 items-center mt-4">
          <Sk w={34} h={34} r={12} />
          <div className="flex-1">
            <Sk w="70%" h={10} />
            <Sk w="40%" h={9} style={{ marginTop: 6 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export type SkeletonShape = 'dashboard' | 'list' | 'cards';

/** Which shape a route draws while it loads. */
export function shapeForPath(pathname: string): SkeletonShape {
  if (pathname.startsWith('/dashboard')) return 'dashboard';
  if (/^\/(budgets|debts|networth|accounts|splits|reports|insights)/.test(pathname)) return 'cards';
  return 'list';
}

export function PageSkeleton({ shape = 'list' }: { shape?: SkeletonShape }) {
  return (
    <div aria-busy="true" data-testid="page-skeleton" className="flex flex-col gap-section-content">
      <div className="hidden sm:block">
        <Sk w={320} h={30} />
        <Sk w={220} h={12} style={{ marginTop: 10 }} />
      </div>
      {shape === 'dashboard' && (
        <>
          <div className="grid sm:grid-cols-2 gap-section-content">
            <HeroSkeleton />
            <div className="hidden sm:block"><HeroSkeleton /></div>
          </div>
          <div className="grid lg:grid-cols-3 gap-section-content">
            <RowsSkeleton />
            <RowsSkeleton />
            <div className="hidden lg:block"><RowsSkeleton /></div>
          </div>
        </>
      )}
      {shape === 'cards' && (
        <>
          <HeroSkeleton />
          <div className="grid sm:grid-cols-2 gap-section-content">
            <RowsSkeleton rows={3} />
            <RowsSkeleton rows={3} />
          </div>
        </>
      )}
      {shape === 'list' && <RowsSkeleton rows={6} />}
      <p role="status" className="text-[12.5px] text-ink-dim text-center">Loading your household…</p>
    </div>
  );
}

/** The whole-screen form for the first load, before the app shell can render: a header bar
 *  placeholder over the page's own shape. */
export function AppSkeleton({ pathname }: { pathname: string }) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--canvas)' }}>
      <div className="h-[67px] border-b border-line hidden sm:flex items-center px-7 gap-4">
        <Sk w={96} h={22} r={11} />
        <Sk w={240} h={36} r={18} style={{ marginInline: 'auto' }} />
        <Sk w={36} h={36} r={18} />
      </div>
      <div className="sm:hidden flex items-center gap-2 px-4 pt-2.5 pb-3.5">
        <Sk w={30} h={30} r={15} />
        <div className="flex-1"><Sk w="40%" h={10} /><Sk w="60%" h={16} style={{ marginTop: 6 }} /></div>
        <Sk w={34} h={34} r={17} />
      </div>
      <div className="max-w-[1320px] mx-auto px-4 lg:px-7 py-5 lg:py-7">
        <PageSkeleton shape={shapeForPath(pathname)} />
      </div>
    </div>
  );
}
