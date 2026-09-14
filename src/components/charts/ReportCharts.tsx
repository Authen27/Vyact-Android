import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtShort, fmt } from '../../lib/format';
import { getCat } from '../../constants';

const hsl = (name: string) => `hsl(var(--${name}))`;

interface PeriodPoint {
  label: string;
  income: number;
  expense: number;
  net: number;
}

interface ChartProps {
  data: PeriodPoint[];
  currency: string;
}

interface CategoryEntry {
  catId: string;
  amount: number;
}

interface CategoryChartProps {
  data: CategoryEntry[];
  currency: string;
}

export function IncomeExpenseArea({ data, currency }: ChartProps) {
  return (
    <div className="px-4 pt-4 pb-2 h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={hsl('sage')} stopOpacity={0.35} />
              <stop offset="100%" stopColor={hsl('sage')} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={hsl('terra')} stopOpacity={0.30} />
              <stop offset="100%" stopColor={hsl('terra')} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 3" stroke={hsl('line')} />
          <XAxis dataKey="label" stroke={hsl('ink-dim')} tick={{ fontSize: 10 }} />
          <YAxis
            stroke={hsl('ink-dim')}
            tick={{ fontSize: 10 }}
            tickFormatter={(value: number) => fmtShort(value, currency)}
            width={50}
          />
          <Tooltip formatter={(value: number, name: string) => [fmt(value, currency), name]} />
          <Legend iconType="circle" />
          <Area type="monotone" dataKey="income" name="Income" stroke={hsl('sage')} strokeWidth={2.2} fill="url(#incomeGrad)" isAnimationActive={false} />
          <Area type="monotone" dataKey="expense" name="Expense" stroke={hsl('terra')} strokeWidth={2.2} fill="url(#expenseGrad)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Tooltip that names the outcome instead of a bare "Net" — a consumer reads
// "Saved ₹X" / "Overspent ₹X" with the in/out split, not an ambiguous signed
// number (the old tooltip showed "Net: ₹0.00" for flat periods, which conveyed
// nothing). Recharts injects active/payload at render time.
function NetTooltip({ active, payload, currency }: {
  active?: boolean;
  payload?: { payload: PeriodPoint }[];
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const saved = p.net >= 0;
  const flat = p.income === 0 && p.expense === 0;
  return (
    <div className="rounded-md border border-line bg-bg2 px-3 py-2 shadow-2 text-[0.74rem]">
      <div className="font-semibold text-ink mb-0.5">{p.label}</div>
      {flat ? (
        <div className="text-ink-dim">No activity</div>
      ) : (
        <>
          <div className={saved ? 'text-sage' : 'text-terra'}>
            {saved ? 'Surplus' : 'Shortfall'} {fmt(Math.abs(p.net), currency)}
          </div>
          <div className="text-ink-dim font-mono text-[0.62rem] mt-0.5">
            +{fmtShort(p.income, currency)} in · −{fmtShort(p.expense, currency)} out
          </div>
        </>
      )}
    </div>
  );
}

// "Saved vs Overspent" per period. Reframed from the old unlabelled net-bar
// chart: a zero baseline makes surplus (sage, above) vs shortfall (terra, below)
// immediately legible, and the tooltip explains each bar in plain words.
export function NetBarChart({ data, currency }: ChartProps) {
  return (
    <div>
      <div className="flex items-center gap-3.5 px-4 pt-3 font-mono text-[0.58rem] tracking-wider uppercase text-ink-dim">
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: hsl('sage') }} /> Surplus</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: hsl('terra') }} /> Shortfall</span>
      </div>
      <div className="px-4 pt-1 pb-2 h-[210px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 3" stroke={hsl('line')} vertical={false} />
            <XAxis dataKey="label" stroke={hsl('ink-dim')} tick={{ fontSize: 10 }} />
            <YAxis
              stroke={hsl('ink-dim')}
              tick={{ fontSize: 10 }}
              tickFormatter={(value: number) => fmtShort(value, currency)}
              width={50}
            />
            <ReferenceLine y={0} stroke={hsl('ink-dim')} strokeWidth={1} />
            <Tooltip cursor={{ fill: 'hsl(var(--bg3))' }} content={<NetTooltip currency={currency} />} />
            <Bar dataKey="net" name="Net" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((entry, index) => (
                <Cell key={index} fill={entry.net >= 0 ? hsl('sage') : hsl('terra')} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function CategoryBars({ data, currency }: CategoryChartProps) {
  if (!data.length) {
    return <div className="text-center py-9 text-ink-dim font-mono text-xs uppercase tracking-wider">No data</div>;
  }
  const sorted = [...data].sort((left, right) => right.amount - left.amount).slice(0, 8);
  const max = sorted[0].amount;
  return (
    <div className="py-2">
      {sorted.map((entry, i) => {
        const category = getCat(entry.catId);
        const width = Math.round(entry.amount / max * 100);
        return (
          <div key={entry.catId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-2 border-b border-line last:border-b-0 min-w-0">
            <div className="text-sm text-ink-mid min-w-0 [overflow-wrap:anywhere]">
              {category.icon} {category.label}
            </div>
            <div className="bg-bg3 h-1.5 rounded-full overflow-hidden col-span-2 row-start-2">
              <div
                className="h-full rounded-full chart-grow transition-[width] duration-500"
                style={{ width: `${width}%`, background: category.color, animationDelay: `${i * 60}ms` }}
              />
            </div>
            <div className="font-mono text-xs text-ink-mid text-right" title={fmt(entry.amount, currency)}>{fmtShort(entry.amount, currency)}</div>
          </div>
        );
      })}
    </div>
  );
}

interface BudgetActualPoint {
  label: string;
  budgeted: number;
  actual: number;
  status: 'under' | 'on' | 'over' | 'in-progress';
}

// v10.31.0 — monthly budget vs actual (lib/budgetTrends.ts). Actual bars are
// sage when within budget, terra when over, and honey while the month is still
// in progress (never judged over or under).
export function BudgetActualBars({ data, currency }: { data: BudgetActualPoint[]; currency: string }) {
  // An explicit key instead of the Recharts legend: the Actual bars take three
  // colours by status, and a single legend swatch would misstate two of them.
  const key: [string, string][] = [
    ['Budgeted', hsl('denim')], ['Actual · within', hsl('sage')], ['Actual · over', hsl('terra')], ['Actual · in progress', hsl('honey')],
  ];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-4 pt-3 font-mono text-[0.58rem] tracking-wider uppercase text-ink-dim">
        {key.map(([label, colour]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: colour }} aria-hidden /> {label}
          </span>
        ))}
      </div>
    <div className="px-4 pt-2 pb-2 h-[230px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 3" stroke={hsl('line')} vertical={false} />
          <XAxis dataKey="label" stroke={hsl('ink-dim')} tick={{ fontSize: 10 }} />
          <YAxis
            stroke={hsl('ink-dim')}
            tick={{ fontSize: 10 }}
            tickFormatter={(value: number) => fmtShort(value, currency)}
            width={50}
          />
          <Tooltip cursor={{ fill: 'hsl(var(--bg3))' }} formatter={(value: number, name: string) => [fmt(value, currency), name]} />
          <Bar dataKey="budgeted" name="Budgeted" fill={hsl('denim')} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="actual" name="Actual" fill={hsl('sage')} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((entry, index) => (
              <Cell key={index} fill={entry.status === 'over' ? hsl('terra') : entry.status === 'in-progress' ? hsl('honey') : hsl('sage')} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
    </div>
  );
}

interface NetWorthPoint {
  label: string;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
}

// v10.30.0 — recorded monthly Net Worth snapshots. Each point is a stored
// record (lib/netWorthSnapshots.ts); nothing between points is interpolated as
// data — the line only joins recorded months.
export function NetWorthHistoryChart({ data, currency }: { data: NetWorthPoint[]; currency: string }) {
  return (
    <div className="px-4 pt-4 pb-2 h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="netWorthGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={hsl('denim')} stopOpacity={0.3} />
              <stop offset="100%" stopColor={hsl('denim')} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 3" stroke={hsl('line')} />
          <XAxis dataKey="label" stroke={hsl('ink-dim')} tick={{ fontSize: 10 }} />
          <YAxis
            stroke={hsl('ink-dim')}
            tick={{ fontSize: 10 }}
            tickFormatter={(value: number) => fmtShort(value, currency)}
            width={56}
          />
          <ReferenceLine y={0} stroke={hsl('ink-dim')} strokeWidth={1} />
          <Tooltip formatter={(value: number, name: string) => [fmt(value, currency), name]} />
          <Legend iconType="circle" />
          <Area type="monotone" dataKey="netWorth" name="Net worth" stroke={hsl('denim')} strokeWidth={2.2} fill="url(#netWorthGrad)" dot isAnimationActive={false} />
          <Area type="monotone" dataKey="totalAssets" name="Assets" stroke={hsl('sage')} strokeWidth={1.4} fill="none" isAnimationActive={false} />
          <Area type="monotone" dataKey="totalLiabilities" name="Liabilities" stroke={hsl('terra')} strokeWidth={1.4} fill="none" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}