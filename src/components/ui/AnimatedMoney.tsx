// Vyact — count-up money (v9.6.0). Animates the figure from its previous value
// to the new one (0 → value on first paint), then hands the number to <Money> so
// all the currency/compact formatting is unchanged. Settles EXACTLY on the real
// amount — no overshoot — and is an instant set under reduced-motion.
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import Money from './Money';

type Props = Omit<ComponentProps<typeof Money>, 'amount'> & {
  amount: number;
  /** Count-up duration in ms (first paint + on value change). */
  durationMs?: number;
};

export default function AnimatedMoney({ amount, durationMs = 750, ...money }: Props) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? amount : 0);
  const from = useRef(reduce ? amount : 0);

  useEffect(() => {
    if (reduce) { setDisplay(amount); from.current = amount; return; }
    const controls = animate(from.current, amount, {
      duration: durationMs / 1000,
      ease: [0.22, 0.61, 0.36, 1],
      onUpdate: v => setDisplay(v),
      onComplete: () => { from.current = amount; },
    });
    return () => { from.current = amount; controls.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, reduce]);

  return <Money amount={display} {...money} />;
}
