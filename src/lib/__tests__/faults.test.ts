import { describe, it, expect, beforeEach, vi } from 'vitest';
import { expected, unexpected, droppedWrite, getFaults, clearFaults, setFaultTransport } from '../faults';

// TD-24 — pins the fault taxonomy that replaced the silent `catch {}` blocks on
// the adapter / sync / persistence paths. The point of the module is that an
// unexpected fault (a dropped write / contract violation) is observable —
// exactly one structured record + one transport hand-off — while an expected
// degraded path (offline, cache miss) stays quiet and never escalates.

describe('faults — TD-24 fault taxonomy', () => {
  beforeEach(() => { clearFaults(); setFaultTransport(null); });

  it('CON-UNIT-069 · unexpected() records exactly one structured fault and forwards it to the transport once', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink = vi.fn();
    setFaultTransport(sink);
    unexpected(new Error('boom'), 'sync.flushQueue:test');
    const faults = getFaults();
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ kind: 'unexpected', context: 'sync.flushQueue:test', message: 'boom' });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toMatchObject({ kind: 'unexpected', context: 'sync.flushQueue:test' });
    vi.restoreAllMocks();
  });

  it('CON-UNIT-070 · expected() records a degraded fault but NEVER reaches the transport', () => {
    const sink = vi.fn();
    setFaultTransport(sink);
    expected(new Error('cache miss'), 'localAdapter.read:budgets');
    const faults = getFaults();
    expect(faults).toHaveLength(1);
    expect(faults[0]!.kind).toBe('expected');
    expect(sink).not.toHaveBeenCalled();
  });

  it('CON-UNIT-071 · droppedWrite() is always an unexpected fault so silent write-loss is observable', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    droppedWrite('sync.flushQueue', 'upsert budgets id=bad');
    const faults = getFaults();
    expect(faults).toHaveLength(1);
    expect(faults[0]!.kind).toBe('unexpected');
    expect(faults[0]!.message).toContain('dropped write');
    vi.restoreAllMocks();
  });
});
