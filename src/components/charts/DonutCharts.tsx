import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { Link } from 'react-router-dom';
import { fmtShort, fmt } from '../../lib/format';
import { getCat } from '../../constants';

interface DonutEntry {
  catId: string;
  amount: number;
}

interface DonutProps {
  data: DonutEntry[];
  currency: string;
  /** When provided, each category row links to filtered Transactions. */
  monthKey?: string;
}

export function CategoryDonut({ data, currency, monthKey }: DonutProps) {
  if (!data.length) {
    return <div className="text-center py-9 text-ink-dim font-mono text-xs uppercase tracking-wider">No data</div>;
  }
  const total = data.reduce((sum, entry) => sum + entry.amount, 0);
  const enriched = data.map(entry => {
    const category = getCat(entry.catId);
    return { ...entry, name: `${category.icon} ${category.label}`, color: category.color };
  });

  return (
    <div className="grid md:grid-cols-[180px_1fr] gap-4 p-4 items-center">
      <div className="h-[180px] relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={enriched}
              dataKey="amount"
              cx="50%"
              cy="50%"
              innerRadius={52}
              outerRadius={78}
              paddingAngle={1}
              startAngle={90}
              endAngle={-270}
              isAnimationActive
            >
              {enriched.map((entry, index) => (
                <Cell key={index} fill={entry.color} stroke="hsl(var(--bg2))" strokeWidth={2} />
              ))}
            </Pie>
            <Tooltip formatter={(value: number) => fmt(value, currency)} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="num font-semibold text-[1.3rem] leading-none text-ink">{fmtShort(total, currency)}</div>
          <div className="font-mono text-[0.55rem] tracking-[0.14em] uppercase text-ink-dim mt-0.5">Total</div>
        </div>
      </div>
      <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
        {enriched.slice(0, 8).map(entry => {
          const pct = Math.round(entry.amount / total * 100);
          const row = (
            <div className="grid grid-cols-[10px_1fr_auto_auto] gap-2 items-center py-1 border-b border-line text-[0.74rem] text-ink-mid">
              <div className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
              <div className="font-medium text-ink truncate">{entry.name}</div>
              <div className="font-mono text-[0.68rem] text-ink">{fmtShort(entry.amount, currency)}</div>
              <div className="font-mono text-[0.6rem] text-ink-dim w-8 text-right">{pct}%</div>
            </div>
          );
          return monthKey ? (
            <Link key={entry.catId} to={`/transactions?type=expense&cat=${entry.catId}&month=${monthKey}`}
              className="block rounded-md hover:bg-bg3 transition-colors -mx-1 px-1">
              {row}
            </Link>
          ) : (
            <div key={entry.catId}>{row}</div>
          );
        })}
      </div>
    </div>
  );
}