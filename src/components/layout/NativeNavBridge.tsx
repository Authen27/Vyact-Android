import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { consumePendingNav } from '../../lib/native';

// Bridges native notification taps to React Router. A tap dispatches a
// 'vyact:navigate' event (warm start) and/or buffers a pending route (cold
// start); this routes either to the right view. Renders nothing.
export default function NativeNavBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    const pending = consumePendingNav();
    if (pending) navigate(pending);

    const onNav = (e: Event) => {
      const route = (e as CustomEvent<string>).detail;
      if (typeof route === 'string' && route.startsWith('/')) navigate(route);
    };
    window.addEventListener('vyact:navigate', onNav);
    return () => window.removeEventListener('vyact:navigate', onNav);
  }, [navigate]);

  return null;
}
