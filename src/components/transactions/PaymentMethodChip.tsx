import { useStore } from '../../store';
import { resolveAccount } from '../../lib/accounts';

interface Props { id?: string; size?: number; }

// Resolves a transaction's stored account ref (cash / asset:<id> / debt:<id> /
// legacy PAYMENT_METHODS key) to a coloured badge.
export default function PaymentMethodChip({ id, size = 28 }: Props) {
  const assets = useStore(s => s.assets);
  const debts  = useStore(s => s.debts);
  if (!id) return null;
  const acct = resolveAccount(id, assets, debts);
  if (!acct) return null;
  return (
    <span
      title={acct.label}
      className="inline-flex items-center justify-center font-mono text-[0.62rem] font-bold flex-shrink-0 shadow-1"
      style={{
        width: size, height: size,
        borderRadius: 6,
        background: acct.color,
        color: '#fff',
        textShadow: '0 1px 1px rgba(0,0,0,.15)',
      }}
    >
      {acct.abbr}
    </span>
  );
}
