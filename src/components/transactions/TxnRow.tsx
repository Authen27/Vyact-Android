import { Lock, Repeat, ArrowRightLeft, TrendingUp, Users, Pencil } from 'lucide-react';
import type { Transaction } from '../../types';
import { useStore } from '../../store';
import { getCat } from '../../constants';
import { formatDate, formatTime } from '../../lib/format';
import PaymentMethodChip from './PaymentMethodChip';
import Badge from '../ui/Badge';
import Money from '../ui/Money';

interface Props {
  txn: Transaction;
  showActions?: boolean;
  onEdit?: (t: Transaction) => void;
}

export default function TxnRow({ txn: t, showActions = false, onEdit }: Props) {
  const members = useStore(s => s.members);
  const dateFormat = useStore(s => s.profile.dateFormat || 'us');
  const baseCurrency = useStore(s => s.profile.baseCurrency);

  const cat = getCat(t.category);
  const member = members.find(m => m.id === t.memberId);
  const cur = t.currency || baseCurrency;
  const showCur = cur !== baseCurrency;
  const isInv   = t.type === 'investment';
  const isXfer  = t.type === 'transfer';
  const isSplit = t.split?.isSplit;

  const sign  = t.type === 'income' ? '+' : isInv ? '↗' : isXfer ? '⇄' : '−';
  const amtCls= t.type === 'income'  ? 'text-olive'
              : isInv               ? 'text-honey'
              : isXfer              ? 'text-denim'
              :                       'text-terra';

  const amount = isSplit ? t.split!.yourShare : t.amount;

  const wrapperBg = t.excluded ? 'opacity-65' : isInv ? 'bg-honey/[0.04]' : isXfer ? 'bg-denim/[0.03]' : '';
  const clickable = showActions && onEdit;

  return (
    <div
      data-testid="txn-row"
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onEdit!(t) : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit!(t); } } : undefined}
      className={`group relative flex items-center gap-2.5 px-4 py-2.5 border-b border-line last:border-b-0 hover:bg-coral-tint/40 transition-colors ${clickable ? 'cursor-pointer' : ''} ${wrapperBg}`}
    >
      <PaymentMethodChip id={t.paymentMethod} />
      <div
        className="w-[34px] h-[34px] rounded-md flex items-center justify-center text-base flex-shrink-0"
        style={{ background: cat.color + '22' }}
      >
        {cat.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[0.84rem] font-semibold text-ink truncate">{t.description}</div>
        <div className="font-mono text-[0.59rem] text-ink-dim mt-px">
          {cat.label} · {formatDate(t.date, dateFormat)}{t.time ? ` · ${formatTime(t.time)}` : ''}{t.note ? ' · ' + t.note : ''}
        </div>
      </div>
      <div className={`font-mono text-[0.86rem] font-medium whitespace-nowrap flex items-center gap-0.5 ${amtCls}`}>
        <span aria-hidden>{sign}</span>
        <Money amount={amount} currency={cur} maxChars={14} />
      </div>

      <div className="hidden sm:flex flex-col gap-0.5 items-end flex-shrink-0">
        {t.excluded && <Badge tone="neutral"><Lock size={10}/> Private</Badge>}
        {isInv      && <Badge tone="warn"><TrendingUp size={10}/> Invest</Badge>}
        {isXfer     && <Badge tone="denim"><ArrowRightLeft size={10}/> Transfer</Badge>}
        {isSplit    && <Badge tone="plum"><Users size={10}/> Split {t.split!.participants.length}</Badge>}
        {t.recurring && <Badge tone="warn"><Repeat size={10}/> {t.recurring}</Badge>}
        {member     && <Badge tone="denim">{member.name}</Badge>}
        {showCur    && <Badge tone="plum">{cur}</Badge>}
      </div>

      {/* Edit affordance overlays the right edge on hover instead of reserving a
          permanent column — otherwise every row showed a dead gutter (the icon
          kept its layout width at opacity-0) in both Transactions and Dashboard. */}
      {clickable && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit!(t); }}
          aria-label={`Edit ${t.description}`}
          title="Edit"
          className="row-action absolute right-2 top-1/2 -translate-y-1/2 !bg-bg2 shadow-sm opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
        >
          <Pencil size={14} strokeWidth={1.6} />
        </button>
      )}
    </div>
  );
}
