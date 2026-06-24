// Vyact — dev-only fault diagnostics panel (TD-24).
//
// A floating, collapsible view over the `lib/faults` ring buffer. It surfaces
// the `unexpected` faults — dropped writes, contract violations, data corruption
// — that the offline-first `catch` paths now record instead of swallowing. It is
// mounted in App.tsx behind `import.meta.env.DEV`, so it never ships to prod.
import { useEffect, useState } from 'react';
import { getFaults, clearFaults, type FaultRecord } from '../../lib/faults';

export default function FaultsPanel() {
  const [faults, setFaults] = useState<readonly FaultRecord[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const tick = () => setFaults(getFaults().filter(f => f.kind === 'unexpected'));
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  if (!faults.length) return null;

  return (
    <div style={{ position: 'fixed', bottom: 12, right: 12, zIndex: 9999, fontSize: 12, fontFamily: 'monospace' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 6,
          padding: '4px 8px', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,.3)',
        }}
        title="Dev: unexpected faults (dropped writes / contract violations)"
      >
        ⚠ {faults.length} fault{faults.length === 1 ? '' : 's'}
      </button>
      {open && (
        <div style={{
          marginTop: 6, maxWidth: 360, maxHeight: 280, overflow: 'auto',
          background: '#1f2937', color: '#f3f4f6', borderRadius: 6, padding: 8,
          boxShadow: '0 2px 8px rgba(0,0,0,.4)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <strong>Unexpected faults</strong>
            <button onClick={() => { clearFaults(); setFaults([]); }} style={{ background: 'none', color: '#9ca3af', border: 'none', cursor: 'pointer' }}>clear</button>
          </div>
          {faults.slice().reverse().map((f, i) => (
            <div key={i} style={{ borderTop: '1px solid #374151', padding: '4px 0' }}>
              <div style={{ color: '#fca5a5' }}>{f.context}</div>
              <div style={{ color: '#d1d5db' }}>{f.message || '(no message)'}</div>
              <div style={{ color: '#6b7280' }}>{new Date(f.at).toLocaleTimeString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
