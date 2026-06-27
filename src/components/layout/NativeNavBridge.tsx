import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { consumePendingNav, consumePendingAction } from '../../lib/native';
import { useStore } from '../../store';

// Bridges native deep-links (notification taps, widget taps, widget "+" button)
// to React. Handles warm events and cold-start buffers. Renders nothing.
export default function NativeNavBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    const pendingRoute = consumePendingNav();
    if (pendingRoute) navigate(pendingRoute);
    if (consumePendingAction() === 'add-transaction') useStore.getState().openAddTxn();

    const onNav = (e: Event) => {
      const route = (e as CustomEvent<string>).detail;
      if (typeof route === 'string' && route.startsWith('/')) navigate(route);
    };
    const onAction = (e: Event) => {
      if ((e as CustomEvent<string>).detail === 'add-transaction') useStore.getState().openAddTxn();
    };
    window.addEventListener('vyact:navigate', onNav);
    window.addEventListener('vyact:action', onAction);
    return () => {
      window.removeEventListener('vyact:navigate', onNav);
      window.removeEventListener('vyact:action', onAction);
    };
  }, [navigate]);

  return null;
}
